// @ci: contract
/**
 * API 契约守护：`PACKAGE_POSITIONING.md` 的端点表 ↔ `router.ts` 的真实路由
 *
 * 背景（2026-09-26）：该表此前记「8 个端点、@cortex/cli 承载」，两处都不实——
 * 承载方是 @cortex/server；真实 18 条；原表 2 条不存在（GET /agents/:type、
 * GET /api/v1/events），且漏列 12 条。手写表格没人比对，必然腐坏。
 *
 * 本测试把两边读成文本再逐条**双向**比对（不 import——避免跨包依赖，
 * 与 client/tests/contract-gap.test.ts 同风格）：
 *   ① 表里每一条都必须有对应路由；
 *   ② 路由表里每一条都必须在表里出现。
 *
 * 于是任何一侧单独改动（加路由不改文档、或文档写了没实现的东西）都会红。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const docSrc = readFileSync(new URL("../../../PACKAGE_POSITIONING.md", import.meta.url), "utf8");
const routerSrc = readFileSync(new URL("../src/http/router.ts", import.meta.url), "utf8");

// ── 文档侧：端点表 ───────────────────────────────────────────
// 只取「RESTful API 契约」到下一个 `## ` 之间的表格，避免把文末规范表也当端点
const section = (docSrc.split("## RESTful API 契约")[1] ?? "").split(/\n## /)[0] ?? "";

/** METHOD + 归一化路径（把 `/:id` 折成前缀形态，好与前缀路由对账） */
function canonical(method: string, p: string): string {
  return `${method.toUpperCase()} ${p.replace(/\/:id$/, "/")}`;
}

const docRows = [...section.matchAll(/^\|\s*`(\/api\/v1\/[^`]*)`\s*\|\s*([A-Z]+)\s*\|/gm)].map((m) => {
  const path = m[1];
  const method = m[2];
  if (path === undefined || method === undefined) throw new Error("端点表行解析失败");
  return canonical(method, path);
});

// ── 路由侧：router.ts 的静态路由与前缀路由 ────────────────────
function routePairs(re: RegExp): string[] {
  return [...routerSrc.matchAll(re)].flatMap((m) => {
    const method = m[1];
    const path = m[2];
    if (method === undefined || path === undefined) return [];
    return [canonical(method, path)];
  });
}

const routerRoutes = [
  ...routePairs(/if \(method === "([A-Z]+)" && path === "(\/api\/v1\/[^"]*)"\)/g),
  ...routePairs(/if \(method === "([A-Z]+)" && path\.startsWith\("(\/api\/v1\/[^"]*)"\)\)/g),
];

const docSet = new Set(docRows);
const routerSet = new Set(routerRoutes);

describe("API 契约：PACKAGE_POSITIONING 端点表 ↔ router.ts", () => {
  it("两侧都解析出了内容（防解析器静默失效导致空对空通过）", () => {
    expect(docRows.length, "文档端点表解析为空——正则或文档结构变了").toBeGreaterThan(10);
    expect(routerRoutes.length, "router 路由解析为空——正则或 router 结构变了").toBeGreaterThan(10);
  });

  it("文档里每条端点都有真实路由（防文档写了没实现的东西）", () => {
    const missing = [...docSet].filter((r) => !routerSet.has(r)).sort();
    expect(missing, `文档声明但 router.ts 无此路由: ${missing.join(", ")}`).toEqual([]);
  });

  it("router.ts 每条路由都记进了文档（防新增路由不更新文档）", () => {
    const undocumented = [...routerSet].filter((r) => !docSet.has(r)).sort();
    expect(undocumented, `router.ts 有但文档未记: ${undocumented.join(", ")}`).toEqual([]);
  });
});
