# data-review.md 审查结论提取

> 源文件：`test-output\self-examination-soft\data-review.md`
> 提取日期：2026-07-22
> 审查范围：艾尔海森（data）核心链路验证

---

## 总体结论

**✅ 核心链路正常** — schema 三层结构完整，读写路径闭环可追踪，迁移兼容性有正式化方案。未发现运行时崩溃或编译阻断性问题。

---

## 一、读写闭环

### 写入路径（闭环 ✅）
```
input → _validateWrite → 嵌入生成(384d) → SHA256去重 → backend.write() → 事件发射 → BM25索引更新 → 向量后验去重 → 超限自动归档
```

异常路径覆盖：
| 异常点 | 处理方式 | 状态 |
|--------|---------|------|
| embedding 失败 | 静默降级，不阻塞写入 | ✅ |
| 后端 persist 失败 | 发射 `MemoryPersistFailed` 事件 + rethrow，内存无残留 | ✅ |
| 超限归档失败 | 写入熔断 `_overflowThrottled` + maintain() 恢复 | ✅ |

### 读取路径（闭环 ✅）
```
query → 自动 query embedding → backend.read()
→ 30天 TTL 过滤 → content_blob 关键词适配器层过滤
→ 混合检索增强(BM25+向量+贪心精排) → 权重自然老化
→ 按 weight 降序 → 截取 limit
```

### 状态转换 CAS（闭环 ✅）
```
Active → Archived (archive/freeze)
Active/Archived → Obliterated (obliterate)
Pending → Active (commitMemory)
Pending → Obliterated (rollback)
```
所有无效转换被 `MEMORY_VALID_TRANSITIONS` 白名单拒绝。

### 回滚验证（8 个场景全部通过 ✅）
1. write() 正常 → read() 可检索
2. write() 后端失败 → 内存无残留
3. link() 正常 → getLinks() 可获取
4. link() 后端失败 → link 回滚
5. cas() 后端失败 → state 恢复为 expected
6. obliterate() 后端失败 → state 回滚为 previousState
7. close() 后拒绝写入
8. 二次 close() 幂等

---

## 二、异常路径覆盖

| 异常场景 | 覆盖位置 | 状态 |
|---------|---------|------|
| 嵌入生成失败 | MemoryStore.write() → 静默降级 | ✅ |
| 后端写入失败 | MemoryStore.write() → 事件 + rethrow | ✅ |
| 超限熔断 | MemoryStore.write() → `_overflowThrottled` | ✅ |
| 状态转换非法 | CAS → `MEMORY_VALID_TRANSITIONS` 拒绝 | ✅ |
| 文件损坏 | FileBasedMemoryStore.load() → 静默跳过 | ✅ |
| 事务超时 | rollback → 自动补偿 | ✅ |
| 竞态写 | `_serializedFlush` 串行化 I/O | ✅ |
| 二次 close | 幂等跳过 | ✅ |

---

## 三、架构完整性

### 3.1 三层 Schema 契约

| 层 | 包 | 职责 |
|----|----|------|
| 类型层 | `@cortex/shared` | MemoryEntry / IMemoryStore / MEMORY_VALID_TRANSITIONS |
| 存储层 | `@cortex/memory` | InMemoryMemoryStore(70+用例)、FileBasedMemoryStore(45+用例)、事务/两阶段提交 |
| 适配层 | `@cortex/memory-store` | EmbeddingService、HybridRetriever、BM25Index、CognitiveEngine、FSM |

### 3.2 迁移兼容性

- SCHEMA_VERSION = 5，常量全部从 `@cortex/config` 导入
- STORAGE_VERSION = 1，文件损坏静默跳过
- MemoryStoreBackend 接口（7 方法），新增后端零改动 AbstractMemoryStore

### 3.3 核心链路拓扑
```
@cortex/shared (类型契约)
    ├── extends → @cortex/memory (存储实现)
    └── imports → @cortex/memory-store (认知适配器)
                        ↓ delegates
                  @cortex/engine/bootstrap/init-memory.ts (组装引导)
```

---

## 四、未发现的问题

| 类别 | 状态 |
|------|------|
| 编译错误（tsc 阻断） | ✅ 未发现 |
| 运行时崩溃 | ✅ 所有异常有 catch + 降级/事件上报 |
| 数据丢失 | ✅ 事务失败有补偿回滚（committedIds 逆序删除） |
| 竞态条件 | ✅ 单线程 EventLoop + _serializedFlush 串行化 |
| 配置漂移 | ✅ 所有常量从 @cortex/config 导入，无魔法数字 |
| FSM 不一致 | ✅ stateTransitionToEvent 桥接旧 CAS 与新编译器 |

---

## 结论摘要

**数据层可安全写入、检索、状态转换、持久化和恢复。读写闭环完整，异常路径覆盖充分（8 种回滚场景 + 熔断/降级/补偿机制），三层架构契约清晰，迁移兼容性有正式版本管理方案。**
