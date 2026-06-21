// ============================================================
// @cortex/engine/memory —— 记忆子系统桶导出
//
// v2.6.7: 兼容层已砍，纯净认知组件请直接导入 @cortex/memory-store。
// 本 barrel 仅保留引擎胶水层（pipeline / skill-pipeline）。
// ============================================================
// ── 记忆增强执行管道（胶水层，仍在 engine） ──
export { executeWithMemoryPipeline, defaultMemoryQuery, makeMemoryQuery, resolvePipeline, DirectStep, DEFAULT_PIPELINE, DIRECT_PIPELINE } from "./pipeline.js";
// ── 技能闭环订阅者（迁入 @cortex/skill-kit） ──
export { registerSkillPipeline, emitSkillReferenced, extractSkillUsageFromOutput } from "@cortex/skill-kit";
// ── Context Sharding（Kimi Agent Swarm 对齐） ──
export { compactToSubAgentSummary } from "./pipeline.js";
//# sourceMappingURL=index.js.map