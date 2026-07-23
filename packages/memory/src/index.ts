// ============================================================
// @cortex/memory —— 记忆系统独立包桶导出
//
// 实现 @cortex/memory 包的全部公开符号导出。所有 src/ 下的
// 公开接口、类型、类必须在此文件追加导出。
//
// @module-convention 模块化铁律
// 1. 凡 src/ 下新增公开类型/接口/类，必须在本文件追加 export 行。
// 2. 测试文件禁止 ../src/ 相对导入——只用 @cortex/memory 包名导入。
// 3. 收益：文件合并/拆分/重命名——只要 barrel 出口不变，所有引用方无感。
//
// @layer 领域包 — 依赖 @cortex/config（配置常量）、@cortex/shared（记忆类型）
// ============================================================

// ─── 错误类型 ──────────────────────────────────────
export {
  MemoryStoreError,
  MemoryStoreErrorCode,
  MemoryNotFoundError,
  StoreNotFoundError,
  StoreAlreadyExistsError,
  MemoryValidationError,
  TransactionError,
  PersistenceError,
} from "./errors/MemoryStoreError.js";

// ─── 接口定义 ──────────────────────────────────────
export type { IMemoryStore } from "./interfaces/MemoryStore.js";

export type {
  TransactionalMemoryStore,
  TransactionContext,
  TransactionIsolation,
  TransactionStatus,
  TransactionResult,
  TransactionLinkOp,
} from "./interfaces/TransactionalMemoryStore.js";

// ─── 存储实现 ──────────────────────────────────────
export { InMemoryMemoryStore } from "./implementations/InMemoryMemoryStore.js";

export { FileBasedMemoryStore } from "./implementations/FileBasedMemoryStore.js";
export type { FileBasedMemoryStoreOptions } from "./implementations/FileBasedMemoryStore.js";
export { AbstractMemoryStore } from "./implementations/AbstractMemoryStore.js";
export type { MemoryStoreBackend } from "./implementations/AbstractMemoryStore.js";

// ─── 注册表 ────────────────────────────────────────
export { MemoryStoreRegistry } from "./registry/MemoryStoreRegistry.js";
export type { StoreRegistration } from "./registry/MemoryStoreRegistry.js";

// ─── 世界书 ────────────────────────────────────────
export { WorldbookEngine } from "./worldbook.js";
export type { WorldbookEntry, EntryState, DmaeState, DmaeParams, KnowledgeEntity, KnowledgeEntityType, KnowledgeRelation, RelationType } from "./worldbook.js";

// ─── Cyrene 记忆子系统（L0/L1/L2 画像记忆） ────────
// re-export 核心类型——完整子路径请用 @cortex/memory/cyrene
export { MemoryManager, MemoryStoreManager, memoryStore, setJudgeLlmService, setCompressorLlmService, setResolverLlmService } from "./cyrene/index.js";
export type { MemoryManagerDeps } from "./cyrene/index.js";

// ─── Cyrene RAG 桥接 ──────────────────────────────
export { initRAG, addMemory as ragAddMemory, searchMemoryEntries as ragSearchMemoryEntries, searchMemory as ragSearchMemory, setRagDataDir, setRagModelsDir } from "./cyrene/index.js";
