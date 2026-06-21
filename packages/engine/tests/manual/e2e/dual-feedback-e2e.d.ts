/**
 * 双向下放全链路 E2E —— 真实 LLM 验证 Pipeline→MetaAgent + sessionId 锚定
 *
 * 用法: npx tsx tests/manual/e2e/dual-feedback-e2e.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 验证链路（v2.5.41 宪法修订核心）:
 *   1. MetaAgent 经 PipelineObserver 订阅 NodeComplete/NodeFailed 事件
 *   2. Scheduler.executeAll() → MemoryStore.beginSession/endSession 生命周期
 *   3. sessionId 在 ExecutionReport ↔ MemoryEntry 中一致锚定
 *   4. getBySession() 可查询当前 run 的全部记忆
 *   5. endSession() 后 sessionId 清除 + Pending 记忆湮灭
 *   6. 第二轮 plan() 可接收第一轮管线上下文（间接验证）
 */
export {};
//# sourceMappingURL=dual-feedback-e2e.d.ts.map