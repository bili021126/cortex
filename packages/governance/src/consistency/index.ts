// ============================================================
// @cortex/consistency —— 记忆-现实一致性校验层
//
// v2.6.6: 从 @cortex/engine 拆出。
// ============================================================

// ── 冲突检测 ───────────────────────────────────
export { createDefaultConflictDetector } from "./conflict-detector.js";
export type { ConflictDetector, ConflictReport } from "./conflict-detector.js";

// ── 意图-事实墙 ───────────────────────────────
export { IntentFactWall } from "./intent-fact-wall.js";

// ── Schema 执行器 ──────────────────────────────
export { SchemaEnforcer } from "./schema-enforcer.js";
export type { ValidationResult } from "./schema-enforcer.js";

// ── 启动校验器 ────────────────────────────────
export { InitVerifier, extractFileReferences } from "./init-verifier.js";
export type { ConsistencyReport, VerificationEntry, FileCoverageReport } from "./init-verifier.js";

// ── 一致性层 Facade ────────────────────────────
export { ConsistencyLayer } from "./consistency-layer.js";

// ── 团队协作协议 ──────────────────────────────
export { TeamCollabManager, DEFAULT_TEAM_COLLAB_CONFIG, AGENT_MEMORY_SCOPES } from "./team-collab.protocol.js";
export type { AgentRole, MemoryDomainScope, SharedMentalEntry, PostTaskReflection, TeamCollabConfig } from "./team-collab.protocol.js";
