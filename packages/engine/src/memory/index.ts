// ============================================================
// @cortex/engine/memory —— 记忆子系统桶导出
//
// @file-overview
// 本文档是 memory/ 目录的统一对外接口，收束 MemoryStore
// Facade、记忆增强执行管道、监控器、技能闭环订阅者、语义嵌入。
//
// @version 2.1.0
// @fix barrel-export-missing — 新增 embedText/embedBatch/isModelLoaded 导出
// ============================================================

// ── 记忆中枢（委托模式 Facade） ──────────────────
export { MemoryStore } from "./memory-store.js";
export type { IMemoryStore, MaintainReport } from "@cortex/shared";

// ── 记忆增强执行管道 ────────────────────────────
export { executeWithMemoryPipeline, defaultMemoryQuery, makeMemoryQuery, resolvePipeline, DirectStep, DEFAULT_PIPELINE, DIRECT_PIPELINE } from "./pipeline.js";

// ── Core-2: 上下文构建器 ─────────────────────────
export { ContextBuilder } from "./context-builder.js";
export type { ContextBuildResult } from "./context-builder.js";

// ── 监控 ─────────────────────────────────────────
export { MemoryStoreMonitor } from "./monitor.js";

// ── 技能闭环订阅者 ──────────────────────────────
export { registerSkillPipeline } from "./skill-pipeline.js";

// ── 语义嵌入（Core-1 六层防御） ─────────────────
// @xenova/transformers 384d 本地嵌入，首次调用时下载 ONNX 模型。
export { embedText, embedBatch, isModelLoaded, defaultEmbeddingService } from "./embedding.js";
export type { IEmbeddingService } from "./embedding.js";
