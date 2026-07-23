// ============================================================
// Cyrene-Agent 记忆系统 — 适配层导出
//
// 从 Cyrene-Agent src/main/memory/ 提取并适配。
// 所有适配后的核心类、类型、单例在此导出。
// ============================================================

// ── 类型 ──
export type {
  L0Profile, L1Profile, L2Memory, L2MemoryStatus, L2SyncStatus,
  MemoryCandidate, MemoryEvidence, MemoryStoreData, MemoryJudgeTurn,
  ConflictLog, ReflectionLog, MemoryConflictResolution,
  ConflictScoringSignals, ConflictResolverPriority, ConflictResolverStatus,
  MemoryConflictResolutionType,
} from "./memory-types.js"

export { L0_FIELD_DESCRIPTIONS } from "./memory-types.js"

// ── 存储 ──
export { MemoryStoreManager, memoryStore, repairMigrations } from "./memory-store.js"
export type { L0WritableField, L1WritableField, L2Input } from "./memory-store.js"

// ── 追踪 ──
export { appendMemoryTrace, setTracePath } from "./memory-trace.js"
export type { MemoryTraceEvent } from "./memory-trace.js"

// ── 冲突检测 ──
export { findPossibleConflictCandidate } from "./memory-conflict.js"
export type { PossibleConflictCandidate } from "./memory-conflict.js"

// ── 冲突评分 ──
export { scoreMemoryConflict } from "./memory-conflict-score.js"
export type { ConflictScoreInput, ConflictScoreResult, ConflictCandidateSource, ConflictEvidenceLevel } from "./memory-conflict-score.js"

// ── Judge ──
export { MemoryJudge, memoryJudge, setModelSettingsPath as setJudgeModelPath, setJudgeLlmService } from "./memory-judge.js"

// ── Compressor ──
export { runReflectionAndCompression, setCompressorModelPath, setCompressorLlmService } from "./memory-compressor.js"

// ── Resolver ──
export { buildResolverPayload, buildResolverMessages, resolvePayload, callResolverLLM, runResolverQueueOnce, setResolverModelPath, setResolverLlmService } from "./memory-resolver.js"
export type { ResolverPayload, ResolverDeps, ResolverRunResult, ResolverRunOptions } from "./memory-resolver.js"

// ── Manager ──
export { MemoryManager } from "./memory-manager.js"
export type { MemoryManagerDeps } from "./memory-manager.js"

// ── Scheduler ──
export { MemoryScheduler } from "./memory-scheduler.js"
export type { MemorySchedulerDeps } from "./memory-scheduler.js"

// ── Entity Graph ──
export { EntityGraph, entityGraph, extractEntitiesFromText } from "./entity-graph.js"
export type { EntityNode, EntityRelation } from "./entity-graph.js"

// ── Recent Injection ──
export {
  clearRecentMemoryInjections, recordRecentMemoryInjection,
  recordRecentMemorySearchEntries, getRecentlyInjectedMemoryIds,
  wasRecentlyInjectedMemory,
} from "./recent-injected-memory.js"

// ── Audit ──
export { auditMemoryStore, summarizeMemoryAudit, auditMemoryFile } from "./memory-audit.js"
export type { MemoryAuditFinding, MemoryAuditReport, MemoryAuditSummary, MemoryAuditSeverity } from "./memory-audit.js"

// ── LLM Adapter ──
export { callLLM, loadModelSettingsFromFile, extractJsonArray, extractJsonObject, recordUsage, resetTokenUsage, getTokenUsage } from "./llm-adapter.js"
export type { LLMConfig, LLMMessage, LLMResponse } from "./llm-adapter.js"

// ── RAG（在 rag/ 子目录） ──
export * from "./rag/index.js"
