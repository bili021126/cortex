# 记忆系统域分析：功能覆盖与缺失 → `@cortex/memory` 包设计

> **分析范围**：母项目 15 个 package 的全部源文件  
> **分析深度**：类型定义 → 实现架构 → 消费方代码 → 测试覆盖  
> **输出目标**：确定 `@cortex/memory` 包的接口、类型、模块边界

---

## 一、现有记忆系统全景图

### 1.1 当前记忆代码分布

| 包 | 文件/模块 | 角色 | 行数约计 |
|---|---|---|---|
| `@cortex/shared/src/memory.ts` | `MemoryEntry`, `MemoryWriteInput`, `MemoryQuery`, `IMemoryStore`, `LinkType` 等 | **类型中枢** — 所有记忆类型的"宪法"定义 | ~260 |
| `@cortex/engine/src/memory/memory-store.ts` | `MemoryStore` class（Facade） | **实现中枢** — 记忆读写+去重+生命周期+session 管理 | ~550 |
| `@cortex/engine/src/memory/storage.ts` | `MemoryStorage` class | **内存存储引擎** — Map<id, MemoryEntry> + links Map | ~260 |
| `@cortex/engine/src/memory/persistence.ts` | `MemoryPersistence` class | **SQLite 持久化** — WAL 模式、建表迁移、FTS5、防抖刷写 | ~400 |
| `@cortex/engine/src/memory/lifecycle.ts` | `MemoryLifecycle` class | **三态状态机** — Active → Archived → Obliterated | ~110 |
| `@cortex/engine/src/memory/query.ts` | `MemoryQueryEngine` class | **查询引擎** — 内存扫描 + BFS 图遍历 + 向量余弦召 | ~210 |
| `@cortex/engine/src/memory/schema.ts` | 常量定义 | EMBEDDING_DIM / MAX_TOTAL_MEMORIES / 权重老化因子等 | ~60 |
| `@cortex/engine/src/memory/embedding.ts` | `embedText`, `embedBatch`, `IEmbeddingService` | **语义嵌入** — @xenova/transformers 384d 本地 ONNX | ~130 |
| `@cortex/engine/src/memory/pipeline.ts` | `executeWithMemoryPipeline` + 4 个 Step | **记忆增强执行管道** — 检索→ReAct→写入 | ~250 |
| `@cortex/engine/src/memory/skill-pipeline.ts` | `extractAndPersistSkills`, `registerSkillPipeline` | **技能闭环订阅者** — NodeComplete → 技能提取→持久化 | ~120 |
| `@cortex/engine/src/memory/monitor.ts` | `MemoryStoreMonitor` | **事件监控** — 内存事件阈值告警 | ~130 |
| `@cortex/engine/src/memory/index.ts` | 桶导出 | 10 个公开符号 | ~40 |
| `@cortex/engine/src/components/skill-persister.ts` | `persistSkillsToMemory`, `loadSkillsFromMemory`, `crystallizeSkillToKnowledge`, `verifySkillKnowledge` | **技能-记忆桥** — Skill ↔ Memory 双向持久化 | ~350 |
| `@cortex/engine/src/agents/registry.ts` | 每个 Agent 的 MemoryQuery 参数 | **消费端注册** — 9 个 Agent 的自定义检索策略 | ~180 |
| `@cortex/data/src/storage/` | `TaskRepository`, `JsonFileAdapter` | **任务存储** — 独立的 JSON 文件持久化，*不* 使用记忆系统 | ~200 |

### 1.2 记忆数据流（当前架构）

