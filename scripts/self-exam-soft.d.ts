/**
 * 软约束自审视 —— 五环治理驱动 7 阶段全流程
 *
 * Phase 0: 甘雨意图解析 → 动态生成任务（直接 LLM 调用）
 * Phase 1: 9 Agent 并发认领执行（单视角独立任务，覆盖全部闭环）
 * Phase 2: 交叉验证（4 对配对）
 * Phase 3: 发现矩阵汇总
 * Phase 4a: 全员归因圆桌（每个 Agent 独立发言 node，并行认领）
 * Phase 4b: 凝光宪法审计（直接 LLM 调用）
 * Phase 4c: 钟离战略评估 + 霜凝监理展望（独立 LLM 调用）
 * Phase 5: 昔涟优先级裁决 → 共识修复清单（P0/P1/P2，不签署）
 *
 * 用法: npx tsx scripts/self-exam-soft.ts
 * 前提: .env 已配置 DEEPSEEK_API_KEY, DEEPSEEK_CYRENE_KEY
 */
export {};
//# sourceMappingURL=self-exam-soft.d.ts.map