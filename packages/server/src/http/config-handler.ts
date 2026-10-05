/**
 * @cortex/server — Config Handler (HTTP)
 *
 * 只读暴露引擎真正加载的配置域，供 desktop「设置」面板显示真实值（替换其硬编码 mock）。
 *   GET /api/v1/config            → 全部域概览（name/fileName/required/present/topKeys）+ 解析出的真实 dir
 *   GET /api/v1/config?domain=X   → 单个域的完整 JSON
 *
 * 关键：配置目录一律来自 resolveConfigDataDir()（引擎实际读取处），**绝不硬编码路径**；
 * 且把解析出的 dir 回带进响应，便于核对「读的就是这一份」——避免桌面写到引擎不读的孤儿路径。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync, writeFileSync, renameSync, copyFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DOMAINS, resolveConfigDataDir } from "@cortex/config";
import { sendJson, sendProblem, readBody } from "./router.js";

/** 读并解析某域文件；不存在或解析失败返回 undefined。 */
function readDomain(dir: string, fileName: string): unknown {
  const fp = join(dir, fileName);
  if (!existsSync(fp)) return undefined;
  try {
    return JSON.parse(readFileSync(fp, "utf-8")) as unknown;
  } catch {
    return undefined;
  }
}

export function handleConfigGet(req: IncomingMessage, res: ServerResponse): void {
  try {
    const dir = resolveConfigDataDir();
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const domainName = url.searchParams.get("domain");

    if (domainName) {
      const d = CONFIG_DOMAINS.find((x) => x.name === domainName);
      if (!d) {
        sendProblem(res, 404, "Not Found", `未知配置域: ${domainName}`);
        return;
      }
      const value = readDomain(dir, d.fileName);
      sendJson(res, 200, {
        data: { domain: domainName, file: join(dir, d.fileName), present: value !== undefined, value: value ?? null },
      });
      return;
    }

    const domains = CONFIG_DOMAINS.map((d) => {
      const value = readDomain(dir, d.fileName);
      const topKeys =
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.keys(value as Record<string, unknown>)
          : [];
      return { name: d.name, fileName: d.fileName, required: d.required, present: value !== undefined, topKeys };
    });
    sendJson(res, 200, { data: { dir, count: domains.length, domains } });
  } catch (e) {
    sendProblem(res, 500, "Config Error", `读取配置失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 只在「已存在的 scalar 叶」上写值：路径每一段必须已存在、末端必须是 scalar（非对象/数组）。
 *  返回 null 表示成功；否则返回拒绝原因。按 prev 类型强转 value（number/boolean），其余按字符串存。 */
function deepSetScalar(
  root: Record<string, unknown>,
  path: Array<string | number>,
  value: unknown,
): string | null {
  let cur: unknown = root;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i] as string | number;
    if (cur === null || typeof cur !== "object") return `路径第 ${i} 段的父节点不存在或不是对象/数组`;
    if (!(k in (cur as Record<string, unknown>))) return `路径段 "${String(k)}" 不存在——拒绝创建新键`;
    cur = (cur as Record<string, unknown>)[k as string];
  }
  const last = path[path.length - 1] as string | number;
  if (cur === null || typeof cur !== "object") return "父节点不是对象/数组";
  if (!(last in (cur as Record<string, unknown>))) return `键 "${String(last)}" 不存在——拒绝创建新键`;
  const prev = (cur as Record<string, unknown>)[last as string];
  if (prev !== null && typeof prev === "object") return "该键的值是对象/数组——不支持整体覆写，请编辑其内部标量项";
  let coerced: unknown;
  if (typeof prev === "number") {
    const n = typeof value === "number" ? value : Number(String(value));
    if (!Number.isFinite(n)) return `期望数字，收到无法解析的值: ${String(value)}`;
    coerced = n;
  } else if (typeof prev === "boolean") {
    coerced = value === true || String(value) === "true";
  } else {
    coerced = value === null ? null : String(value);
  }
  (cur as Record<string, unknown>)[last as string] = coerced;
  return null;
}

/** 原子写：先备份 .bak，再写临时文件并 rename 覆盖；对瞬时 EPERM/EACCES/EBUSY 退避重试（Windows 防护）。 */
function atomicWriteRetry(fp: string, data: string, tries = 5): void {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      if (existsSync(fp)) {
        try { copyFileSync(fp, `${fp}.bak`); } catch { /* 备份失败不阻断主写 */ }
      }
      const tmp = `${fp}.tmp-${process.pid}`;
      writeFileSync(tmp, data, "utf-8");
      renameSync(tmp, fp);
      return;
    } catch (e) {
      lastErr = e;
      const code = (e as NodeJS.ErrnoException).code;
      const transient = code === "EPERM" || code === "EACCES" || code === "EBUSY";
      if (transient && i < tries - 1) {
        const t = Date.now() + 60 * (i + 1);
        while (Date.now() < t) { /* 忙等退避（同步上下文） */ }
        continue;
      }
      break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * POST /api/v1/config  body = { domain, path: (string|number)[], value }
 * 把设置面板编辑的标量值写回引擎实际读取的配置域文件（resolveConfigDataDir），非孤儿路径。
 */
export async function handleConfigSet(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const dir = resolveConfigDataDir();
    const raw = await readBody(req, res);
    let body: { domain?: unknown; path?: unknown; value?: unknown };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      sendProblem(res, 422, "Validation Error", "请求体必须为 JSON");
      return;
    }

    const domainName = typeof body.domain === "string" ? body.domain : "";
    if (!domainName) {
      sendProblem(res, 422, "Validation Error", "domain 必填");
      return;
    }
    const d = CONFIG_DOMAINS.find((x) => x.name === domainName);
    if (!d) {
      sendProblem(res, 404, "Not Found", `未知配置域: ${domainName}`);
      return;
    }
    const path = Array.isArray(body.path) ? body.path.filter((p) => typeof p === "string" || typeof p === "number") : [];
    if (path.length === 0) {
      sendProblem(res, 422, "Validation Error", "path 至少一段");
      return;
    }

    const fp = join(dir, d.fileName);
    if (!existsSync(fp)) {
      sendProblem(res, 409, "Conflict", `配置域文件不存在: ${fp}`);
      return;
    }
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(fp, "utf-8")) as unknown;
    } catch (e) {
      sendProblem(res, 500, "Parse Error", `目标文件解析失败，拒绝写入: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      sendProblem(res, 409, "Conflict", "配置域根不是对象");
      return;
    }

    const reject = deepSetScalar(doc as Record<string, unknown>, path, body.value);
    if (reject) {
      sendProblem(res, 400, "Bad Request", `拒绝写入：${reject}`);
      return;
    }

    try {
      atomicWriteRetry(fp, JSON.stringify(doc, null, 2) + "\n");
    } catch (e) {
      sendProblem(res, 500, "Write Error", `写回失败: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    // 回带真实 dir + 落盘后的该域新值，供客户端核对「写的就是引擎读的这份」
    const after = readDomain(dir, d.fileName);
    sendJson(res, 200, {
      data: { domain: domainName, file: fp, dir, present: after !== undefined, value: after ?? null, reloaded: false },
    });
  } catch (e) {
    sendProblem(res, 500, "Config Error", `写回配置失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}