```
┌─ @cortex/shared ─────────────────────────────┐
│  IMemoryStore 接口 / MemoryEntry 类型 /        │
│  MemoryWriteInput / MemoryQuery / LinkType    │
└────────────────────┬─────────────────────────┘
                     │  Type import
                     ▼
┌─ @cortex/engine ────────────────────────────────┐
│                                                   │
│  ┌─ MemoryStore (Facade) ────────────────────┐   │
│  │  write() → 去重→嵌入→存Map→write-through DB│   │
│  │  read()  → SQL→向量召→BFS→权重老化→排序    │   │
│  │  link() / cas() / archive() / obliterate() │   │
│  │  beginSession() / endSession() / maintain()│   │
│  ├────────────────────────────────────────────┤   │
│  │  ▲ 依赖 PipelineObserver（engine 基建）    │   │
│  │  ▲ 依赖 better-sqlite3（硬编码）           │   │
│  │  ▲ 依赖 @xenova/transformers（硬编码）     │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  ┌─ 管道层 ─────────────────────────────────┐   │
│  │  MemoryRetrievalStep → ReActLoopStep →    │   │
│  │  MemoryWriteStep                           │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  ┌─ 技能闭环 ───────────────────────────────┐   │
│  │  extractAndPersistSkills → MemoryStore    │   │
│  │  crystallizeSkillToKnowledge → MemoryStore │   │
│  └────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────┘
```

---

## 二、功能覆盖评估

### ✅ 已覆盖（成熟度评估）

| 功能 | 成熟度 | 说明 |
|---|---|---|
| CRUD 基本操作 | ★★★★☆ | write/read/link/has/peek 完备 |
| 三态生命周期 | ★★★★☆ | Active/Archived/Obliterated + CAS 原子性 |
| SQLite WAL 持久化 | ★★★★☆ | write-through、防抖刷写、指数退避、重连 |
| 内容去重 | ★★★★☆ | SHA256 精确 + 向量相似 (0.95) 双层 |
| BFS 图遍历 | ★★★☆☆ | 出边/入边衰减展开，噪声门限 |
| 向量语义检索 | ★★★☆☆ | 384d ONNX 本地嵌入 + 余弦相似 TopK |
| Session 管理 | ★★★★☆ | beginSession/endSession 自动注入 |
| 两阶段提交 | ★★★★☆ | writePending → commitMemory / rollback |
| 自动维护 | ★★★☆☆ | maintain() 冻结 + 湮灭 + 孤儿边清理 |
| Pipeline 集成 | ★★★★☆ | Retrieval → ReAct → Write 三步管道 |
| 技能持久化桥 | ★★★☆☆ | Skill ↔ Memory 双向读写 |
| 知识结晶 | ★★★☆☆ | 技能→Insight 记忆 + 版本追踪 + 证据链 |
| FTS5 全文索引 | ★★★☆☆ | summary + semantic_gist 全文检索 |
| Schema 版本迁移 | ★★★☆☆ | v3→v4→v5 自动迁移 |
| DB 损坏自愈 | ★★★☆☆ | 检测malformed→删文件→重建 |
| 事件监控 | ★★☆☆☆ | MemoryStoreMonitor 基础阈值告警 |

### ❌ 未覆盖 / 严重缺失

| 缺失功能 | 影响 | 根因 |
|---|---|---|
| **记忆为独立包** | 任何非-engine 包想用记忆 → 要么依赖整个 engine，要么放弃 | 实现与 engine 紧耦合 |
| **去 Engine 依赖** | MemoryStore 依赖 PipelineObserver（engine 基建），无法独立运行 | `_observer?: IPipelineObserver` 存在于 MemoryStore 构造器 |
| **可配置持久化后端** | 硬编码 better-sqlite3，无法切换为 Redis/PostgreSQL/内存-only | `new Database()` 在 persistence.ts 中直接构造 |
| **可配置嵌入后端** | 硬编码 @xenova/transformers，无配置切换（OpenAI/CLIP 等） | `defaultEmbeddingService` 编译时绑定 |
| **可配置缓存层** | 只 Map 内存一级缓存，无 LRU/TTL/Redis 分层 | MemoryStorage 就是 Map |
| **独立内存类型域** | 所有类型在 @cortex/shared 中与其他域混合导出 | 未按 DDD 拆分上下文 |
| **查询 DSL / 构建器** | MemoryQuery 是扁平接口，无链式/类型安全构建器 | 直接用对象字面量 |
| **记忆统计与分析** | MemoryStoreMonitor 只有告警，无命中率/热力图/趋势 | 无 analytics 模块 |
| **记忆迁移 CLI** | Schema 迁移硬编码在 persistence.ts 的 _createTables 中 | 无独立迁移运行器 |
| **测试夹具/工厂** | 每个测试文件自己构造 MemoryEntry，无工厂函数 | 无 `createTestMemory()` 等工具 |
| **TypeScript 类型守卫** | memory.ts 类型定义无 branded types / 运行时校验 | `MemoryKind` 为 string literal union |
| **批量操作** | write/delete/link 都单条，无 writeMany / deleteMany / linkMany | IMemoryStore 接口无批量方法 |
| **快照/导出/导入** | 无 memory dump/restore/export/import 工具 | 仅 SQLite 文件级 |
| **外部向量存储集成** | Pinecone/Chroma/pgvector 无抽象层 | MemoryQueryEngine 的 vectorRecall 是内存计算 |
| **分布式/并发安全** | 无多进程安全（better-sqlite3 进程锁未探讨） | 单进程假设 |
| **记忆垃圾回收** | maintain() 只做状态转移，不释放 memory Map 的 Obliterated 条目 | 无真正回收 |

