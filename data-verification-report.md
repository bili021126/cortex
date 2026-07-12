# Data 读写→检索→状态转换→维护 全链路验证报告

> 水镜追溯：莫娜·梅姬斯图斯 — Loop Agent
> 溯源范围：packages/memory-store/src/ + packages/memory/src/implementations/ + packages/consistency/src/
> 受审文件：memory-store.ts, AbstractMemoryStore.ts, InMemoryMemoryStore.ts, FileBasedMemoryStore.ts, memory-state-machine.ts, consistency-layer.ts, weight-ager.ts, dedup-service.ts, hybrid-retrieval.ts, context-builder.ts, cognitive-engine.ts, ingest-pipeline.ts, monitor.ts

---

## 1. 写入→读取全路径追踪性

### 1.1 写入路径

```
用户调用 MemoryStore.write(input)
  ↓ 校验 phase (仅 Running 可写入)
  ↓ 熔断检查 (overflowThrottled)
  ↓ validateWrite (preWriteHook + embedding 维度校验)
  ↓ 嵌入生成 (静默降级: 失败不阻塞写入)
  ↓ SHA256 内容去重 (_tryDedup)
  ↓ AbstractMemoryStore.write (验证 → 注入 → 创建 MemoryEntry)
    ↓ backend.persist (FileBackend: atomic write via tmp+rename)
    ↓ InMemoryMemoryStore: no-op (无持久化)
  ↓ PipelineObserver emit MemMemoryWritten
  ↓ BM25 索引更新
  ↓ 向量相似去重 (_tryVectorDedup)
  ↓ 总量上限自动归档 (_autoArchiveIfOverflow)
```

**判定：✅ 全路径可追踪** — 每步有明确责任人，无隐式状态通信。

### 1.2 读取路径

```
MemoryStore.read(query, mode)
  ↓ 关闭检查
  ↓ 自动生成 query embedding (静默降级)
  ↓ AbstractMemoryStore.read
    ├─ kind/关键词/timeRange/agentType/metadata 过滤
    ├─ BFS 图遍历扩展 (可选)
    ├─ weight+createdAt 降序排序
    └─ CSA 模式: 更新 accessCount + lastAccessedAt
  ↓ 适配器层 TTL 过滤 (30天)
  ↓ 适配器层 content_blob 关键词过滤 (安全网)
  ↓ 混合检索增强 (BM25 + 向量余弦 + 贪心精排)
    └─ 失败时降级返回原始结果
  ↓ 权重自然老化 (每7天衰减5%)
  ↓ weight 降序排序 → limit 截取
```

**判定：✅ 全路径可追踪** — 读取路径有双层过滤（后端过滤 + 适配器层补充过滤），混合检索作为增强层而非必经层。

### 1.3 特殊读取路径

| 读取方式 | 路径 |
|---------|------|
| `peek(id)` | 直接返回 `_entries.get(id)` 内部引用 — 0 开销 |
| `get(id)` | `_entries.get(id)` → `structuredClone` — 深拷贝 |
| `read(query, "HCA")` | 纯查询，不修改 accessCount |
| `read(query, "CSA")` | 查询 + 递增 accessCount + 更新 lastAccessedAt |
| `getPending()` | 从 `_pendingEntries` Map 构建伪 MemoryEntry（带 `_pending` 标记）|
| `getAllEntries()` | 同步 `Array.from(_entries.values())` — 用于 maintain/去重 |

---

## 2. 两阶段提交与回滚逻辑

### 2.1 Pending 机制 (单条目两阶段提交)

```
Phase 1: writePending(input)
  ├─ 校验写入输入
  ├─ 生成 UUID (cleanId)
  ├─ 存入 _pendingEntries Map (key: "pending_" + cleanId)
  └─ 返回 cleanId (不含 pending_ 前缀 — H-06 修复)

Phase 2a: commitMemory(memoryId)
  ├─ 查找 "pending_" + memoryId
  ├─ 构建 MemoryEntry (semantic_state = "Active")
  ├─ 写入 _entries Map
  ├─ 从 _pendingEntries 移除
  ├─ 异步 enrichment (embedding + dedup cache + BM25 索引)
  └─ 返回 true/false

Phase 2b: rollback(memoryId)
  ├─ 查找 "pending_" + memoryId
  ├─ 从 _pendingEntries 移除
  └─ 返回 true/false

Cancel (统一取消):
  ├─ Pending 态 → 从 _pendingEntries 移除
  ├─ Active 态 → cas(id, "Active", "Archived")
  └─ 其他 → return false
```

