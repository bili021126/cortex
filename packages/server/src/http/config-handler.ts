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
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DOMAINS, resolveConfigDataDir } from "@cortex/config";
import { sendJson, sendProblem } from "./router.js";

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