---

## 三、缺失根因分析

### 3.1 架构演进历史

记忆系统从 v2 → v3 经历了：

1. **v2 早期**：记忆类型定义在 engine 内部 `types.ts`
2. **v2.x**：为了 Agent 跨包共享，将类型迁至 `@cortex/shared`（见 memory.ts 文件头的 `@contract` 注释：任何包要写入记忆必须构造此接口）
3. **v3 现状**：类型在 shared，实现在 engine，消费方（CLI、LLM、Testing）依赖 engine 间接使用

**迁移不彻底的原因**：记忆系统伴随 engine 重构（Core-1/2 组件化），一直作为 engine 内部子模块演进，未提升为独立包。

### 3.2 耦合链

```
@cortex/shared (IMemoryStore 接口)
    ↑
@cortex/engine (MemoryStore 类)
    ↑ 依赖 PipelineObserver (engine 事件基建)
    ↑ 依赖 better-sqlite3 (直接 new Database)
    ↑ 依赖 @xenova/transformers (硬编码 embedder)
    ↑
@cortex/cli  ──→ 想用记忆? 必须装 engine
@cortex/llm   ──→ 想用记忆? 必须装 engine
@cortex/testing ─→ 想 mock 记忆? 但 engine 类型在 shared
```

---

## 四、`@cortex/memory` 包设计

### 4.1 包定位

```
@cortex/memory —— 记忆系统独立包
├── 从 @cortex/shared 提取所有记忆类型
├── 从 @cortex/engine 提取 MemoryStore 实现
├── 解耦 PipelineObserver / better-sqlite3 / @xenova/transformers
├── 增加可插拔后端抽象
└── 提供测试工具、统计、迁移 CLI
```

### 4.2 模块划分

