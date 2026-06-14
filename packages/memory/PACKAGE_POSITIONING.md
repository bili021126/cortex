# @cortex/memory 包定位

> 回答三个关键问题，明确 @cortex/memory 在 Cortex v2.0 生态系统中的位置。

---

## Q1: 这个包解决什么问题？

**@cortex/memory 解决母项目记忆系统的「非独立包」架构问题。**

在母项目中，所有记忆存储实现都位于 `@cortex/engine` 包内（`engine/memory/` 目录），导致以下严重问题：

1. **高耦合**：任何非 engine 包（CLI、LLM、testing）想使用记忆功能，必须依赖整个 engine
2. **不可插拔**：存储后端硬编码为 SQLite（better-sqlite3），无法运行时切换为内存、Redis、PostgreSQL
3. **无事务语义**：只有单条目两阶段提交（writePending/commitMemory），缺乏跨多条目的原子事务
4. **不可测试**：没有独立的 MockMemoryStore，测试只能依赖完整 engine 环境
5. **无注册机制**：后端选择 hardcode，无法运行时动态注册和切换

**@cortex/memory 将记忆系统从 engine 中解耦，成为独立领域包**，消费方只需 `import { IMemoryStore } from "@cortex/memory"` 即可获得完整的记忆存储能力，无需引入 engine。

具体解决的缺失清单（来自 design.md）：

| 缺失编号 | 问题 | 解决方案 |
|---|---|---|
| M1 | 记忆非独立包 | @cortex/memory 独立包发布 |
| M3 | 无可配置持久化后端 | IStorageBackend SPI + 多种实现 |
| M5 | 无可配置缓存层 | ICacheLayer SPI（预留） |
| M10 | 无事务性内存操作 | TransactionalMemoryStore 接口 |
| M11 | 无存储后端注册机制 | MemoryStoreRegistry 注册表 |
| M12 | 无快照/导出/导入 | exportSnapshot/importSnapshot（预留） |

---

## Q2: 这个包的职责边界是什么？

### 职责内（本包负责）

- **记忆存储核心接口**：定义 `IMemoryStore`（只读）和 `TransactionalMemoryStore`（读写+事务）
- **纯内存实现**：`InMemoryMemoryStore` — 基于 Map 的轻量实现，适合测试和临时场景
- **文件持久化实现**：`FileBasedMemoryStore` — 基于 JSON 文件的持久化，适合单进程轻量场景
- **注册表管理**：`MemoryStoreRegistry` — 按名称注册、查找、切换存储实例（工厂模式 + 惰性初始化）
- **统一错误类型**：`MemoryStoreError` 层次化错误体系
- **存储 SPI 定义**：定义 `IStorageBackend`、`IEmbeddingService`、`IVectorStore`、`ICacheLayer` 等 SPI 接口（接口定义，不强制实现）

### 职责外（本包不负责）

- **不负责 Agent 管理**：Agent 的定义、注册、调度由 `@cortex/engine` 或 `@cortex/agent` 负责
- **不负责 Pipeline 编排**：记忆增强执行管道（Retrieval→ReAct→Write）属于 `@cortex/engine`
- **不负责技能持久化桥**：Skill ↔ Memory 双向读写由 engine 的 skill-persister 负责
- **不负责嵌入计算**：语义嵌入由 `IEmbeddingService` 实现方（如 `@cortex/embedding`）负责
- **不负责向量搜索集群**：分布式向量搜索由 `IVectorStore` 实现方（如 Pinecone、Chroma）负责
- **不负责配置加载**：配置读取由 `@cortex/config` 负责，本包只定义自己的 `MemoryConfig` 类型
- **不负责遥测**：事件监控和遥测由 `@cortex/telemetry` 负责

### 边界原则

```
┌─────────────────────────────────────────────────┐
│  @cortex/memory 边界                             │
│                                                   │
│  提供接口 + 默认实现 + 注册机制                    │
│  不依赖 engine、不依赖运行时框架                    │
│  消费方只需 @cortex/memory + 实现 SPI 即可          │
└─────────────────────────────────────────────────┘
         ↕ 接口依赖
┌─────────────────────────────────────────────────┐
│  实现方（本包内置 / 第三方）                       │
│  InMemoryMemoryStore  ← 本包内置                  │
│  FileBasedMemoryStore  ← 本包内置                 │
│  SqliteStorageBackend  ← @cortex/memory-sqlite    │
│  RedisStorageBackend   ← 第三方包                  │
└─────────────────────────────────────────────────┘
```

---

## Q3: 这个包和其他包的关系是什么？

### 依赖关系

```
@cortex/memory
├── dependencies
│   ├── @cortex/config    (workspace:*) — 引用配置常量（FILE_CYRENE_MEMORY_DB 等）
│   └── @cortex/shared    (workspace:*) — 引用记忆类型（MemoryEntry, MemoryQuery, LinkType 等）
│
├── devDependencies
│   ├── typescript, vitest, @types/node
│
└── 不依赖
    ├── @cortex/engine     — 去耦合目标，零依赖
    ├── @cortex/telemetry  — 借鉴模式但不依赖
    └── 任何运行时框架
```

### 与其他包的协作

| 包 | 关系类型 | 说明 |
|---|---|---|
| `@cortex/shared` | **类型依赖** | 引用 `memory.ts` 中的 `MemoryEntry`、`MemoryQuery`、`LinkType` 等类型 |
| `@cortex/config` | **常量依赖** | 引用配置常量（路径、默认值等），纯编译时依赖 |
| `@cortex/engine` | **无依赖** | 当前 engine 的 `memory/` 目录应逐步迁移至此包 |
| `@cortex/telemetry` | **模式借鉴** | Registry 模式借鉴 telemetry 的 `ICollectorRegistry` 设计 |
| `@cortex/testing` | **消费者** | testing 包可通过 `@cortex/memory` 获取 MockMemoryStore |
| `@cortex/cli` | **消费者** | CLI 可直接 `import from "@cortex/memory"` 访问记忆 |
| `@cortex/llm` | **消费者** | LLM 包可直接读取记忆，无需经过 engine |

### 迁移路线

```
Phase 1 (当前)     →  @cortex/memory 独立发布，双实现就绪
Phase 2 (v0.2.0)  →  engine 创建适配层，逐步迁移 memory/ 子模块
Phase 3 (v1.0.0)  →  engine/memory/* 废弃，全部切换至 @cortex/memory
Phase 4 (v2.0.0)  →  shared/memory.ts 标记 @deprecated，re-export from @cortex/memory
```

---

*文档版本：v1.0 | 最后更新：2025-07-16*
