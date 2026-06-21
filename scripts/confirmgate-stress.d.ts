/**
 * ConfirmGate 压力测试 — 验证确认门机制的完整性
 *
 * 测试维度:
 *   T1: 单元测试 — ConfirmGate 基本机制
 *   T2: 单元测试 — Toolkit 的 ConfirmGate 拦截
 *   T3: 集成测试 — bootstrapEngine 是否将 gate 注入 Toolkit ⚠️ 关键 bug 点
 *   T4: 集成测试 — Agent 执行 write_file 时 ConfirmGate 是否触发
 *   T5: 集成测试 — MetaAgent 规划→执行 全链路 ConfirmGate 行为
 *
 * 用法: npx tsx scripts/confirmgate-stress.ts
 */
export {};
//# sourceMappingURL=confirmgate-stress.d.ts.map