```
packages/memory/
├── src/
│   ├── index.ts                    # 桶导出
│   │
│   ├── types/                      # ★ 从 shared 迁入
│   │   ├── entry.ts                #   MemoryEntry, MemoryWriteInput
│   │   ├── query.ts                #   MemoryQuery, ReadMode
│   │   ├── link.ts                 #   MemoryLink, LinkType
│   │   ├── lifecycle.ts            #   MemoryKind, SemanticState
│   │   ├── session.ts              #   SessionId, MemorySource
│   │   └── index.ts                #   再导出
│   │
│   ├── interfaces/                 # ★ 可插拔抽象层（新设计）
│   │   ├── memory-store.ts         #   IMemoryStore（从 shared 迁入，增强）
│   │   ├── storage-backend.ts      #   ★ 新：IStorageBackend（可替换 SQLite/Redis/内存）
│   │   ├── embedding-service.ts    #   ★ 新：IEmbeddingService（从 engine 迁入，抽象化）
│   │   ├── vector-store.ts         #   ★ 新：IVectorStore（可替换 Pinecone/Chroma/pgvector）
│   │   ├── cache-layer.ts          #   ★ 新：ICacheLayer（可替换 LRU/Redis/无）
│   │   ├── event-bus.ts            #   ★ 新：IMemoryEventBus（替代 PipelineObserver）
│   │   ├── lock-manager.ts         #   ★ 新：ILockManager（分布式锁抽象）
│   │   └── index.ts
│   │
│   ├── store/                      # ★ 从 engine/memory 迁入，去耦合
│   │   ├── memory-store.ts         #   MemoryStore 实现（Facade）
│   │   ├── storage-backend.ts      #   DefaultStorageBackend（封装 MemoryMap + SQLite）
│   │   ├── cache-layer.ts          #   DefaultCacheLayer（LRUMap）
│   │   ├── lifecycle.ts            #   MemoryLifecycle（状态机）
│   │   ├── query-engine.ts         #   MemoryQueryEngine（扫描+BFS+向量）
│   │   └── schema.ts               #   常量（移至 config-aware）
│   │
│   ├── persistence/                # ★ 从 engine/memory 迁入，后端化
│   │   ├── sqlite-backend.ts       #   SqliteStorageBackend（原 MemoryPersistence）
│   │   ├── sqlite-migrations.ts    #   ★ 拆出独立迁移定义
│   │   └── memory-backend.ts       #   InMemoryStorageBackend（纯内存实现）
│   │
│   ├── embedding/                  # ★ 从 engine/memory 迁入，可切换
│   │   ├── local-embedder.ts       #   LocalEmbedder（@xenova/transformers）
│   │   ├── openai-embedder.ts      #   ★ 新：OpenAIEmbedder
│   │   └── noop-embedder.ts        #   ★ 新：NoopEmbedder（测试用）
│   │
│   ├── vector/                     # ★ 新：外部向量存储适配层
│   │   ├── memory-vector-store.ts  #   MemoryVectorStore（原内存向量搜索）
│   │   └── pgvector-store.ts       #   ★ 预留：pgvector 适配器
│   │
│   ├── pipeline/                   # ★ 从 engine/memory 迁入
│   │   ├── memory-pipeline.ts      #   执行管道（检索→执行→写入）
│   │   ├── retrieval-step.ts       #   MemoryRetrievalStep
│   │   └── write-step.ts          #   MemoryWriteStep
│   │
│   ├── skill-bridge/               # ★ 从 engine/components 迁入，去引擎化
│   │   ├── skill-persister.ts      #   persistSkillsToMemory / loadSkillsFromMemory
│   │   └── knowledge-crystallizer.ts # crystallizeSkillToKnowledge / verifySkillKnowledge
│   │
│   ├── analytics/                  # ★ 新：记忆统计与分析
│   │   ├── collector.ts            #   MemoryStatsCollector
│   │   ├── reporter.ts             #   MemoryStatsReporter
│   │   └── types.ts                #   统计类型
│   │
│   ├── monitor/                    # ★ 从 engine/memory 迁入，重构
│   │   ├── memory-monitor.ts       #   MemoryMonitor（取代 MemoryStoreMonitor）
│   │   └── alert-rules.ts          #   告警规则定义
│   │
│   ├── testing/                    # ★ 新：测试工具
│   │   ├── memory-factory.ts       #   createTestMemory() 工厂
│   │   ├── mock-store.ts           #   MockMemoryStore 完整实现
│   │   └── assert-memories.ts      #   记忆断言工具
│   │
│   ├── config/                     # ★ 新：记忆配置
│   │   ├── memory-config.ts        #   MemoryConfig 类型 + 默认值
│   │   └── config-schema.ts        #   Zod/JOI 校验
│   │
│   └── migrations/                 # ★ 新：独立迁移工具
│       ├── runner.ts               #   MigrationRunner
│       ├── registry.ts             #   迁移注册表
│       └── v4-to-v5.ts             #   迁移实例
│
├── tests/
│   ├── store/                      # 存储层测试
│   ├── persistence/                # 持久化测试
│   ├── query/                      # 查询引擎测试
│   ├── embedding/                  # 嵌入测试
│   ├── pipeline/                   # 管道测试
│   ├── analytics/                  # 统计测试
│   └── integration/                # 集成测试
│
├── package.json                    # @cortex/memory, 外部依赖可选
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

### 4.3 接口签名设计

#### 4.3.1 `IMemoryStore`（增强版，从 shared 迁入）

```typescript
// packages/memory/src/interfaces/memory-store.ts

import type {
  MemoryEntry, MemoryWriteInput, MemoryQuery,
  MemoryLink, MemorySource, MemoryKind, SemanticState,
} from "../types/index.js";
import type { ReadMode } from "../types/query.js";
import type { IStorageBackend } from "./storage-backend.js";
import type { IEmbeddingService } from "./embedding-service.js";
import type { IVectorStore } from "./vector-store.js";
import type { ICacheLayer } from "./cache-layer.js";
import type { IMemoryEventBus } from "./event-bus.js";

