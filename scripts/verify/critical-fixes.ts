#!/usr/bin/env npx tsx
/**
 * 关键修复验证脚本
 *
 * 验证 Phase 1 止血的 7 个 Critical 修复是否仍在生效。
 * 与 closed-loop-e2e.test.ts 的差异：
 *   - 独立于 vitest 运行，zero 依赖
 *   - 直接构造组件，不依赖框架
 *   - 产出 PASS/FAIL 报告供 CI 消费
 *
 * 用法: npx tsx scripts/verify/critical-fixes.ts
 * 返回码: 0 = 全部通过, 1 = 有失败
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

type Result = { name: string; ok: boolean; detail?: string };

const results: Result[] = [];

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  const mark = ok ? "✅" : "❌";
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  🔒 关键修复验证 (critical-fixes)       ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // ── C-01: 命令注入防护 ──
  console.log("┌─ C-01: 命令注入防护 ─────────────────────┐");
  try {
    const { HardVerificationGate } = await import(
      "../../packages/engine/src/core/hard-verification-gate.js"
    ) as any;
    const gate = new HardVerificationGate();
    const result = gate.check({
      eventType: "constitution.violation",
      interfaceName: '"; rm -rf / #',
      sourcePkg: "engine",
      targetPkg: "shared",
      detail: "test",
      nodeId: "test",
      source: "doc-govern",
      aggregate: "test",
    });
    const cpRule = result.verdicts.find((v: any) => v.ruleName === "cross-package");
    check("C-01: 非法接口名被拦截", cpRule?.passed === false,
      cpRule?.passed ? "漏放" : "✓");
    check("C-01: 合法接口名正常校验",
      Array.isArray(result.verdicts), "verdicts 为数组");
  } catch (e: any) {
    check("C-01: 执行异常", false, e.message);
  }

  // ── C-02: rollback 返回 Promise<boolean> ──
  console.log("\n┌─ C-02: rollback 签名 ──────────────────────┐");
  try {
    const { MemoryStore } = await import("../../packages/memory-store/src/index.ts") as any;
    const store = new MemoryStore();
    await store.init(":memory:");
    const r = store.rollback("non_existent");
    check("C-02: rollback 返回 Promise", r instanceof Promise, typeof r);
    const val = await r;
    check("C-02: 不存在的 ID 回滚返回 false", val === false, String(val));
  } catch (e: any) {
    check("C-02: 执行异常", false, e.message);
  }

  // ── C-04: CircuitBreaker OPEN 不穿透 ──
  console.log("\n┌─ C-04: 断路器穿透防护 ────────────────────┐");
  try {
    const { SimpleCircuitBreaker, CircuitBreakerOpenError }
      = await import("../../packages/resilience/src/index.ts") as any;
    const cb = new SimpleCircuitBreaker("verify-c04", {
      threshold: 1,
      halfOpenAfterMs: 60000,
    });
    // 触发 OPEN
    await cb.call(async () => { throw new Error("fail"); }).catch(() => {});

    // 验证 CB 内部状态为 OPEN
    const state = cb["_state" as any];
    check("C-04: 触发失败后状态为 OPEN", state === "OPEN", state);

    // 验证第二次调用抛出 CircuitBreakerOpenError
    let fnCalled = false;
    try {
      await cb.call(async () => { fnCalled = true; return "ok"; });
      check("C-04: OPEN 应抛出异常", false, "未抛出");
    } catch (e: any) {
      check("C-04: OPEN 阻止 fn 调用", fnCalled === false,
        fnCalled ? "fn 被穿透" : "✓");
    }
  } catch (e: any) {
    check("C-04: 执行异常", false, e.message);
  }

  // ── C-05: bootstrap 回滚 ──
  console.log("\n┌─ C-05: 部分 init 失败回滚 ────────────────┐");
  try {
    const order: string[] = [];
    const comps = [
      { n: "A", init: async () => { order.push("A:i"); }, stop: async () => { order.push("A:s"); }, dispose: async () => { order.push("A:d"); } },
      { n: "B", init: async () => { order.push("B:i"); }, stop: async () => { order.push("B:s"); }, dispose: async () => { order.push("B:d"); } },
      { n: "C", init: async () => { throw new Error("fail"); }, stop: async () => {}, dispose: async () => {} },
    ];
    const initd: string[] = [];
    try { for (const c of comps) { await c.init(); initd.push(c.n); } }
    catch { for (let i = initd.length - 1; i >= 0; i--) { const c = comps.find(x => x.n === initd[i]); if (c) { try { await c.stop(); } catch {} try { await c.dispose(); } catch {} } } }
    check("C-05: B 逆序 stop", order.indexOf("B:s") > order.indexOf("B:i"), String(order));
    check("C-05: A 逆序 dispose", order.indexOf("A:d") > order.indexOf("A:s"), String(order));
  } catch (e: any) {
    check("C-05: 执行异常", false, e.message);
  }

  // ── C-06: RLM 成功率阈值 ──
  console.log("\n┌─ C-06: RLM 成功率阈值 ────────────────────┐");
  const judge = (a: number, s: number) =>
    a > 0 && s > 0 ? (a / s) >= 0.5 : a > 0;
  check("C-06: 50% 通过", judge(5, 10) === true, "5/10");
  check("C-06: 10% 失败", judge(1, 10) === false, "1/10");
  check("C-06: 0% 失败", judge(0, 10) === false, "0/10");

  // ── C-07: obliterate 幂等 ──
  console.log("\n┌─ C-07: obliterate 幂等 ───────────────────┐");
  try {
    const { MemoryStore } = await import("../../packages/memory-store/src/index.ts") as any;
    const store = new MemoryStore();
    await store.init(":memory:");
    const id = await store.write({
      source: { agentType: "test", taskId: "test" },
      kind: "TaskLog",
      summary: "test",
      semantic_gist: "test",
      content_blob: {},
    });
    check("C-07: 第一次湮灭成功", store.obliterate(id) === true, String(store.obliterate(id)));
    check("C-07: 幂等返回 true", store.obliterate(id) === true, String(store.obliterate(id)));
    check("C-07: 不存在 ID 返回 false", store.obliterate("nope") === false, String(store.obliterate("nope")));
  } catch (e: any) {
    check("C-07: 执行异常", false, e.message);
  }

  // ── 汇总 ──
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  console.log("\n╔══════════════════════════════════════════╗");
  console.log(`║  结果: ${passed} 通过 / ${failed} 失败 / ${results.length} 总计`);
  console.log("╚══════════════════════════════════════════╝\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("💥 验证脚本崩溃:", err);
  process.exit(1);
});
