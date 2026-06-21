/**
 * Pipeline 策略路由 E2E —— 真实 LLM 验证 react/direct 策略
 *
 * 用法: npx tsx tests/manual/e2e/pipeline-strategy-e2e.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 验证链路:
 *   1. react 策略 → CodeAgent 走 ReAct 循环完成
 *   2. direct 策略 → CodeAgent 走 DirectStep 单次 LLM 调用完成
 *   3. 混合策略共存于同一 dispatch 轮次
 *   4. 两种策略均正确写入记忆
 */
export {};
//# sourceMappingURL=pipeline-strategy-e2e.d.ts.map