export interface MaintainReport {
  archived: number;
  obliterated: number;
  orphanedLinks: number;
  skipped?: string;
}

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
  /** 记忆上限 */
  maxTotalMemories?: number;
  /** 权重老化因子 */
  weightAgingFactor?: number;
  /** 自动归档未访问天数 */
  staleFreezeDays?: number;
  /** 湮灭归档天数 */
  frozenObliterateDays?: number;
}

export interface IMemoryStore {
  // ── 生命周期 ──
  init(config: MemoryStoreConfig): Promise<void>;
  close(): Promise<void>;
  readonly isReady: boolean;
  readonly size: number;

  // ── 会话 ──
  readonly sessionId?: string;
  beginSession(externalId?: string): string;
  endSession(): Promise<number>;

  // ── 写入 ──
  write(input: MemoryWriteInput): Promise<string>;
  writeMany(inputs: MemoryWriteInput[]): Promise<string[]>;    // ★ 新增
  writePending(input: MemoryWriteInput): string;
  commitMemory(memoryId: string): boolean;
  rollback(memoryId: string): boolean;

  // ── 读取 ──
  read(query: MemoryQuery, mode?: ReadMode): Promise<MemoryEntry[]>;
  getBySession(sessionId: string): MemoryEntry[];
  getPending(): MemoryEntry[];
  hasPending(): boolean;
  peek(memoryId: string): Readonly<MemoryEntry> | undefined;
  has(memoryId: string): boolean;

  // ── 关联 ──
  link(sourceId: string, targetId: string, linkType: LinkType): MemoryLink | null;
  linkMany(links: Array<{ sourceId: string; targetId: string; linkType: LinkType }>): (MemoryLink | null)[];  // ★ 新增
  getLinks(sourceId: string): MemoryLink[];

  // ── 生命周期管理 ──
  cas(memoryId: string, expected: SemanticState, newState: SemanticState): boolean;
  archive(memoryId: string): boolean;
  obliterate(memoryId: string): boolean;
  maintain(): MaintainReport;

  // ── 持久化 ──
  flush(): Promise<void>;

  // ── 钩子 ──
  setPreWriteHook(hook: (input: MemoryWriteInput) => MemoryWriteInput): void;
}
```

#### 4.3.2 `IStorageBackend`（新抽象）

```typescript
// packages/memory/src/interfaces/storage-backend.ts

import type { MemoryEntry, MemoryLink, MemoryWriteInput, MemoryQuery } from "../types/index.js";
import type { SemanticState } from "../types/lifecycle.js";

export interface IStorageBackend {
  /** 唯一标识（用于日志/诊断） */
  readonly name: string;

  /** 初始化（接收 dbPath 或连接串） */
  init(connectionString: string): Promise<void>;

  /** 关闭连接 */
  close(): Promise<void>;

