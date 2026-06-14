# @cortex/memory — 记忆系统独立包设计文档

> **分析范围**：母项目全部 packages（shared、config、telemetry、engine 等15个包）  
> **分析深度**：类型定义 → barrel 导出 → 实现架构 → 消费方耦合 → 接口契约  
> **文档版本**：v1.0  
> **状态**：草案评审中

---

## 目录

1. [缺失分析：母项目记忆管理需求缺口](#一缺失分析母项目记忆管理需求缺口)
2. [已有包 Barrel 导出探索报告](#二已有包-barrel-导出探索报告)
3. [设计目标与原则](#三设计目标与原则)
4. [包结构](#四包结构)
5. [核心接口设计](#五核心接口设计)
6. [MemoryStore 注册机制](#六memorystore-注册机制)
7. [包依赖设计](#七包依赖设计)
8. [迁移路径](#八迁移路径)
9. [与现有包的接口合约](#九与现有包的接口合约)
10. [消费方指南](#十消费方指南)

---

## 一、缺失分析：母项目记忆管理需求缺口

### 1.1 当前记忆代码分布

| 包 | 文件/模块 | 角色 | 行数约计 |
|---|---|---|---|
| `@cortex/shared/src/memory.ts` | `MemoryEntry`, `MemoryWriteInput`, `IMemoryStore`, `LinkType` 等 | **类型中枢** — 所有记忆类型的"宪法"定义 | ~260 |
| `@cortex/engine/src/memory/memory-store.ts` | `MemoryStore` class（Facade） | **实现中枢** — 记忆读写+去重+生命周期+session | ~550 |
| `@cortex/engine/src/memory/storage.ts` | `MemoryStorage` class | **内存存储引擎** — Map<id, MemoryEntry> + links Map | ~260 |
| `@cortex/engine/src/memory/persistence.ts` | `MemoryPersistence` class | **SQLite 持久化** — WAL、FTS5、防抖刷写 | ~400 |
| `@cortex/engine/src/memory/lifecycle.ts` | `MemoryLifecycle` class | **三态状态机** — Active → Archived → Obliterated | ~110 |
| `@cortex/engine/src/memory/query.ts` | `MemoryQueryEngine` class | **查询引擎** — 内存扫描 + BFS + 向量余弦召 | ~210 |
| `@cortex/engine/src/memory/schema.ts` | 常量定义 | EMBEDDING_DIM / MAX_TOTAL_MEMORIES / 权重老化因子等 | ~60 |
| `@cortex/engine/src/memory/embedding.ts` | `embedText`, `IEmbeddingService` | **语义嵌入** — @xenova/transformers 384d | ~130 |
| `@cortex/engine/src/memory/pipeline.ts` | `executeWithMemoryPipeline` + 4 Step | **记忆增强执行管道** — 检索→ReAct→写入 | ~250 |
| `@cortex/engine/src/memory/skill-pipeline.ts` | `extractAndPersistSkills` | **技能闭环** — NodeComplete → 技能提取→持久化 | ~120 |
| `@cortex/engine/src/memory/monitor.ts` | `MemoryStoreMonitor` | **事件监控** — 基础阈值告警 | ~130 |
| `@cortex/engine/src/components/skill-persister.ts` | `persistSkillsToMemory` | **技能-记忆桥** — Skill ↔ Memory 双向持久化 | ~350 |
| `@cortex/config/src/interfaces/seed-memory.ts` | `SeedMemoryEntry` | **种子记忆配置类型** — JSON 配置化种子记忆 | ~20 |
| `@cortex/shared/src/kv-store.ts` | `KvStore`, `InMemoryKvStore` | **键值存储抽象** — 通用基础设施 | ~160 |

### 1.2 已覆盖功能成熟度评估

| 功能 | 成熟度 | 位置 | 说明 |
|---|---|---|---|
| CRUD 基础操作 | ★★★★☆ | engine/memory | write/read/link/has/peek 完备 |
| 三态生命周期 | ★★★★☆ | engine/memory | Active/Archived/Obliterated + CAS |
| SQLite WAL 持久化 | ★★★★☆ | engine/memory | write-through、防抖刷写、重连 |
| 内容去重 | ★★★★☆ | engine/memory | SHA256 + 向量相似(0.95)双层 |
| BFS 图遍历 | ★★★☆☆ | engine/memory | 出/入边衰减展开，噪声门限 |
| 向量语义检索 | ★★★☆☆ | engine/memory | 384d ONNX + 余弦 TopK |
| Session 管理 | ★★★★☆ | engine/memory | beginSession/endSession 自动注入 |
| 两阶段提交 | ★★★★☆ | engine/memory | writePending → commit/rollback |
| 自动维护 | ★★★☆☆ | engine/memory | maintain() 冻结+湮灭+孤儿边清理 |
| Pipeline 集成 | ★★★★☆ | engine/memory | Retrieval→ReAct→Write 三步管道 |
| 技能持久化桥 | ★★★☆☆ | engine/components | Skill ↔ Memory 双向读写 |
| FTS5 全文索引 | ★★★☆☆ | engine/persistence | summary + semantic_gist 全文检索 |
| Schema 版本迁移 | ★★★☆☆ | engine/persistence | v3→v4→v5 自动迁移 |
| DB 损坏自愈 | ★★★☆☆ | engine/memory-store | 检测malformed→删文件→重建 |
| 事件监控 | ★★☆☆☆ | engine/monitor | 基础阈值告警 |

### 1.3 严重缺失（根因分析）

| # | 缺失功能 | 影响范围 | 根因 |
|---|---|---|---|
| **M1** | **记忆非独立包** | 任何非-engine 包想用记忆 → 要么依赖整个 engine，要么放弃 | 实现与 engine 紧耦合 |
| **M2** | **去 Engine 依赖** | MemoryStore 依赖 PipelineObserver，无法独立运行 | `_observer?: IPipelineObserver` 在构造器中 |
| **M3** | **无可配置持久化后端** | 硬编码 better-sqlite3，无法切换 Redis/PostgreSQL/内存 | `new Database()` 直接构造于 persistence.ts |
| **M4** | **无可配置嵌入后端** | 硬编码 @xenova/transformers | `defaultEmbeddingService` 编译时绑定 |
| **M5** | **无可配置缓存层** | 只有 Map 内存一级缓存，无 LRU/TTL/Redis 分层 | MemoryStorage 就是 Map |
| **M6** | **无独立记忆类型域** | 所有类型在 shared 中与其他域混合导出 | 未按 DDD 拆分上下文 |
| **M7** | **无查询 DSL/构建器** | MemoryQuery 是扁平接口，无链式/类型安全构建器 | 直接用对象字面量 |
| **M8** | **无记忆统计与分析** | MemoryStoreMonitor 只有告警，无命中率/热力图/趋势 | 无 analytics 模块 |
| **M9** | **无测试夹具/工厂** | 每个测试自己构造 MemoryEntry | 无 `createTestMemory()` 工具 |
| **M10** | **无事务性内存操作** | writeMany/deleteMany/linkMany 缺失，无事务语义 | IMemoryStore 接口无批量事务方法 |
| **M11** | **无存储后端注册机制** | 后端选择 hardcode，无法运行时切换 | 无 Registry/Factory 模式 |
| **M12** | **无快照/导出/导入** | 仅 SQLite 文件级，无法程序化 dump/restore | 无 export/import 方法 |
| **M13** | **无外部向量存储集成** | Pinecone/Chroma/pgvector 无抽象层 | vectorRecall 是内存计算 |
| **M14** | **无分布式/并发安全** | 无多进程安全机制 | 单进程假设 |
| **M15** | **无真正垃圾回收** | maintain() 不做 obliterated 条目内存释放 | 无真正回收机制 |

### 1.4 耦合链可视化

```
@cortex/shared (IMemoryStore 接口 + 类型)
    ↑ 类型导入
@cortex/engine (MemoryStore 实现 + 全部逻辑)
    ↑ 依赖 PipelineObserver (engine 事件基建)
    ↑ 依赖 better-sqlite3 (直接 new Database)
    ↑ 依赖 @xenova/transformers (硬编码 embedder)
    ↑
@cortex/cli  ──→ 想用记忆? 必须装 engine
@cortex/llm   ──→ 想用记忆? 必须装 engine
@cortex/testing ─→ 想 mock 记忆? 类型在 shared，实现在 engine，两头不靠
```

---

## 二、已有包 Barrel 导出探索报告

### 2.1 `@cortex/shared` — barrel 导出全景

**位置**：`packages/shared/src/index.ts`

```typescript
// 完整导出清单（按顺序）
export * from "./agent.js";             // AgentType 枚举, Agent 接口
export * from "./task.js";              // TaskNode, PipelineEventType, PipelinePriority
export * from "./memory.js";            // ★ MemoryEntry, IMemoryStore, MemoryQuery, LinkType
export * from "./toolkit.js";           // 工具执行类型
export * from "./file-lock-manager.js"; // 文件锁类型
export * from "./cli-adapter.js";       // CLI 适配器接口
export * from "./infra.js";             // 基础设施类型
export * from "./skill-registry.js";    // 技能注册表类型
export * from "./fs-adapter.js";        // 文件系统适配器接口
export * from "./modification-record.js"; // 修改记录类型
export * from "./doc-registry.js";      // 文档注册表类型
export * from "./amendment.js";         // 宪法修订类型
export * from "./kv-store.js";          // ★ KvStore 接口 + InMemoryKvStore 实现
export * from "./context-policy.js";    // 上下文策略类型
```

**关键发现**：
- `memory.ts` 包含 `IMemoryStore` 接口、`MemoryEntry`、`MemoryQuery`、`MemoryWriteInput`、`LinkType`、`ReadMode` 等——这正是设计文档分析的"类型中枢"
- `memory.ts` 中的 `IMemoryStore` 接口只有 `read/write/link/has/cas/archive/obliterate/writePending/commitMemory/rollback/getPending/hasPending/getBySession/peek/flush/close/maintain/setPreWriteHook`——**缺失** `set/get/delete` 命名法，也没有 `beginTransaction/commit/rollback` 事务语义
- `memory.ts` 中的 `MemorySource` 强依赖 `AgentType`（来自 `agent.ts`），这是跨域耦合
- `kv-store.ts` 提供了通用 `KvStore<T>` 接口和 `InMemoryKvStore` 实现，可作为底层存储参考

### 2.2 `@cortex/config` — barrel 导出全景

**位置**：`packages/config/src/index.ts`

```typescript
// 分层架构：interfaces/ → constants/ → defaults → loader
// 
// interfaces/index.ts 导出类型（按职责域拆分）：
//   EngineConfig, ToolTimeoutsConfig, LlmConfig, FilePathsConfig,
//   AgentDefinition, AgentsConfig, RouteTableEntry, EventRoutingConfig,
//   SearchConfig, SeedMemoryEntry, SeedMemoriesConfig,
//   GovernancePipelineConfig, CognitionConfig, DocsConfig, ...
//
// constants/index.ts 导出常量（按类别拆分）：
//   CORTEX_VERSION, DEFAULT_MAX_TOTAL_MEMORIES,
//   FILE_CYRENE_MEMORY_DB, FILE_ENGINE_DB,
//   ENV_* 系列环境变量名, 路径常量, 超时常量, ...
//
// defaults.ts → DEFAULT_ENGINE_CONFIG, resolveConfig
// loader.ts → loadConfigDomain, loadAllConfig, ConfigLoadError
```

**关键发现**：
- `seed-memory.ts` 中的 `SeedMemoryEntry`（`taskId/memoryType/agentType/content/summary/linkTo`）与 shared 的 `MemoryEntry` 格式不同——这是两个不同的记忆类型定义
- `DEFAULT_MAX_TOTAL_MEMORIES` 已被 engine/memory/schema.ts 引用
- `FILE_CYRENE_MEMORY_DB` 定义记忆数据库路径
- config 严格遵守"零依赖"原则，纯类型层

### 2.3 `@cortex/telemetry` — barrel 导出全景

**位置**：`packages/telemetry/src/index.ts`

```typescript
// 核心接口：
//   ITelemetryCollector  — collect(data)/flush()/shutdown()
//   ICollectorRegistry    — register/registerFactory/get/unregister/flushAll/shutdownAll
//   Sampler               — decide(data) → SamplerDecision
//   Batcher               — add(data)/flush() → TelemetryBatch
// 
// 实现：
//   ConsoleCollector, FileCollector — ITelemetryCollector 实现
//   CollectorRegistry — ICollectorRegistry 实现
//   RateSampler, ThresholdSampler — Sampler 实现
//   SizeBatcher, TimeBatcher — Batcher 实现
```

**关键发现**：
- 采用 Strategy + Factory 模式实现了完整的可插拔架构
- `ICollectorRegistry` 的注册/查找模式值得 `MemoryStoreRegistry` 借鉴
- `CollectorRegistration` 使用 discriminated union（`initialized: true/false`）管理惰性初始化——设计亮点
- 与 memory 无直接依赖关系

### 2.4 包间依赖关系总结

```
@cortex/config        ← 零依赖，纯类型+常量
@cortex/shared        ← 零包依赖（仅 TypeScript 内置类型）
@cortex/telemetry     ← 零包依赖
@cortex/engine        ← 依赖 @cortex/shared, @cortex/config, better-sqlite3, @xenova/transformers
                    └── memory/ 子模块耦合 engine 的 PipelineObserver

┌──────────────────────────────────────────────────────────┐
│  @cortex/shared/memory.ts (IMemoryStore 接口)             │
│          ↑ 类型导入                                        │
│  @cortex/engine/memory/ (MemoryStore 实现)                │
│          ↑ 硬依赖                                          │
│  @cortex/cli, @cortex/llm, @cortex/testing (消费方)       │
└──────────────────────────────────────────────────────────┘
```

---

## 三、设计目标与原则

### 3.1 核心目标

| # | 目标 | 度量标准 |
|---|---|---|
| G1 | **记忆独立包化** — 零 engine 依赖 | 消费方可 `import { MemoryStore } from "@cortex/memory"` 无需装 engine |
| G2 | **可插拔后端架构** — 存储/嵌入/向量/缓存均接口化 | 4 个 SPI 接口 + 默认实现，切换后端不改业务代码 |
| G3 | **事务性内存操作** — 多条目原子写入/读取 | `TransactionalMemoryStore` 接口定义明确的 beginTransaction/commit/rollback |
| G4 | **注册机制** — 运行时动态选择后端 | `MemoryStoreRegistry` 支持按名称注册/查找/切换 |
| G5 | **向后兼容** — engine 零破坏迁移 | shared re-export + engine 适配层，消费方无感 |
| G6 | **测试性** — MockStore + Factory 开箱即用 | 一行 `createTestMemory()` 构造测试数据 |

### 3.2 设计原则

1. **接口隔离（ISP）**：每个 SPI 接口只有一个职责（存储/嵌入/向量/缓存/事件）
2. **依赖反转（DIP）**：MemoryStore Facade 依赖接口而非具体实现
3. **组合优于继承**：MemoryStore 组合 IStorageBackend + IEmbeddingService + IVectorStore + ICacheLayer
4. **注册-查找-工厂（Registry）**：统一管理后端实现的注册和惰性初始化
5. **分层事务**：从简单批处理到完整事务的渐进式支持

### 3.3 与已有包的边界约定

```
@cortex/memory
├── 从 shared 提取：所有记忆类型（迁出 memory.ts）
├── 从 engine 提取：MemoryStore Facade 及全部子模块（去耦合）
├── 从 config 引用：配置文件路径常量（可选，纯读取）
├── 从 telemetry 借鉴：Registry 模式 + Strategy/Factory 架构风格
└── 不依赖：engine、shared（过渡期后）、任何运行时框架
```

---

## 四、包结构

```
packages/memory/
├── src/
│   ├── index.ts                          # 桶导出（全量公开符号）
│   │
│   ├── types/                            # ★ 从 shared/memory.ts 迁入
│   │   ├── entry.ts                      #   MemoryEntry, MemoryWriteInput
│   │   ├── query.ts                      #   MemoryQuery, ReadMode, QueryBuilder
│   │   ├── link.ts                       #   MemoryLink, LinkType, LinkDirection
│   │   ├── lifecycle.ts                  #   MemoryKind, SemanticState
│   │   ├── session.ts                    #   SessionId, MemorySource
│   │   ├── transaction.ts                #   ★ 新增：Transaction, TransactionIsolation
│   │   └── index.ts                      #   子桶导出
│   │
│   ├── interfaces/                       # ★ 可插拔抽象层
│   │   ├── memory-store.ts               #   IMemoryStore（从 shared 迁入，增强）
│   │   ├── transactional-store.ts        #   ★ 新增：TransactionalMemoryStore
│   │   ├── storage-backend.ts            #   ★ 新增：IStorageBackend
│   │   ├── embedding-service.ts          #   ★ 从 engine 迁入，抽象化
│   │   ├── vector-store.ts               #   ★ 新增：IVectorStore
│   │   ├── cache-layer.ts                #   ★ 新增：ICacheLayer
│   │   ├── event-bus.ts                  #   ★ 新增：IMemoryEventBus
│   │   ├── lock-manager.ts               #   ★ 新增：ILockManager
│   │   └── index.ts                      #   子桶导出
│   │
│   ├── store/                            # ★ 从 engine/memory 迁入，去耦合
│   │   ├── memory-store.ts               #   MemoryStore（IMemoryStore 实现）
│   │   ├── transactional-store.ts        #   ★ 新增：DefaultTransactionalStore
│   │   ├── storage-engine.ts             #   MemoryStorageEngine（封装 Map + 操作）
│   │   ├── lifecycle.ts                  #   MemoryLifecycle（状态机）
│   │   ├── query-engine.ts               #   MemoryQueryEngine（扫描+BFS+向量）
│   │   └── schema.ts                     #   常量定义
│   │
│   ├── persistence/                      # ★ 从 engine/memory 迁入，后端化
│   │   ├── sqlite-backend.ts             #   SqliteStorageBackend（原 MemoryPersistence）
│   │   ├── sqlite-migrations.ts          #   ★ 拆出独立迁移定义
│   │   └── memory-backend.ts             #   InMemoryStorageBackend（纯内存实现）
│   │
│   ├── embedding/                        # ★ 从 engine/memory 迁入，可切换
│   │   ├── local-embedder.ts             #   LocalEmbedder（@xenova/transformers）
│   │   ├── openai-embedder.ts            #   ★ 新增：OpenAIEmbedder
│   │   └── noop-embedder.ts              #   ★ 新增：NoopEmbedder（测试用）
│   │
│   ├── vector/                           # ★ 新增：向量存储适配层
│   │   ├── memory-vector-store.ts        #   MemoryVectorStore（内存向量搜索）
│   │   └── pgvector-store.ts             #   ★ 预留：pgvector 适配器
│   │
│   ├── registry/                         # ★ 新增：注册机制
│   │   ├── memory-store-registry.ts      #   MemoryStoreRegistry
│   │   ├── backend-registry.ts           #   StorageBackendRegistry
│   │   └── index.ts
│   │
│   ├── pipeline/                         # ★ 从 engine/memory 迁入
│   │   ├── memory-pipeline.ts            #   执行管道
│   │   ├── retrieval-step.ts             #   MemoryRetrievalStep
│   │   └── write-step.ts                 #   MemoryWriteStep
│   │
│   ├── skill-bridge/                     # ★ 从 engine/components 迁入
│   │   ├── skill-persister.ts            #   persistSkillsToMemory / loadSkillsFromMemory
│   │   └── knowledge-crystallizer.ts     #   crystallizeSkillToKnowledge
│   │
│   ├── analytics/                        # ★ 新增：统计与分析
│   │   ├── collector.ts                  #   MemoryStatsCollector
│   │   ├── reporter.ts                   #   MemoryStatsReporter
│   │   └── types.ts                      #   统计类型
│   │
│   ├── monitor/                          # ★ 从 engine/memory 迁入，重构
│   │   ├── memory-monitor.ts             #   MemoryMonitor
│   │   └── alert-rules.ts                #   告警规则
│   │
│   ├── testing/                          # ★ 新增：测试工具
│   │   ├── memory-factory.ts             #   createTestMemory() 工厂
│   │   ├── mock-store.ts                 #   MockMemoryStore
│   │   └── assert-memories.ts            #   记忆断言工具
│   │
│   ├── config/                           # ★ 新增：记忆配置
│   │   ├── memory-config.ts              #   MemoryConfig 类型 + 默认值
│   │   └── config-schema.ts              #   Zod 校验 schema
│   │
│   └── migrations/                       # ★ 新增：独立迁移工具
│       ├── runner.ts                     #   MigrationRunner
│       ├── registry.ts                   #   迁移注册表
│       └── v4-to-v5.ts                   #   迁移实例
│
├── tests/
│   ├── store/                            # 存储层单元测试
│   ├── persistence/                      # 持久化测试
│   ├── registry/                         # 注册机制测试
│   ├── query/                            # 查询引擎测试
│   ├── embedding/                        # 嵌入测试
│   ├── transactional/                    # 事务测试
│   ├── analytics/                        # 统计测试
│   └── integration/                      # 集成测试
│
├── package.json                          # @cortex/memory
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## 五、核心接口设计

### 5.1 `IMemoryStore`（增强版）

> 从 `@cortex/shared/src/memory.ts` 迁入，增加 `set/get/delete` 命名法、批量操作和快照能力。

```typescript
// packages/memory/src/interfaces/memory-store.ts

import type {
  MemoryEntry,
  MemoryWriteInput,
  MemoryQuery,
  MemoryLink,
  MemorySource,
  MemoryKind,
  SemanticState,
} from "../types/index.js";
import type { ReadMode, QueryBuilder } from "../types/query.js";
import type { MaintainReport } from "../types/lifecycle.js";

/**
 * MemoryStore 配置——可注入所有可插拔后端。
 * 所有字段均为可选，缺省使用 InMemoryStorageBackend + NoopEmbedder 等默认实现。
 */
export interface MemoryStoreConfig {
  /** 存储后端（默认 InMemoryStorageBackend） */
  storage?: IStorageBackend;
  /** 嵌入服务（默认 noop） */
  embedder?: IEmbeddingService;
  /** 向量存储（默认 MemoryVectorStore） */
  vectorStore?: IVectorStore;
  /** 缓存层（默认 LRU 1000 条） */
  cache?: ICacheLayer;
  /** 事件总线（默认无） */
  eventBus?: IMemoryEventBus;
  /** 锁管理器（默认单进程锁） */
  lockManager?: ILockManager;

  // ── 记忆约束 ──
  /** 记忆条目上限 */
  maxTotalMemories?: number;
  /** 权重老化因子（0~1），每7天未访问衰减 */
  weightAgingFactor?: number;
  /** 自动归档未访问天数（默认30天） */
  staleFreezeDays?: number;
  /** 湮灭归档天数（默认7天） */
  frozenObliterateDays?: number;
  /** 嵌入维度校验（默认384） */
  embeddingDim?: number;
}

/**
 * IMemoryStore —— 记忆存储核心接口。
 *
 * 命名约定：
 *   - set/get/delete = 按 ID 的单个条目操作（K/V 风格）
 *   - read = 按查询条件检索（查询引擎风格）
 *   - write = 创建新条目（含去重/嵌入/自动注入）
 *
 * @remarks
 * 与 @cortex/shared 的 IMemoryStore 向后兼容。
 * 新增: set()/get()/delete() + writeMany()/linkMany() + exportSnapshot()/importSnapshot()
 */
export interface IMemoryStore {
  // ── 生命周期 ──
  init(config?: MemoryStoreConfig): Promise<void>;
  close(): Promise<void>;
  readonly isReady: boolean;
  readonly size: number;

  // ── 会话 ──
  readonly sessionId?: string;
  beginSession(externalId?: string): string;
  endSession(): Promise<number>;

  // ══════════════════════════════════════════════
  // 写入操作
  // ══════════════════════════════════════════════

  /**
   * 写入一条记忆（含去重 + 嵌入 + 自动注入 sessionId）。
   * 如果内容已存在（SHA256 或向量相似），返回已存在的记忆 ID。
   */
  write(input: MemoryWriteInput): Promise<string>;

  /**
   * 批量写入多条记忆。
   * 无事务语义——部分成功时返回成功的 ID 列表，失败的抛出 AggregateError。
   */
  writeMany(inputs: MemoryWriteInput[]): Promise<string[]>;

  // ══════════════════════════════════════════════
  // 读取操作
  // ══════════════════════════════════════════════

  /**
   * 按查询条件检索记忆。
   * @param mode HCA=广度浅读不追踪热度，CSA=深度窄读追踪热度
   */
  read(query: MemoryQuery, mode?: ReadMode): Promise<MemoryEntry[]>;

  /** 返回 QueryBuilder 实例用于链式构建查询 */
  query(): QueryBuilder;

  // ══════════════════════════════════════════════
  // 单条目 K/V 风格操作（★ 新增）
  // ══════════════════════════════════════════════

  /**
   * 按 ID 设置/覆盖一条记忆。
   * 区别于 write()——不做去重/嵌入/自动注入，纯粹按 ID 写入。
   * 适用于恢复、导入、测试场景。
   */
  set(id: string, entry: MemoryEntry): Promise<void>;

  /**
   * 按 ID 获取一条记忆的只读快照。
   * 等价于 peek()，返回冻结副本防止外部篡改。
   */
  get(id: string): Promise<MemoryEntry | undefined>;

  /**
   * 按 ID 删除一条记忆。
   * @returns 是否实际删除了条目
   */
  delete(id: string): Promise<boolean>;

  // ══════════════════════════════════════════════
  // 关联操作
  // ══════════════════════════════════════════════

  link(sourceId: string, targetId: string, linkType: LinkType, weight?: number): MemoryLink | null;
  linkMany(links: Array<{ sourceId: string; targetId: string; linkType: LinkType; weight?: number }>): (MemoryLink | null)[];
  getLinks(sourceId: string): MemoryLink[];

  // ══════════════════════════════════════════════
  // 生命周期管理
  // ══════════════════════════════════════════════

  has(id: string): boolean;
  peek(id: string): Readonly<MemoryEntry> | undefined;
  cas(id: string, expected: SemanticState, newState: SemanticState): boolean;
  archive(id: string): boolean;
  obliterate(id: string): boolean;
  maintain(): MaintainReport;

  // ══════════════════════════════════════════════
  // 两阶段提交（Pending 机制）
  // ══════════════════════════════════════════════

  writePending(input: MemoryWriteInput): string;
  commitMemory(memoryId: string): boolean;
  rollback(memoryId: string): boolean;
  getPending(): MemoryEntry[];
  hasPending(): boolean;
  getBySession(sessionId: string): MemoryEntry[];

  // ══════════════════════════════════════════════
  // 持久化
  // ══════════════════════════════════════════════

  flush(): Promise<void>;

  // ══════════════════════════════════════════════
  // 快照（★ 新增）
  // ══════════════════════════════════════════════

  /**
   * 导出全部记忆的快照（用于备份/迁移）。
   * @returns 序列化的记忆数据
   */
  exportSnapshot(): Promise<MemorySnapshot>;

  /**
   * 从快照导入记忆（覆盖当前存储）。
   */
  importSnapshot(snapshot: MemorySnapshot): Promise<void>;

  // ══════════════════════════════════════════════
  // 钩子
  // ══════════════════════════════════════════════

  setPreWriteHook(hook: (input: MemoryWriteInput) => MemoryWriteInput): void;
}

/** 记忆快照格式 */
export interface MemorySnapshot {
  version: number;
  exportedAt: number;
  entries: MemoryEntry[];
  links: MemoryLink[];
  metadata?: Record<string, unknown>;
}
```

### 5.2 `TransactionalMemoryStore`（★ 新增）

> 为多条目原子操作提供事务语义。这是母项目最严重缺失之一——当前只有单条目 writePending/commitMemory 的两阶段提交，缺乏跨多条目的事务能力。

```typescript
// packages/memory/src/interfaces/transactional-store.ts

import type { IMemoryStore } from "./memory-store.js";
import type { MemoryWriteInput, MemoryEntry, MemoryLink, LinkType } from "../types/index.js";

/**
 * 事务隔离级别。
 * - ReadCommitted: 只能读到已提交的数据（默认）
 * - RepeatableRead: 事务内多次读取结果一致
 * - Serializable: 最强隔离，串行化执行
 */
export type TransactionIsolation = "ReadCommitted" | "RepeatableRead" | "Serializable";

/**
 * 事务状态枚举。
 */
export type TransactionStatus = "active" | "committed" | "rolledback" | "error";

/**
 * 事务上下文——在 beginTransaction 和 commit/rollback 间传递。
 * 包含事务 ID、状态、时间戳和挂起的操作日志。
 */
export interface TransactionContext {
  /** 全局唯一事务 ID */
  readonly id: string;
  /** 事务状态 */
  readonly status: TransactionStatus;
  /** 事务开始时间戳 */
  readonly startedAt: number;
  /** 隔离级别 */
  readonly isolation: TransactionIsolation;
  /** 挂起的写入操作（用于回滚时逆向操作） */
  readonly pendingWrites: Map<string, MemoryWriteInput>;
  /** 挂起的链接操作 */
  readonly pendingLinks: Array<{ action: "link" | "unlink"; sourceId: string; targetId: string; linkType: LinkType }>;
  /** 用户自定义数据（如调用链追踪 ID） */
  readonly metadata?: Record<string, unknown>;
}

/**
 * 事务操作结果。
 */
export interface TransactionResult<T = void> {
  success: boolean;
  data?: T;
  error?: Error;
  /** 受影响的事务数 */
  affectedCount: number;
}

/**
 * TransactionalMemoryStore —— 支持事务性内存操作的接口。
 *
 * 设计目标：
 * 1. 多条目原子写入：writeMany + linkMany 在一个事务中全部成功或全部回滚
 * 2. 嵌套事务支持：事务内可开启子事务（savepoint）
 * 3. 回滚日志：commit 失败时自动回滚所有挂起操作
 * 4. 隔离级别：默认 ReadCommitted，可提升至 Serializable
 *
 * @example
 * ```typescript
 * const txnStore: TransactionalMemoryStore = store;
 * const txn = await txnStore.beginTransaction("Serializable");
 * try {
 *   const id1 = await txnStore.writeWithin(txn, input1);
 *   const id2 = await txnStore.writeWithin(txn, input2);
 *   txnStore.linkWithin(txn, id1, id2, LinkType.DerivedFrom);
 *   const result = await txnStore.commit(txn);
 *   // 全部成功
 * } catch (e) {
 *   await txnStore.rollback(txn);
 *   // 全部回滚
 * }
 * ```
 */
export interface TransactionalMemoryStore extends IMemoryStore {
  /**
   * 开启一个新事务。
   * 返回 TransactionContext，后续 writeWithin/linkWithin/commit/rollback 使用此上下文。
   *
   * @param isolation 隔离级别（默认 ReadCommitted）
   * @param metadata 可选元数据
   * @returns 事务上下文
   */
  beginTransaction(isolation?: TransactionIsolation, metadata?: Record<string, unknown>): Promise<TransactionContext>;

  /**
   * 在指定事务内写入一条记忆。
   * 与 write() 的区别：
   *   - 写入操作被记录在事务挂起日志中
   *   - commit 前其他事务不可见（取决于隔离级别）
   *   - rollback 时自动撤销
   *
   * @param txn 事务上下文
   * @param input 记忆写入输入
   * @returns 记忆 ID
   * @throws 如果事务已关闭（committed/rolledback）
   */
  writeWithin(txn: TransactionContext, input: MemoryWriteInput): Promise<string>;

  /**
   * 在指定事务内批量写入多条记忆。
   * 所有写入全部成功或全部回滚。
   */
  writeManyWithin(txn: TransactionContext, inputs: MemoryWriteInput[]): Promise<string[]>;

  /**
   * 在指定事务内建立关联。
   */
  linkWithin(txn: TransactionContext, sourceId: string, targetId: string, linkType: LinkType, weight?: number): Promise<MemoryLink | null>;

  /**
   * 在指定事务内批量建立关联。
   */
  linkManyWithin(txn: TransactionContext, links: Array<{ sourceId: string; targetId: string; linkType: LinkType; weight?: number }>): Promise<(MemoryLink | null)[]>;

  /**
   * 在指定事务内读取记忆（事务隔离的快照读）。
   */
  readWithin(txn: TransactionContext, query: MemoryQuery, mode?: ReadMode): Promise<MemoryEntry[]>;

  /**
   * 提交事务——将事务内所有挂起操作原子化写入底层存储。
   *
   * 处理流程：
   *   1. 校验事务状态（必须是 active）
   *   2. 对所有挂起写入执行去重和嵌入
   *   3. 批量写入存储后端
   *   4. 批量写入关联
   *   5. 标记事务为 committed
   *   6. 清空挂起日志
   *
   * @param txn 事务上下文
   * @returns 提交结果（含写入的记忆 ID 列表）
   * @throws 如果任何操作失败，事务自动标记为 error
   */
  commit(txn: TransactionContext): Promise<TransactionResult<string[]>>;

  /**
   * 回滚事务——撤销事务内所有挂起操作。
   *
   * 处理流程：
   *   1. 校验事务状态（必须是 active 或 error）
   *   2. 从挂起日志中逆向操作
   *   3. 清理临时数据
   *   4. 标记事务为 rolledback
   *
   * @param txn 事务上下文
   * @returns 回滚结果
   */
  rollback(txn: TransactionContext): Promise<TransactionResult<void>>;

  /**
   * 获取当前活动事务列表。
   */
  getActiveTransactions(): TransactionContext[];

  /**
   * 设置事务超时（毫秒）。
   * 超过超时时间未 commit 的事务自动回滚。
   */
  setTransactionTimeout(ms: number): void;
}
```

### 5.3 `IStorageBackend`（★ 新增抽象层）

> 解决 M3（无可配置持久化后端）。将当前 SQLite 和内存实现统一到接口之下。

```typescript
// packages/memory/src/interfaces/storage-backend.ts

import type { MemoryEntry, MemoryLink, MemoryWriteInput } from "../types/index.js";
import type { SemanticState } from "../types/lifecycle.js";

/**
 * 存储后端接口——所有持久化引擎（SQLite、PostgreSQL、Redis、内存）必须实现。
 *
 * @remarks
 * 职责单一：只做"存/取"不涉及逻辑（去重、嵌入、权重老化等由 MemoryStore 处理）。
 * 这是 Data Mapper 模式——存储后端不感知 MemoryEntry 的业务含义。
 */
export interface IStorageBackend {
  /** 后端唯一名称（用于日志/诊断/注册表查找） */
  readonly name: string;

  /** 初始化——接收连接字符串或配置对象 */
  init(connectionString: string): Promise<void>;

  /** 关闭连接释放资源 */
  close(): Promise<void>;

  /** 是否已连接就绪 */
  readonly isConnected: boolean;

  // ── 写入 ──
  insert(entry: MemoryEntry): Promise<void>;
  insertBatch(entries: MemoryEntry[]): Promise<void>;
  updateState(id: string, newState: SemanticState): Promise<void>;
  updateAccess(id: string, accessCount: number, lastAccessedAt: number): Promise<void>;
  updateWeight(id: string, weight: number): Promise<void>;
  delete(id: string): Promise<void>;

  // ── 读取 ──
  get(id: string): Promise<MemoryEntry | null>;
  getAll(): Promise<MemoryEntry[]>;
  query(query: MemoryQuery, now: number): Promise<MemoryEntry[]>;

  // ── 链接 ──
  insertLink(link: MemoryLink): Promise<void>;
  getLinks(sourceId: string): Promise<MemoryLink[]>;
  deleteLinksBySource(sourceId: string): Promise<void>;
  cleanOrphanedLinks(): Promise<number>;

  // ── 维护 ──
  flush(): Promise<void>;
  vacuum(): Promise<void>;
}
```

### 5.4 `IEmbeddingService`（迁入 + 增强）

> 从 `@cortex/engine/src/memory/embedding.ts` 迁入，增加预热和批量接口。

```typescript
// packages/memory/src/interfaces/embedding-service.ts

export interface IEmbeddingService {
  /** 服务名称（用于日志/诊断） */
  readonly name: string;
  /** 向量维度 */
  readonly dimensions: number;
  /** 是否已就绪 */
  readonly isReady: boolean;

  /** 对单段文本生成嵌入向量 */
  embedText(text: string): Promise<number[]>;

  /** 批量生成嵌入向量 */
  embedBatch(texts: string[]): Promise<number[][]>;

  /** 预热模型（可选实现，如 ONNX 下载） */
  warmup?(signal?: AbortSignal): Promise<void>;
}
```

### 5.5 `IVectorStore`（★ 新增）

> 解决 M13（无外部向量存储集成）。为 Pinecone/Chroma/pgvector 等提供统一适配接口。

```typescript
// packages/memory/src/interfaces/vector-store.ts

export interface IVectorStore {
  readonly name: string;
  readonly dimensions: number;

  init(config: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;

  /** 插入/更新向量 */
  upsert(id: string, vector: number[]): Promise<void>;
  upsertBatch(entries: Array<{ id: string; vector: number[] }>): Promise<void>;

  /** Top-K 近似最近邻查询 */
  query(vector: number[], topK: number): Promise<Array<{ id: string; score: number }>>;

  /** 删除向量 */
  remove(id: string): Promise<void>;

  /** 清空 */
  clear(): Promise<void>;
}
```

### 5.6 `ICacheLayer`（★ 新增）

> 解决 M5（无可配置缓存层）。支持 LRU/TTL/Redis 等多级缓存策略。

```typescript
// packages/memory/src/interfaces/cache-layer.ts

export interface ICacheLayer {
  readonly name: string;
  readonly size: number;

  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
}
```

### 5.7 `IMemoryEventBus`（替代 PipelineObserver）

> 解决 M2（去 Engine 依赖）。用独立事件总线替代 engine 的 `IPipelineObserver`。

```typescript
// packages/memory/src/interfaces/event-bus.ts

export type MemoryEventType =
  | "memory:write"
  | "memory:read"
  | "memory:delete"
  | "memory:archive"
  | "memory:obliterate"
  | "memory:link"
  | "memory:commit"
  | "memory:rollback"
  | "memory:flush"
  | "memory:maintain"
  | "memory:error"
  | "memory:cache-hit"
  | "memory:cache-miss"
  | "memory:degraded"
  | "memory:txn:begin"
  | "memory:txn:commit"
  | "memory:txn:rollback";

export type MemoryEventSeverity = "debug" | "info" | "warning" | "error" | "critical";

export interface MemoryEvent {
  type: MemoryEventType;
  severity: MemoryEventSeverity;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export type MemoryEventHandler = (event: MemoryEvent) => void;

export interface IMemoryEventBus {
  emit(event: MemoryEvent): void;
  on(type: MemoryEventType | "*", handler: MemoryEventHandler): () => void;
  off(type: MemoryEventType | "*", handler: MemoryEventHandler): void;
  clear(): void;
}
```

### 5.8 `QueryBuilder`（★ 新增）

> 解决 M7（无查询 DSL/构建器）。链式 API 替代扁平 MemoryQuery 对象。

```typescript
// packages/memory/src/types/query.ts

export interface QueryBuilder {
  /** 按认知类别过滤 */
  ofKind(kind: MemoryKind): this;
  /** 关键词匹配 */
  withKeywords(...keywords: string[]): this;
  /** 语义向量检索 */
  withVector(vector: number[], topK?: number): this;
  /** 时间范围过滤 */
  inTimeRange(start: number, end: number): this;
  /** 按 agent 类型过滤 */
  fromAgent(...agentTypes: string[]): this;
  /** BFS 图展开深度 */
  withBFS(depth: number, maxNodes?: number): this;
  /** BFS 遍历方向 */
  bfsDirection(dir: "both" | "outbound" | "inbound"): this;
  /** 按边类型过滤（仅在 BFS 时生效） */
  withLinkTypes(...types: LinkType[]): this;
  /** 结果数量上限 */
  limit(n: number): this;
  /** 按 metadata 字段精确过滤 */
  whereMetadata(key: string, value: unknown): this;
  /** 构建 MemoryQuery */
  build(): MemoryQuery;
}
```

---

## 六、MemoryStore 注册机制

### 6.1 设计动机

母项目当前无法运行时切换存储后端——`MemoryStore` 直接 `new MemoryPersistence()` 和 `new MemoryStorage()`，没有任何注册表或工厂机制。借鉴 `@cortex/telemetry` 的 `ICollectorRegistry` 设计，实现统一的 **MemoryStoreRegistry**。

### 6.2 三层注册架构

```
MemoryStoreRegistry (顶层)
├── 按名称注册/查找/切换 IMemoryStore 实例
├── 每个 store 可独立配置后端
└── 支持惰性初始化（工厂模式）

StorageBackendRegistry (存储层)
├── 注册 IStorageBackend 实现（InMemory/SQLite/Redis/PostgreSQL）
├── 按连接字符串自动选择后端
└── 支持自定义后端注册
```

### 6.3 `MemoryStoreRegistry` 接口

```typescript
// packages/memory/src/registry/memory-store-registry.ts

import type { IMemoryStore, MemoryStoreConfig } from "../interfaces/memory-store.js";

/**
 * Store 注册项——惰性初始化支持。
 * 使用 discriminated union 窄化类型。
 */
export type StoreRegistration =
  | { readonly name: string; readonly store: IMemoryStore; readonly initialized: true; readonly config?: MemoryStoreConfig }
  | { readonly name: string; readonly store: (() => IMemoryStore); readonly initialized: false; readonly config?: MemoryStoreConfig };

/**
 * MemoryStoreRegistry —— 记忆存储实例的注册中心。
 *
 * @remarks
 * 设计借鉴 @cortex/telemetry 的 ICollectorRegistry：
 * - register(): 注册已初始化的 IMemoryStore 实例
 * - registerFactory(): 注册工厂函数，首次 get() 时自动创建
 * - get(): 按名称查找（工厂模式自动初始化）
 * - switchDefault(): 切换默认存储实例
 *
 * @example
 * ```typescript
 * const registry = new MemoryStoreRegistry();
 *
 * // 注册内存存储（默认）
 * registry.register("default", new MemoryStore({ storage: new InMemoryStorageBackend() }));
 *
 * // 注册 SQLite 持久化存储（惰性）
 * registry.registerFactory("persistent", () => {
 *   const store = new MemoryStore({ storage: new SqliteStorageBackend() });
 *   await store.init({ connectionString: "./memory.db" });
 *   return store;
 * });
 *
 * // 使用
 * const store = registry.get("persistent");
 * ```
 */
export interface IMemoryStoreRegistry {
  /**
   * 注册一个已初始化的 IMemoryStore 实例。
   * @param name 注册名称（全局唯一）
   * @param store IMemoryStore 实例
   * @param config 可选的配置覆盖
   * @throws 如果 name 已存在
   */
  register(name: string, store: IMemoryStore, config?: MemoryStoreConfig): void;

  /**
   * 注册一个 IMemoryStore 工厂（惰性初始化）。
   * @param name 注册名称（全局唯一）
   * @param factory 工厂函数，首次 get() 时调用
   * @param config 可选的配置覆盖
   */
  registerFactory(name: string, factory: () => IMemoryStore, config?: MemoryStoreConfig): void;

  /**
   * 按名称查找存储实例。
   * 如果是工厂注册且尚未初始化，自动调用工厂创建实例。
   * @param name 注册名称
   * @returns IMemoryStore 实例，或 undefined
   */
  get(name: string): IMemoryStore | undefined;

  /**
   * 获取当前默认的存储实例。
   * 未设置时返回第一个注册的实例。
   */
  getDefault(): IMemoryStore;

  /**
   * 切换默认存储实例。
   * @param name 已注册的存储名称
   * @throws 如果 name 未注册
   */
  switchDefault(name: string): void;

  /**
   * 注销存储实例。
   * 如果已初始化，调用其 close() 后再移除。
   * @param name 注册名称
   */
  unregister(name: string): Promise<void>;

  /**
   * 获取所有已注册的存储名称。
   */
  getNames(): readonly string[];

  /**
   * 刷新所有已初始化的存储。
   */
  flushAll(): Promise<void>;

  /**
   * 关闭并注销所有已初始化的存储。
   */
  shutdownAll(): Promise<void>;
}
```

### 6.4 `StorageBackendRegistry` 接口

```typescript
// packages/memory/src/registry/backend-registry.ts

import type { IStorageBackend } from "../interfaces/storage-backend.js";

/**
 * 后端注册项。
 */
export type BackendRegistration =
  | { readonly name: string; readonly backend: IStorageBackend; readonly initialized: true }
  | { readonly name: string; readonly factory: () => IStorageBackend; readonly initialized: false };

/**
 * StorageBackendRegistry —— 存储后端实现注册中心。
 *
 * 设计目的：
 * 1. 允许用户注册自定义存储后端（如 RedisBackend、PostgreSQLBackend）
 * 2. 根据连接字符串自动匹配合适的后端
 * 3. 支持后端的惰性初始化
 *
 * 内置后端：
 *   - "in-memory" → InMemoryStorageBackend
 *   - "sqlite"    → SqliteStorageBackend
 *   - "redis"     → RedisStorageBackend（预留）
 *   - "postgres"  → PostgresStorageBackend（预留）
 */
export interface IStorageBackendRegistry {
  register(name: string, backend: IStorageBackend): void;
  registerFactory(name: string, factory: () => IStorageBackend): void;
  get(name: string): IStorageBackend | undefined;
  getByConnectionString(connectionString: string): IStorageBackend | undefined;
  unregister(name: string): Promise<void>;
  getNames(): readonly string[];
  shutdownAll(): Promise<void>;
}
```

### 6.5 注册机制使用示例

```typescript
import { MemoryStoreRegistry, MemoryStore, InMemoryStorageBackend, SqliteStorageBackend } from "@cortex/memory";

// ── 应用启动初始化 ──
const registry = new MemoryStoreRegistry();

// 注册内存存储（纯内存，无持久化，适合测试或 ephemeral 场景）
registry.register("ephemeral", new MemoryStore({
  storage: new InMemoryStorageBackend(),
}));

// 注册 SQLite 持久化存储（惰性初始化，减少启动开销）
registry.registerFactory("default", async () => {
  const store = new MemoryStore({
    storage: new SqliteStorageBackend({ dbPath: "./cortex-memory.db" }),
    embedder: new LocalEmbedder(),
    cache: new LRUCacheLayer({ maxSize: 1000 }),
  });
  await store.init();
  return store;
});

// 切换默认存储
await registry.switchDefault("default");

// ── 消费方使用 ──
const store = registry.getDefault();
await store.write({
  kind: "Insight",
  summary: "事务性记忆设计需求分析",
  semantic_gist: "母项目缺失事务性内存操作，需要 TransactionalMemoryStore 接口",
  source: { agentType: "Alhaitham", taskId: "task-memory-design" },
  content_blob: { analysis: "..." },
});
```

### 6.6 与 `@cortex/telemetry` 注册模式的对比

| 维度 | `ICollectorRegistry` | `IMemoryStoreRegistry` |
|---|---|---|
| 注册物 | `ITelemetryCollector` | `IMemoryStore` |
| 工厂支持 | `registerFactory()` | `registerFactory()` |
| 惰性初始化 | discriminated union | discriminated union |
| 默认实例 | 无（需手动指定） | `getDefault()` + `switchDefault()` |
| 生命周期 | `shutdownAll()` | `shutdownAll()` + `flushAll()` |
| 线程安全 | 单进程假设 | 单进程假设（+ 预留 ILockManager） |

---

## 七、包依赖设计

### 7.1 依赖矩阵

```
@cortex/memory
├── dependencies (必须)
│   └── 无运行时依赖（纯 TypeScript 实现）
│
├── optionalDependencies (可选)
│   ├── better-sqlite3  — SQLite 持久化后端需要
│   ├── @xenova/transformers — 本地嵌入需要
│   └── openai — OpenAI 嵌入需要
│
├── peerDependencies (过渡期)
│   └── @cortex/shared — 过渡期类型 re-export（v4.0 移除）
│
├── devDependencies
│   ├── typescript
│   ├── vitest
│   └── eslint
│
└── 明确不依赖
    ├── @cortex/engine — 去耦合目标
    ├── @cortex/config — 可选引用配置常量但不依赖
    └── @cortex/telemetry — 借鉴模式但不依赖
```

### 7.2 包名与版本策略

```json
{
  "name": "@cortex/memory",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./testing": {
      "types": "./dist/testing/index.d.ts",
      "import": "./dist/testing/index.js"
    }
  },
  "files": ["dist"],
  "engines": {
    "node": ">=20.0.0"
  }
}
```

---

## 八、迁移路径

### 8.1 Phase 1 — 类型提取与接口定义（v0.1.0）

```
目标：类型独立 + 接口定义完成
├── 从 @cortex/shared/memory.ts 迁出所有类型
│   ├── MemoryEntry, MemoryWriteInput, MemoryQuery
│   ├── MemoryLink, LinkType, ReadMode, MemorySource
│   ├── SemanticState, MemoryKind, MaintainReport
│   └── IMemoryStore 接口（增强版）
├── 新增接口（本设计文档定义）
│   ├── TransactionalMemoryStore
│   ├── IStorageBackend, IEmbeddingService, IVectorStore
│   ├── ICacheLayer, IMemoryEventBus, ILockManager
│   └── IMemoryStoreRegistry, IStorageBackendRegistry
├── shared 兼容性：memory.ts 改为 re-export from @cortex/memory
└── 测试：类型编译检查 + barrel 导出完整性
```

### 8.2 Phase 2 — 核心存储实现（v0.2.0）

```
目标：MemoryStore 可独立运行
├── MemoryStore Facade（从 engine 迁入，去 PipelineObserver）
├── InMemoryStorageBackend（纯内存完整实现）
├── MemoryLifecycle（状态机，从 engine 迁入）
├── MemoryQueryEngine（查询引擎，从 engine 迁入）
├── MemoryStoreRegistry（注册机制）
├── QueryBuilder（链式查询构建器）
└── 测试：store 单元测试 + registry 集成测试
```

### 8.3 Phase 3 — 持久化与嵌入（v0.3.0）

```
目标：SQLite + ONNX 可插拔集成
├── SqliteStorageBackend（原 MemoryPersistence，重构为 IStorageBackend）
├── SqliteMigrations（独立迁移定义）
├── LocalEmbedder（@xenova/transformers 集成）
├── NoopEmbedder（测试用）
├── LRUCacheLayer（默认缓存实现）
├── MemoryVectorStore（内存向量搜索实现）
└── 测试：SQLite 持久化测试 + 嵌入降级测试
```

### 8.4 Phase 4 — 事务与管道（v0.4.0）

```
目标：事务性操作 + Pipeline 集成
├── DefaultTransactionalStore（TransactionalMemoryStore 实现）
├── MemoryPipeline（从 engine 迁入，去 PipelineObserver）
├── MemoryEventBus（事件总线实现）
├── SkillBridge（从 engine 迁入）
└── 测试：事务原子性测试 + 并发测试
```

### 8.5 Phase 5 — 工具与运维（v0.5.0）

```
目标：生产就绪
├── MemoryFactory（测试数据工厂）
├── MockMemoryStore（完整 mock 实现）
├── MemoryStatsCollector（统计收集）
├── MigrationRunner（独立迁移运行器）
├── OpenAIEmbedder（OpenAI 嵌入适配器）
├── PgVectorStore（pgvector 适配器预留）
├── 导出/导入（快照工具）
└── 测试：全量集成测试
```

### 8.6 Phase 6 — engine 适配（v1.0.0）

```
目标：engine 零破坏切换
├── engine 创建 @cortex/memory 适配层
├── PipelineObserver → IMemoryEventBus 适配器
├── engine/memory/* → @cortex/memory 包装
├── shared/memory.ts → 标记 @deprecated
└── 逐步废弃 engine/memory/*
```

---

## 九、与现有包的接口合约

### 9.1 `@cortex/shared` 变动合约

```typescript
// shared/src/memory.ts → v4.0 标记为 @deprecated

/**
 * @deprecated 从 v4.0 起记忆类型迁至 @cortex/memory
 * 此 re-export 提供向后兼容，将在下个主版本移除。
 * 请迁移至: import { ... } from "@cortex/memory";
 */
export {
  type MemoryEntry,
  type MemoryWriteInput,
  type MemoryQuery,
  type MemoryLink,
  type MemorySource,
  type MemoryKind,
  type SemanticState,
  type ReadMode,
  type IMemoryStore,
  type MaintainReport,
  LinkType,
} from "@cortex/memory";
```

### 9.2 `@cortex/engine` 适配层合约

```typescript
// engine/src/memory/engine-memory-adapter.ts

/**
 * EngineMemoryEventAdapter —— 将 @cortex/memory 的 IMemoryEventBus
 * 适配到 @cortex/engine 的 IPipelineObserver。
 *
 * 这是 engine 使用 @cortex/memory 的唯一桥接层，约 50 行。
 * 当 engine 自身也迁至独立事件总线后可移除此适配器。
 */
export class EngineMemoryEventAdapter {
  constructor(
    private readonly memoryBus: IMemoryEventBus,
    private readonly observer: IPipelineObserver,
  ) {
    this.memoryBus.on("*", this._forward);
  }

  private _forward = (event: MemoryEvent): void => {
    this.observer.emit({
      type: PipelineEventType.MemorySqlDegraded,
      priority: event.severity === "critical" || event.severity === "error"
        ? PipelinePriority.HIGH
        : PipelinePriority.NORMAL,
      payload: event.payload ?? {},
      timestamp: event.timestamp,
    });
  };

  detach(): void {
    this.memoryBus.off("*", this._forward);
  }
}
```

### 9.3 `@cortex/config` 引用合约

`@cortex/memory` 不应直接依赖 `@cortex/config`，但可选择性读取配置常量：

```typescript
// memory/src/config/memory-config.ts
// 不 import @cortex/config，而是定义自己的配置类型
// 由外层（engine 或 CLI）负责从 @cortex/config 读取值并注入

export interface MemoryConfig {
  dbPath?: string;
  maxTotalMemories?: number;
  embeddingDim?: number;
  weightAgingFactor?: number;
  staleFreezeDays?: number;
  frozenObliterateDays?: number;
}
```

### 9.4 `@cortex/telemetry` 借鉴模式

`@cortex/memory` 的注册机制设计直接借鉴 `@cortex/telemetry` 的 `ICollectorRegistry`：

| telemetry 模式 | memory 适配 |
|---|---|
| `ICollectorRegistry` | `IMemoryStoreRegistry` |
| `CollectorFactory` | `StoreFactory` |
| `ConsoleCollector` / `FileCollector` | `InMemoryStorageBackend` / `SqliteStorageBackend` |
| `registerFactory()` 惰性初始化 | 同上 |
| discriminated union `CollectorRegistration` | `StoreRegistration` |

### 9.5 其他包影响矩阵

| 包 | 当前 | 迁移后 | 破坏性 |
|---|---|---|---|
| `@cortex/cli` | 通过 engine 间接使用记忆 | 可选直接 `import from "@cortex/memory"` | 无（可选） |
| `@cortex/llm` | 无法读记忆 | 可 `import { IMemoryStore } from "@cortex/memory"` | 无（新增） |
| `@cortex/testing` | 无法 mock 记忆 | `import { MockMemoryStore } from "@cortex/memory/testing"` | 无（新增） |
| `@cortex/data` | 自己的 TaskRepository | 可选择实现 `IStorageBackend` | 无（可选） |
| `@cortex/factory` | 无记忆使用 | 无变化 | 无 |
| `@cortex/notification` | 无记忆使用 | 无变化 | 无 |
| `@cortex/parser` | 无记忆使用 | 无变化 | 无 |

---

## 十、消费方指南

### 10.1 快速开始

```typescript
import { MemoryStore, InMemoryStorageBackend, QueryBuilder } from "@cortex/memory";

// 创建纯内存记忆存储
const store = new MemoryStore({
  storage: new InMemoryStorageBackend(),
});
await store.init();

// 写入记忆
const id = await store.write({
  kind: "Insight",
  summary: "架构设计决策",
  semantic_gist: "记忆包应采用可插拔后端架构",
  source: { agentType: "Alhaitham", taskId: "task-memory-design" },
  content_blob: { decision: "interface-based SPI" },
});

// 读取记忆
const results = await store.read(
  new QueryBuilder()
    .ofKind("Insight")
    .withKeywords("可插拔", "后端")
    .limit(5)
    .build()
);

// 按 ID 操作
const entry = await store.get(id);
await store.delete(id);
```

### 10.2 事务性操作

```typescript
import { MemoryStore, SqliteStorageBackend } from "@cortex/memory";
import type { TransactionalMemoryStore } from "@cortex/memory";

const store = new MemoryStore({
  storage: new SqliteStorageBackend({ dbPath: "./memory.db" }),
}) as MemoryStore & TransactionalMemoryStore;

// 开启事务
const txn = await store.beginTransaction("Serializable");

try {
  const id1 = await store.writeWithin(txn, { kind: "TaskLog", summary: "步骤1", ... });
  const id2 = await store.writeWithin(txn, { kind: "TaskLog", summary: "步骤2", ... });
  store.linkWithin(txn, id1, id2, LinkType.DerivedFrom);

  // 原子提交
  const result = await store.commit(txn);
  console.log(`已提交 ${result.affectedCount} 条记忆`);
} catch (error) {
  // 自动回滚所有未提交操作
  await store.rollback(txn);
  console.error("事务回滚", error);
}
```

### 10.3 多后端切换

```typescript
import { MemoryStoreRegistry, MemoryStore, InMemoryStorageBackend, SqliteStorageBackend } from "@cortex/memory";

const registry = new MemoryStoreRegistry();

// 开发环境：内存存储
registry.register("dev", new MemoryStore({ storage: new InMemoryStorageBackend() }));

// 生产环境：SQLite 持久化（惰性初始化）
registry.registerFactory("prod", () => {
  const store = new MemoryStore({ storage: new SqliteStorageBackend({ dbPath: "./prod.db" }) });
  await store.init();
  return store;
});

// 根据环境切换
const env = process.env.NODE_ENV ?? "development";
await registry.switchDefault(env === "production" ? "prod" : "dev");

const store = registry.getDefault();
```

### 10.4 测试 Mock

```typescript
import { MockMemoryStore, createTestMemory } from "@cortex/memory/testing";

describe("MyService", () => {
  it("should read memories", async () => {
    const mockStore = new MockMemoryStore();
    const testMemory = createTestMemory({ kind: "Insight", summary: "测试" });

    await mockStore.write(testMemory);

    const results = await mockStore.read({ kind: "Insight" });
    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe("测试");
  });
});
```

---

## 附录 A：与 `analysis-memory-gap.md` 的关系

本文档是 `analysis-memory-gap.md`（已存在于 `packages/analysis-memory-gap.md`）的**实现层扩展**：

| 维度 | `analysis-memory-gap.md` | `DESIGN.md`（本文） |
|---|---|---|
| 定位 | 问题分析报告 | 架构设计文档 |
| 内容 | 问题枚举、根因分析 | 接口签名、模块结构、迁移路径 |
| 深度 | 宏观全景 + 缺失清单 | 具体接口定义、实现策略 |
| 产出 | 是否创建 @cortex/memory 的决策 🔒 | 实现 @cortex/memory 的蓝图 🔧 |

**建议**：合并两份文档或交叉引用。`analysis-memory-gap.md` 作为"为什么做"的依据，本文作为"怎么做"的规范。

## 附录 B：术语对照表

| 术语 | 含义 |
|---|---|
| MemoryStore | 记忆存储 Facade，对外统一接口 |
| TransactionalMemoryStore | 支持事务性操作（beginTransaction/commit/rollback）的存储 |
| IStorageBackend | 数据持久化后端 SPI（InMemory/SQLite/Redis/PostgreSQL） |
| IEmbeddingService | 语义嵌入服务 SPI（Local/OpenAI/Noop） |
| IVectorStore | 向量存储 SPI（内存/Pinecone/Chroma/pgvector） |
| ICacheLayer | 缓存层 SPI（LRU/Redis/Noop） |
| IMemoryEventBus | 内部事件总线，替代 engine 的 IPipelineObserver |
| MemoryStoreRegistry | Store 实例注册中心，支持按名称查找和切换 |
| StorageBackendRegistry | 存储后端实现注册中心，支持按连接字符串匹配 |
| QueryBuilder | 链式查询构建器，替代扁平 MemoryQuery 对象 |
| MemorySnapshot | 记忆快照格式，支持导出/导入 |
| two-phase commit | 两阶段提交：writePending → commitMemory / rollback |
| HCA / CSA | 检索模式：广度浅读 / 深度窄读 |

---

*文档版本：v1.0 | 最后更新：2025-07-16 | 状态：草案评审中*
