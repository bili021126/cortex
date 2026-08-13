// @ci: contract
/**
 * 契约守护：client 方法面 ⊆ daemon 路由面 ∪ 能力面守卫（D2 防裂口复发）
 *
 * 读取两端源码（不 import——避免跨包依赖），断言：
 *  1. client 每个 REST 路径要么有 server 路由覆盖，要么在能力面守卫域映射中
 *  2. server 路由与 capabilities 声明一致（api 键 ↔ 路由存在性）
 *
 * 任何新增 client 方法必须二选一：有 server 路由，或有 _assertSupported 守卫。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const clientSrc = readFileSync(new URL("../src/http-client.ts", import.meta.url), "utf8");
const serverSrc = readFileSync(new URL("../../server/src/http/router.ts", import.meta.url), "utf8");

/** client 方法面：REST 调用路径——双引号完整路径 + 反引号模板静态前缀 */
const clientPaths = [
  ...[...clientSrc.matchAll(/"(\/api\/v1\/[^"]*)"/g)].map((m) => m[1]),
  ...[...clientSrc.matchAll(/`(\/api\/v1\/[^`${]*)/g)].map((m) => m[1]),
];

/** server 静态路由 */
const serverStatic = [...serverSrc.matchAll(/path === "(\/api\/v1\/[^"]*)"/g)].map((m) => m[1]);

/** server 前缀路由（:id 形态） */
const serverPrefix = [...serverSrc.matchAll(/path\.startsWith\("(\/api\/v1\/[^"]*)"\)/g)].map((m) => m[1]);

/** D2 能力面守卫域映射——与 http-client.ts 的 _assertSupported 调用一一对应 */
const guardedDomains: Record<string, string> = {
  "/api/v1/events": "events",
  "/api/v1/models": "models",
  "/api/v1/agents/": "agents-patch",
  "/api/v1/keys": "keys",
  "/api/v1/tuning": "tuning",
  "/api/v1/config/": "config",
};

/** 归一化：/api/v1/nodes/${encodeURIComponent(id)} → 静态前缀；/api/v1/memory?${params} → 去 query */
const staticPrefix = (p: string): string => (p.split("${")[0] ?? p).replace(/[?#].*$/, "");

describe("契约守护：client 方法面 ⊆ server 路由 ∪ 能力面守卫", () => {
  for (const p of clientPaths) {
    it(`client 路径 ${p} 有路由或守卫覆盖`, () => {
      const prefix = staticPrefix(p);
      const hasServerRoute =
        serverStatic.includes(prefix) || serverPrefix.some((s) => prefix.startsWith(s));
      const hasGuard = Object.keys(guardedDomains).some((g) => prefix.startsWith(g));
      expect(hasServerRoute || hasGuard, `${p} 无 server 路由且无能力面守卫——需补路由或加 _assertSupported`).toBe(true);
    });
  }
});

describe("契约守护：server 路由面与 capabilities 声明一致", () => {
  it("声明为 true 的域必须有对应路由", () => {
    // capabilities.handleCapabilities 中 api 键（router.ts 源码内）
    const capsBlock = serverSrc.match(/api:\s*\{[\s\S]*?\}/)?.[0] ?? "";
    const trueDomains = [...capsBlock.matchAll(/(\w+): true/g)].map((m) => m[1]);
    const falseDomains = [...capsBlock.matchAll(/(\w+): false/g)].map((m) => m[1]);

    const routeFor = (domain: string): boolean => {
      // 域键 → 路由前缀映射（daemonHealth 与路径命名不一致，需特例）
      const byPath = (p: string) =>
        domain === "daemonHealth"
          ? p.startsWith("/api/v1/daemon/health")
          : p.startsWith(`/api/v1/${domain}`);
      return serverStatic.some(byPath) || serverPrefix.some(byPath);
    };

    for (const d of trueDomains) {
      expect(routeFor(d), `capabilities.api.${d} 声明 true 但无对应路由`).toBe(true);
    }
    for (const d of falseDomains) {
      expect(routeFor(d), `capabilities.api.${d} 声明 false 但存在对应路由（声明过时）`).toBe(false);
    }
  });
});
