// ============================================================
// Cyrene-Agent 记忆系统 — 适配层导出
//
// 从 Cyrene-Agent src/main/memory/ 提取并适配。
// 所有适配后的核心类、类型、单例在此导出。
// ============================================================

// ⚠️ 本文件是「Cyrene-Agent 适配层」，其中 10 个导出全仓零消费（2026-09-30 核实，**未修**）
//
// 零消费清单（`audit-unconsumed.ts` 口径：包内外皆无引用）：
//   `setTracePath` · `memoryJudge` · `setModelSettingsPath` · `setCompressorModelPath`
//   · `setResolverModelPath` · `clearRecentMemoryInjections` · `recordRecentMemorySearchEntries`
//   · `getRecentlyInjectedMemoryIds` · `resetTokenUsage` · `getTokenUsage`
//
// **前三类「set*」不是死代码，是没接上的配置入口。** 本包由 Cyrene-Agent 适配而来，
// 适配动作的核心之一就是**把路径从硬编码改成可注入**（对照同目录 `rag/index.ts` 的
// 「路径参数化」、`rag/reranker.ts` 的「路径改为参数注入」、`entity-graph.ts` 的
// 「路径改为构造注入」）——**而这批注入点没有一个被调用过**。
//
// 后果是可验证的：记忆层的**文件位置全部是 cwd 相对的、无法从引擎配置**
// （真正干活的是 `memory-store.ts` 里那个**不带参数**的模块级单例，
// 兜底到 `process.cwd()/data/memory.json`，而不是代码自称的 `.cortex/cyrene-memory.json`）。
//
// 详见 `docs/core/core-3-open-decisions.md` **第 4 条（N-22）** 与
// `docs/core/core-3-design-backlog.md` N-22。**只加注释，未加调用点、未删导出。**

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