  /** 是否已连接 */
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

#### 4.3.3 `IEmbeddingService`（迁入 + 增强）

```typescript
// packages/memory/src/interfaces/embedding-service.ts

export interface IEmbeddingService {
  readonly name: string;
  readonly dimensions: number;
  readonly isReady: boolean;

  embedText(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;

  /** 预热模型（可选） */
  warmup?(signal?: AbortSignal): Promise<void>;
}
```

#### 4.3.4 `IVectorStore`（新抽象）

```typescript
// packages/memory/src/interfaces/vector-store.ts

export interface IVectorStore {
  readonly name: string;
  readonly dimensions: number;

  init(config: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;

  /** 插入向量（id → 向量映射） */
  upsert(id: string, vector: number[]): Promise<void>;
  upsertBatch(entries: Array<{ id: string; vector: number[] }>): Promise<void>;

  /** 查询 Top-K 最相似向量 */
  query(vector: number[], topK: number): Promise<Array<{ id: string; score: number }>>;

  /** 删除 */
  remove(id: string): Promise<void>;

  /** 清空 */
  clear(): Promise<void>;
}
```

#### 4.3.5 `ICacheLayer`（新抽象）

```typescript
// packages/memory/src/interfaces/cache-layer.ts

export interface ICacheLayer {
  readonly name: string;

  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  readonly size: number;
}
```

#### 4.3.6 `IMemoryEventBus`（替代 PipelineObserver）

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
  | "memory:degraded";

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

### 4.4 类型提取与重构（从 shared 迁入）

```typescript
// packages/memory/src/types/entry.ts

/** 记忆认知类别 */
export type MemoryKind = "TaskLog" | "Insight" | "Skill";

/** 记忆来源锚点 */
export interface MemorySource {
  agentType: string;    // 原为 AgentType（跨域依赖）→ 改为 string，保持类型纯洁
  taskId: string;
}

export interface MemoryEntry {
  // §1 身份层（永不变）
  id: string;
  source: MemorySource;
  sessionId?: string;

  // §2 认知层
  kind: MemoryKind;
  summary: string;
  semantic_gist: string;
  content_blob: Record<string, unknown>;

  // §3 生命周期层
  semantic_state: SemanticState;
  weight: number;
  accessCount: number;
  lastAccessedAt: number;
  createdAt: number;

  // §4 工程层
  embedding?: number[];
  content_hash: string;
  expires_at?: number;
}

// 附加：运行时类型守卫（新）
export function isMemoryEntry(value: unknown): value is MemoryEntry { /* ... */ }
export function isValidMemoryKind(kind: string): kind is MemoryKind { /* ... */ }
```

### 4.5 包依赖设计

```
@cortex/memory
├── dependencies (必须)
│   ├── none at minimum runtime
│   └── (可选: better-sqlite3, @xenova/transformers 为 optionalDependencies)
│
├── devDependencies
│   ├── typescript
│   ├── vitest
│   └── eslint
│
└── peerDependencies (可选)
    └── @cortex/shared (迁移过渡期：共享 AgentType 枚举)
```

**关键原则**：`@cortex/memory` **不依赖** `@cortex/engine`、`@cortex/config`、`@cortex/shared`（除非过渡期）。它是独立的领域包。

### 4.6 消费方迁移路径

| 包 | 当前 | 迁移后 |
|---|---|---|
| `@cortex/engine` | `import { MemoryStore, IMemoryStore } from "@cortex/engine"` | `import { MemoryStore, IMemoryStore } from "@cortex/memory"` |
| `@cortex/cli` | 通过 engine 间接使用记忆 | `import { IMemoryStore } from "@cortex/memory"` — 直接 |
| `@cortex/testing` | 无法 mock 记忆（类型在 shared，实现在 engine） | `import { MockMemoryStore, createTestMemory } from "@cortex/memory/testing"` |
| `@cortex/llm` | 无法直接读记忆 | `import { IMemoryStore } from "@cortex/memory"` |
| `@cortex/shared` | 导出 memory.ts（被拆分） | **删除** memory.ts，类型改从 @cortex/memory 导入 |

### 4.7 实施顺序（Phase 建议）

```
Phase 1 — 类型提取
  └─ 从 shared 迁出类型 → packages/memory/src/types/
  └─ 接口定义（IMemoryStore, IStorageBackend 等）
  └─ shared 的 barrel export 改为 re-export from @cortex/memory

Phase 2 — 核心实现
  └─ MemoryStore (Facade) — 依赖接口而非具体实现
  └─ InMemoryStorageBackend
  └─ MemoryLifecycle（状态机）
  └─ MemoryQueryEngine（扫描 + BFS）

Phase 3 — 持久化与嵌入
  └─ SqliteStorageBackend（从 engine/persistence 迁入）
  └─ LocalEmbedder（从 engine/embedding 迁入）
  └─ 可选 OpenAIEmbedder

Phase 4 — 管道与桥
  └─ MemoryPipeline（从 engine/pipeline 迁入，去 PipelineObserver）
  └─ SkillBridge（从 engine/skill-persister 迁入）

Phase 5 — 工具与运维
  └─ 测试夹具 / MockMemoryStore
  └─ MemoryStatsCollector
  └─ MigrationRunner
  └─ 向量存储适配器（pgvector 预留）

Phase 6 — engine 适配
  └─ engine 的 memory/ 目录包装 @cortex/memory（适配层）
  └─ PipelineObserver → IMemoryEventBus 适配器
  └─ 逐步废弃 engine/memory/*
```

---

## 五、与现有包的接口合约

### 5.1 `@cortex/engine` 适配层

engine 需要 `@cortex/memory` 提供以下适配：

```typescript
// engine/src/memory/engine-memory-adapter.ts
// 将 IMemoryEventBus → IPipelineObserver

import { type IMemoryEventBus, type MemoryEvent } from "@cortex/memory";
import { type IPipelineObserver, PipelinePriority } from "@cortex/shared";

export class EngineMemoryEventAdapter {
  constructor(
    private readonly memoryBus: IMemoryEventBus,
    private readonly observer: IPipelineObserver,
  ) {
    this.memoryBus.on("*", this._forwardToObserver);
  }

  private _forwardToObserver(event: MemoryEvent): void {
    this.observer.emit({
      type: `memory.${event.type}` as any,
      priority: severityToPriority(event.severity),
      payload: event.payload ?? {},
      timestamp: event.timestamp,
    });
  }

  detach(): void {
    this.memoryBus.off("*", this._forwardToObserver);
  }
}
```

### 5.2 `@cortex/shared` 变动

```typescript
// shared/src/memory.ts → 全部删除，改为 re-export

/**
 * @deprecated 从 v3.0 起记忆类型迁至 @cortex/memory
 * 此 re-export 提供向后兼容，将在下个主版本移除。
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
  MemoryType,       // @deprecated
  MemoryState,      // @deprecated
  MemorySubType,    // @deprecated
  LinkType,
} from "@cortex/memory";
```

### 5.3 其他包影响

| 包 | 变动 |
|---|---|
| `@cortex/cli` | 可选择性依赖 `@cortex/memory` 替代通过 `@cortex/engine` 间接使用 |
| `@cortex/factory` | 目前未直接使用记忆，无需变更 |
| `@cortex/llm` | 可新增 `@cortex/memory` 依赖，实现 LLM 日志记忆 |
| `@cortex/data` | 当前使用自己的 TaskRepository/JsonFileAdapter **不** 使用记忆系统。未来可考虑 TaskRepository 实现基于 IMemoryStore |
| `@cortex/notification` | 目前无记忆关联 |
| `@cortex/parser` | 目前无记忆关联 |
| `@cortex/testing` | 强烈受益 — 可依赖 `@cortex/memory/testing` 获取测试工具 |

---

## 六、结论

### 6.1 创建 `@cortex/memory` 包的决策

**批准 ✅** — 理由：

1. **架构独立性**：记忆是横切关注点，不应埋在 engine 内部。CLI、LLM、Testing、未来包都需要记忆能力但不应依赖 engine。
2. **解耦迫切需要**：当前 coupling 阻碍了 engine 重构（见 engine-refactor-plan.md）——engine 变小而 memory 变独立，是重构的前提条件。
3. **包大小合理**：迁移后约 15-20 个源文件，3K-4K 行，边界清晰。
4. **向后兼容可保证**：通过 shared re-export + engine 适配层，零外部破坏。

### 6.2 不包含在 `@cortex/memory` 中的功能

| 功能 | 原因 | 归属 |
|---|---|---|
| Agent 记忆查询策略 | 属于 Agent 领域配置 | `@cortex/engine/agents/registry.ts` |
| ReAct 循环 | 属于 Agent 执行模型 | `@cortex/engine/components/react-loop.ts` |
| PipelineRunner | 属于调度框架 | `@cortex/engine/core/pipeline-runner.ts` |
| SkillRegistry | 属于技能系统 | `@cortex/engine/registry/skill-registry.ts` |
| 工具执行（Toolkit） | 属于执行平台 | `@cortex/engine/platform/toolkit.ts` |

### 6.3 风险与缓解

| 风险 | 缓解 |
|---|---|
| 迁移过程破坏现有测试 | Phase 1 仅类型移动 + shared re-export，测试零改动 |
| engine 适配层增加间接性 | 适配层是 1 个文件 ~50 行，开销极低 |
| 新包初期缺少外部向量存储实现 | Phase 5 作为预留，不做为 must-have |
| 包拆分后版本管理复杂度 | 跟随 monorepo 模式，统一版本 |