**判定：✅ 两阶段提交逻辑完整** — Pending 条目对 read() 不可见，commit 后转为 Active。

### 2.2 事务机制 (多条目原子操作)

```
beginTransaction(isolation, metadata?)
  └─ 创建 InternalTransaction (id, status=active, timeout, pendingWrites[], pendingLinks[])

writeWithin(txn, input)     → 追加到 txn.pendingWrites
linkWithin(txn, ...)        → 追加到 txn.pendingLinks
writeManyWithin(txn, [])    → 循环 writeWithin
linkManyWithin(txn, [])     → 循环 linkWithin

commit(txn):
  ├─ 校验 txn.status === "active"
  ├─ 逐个执行 pendingWrites → this.write(w) → 收集 committedIds
  ├─ 逐个执行 pendingLinks → this.link() → 收集 committedLinks
  ├─ flushLinks + flushIndex
  ├─ txn.status = "committed", 从 _transactions 移除
  └─ 失败: 补偿回滚 (撤销 committedIds + committedLinks)

rollback(txn):
  ├─ 校验 txn.status 为 active 或 error
  ├─ 清空 pendingWrites + pendingLinks
  ├─ txn.status = "rolledback", 从 _transactions 移除
  └─ return { success: true }
```

**判定：✅ 事务语义完整** — commit 有补偿回滚机制，rollback 安全清空挂起操作。

### 2.3 回滚路径汇总

| 触发方式 | 回滚目标 | 实现 |
|---------|---------|------|
| `rollback(memoryId)` | 单条 Pending 条目 | 从 `_pendingEntries` 移除 |
| `rollback(txn)` | 整个事务的挂起操作 | 清空 pendingWrites/pendingLinks |
| `commit(txn)` 异常补偿 | 已写入的条目+链路 | `for...remove...delete` 撤销 |
| 事务超时自动回滚 | 超时事务 | `_pe()` 标记 rolledback + 删除 |
| `cancel(memoryId)` | Pending 或 Active 条目 | Pending=移除 / Active=归档 |

### 2.4 关键风险点：rollback() 返回类型

**⚠️ 发现：** `AbstractMemoryStore.rollback(mid)` 实现为 `return Promise<boolean>`（`_rp()` 同步返回 + async 包装），但 `MemoryStore.rollback(memoryId)` 适配器层使用 `try { return await this._backend.rollback(memoryId); } catch { return false; }`。**已验证为正确传递**—适配器层正确 await 后端的 Promise<boolean>，catch 返回 false 无阻塞风险。

---

## 3. 状态转换验证

### 3.1 FSM 定义的状态图

```
                  ┌─────────┐
                  │ Pending │
                  └────┬────┘
              ┌────────┼────────┐
              │ commit │        │ rollback
              ▼        │        ▼
          ┌───────┐    │   ┌────────────┐
          │ Active │    │   │ Obliterated │ (终态)
          └───┬───┘    │   └────────────┘
              │ archive│        ▲
              ▼        │        │
          ┌─────────┐  │  ┌───────────┐
          │ Archived │──┼──│ Obliterate │
          └────┬────┘  │  └───────────┘
               │restore│
               └───────┘
```

### 3.2 CAS 白名单验证

```typescript
// MEMORY_VALID_TRANSITIONS 来自 @cortex/shared (单一事实来源)
VALID_TRANSITIONS = {
  "Pending"    → Set(["Active", "Obliterated"]),
  "Active"     → Set(["Archived", "Obliterated"]),
  "Archived"   → Set(["Active", "Obliterated"]),
  "Obliterated"→ Set([]),  // 终态
}
```

### 3.3 FSM 编译器集成 (memory-state-machine.ts)

`MemoryEntryStateMachine` 使用 `@cortex/fsm-compiler` 的 `StateMachine`，提供：
- `cas(memoryId, expected, event, ctx)` — 与 MemoryStore.cas() 签名兼容
- `dispatch(event, ctx)` — 直接分发事件
- `can(event)` / `canWithContext(event, ctx)` — guard 评估
- Guard 条件：canArchive (weight<0.5 或 30天未访问)
- Action 钩子：onCommit/onRollback/onArchive/onObliterate/onRestore

**判定：✅ 状态转换受双重保护** — 静态的 MEMORY_VALID_TRANSITIONS 白名单 + 运行时 FSM guard 评估。

### 3.4 维护扫描 (maintain)

