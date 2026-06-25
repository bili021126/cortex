/**
 * @cortex/context-manager —— 桶导出
 */
export { ContextManager } from "./context-manager.js";
export type {
  ContextResolveInput,
  ResolvedContext,
} from "./context-manager.js";

// ── Domain Gate（C 层域门控）──
export { DomainGateController } from "./domain-gate.js";

// ── Phase 6 记忆世界模型（V+M 层）──
export { PredictiveEncoder } from "./predictive-encoder.js";
export { PredictiveRetriever } from "./predictive-retriever.js";
export { MemoryWorldModel } from "./memory-world-model.js";
