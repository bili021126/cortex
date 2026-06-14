# @cortex/memory — 记忆系统独立包

## 概述

`@cortex/memory` 是 Cortex v2.0 的记忆系统独立包，提供可插拔的记忆存储架构。支持纯内存存储和 JSON 文件持久化，未来可扩展 SQLite、Redis 等后端。

## 安装

```bash
pnpm add @cortex/memory
```

## 快速开始

### 纯内存存储

```typescript
import { InMemoryMemoryStore } from "@cortex/memory";

const store = new InMemoryMemoryStore();
await store.init(":memory:");

const id = await store.write({
  kind: "Insight",
  summary: "架构设计决策",
  semantic_gist: "记忆包应采用可插拔后端架构",
  source: { agentType: "Alhaitham", taskId: "task-design" },
  content_blob: { decision: "interface-based SPI" },
});

const entry = await store.get(id);
console.log(entry?.summary); // "架构设计决策"
```

### 文件持久化存储

```typescript
import { FileBasedMemoryStore } from "@cortex/memory";

const store = new FileBasedMemoryStore();
await store.init("./memory-data");

// 写入数据
const id = await store.write({
  kind: "TaskLog",
  summary: "任务执行记录",
  semantic_gist: "任务成功完成",
  source: { agentType: "Cyno", taskId: "task-exec" },
  content_blob: { result: "success" },
});

// 数据自动持久化到磁盘
await store.flush();
```

### 使用注册表管理多个存储

```typescript
import { MemoryStoreRegistry, InMemoryMemoryStore } from "@cortex/memory";

const registry = new MemoryStoreRegistry();

// 注册默认内存存储
registry.register("default", new InMemoryMemoryStore());

// 注册工厂（惰性初始化）
registry.registerFactory("persistent", async () => {
  const store = new FileBasedMemoryStore();
  await store.init("./data");
  return store;
});

// 切换默认存储
registry.switchDefault("persistent");

// 获取并使用
const store = await registry.getDefault();
```

## 特性

- **双接口设计**：`IMemoryStore` 只读接口 + `TransactionalMemoryStore` 读写事务接口
- **纯内存实现**：`InMemoryMemoryStore` — 基于 Map，零外部依赖
- **文件持久化**：`FileBasedMemoryStore` — JSON 文件存储，支持自动刷写
- **注册表模式**：`MemoryStoreRegistry` — 按名称注册、查找、切换存储实例
- **事务支持**：beginTransaction → writeWithin → commit/rollback
- **两阶段提交**：writePending → commitMemory/rollback
- **查询引擎**：按类别、关键词、时间范围、metadata 过滤
- **BFS 图遍历**：关联链路展开
- **会话管理**：beginSession/endSession 自动生命周期管理
- **生命周期**：Active → Archived → Obliterated 三态管理

## 包结构

```
packages/memory/
├── src/
│   ├── index.ts                              # 桶导出
│   ├── interfaces/
│   │   ├── MemoryStore.ts                    # IMemoryStore 只读接口
│   │   └── TransactionalMemoryStore.ts       # 事务性接口
│   ├── implementations/
│   │   ├── InMemoryMemoryStore.ts            # 纯内存实现
│   │   └── FileBasedMemoryStore.ts           # JSON 文件持久化
│   ├── registry/
│   │   └── MemoryStoreRegistry.ts            # 注册表+工厂模式
│   └── errors/
│       └── MemoryStoreError.ts               # 统一错误类型
├── tests/
│   ├── InMemoryMemoryStore.test.ts
│   ├── FileBasedMemoryStore.test.ts
│   └── MemoryStoreRegistry.test.ts
├── examples/
│   └── basic-usage.ts
├── package.json
└── tsconfig.json
```

## 设计原则

- **接口隔离（ISP）**：每个接口只有一个职责
- **依赖反转（DIP）**：实现依赖接口而非具体实现
- **组合优于继承**：存储组合多个抽象层
- **禁止 any**：所有公开类型使用具体 interface
- **禁止非空断言**：使用类型窄化替代 `!`
- **readonly 优先**：共享数据字段均为 readonly
- **discriminated union**：窄化状态空间

## API

### IMemoryStore（只读）

| 方法 | 说明 |
|---|---|
| `get(id)` | 按 ID 获取记忆只读快照 |
| `peek(id)` | 按 ID 获取内部引用 |
| `has(id)` | 检查存在性 |
| `read(query, mode?)` | 按条件检索 |
| `getLinks(sourceId)` | 获取关联链路 |
| `getBySession(sessionId)` | 按会话查询 |
| `getPending()` | 获取 Pending 条目 |
| `hasPending()` | 检查 Pending 存在 |
| `init(dbPath)` | 初始化 |
| `beginSession(externalId?)` | 开始会话 |
| `endSession()` | 结束会话 |
| `flush()` | 刷写持久化 |
| `close()` | 关闭存储 |

### TransactionalMemoryStore（读写 + 事务）

继承 IMemoryStore，增加：

| 方法 | 说明 |
|---|---|
| `write(input)` | 写入记忆 |
| `set(id, entry)` | 按 ID 覆盖 |
| `delete(id)` | 删除记忆 |
| `writeMany(inputs)` | 批量写入 |
| `linkMany(links)` | 批量关联 |
| `cas(id, expected, newState)` | 比较并交换状态 |
| `archive(id)` | 归档 |
| `obliterate(id)` | 湮灭 |
| `writePending(input)` | 两阶段提交：写入 |
| `commitMemory(memoryId)` | 两阶段提交：提交 |
| `rollback(memoryId)` | 两阶段提交：回滚 |
| `link(sourceId, targetId, linkType)` | 创建关联 |
| `beginTransaction(isolation?)` | 开启事务 |
| `writeWithin(txn, input)` | 事务内写入 |
| `writeManyWithin(txn, inputs)` | 事务内批量写入 |
| `linkWithin(txn, ...)` | 事务内关联 |
| `linkManyWithin(txn, links)` | 事务内批量关联 |
| `readWithin(txn, query, mode?)` | 事务内读取 |
| `commit(txn)` | 提交事务 |
| `rollback(txn)` | 回滚事务 |

## 许可证

私有 — Cortex v2.0 内部包