```
maintain():
  Phase 1: 归档过期低权重 Active 记忆
    ├─ 条件: semantic_state === "Active"
    ├─ 条件: lastAccessedAt > STALE_FREEZE_DAYS (30天)
    ├─ 条件: weight < MAINTENANCE_WEIGHT_THRESHOLD (0.5)
    └─ 动作: backend.archive(id)

  Phase 2: 湮灭长期 Archived 记忆
    ├─ 条件: semantic_state === "Archived"
    ├─ 条件: lastAccessedAt ≤ FROZEN_OBLITERATE_DAYS (90天)
    └─ 动作: backend.obliterate(id)

  熔断恢复:
    ├─ 维护成功后重置 _overflowThrottled = false
    └─ emit throttle-reset 事件

_autoArchiveIfOverflow():
  ├─ 触发条件: _backend.size > MAX_TOTAL_MEMORIES
  ├─ 排序: Active 条目按 lastAccessedAt 升序
  ├─ 选 excess 条最久未访问的归档
  └─ 归档失败: 设置 _overflowThrottled = true (写入熔断)
```

**判定：✅ 维护路径完整** — 从身份识别 → 归档/湮灭 → 熔断恢复，闭环无泄漏。

---

## 4. 异常路径覆盖

### 4.1 阻断路径 (抛出 Error)

| 条件 | 抛出 | 位置 |
|------|------|------|
| Store 未初始化 | `"Not initialized"` | AbstractMemoryStore._ei() |
| 写入已关闭 Store | `"MemoryStore 已关闭"` | MemoryStore.write() |
| 非 Running phase 写入 | `"当前 phase=..."` | MemoryStore.write() |
| 写入熔断 | `"写入熔断"` | MemoryStore.write() |
| Embedding 维度不匹配 | `"维度不匹配"` | MemoryStore._validateWrite() |
| 缺 source/kind/summary/semantic_gist/content_blob | `MemoryValidationError` | AbstractMemoryStore._vw() |
| 事务不存在 | `"Transaction not found"` | AbstractMemoryStore._va() |
| 事务非 active | `"Transaction is ..."` | AbstractMemoryStore._va() |
| 事务超时 | `"Transaction timed out"` | AbstractMemoryStore._va() |

### 4.2 降级路径 (静默 + emit degraded)

| 条件 | 降级行为 | emit |
|------|---------|------|
| embedding 生成失败 | 跳过 embedding | MemorySqlDegraded |
| query embedding 生成失败 | 跳过向量检索 | MemorySqlDegraded |
| SHA256 去重扫描失败 | 跳过去重 | MemorySqlDegraded |
| 向量去重扫描失败 | 跳过向量去重 | MemorySqlDegraded |
| 混合检索失败 | 返回原始排序结果 | MemorySqlDegraded |
| CAS 非法转换 | return false + degraded | MemorySqlDegraded |
| CAS 失败 | return false + degraded | MemorySqlDegraded |
| 维护扫描失败 | 静默降级 | MemorySqlDegraded |
| 自动归档失败 | 设置熔断 | MemorySqlDegraded |
| flush 失败 | emit + rethrow | MemoryFlushSkipped (HIGH) |
| persist 失败 | emit + rethrow | MemoryPersistFailed (HIGH) |

### 4.3 CAS 特殊边界

```
Obliterated 条目上执行 cas() → return false (FIND-001)
Obliterated 条目上执行 obliterate() → return true (幂等)
非 Active 条目上执行 archive() → return false
Commit 时补偿回滚 → 撤销已写入条目 (catch 块)
```

---

## 5. 一致性层 (ConsistencyLayer)

作为 MemoryStore 的外部中间件，提供写前校验和数据完整性保障：

```
preWriteCheck(input):
  ├─ SchemaEnforcer.validate() — 结构完整性校验
  ├─ SchemaEnforcer.annotate() — 自动注入默认字段
  └─ IntentFactWall.ensureSubType() — subType 默认值注入

filterRead(entries, mode):
  ├─ CSA 模式: 排除 subType === Intent 的记忆
  └─ HCA 模式: 不过滤 (MetaAgent 需要全局视图)

verify(): 启动校验 — 遍历 Active 记忆检查文件引用一致性
checkCoverage(): 反向文件覆盖度校验
```

**判定：✅ 一致性层作为看门人存在** — 不修改 MemoryStore 内部实现，纯中间件模式。

---

## 6. 权重老化与维护服务 (纯计算层)

### WeightAger
- `decayWeights(entries, now)` — 每7天未访问衰减5%，纯函数式无副作用
- `freezeStale(entries, now)` — 识别低权重过期 Active 条目
- `obliterateFrozen(entries, now)` — 识别长期 Archived 条目

### DedupService
- `contentHash(summary, blob)` — SHA256 内容哈希
- `exactMatch(hash, entries)` — 精确匹配去重
- `vectorDedup(embedding, entries)` — 余弦相似度去重 (≥ threshold 视为重复)

### MemoryStoreMonitor
- 订阅 CRITICAL/HIGH/NORMAL 级别 memory.* 事件
- 关键事件落盘归档 (persist_failed / sql_degraded / deserialize_failed)
- 告警洪泛防护 (D3 修复: 仅跨阈值时触发一次告警)
- 精确移除 handler (D4 修复: 按 handler 引用 off)

---

## 7. 两阶段提交与回滚——关键证据链

### 7.1 writePending → commitMemory 完整链路

```
MemoryStore.writePending(input)
  └→ AbstractMemoryStore.writePending(input)
       ├─ validate input
       ├─ generateId → cleanId
       └─ _pendingEntries.set("pending_" + cleanId, { input, createdAt })

MemoryStore.commitMemory(memoryId)
  ├→ _enrichPendingEntry(memoryId)  // 异步: embedding + dedup cache + BM25
  └→ AbstractMemoryStore.commitMemory(memoryId)
       ├─ _pendingEntries.get("pending_" + memoryId)
       ├─ 构建 MemoryEntry (semantic_state = "Active")
       ├─ _entries.set(memoryId, entry)
       └─ _pendingEntries.delete("pending_" + memoryId)
```

### 7.2 writePending → rollback 完整链路

```
MemoryStore.rollback(memoryId)  // async
  └→ AbstractMemoryStore.rollback(memoryId)
       ├─ 校验: _pendingEntries.has("pending_" + memoryId)
       └─ _pendingEntries.delete("pending_" + memoryId)
```

### 7.3 事务 commit → 补偿回滚

```
AbstractMemoryStore.commit(txn):
  try:
    for w in txn.pendingWrites:
      id = await this.write(w)        // ← 可能失败
      committedIds.push(id)
    for l in txn.pendingLinks:
      this.link(l.sourceId, ...)      // ← 可能失败
      committedLinks.push({...})
    flushLinks + flushIndex
    txn.status = "committed"
    delete from _transactions
    return { success: true, data: ids }
  catch(err):
    // ★ 补偿回滚 ★
    for cid in committedIds:
      this._entries.delete(cid)
      this._be.remove(cid)            // 清理磁盘文件
    for cl in committedLinks:
      links.get(cl.sourceId).splice(...)  // 移除已写入的链路
    txn.status = "error"
    return { success: false, error: err }
```

---

## 8. 测试覆盖验证

| 测试文件 | 覆盖场景数 | 覆盖领域 |
|---------|-----------|----------|
| `read-write-consistency.test.ts` | 14 个 it | 基本RW、批量一致性、特殊载荷、读路径完整性、状态转换字段完整性 |
| `InMemoryMemoryStore.test.ts` | 50+ 个 it | init、write/get、has/peek、delete、read/query、session、link、2PC、lifecycle、transaction、错误处理、并发 |
| `memory-state-machine.test.ts` | — | FSM 状态转换 |
| `hybrid-retrieval.test.ts` | — | 混合检索逻辑 |
| `ingest-pipeline.test.ts` | — | 摄入管线 |
| `e2e.test.ts` | — | 端到端 |

---

## 9. 结论

| 验证维度 | 状态 | 证据 |
|---------|------|------|
| 写入→读取全路径可追踪 | ✅ | 每步有明确责任人，无隐式状态通信 |
| 两阶段提交逻辑完整 | ✅ | writePending→commitMemory/rollback 完整链路 |
| 事务回滚逻辑完整 | ✅ | commit补偿回滚 + rollback清空 + 超时自动回滚 |
| 状态转换受双重保护 | ✅ | MEMORY_VALID_TRANSITIONS 白名单 + FSM guard |
| 维护扫描闭环 | ✅ | 归档→湮灭→熔断恢复，整体闭环 |
| 异常路径全覆盖 | ✅ | 8 条阻断路径 + 11 条降级路径 |
| 最终一致性层 | ✅ | SchemaEnforcer + IntentFactWall + InitVerifier |
| 纯计算服务可独立测试 | ✅ | WeightAger/DedupService/CognitiveEngine 无副作用 |
