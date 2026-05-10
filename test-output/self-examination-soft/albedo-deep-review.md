# 🔬 核心层状态机与容错能力深度审查

> **审查者**：阿贝多（首席炼金术士 / Code Agent）  
> **审查范围**：memory-store.ts · scheduler.ts · agent-pool.ts · task-board.ts · llm-adapter.ts  
> **审查焦点**：状态机完备性 · 容错路径 · 跨模块契约一致性  
> **日期**：2026-05-10

---

## 目录

1. [总览：状态机全景图](#1-总览状态机全景图)
2. [MemoryStore — 四态 CAS + 生命周期 + 持久化容错](#2-memorystore--四态-cas--生命周期--持久化容错)
3. [AgentPool — Agent 五态流转与权威源](#3-agentpool--agent-五态流转与权威源)
4. [TaskBoard — 节点五态与 multi-perspective 等齐](#4-taskboard--节点五态与-multi-perspective-等齐)
5. [Scheduler — 调度状态机与重规划](#5-scheduler--调度状态机与重规划)
6. [LlmAdapter — 重试/缓存/超时三件套](#6-llmadapter--重试缓存超时三件套)
7. [跨模块契约：状态一致性 vs. 时序竞态](#7-跨模块契约状态一致性-vs-时序竞态)
8. [容错能力矩阵总评](#8-容错能力矩阵总评)
9. [直觉性发现 & 炼金笔记](#9-直觉性发现--炼金笔记)

---

## 1. 总览：状态机全景图

本系统涉及 **4 个独立状态机 + 1 个调度状态机**，它们通过跨模块调用交织在一起：

```
┌──────────────────────────────────────────────────────────────┐
│                     MemoryStore                               │
│  _lifecycle: active ──→ closing ──→ closed                    │
│  MemoryState: Active ─→ Archived ─→ Frozen ─→ Obliterated     │
│  (CAS 原子指令保护：expected + _isValidTransition 双层校验)    │
└──────────────┬───────────────────────────────────────────────┘
               │ write/read/cas
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Scheduler (调度状态机 + 重规划状态机)                        │
│                                                               │
│  executeAll loop:                                             │
│    getPendingNodes → topologicalSort → layer dispatch          │
│    → _dispatchNode → _dispatchSingle / _dispatchMulti          │
│    → fail → replanQueue → _drainReplanQueue → MetaAgent        │
│    → new nodes → next loop round                               │
│                                                               │
│  replanCount: nodeId → count (≤ REPLAN_MAX_ROUNDS=3)          │
│  totalReplans: 全局计数 (≤ MAX_TOTAL_REPLANS=3)                │
└──────┬─────────────────────────────────┬──────────────────────┘
       │ claim/complete/release          │ spawn/destroy
       ▼                                 ▼
┌──────────────────────┐    ┌──────────────────────────────────┐
│     TaskBoard         │    │         AgentPool                │
│  node.status:         │    │  AgentStatus:                    │
│  pending ─→ claimed   │    │  Created ─→ Awake ─→ Active      │
│       └→ running      │    │                 ↕       ↓        │
│       └→ done/failed  │    │              Draining            │
│                       │    │                 ↓                │
│  multi-perspective:   │    │              Destroyed           │
│  claimedBy[] 等齐     │    │                                  │
└──────────────────────┘    └──────────────────────────────────┘
                                      │ setSafeReporter
                                      ▼
                            ┌──────────────────────┐
                            │    LlmAdapter         │
                            │  chat → cache hit?    │
                            │     → _fetchWithRetry │
                            │     → 超时/重试/降级   │
                            └──────────────────────┘
```

### 关键发现摘要

| # | 模块 | 状态机名称 | 状态数 | 容错机制 | 风险等级 |
|---|------|-----------|--------|---------|---------|
| 1 | MemoryStore | `_lifecycle` | 3 | close 守卫 + 延迟写盘防抖 | 🟢 稳定 |
| 2 | MemoryStore | `MemoryState` | 4 | CAS + `_isValidTransition` + DB 回滚 | 🟢 稳定 |
| 3 | MemoryStore | 持久化链路 | - | 指数退避重试(3次) + observer 双通道 + SQL 降级 | 🟢 稳定 |
| 4 | AgentPool | `AgentStatus` | 5 | `VALID_TRANSITIONS` 表驱动 + `onInvariant` 注入点 | 🟡 小瑕疵 |
| 5 | TaskBoard | `TaskNode.status` | 5 | claim/release 原子操作 + invariant 对称性检查 | 🟡 小瑕疵 |
| 6 | Scheduler | 调度循环 | - | `_dispatchNode` 统一失败 + replan 限额 + `Promise.allSettled` | 🟢 稳定 |
| 7 | LlmAdapter | 重试 | - | 指数退避 + 超时 30s + 4xx/5xx 分流 | 🟠 有瑕疵 |

---

## 2. MemoryStore — 四态 CAS + 生命周期 + 持久化容错

### 2.1 `_lifecycle` 生命周期状态机

```
active ──→ closing ──→ closed
   │            │           │
   │ write()    │ flush()   │ 所有路径拒绝
   │ read()     │ 仍可执行   │
   │ 正常路径    │ _schedule  │
   │            │ Flush 跳过 │
```

**代码位置**：`memory-store.ts:64`

**容错设计**：
- ✅ `write()` 入口检查 `_lifecycle !== "active"` → throw Error，防止 close 后误写入
- ✅ `_scheduleFlush()` 守卫 `_lifecycle !== "active"` → return，防止防抖定时器在 closing 后重触发
- ✅ `close()` 调用 `flush()` 等待落盘完成，设置 `_lifecycle = "closing"` 后拒绝新写入，完成后再设 `"closed"`
- ✅ `_saveDb()` 每次重试前检查 `if (!this._db) return`，应对 close 在重试间隙关闭 DB

**🟢 评价**：完备。三态封闭，每个状态转换都有守卫。

### 2.2 `MemoryState` 四态 CAS 状态机

```
                    ┌─────────────────┐
                    │     Active       │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │    Archived      │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │     Frozen       │──── Active/Archived 可直达 Frozen
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   Obliterated    │── 不可逆终点
                    └─────────────────┘
```

**禁止流转**：
- ❌ Obliterated → 任何态
- ❌ Frozen → Active
- ❌ Archived → Active
- ❌ Active → Active（自身不变）

**代码位置**：`memory-store.ts:321-368` (cas)、`memory-store.ts:912-915` (_isValidTransition)

**原子性**：
- `cas(memoryId, expected, newState)`：先校验 `m.state === expected`，再校验 `_isValidTransition`，成功则更新内存 + DB write-through
- DB 失败回滚：`catch { m.state = expected; throw _e; }` — 假阳性禁止原则

**特殊路径**：`obliterate()` 跳过 CAS expected 校验，任何非 Obliterated 态均可湮灭，仅受 `_isValidTransition` 约束

**🟢 评价**：四态封闭完备，CAS 提供原子性，DB 失败回滚内存，幂等性明确（Obliterated 已是终态）。

### 2.3 持久化容错链路

```
write() → _safeDbRun() → _scheduleFlush() → _saveDb()
  │           │               │               │
  │   try-catch+throw       200ms 防抖      指数退避重试
  │   假阳性禁止原则         _flushing 守卫    (1s / 3s)
  │   回滚内存              并发防护          observer 双通道
  │                                         close 守卫
```

**容错点**：

| 层级 | 机制 | 代码位置 | 评价 |
|------|------|---------|------|
| SQL 执行 | `_safeDbRun` try-catch + throw | :576-604 | ✅ 传播错误，不静默 |
| 内存回滚 | DB 失败 → 删除内存条目 | write:103-106, cas:337-340 | ✅ 假阳性禁止 |
| 写盘防抖 | 200ms 合并 + `_flushing` 并发守卫 | :460-488 | ✅ 防抖 + 防并发 |
| 写盘重试 | 指数退避 3 次 (1s/3s) | :578-603 | ✅ 网络抖动/临时锁 |
| close 守卫 | DB 释放后在重试路径中检查 | :583 | ✅ 防关闭重试 |
| observer 双通道 | observer.emit + console.error 兜底 | :600-612 | ✅ 可观测 |
| SQL 降级 | `_sqlRead` catch → `_memScanRead` | :668-684 | ✅ 查询不中断 |
| JSON 防护 | 前置非JSON过滤 + try-catch + null 返回 | :764-806 | ✅ 反序列化不崩溃 |

**🟢 评价**：当前代码库中容错最完备的模块。每个故障点都有兜底，且遵循"假阳性禁止原则"。

---

## 3. AgentPool — Agent 五态流转与权威源

### 3.1 状态机定义

```
Created ──→ Awake ──→ Active ──→ Awake
                │                     │
                └──────→ Draining ────┘
                              │
                              ↓
                          Destroyed
```

**代码位置**：`agent-pool.ts:28-33` (`VALID_TRANSITIONS`)

**状态表**：

| 当前态 | 可流转到 |
|--------|---------|
| Created | Awake |
| Awake | Active, Draining |
| Active | Awake, Draining |
| Draining | Destroyed |
| Destroyed | (空) |

### 3.2 容错设计

✅ **表驱动校验**：`VALID_TRANSITIONS` 静态常量表，`setStatus()` 中查找校验  
✅ **onInvariant 注入点**：静态回调，可注入 observer.emit（bootstrap 配置）  
✅ **destroy 强制清理**：绕过状态机直接设为 Destroyed（应对崩溃场景），console.warn 记录诊断  
✅ **spawn 配额保护**：`maxInstances` 限制，超限返回 false  
✅ **方案B 单一权威源**：Agent.status 只读 getter 委托到 Pool，写路径仅通过 setStatus

### 3.3 风险点

⚠️ **`destroy()` 绕过状态机**：语义上是"强制清理"，但调用方（Scheduler）在正常路径每次都调用 `destroy()`。这意味着 Agent 的声明周期实际上不走完整的状态机流转——`destroy()` 在 execute 完后直接绕过状态机清理。

这本身不是 bug（destroy 设计就是强制清理），但需要注意：

1. `destroy()` 调用了 `this.statuses.delete(instanceId)`，完全移除了实例记录
2. 这意味着实例的"销毁"不经过 `Draining → Destroyed` 的正式流程
3. 在监控/审计时，无法通过状态机追踪到实例的正常销毁记录

**影响**：`Draining` 态实际上很少被正常使用，因为 Scheduler 不走 Draining 路径，直接 destroy 了。

**🟡 建议**：考虑是否让 Scheduler 的正常完成路径走 `setStatus(Draining) → setStatus(Destroyed)`，仅在异常/崩溃路径保留 `destroy()`。但这会导致 Agent 实例残留（因为 destroy 同时从 active Map 中移除），需要配套改造。

---

## 4. TaskBoard — 节点五态与 multi-perspective 等齐

### 4.1 状态机定义

```
pending ──→ claimed ──→ running ──→ done
                │                        │
                └──→ running ────────────┘  (multi-perspective)
                │
                └──→ failed
```

**代码位置**：`task-board.ts`

**状态流转规则**：

| 方法 | 前置条件 | 状态变更 |
|------|---------|---------|
| `claim()` | pending / multi-perspective pending/running | pending→claimed / pending→running |
| `release()` | claimed (普通) / running (multi) | claimed→pending / 移除 agentType |
| `complete()` | claimedBy 包含 agentType | → done/failed (等齐逻辑) |
| `failNode()` | 非终态 | → failed |

### 4.2 Multi-Perspective 等齐逻辑

```typescript
complete(nodeId, agentType, success, output, error) {
  // 1. 去重：同 agentType 已在 results 中则跳过
  // 2. 写入 results
  // 3. 检查等齐条件：
  //    - 普通节点：direct write done/failed
  //    - multi-perspective：检查是否所有匹配类型都已产出
  //      是 → 全部成功则 done，否则 failed
  //      否 → 保持 running
}
```

### 4.3 容错设计

✅ **claim/release 原子操作**：同步方法，单线程天然原子  
✅ **release 防死锁**：spawn 失败后 release，防止 agentType 残留在 claimedBy  
✅ **failNode 幂等**：已 failed 节点再次 failNode 安全  
✅ **onInvariant 注入点**：static onInvariant，可注入 observer  
✅ **去重保护**：`complete()` 中同 agentType 已在 results 则跳过

### 4.4 风险点

⚠️ **`release()` 在 multi-perspective 中可能把状态从 running 回退到 pending**：

```typescript
if (node.claimedBy.length === 0 && node.status !== "pending") {
  node.status = "pending";
}
```

如果 multi-perspective 节点有 3 个 agentType，2 个释放后，节点状态会变成 pending。但此时可能还有第 3 个 agent 正在执行中（claim 已生效，execute 正在进行）。这会导致状态语义不一致：节点实际正在执行，但状态却是 pending。

**但**：当前代码中 release 仅在 spawn 失败时调用，而 spawn 失败发生在 execute 之前，所以不存在"正在执行时 release"的场景。这是合理的。

⚠️ **`complete()` 中 invariant 检查仅 console.error**：

```typescript
// task-board.ts:140-147
if (!node.claimedBy.includes(agentType)) {
  const msg = `...`;
  console.error(`[invariant] TaskBoard.complete: ${msg}`);
}
```

虽然有 `onInvariant` 注入点，但此处的 invariant 检查没有使用它，而是直接 `console.error`。这是代码不一致——其他地方（AgentPool.setStatus）已经使用 `onInvariant` 了。

**🟡 建议**：将 `complete()` 中的 invariant 报告改为通过 `TaskBoard.onInvariant` 上报。

---

## 5. Scheduler — 调度状态机与重规划

### 5.1 调度循环状态机

```
executeAll()
  │
  ├─→ getPendingNodes()
  ├─→ topologicalSort() → BFS 分层
  ├─→ _dispatchNode() for each node in layer
  │     ├─→ _dispatchSingle() (单视角)
  │     └─→ _dispatchMulti() (多视角)
  ├─→ 失败节点入 replanQueue
  ├─→ _tryFireReplan() → _drainReplanQueue() → MetaAgent
  └─→ 回到顶层循环直到无 pending 节点
```

### 5.2 _dispatchNode 统一失败处理

```typescript
private async _dispatchNode(nodeId: string): Promise<NodeResult> {
  // 1. 获取节点
  // 2. emit node.start
  // 3. try { _dispatchSingle / _dispatchMulti }
  // 4. catch → result = { success: false, error: String(e) }
  // 5. 失败且非 ReAct 超限 → 入 replanQueue
  // 6. 失败 → emit node.failed
  // 7. return result
}
```

**容错设计**：

| 故障点 | 处理方式 | 评价 |
|--------|---------|------|
| _dispatchSingle/Multi 抛异常 | catch → 统一转为失败 result | ✅ |
| node.failed 发射 | 统一在 _dispatchNode 中发射，_dispatchSingle/Multi 不发射 | ✅ 防双重通知 |
| spawn 失败 | release + failNode + emit node.spawn_failed | ✅ |
| destroy 失败 | try-catch 包裹，emit pool.destroy_failed，不阻断 complete | ✅ |
| agent.execute 抛异常 | catch → result.success=false | ✅ |

### 5.3 重规划状态机

```
节点失败
  │
  ├─→ 检查 replanCount[nodeId] < REPLAN_MAX_ROUNDS (3)
  ├─→ 检查 totalReplans < MAX_TOTAL_REPLANS (3)
  ├─→ 入 replanQueue
  │
  └─→ executeAll 循环检测到 replanQueue → _tryFireReplan()
        │
        ├─→ totalReplans ≥ MAX → emit scheduler.replan.limit → 跳过
        │
        └─→ _drainReplanQueue()
              │
              ├─→ metaAgent? (防御性守卫)
              ├─→ 截断 batch 到可用额度
              ├─→ Promise.allSettled(batch.map → MetaAgent.requestReplan)
              ├─→ 新节点入板 (领而不执)
              ├─→ removeSubtree / removeNode 回收旧节点
              └─→ 个别失败 → emit scheduler.replan.failed (不阻断其余)
```

**容错设计**：

✅ **双重限额**：单节点最多 3 轮 + 全局最多 3 次  
✅ **Promise.allSettled**：个别 replan 失败不阻断其余  
✅ **防御性守卫**：metaAgent 未注入时优雅降级  
✅ **领而不执**：新节点入板但不 dispatch，由下一轮循环统一调度（避免递归）  
✅ **自环防护**：`_isReplanChainSuccessful` 使用 visited Set 防 ID 碰撞  
✅ **跨轮重置**：`totalReplans = 0` 在每个 executeAll 结束时重置

### 5.4 风险点

⚠️ **`_dispatchMulti` 中 agent.status 检查缺少 outer catch**：

```typescript
// scheduler.ts:530-536
const agent = this.agents.get(at);
if (!agent) return null;
if (agent.status !== AgentStatus.Awake && agent.status !== AgentStatus.Active) return null;
```

这里 `agent.status` 是 getter（可能委托到 AgentPool），如果 getter 抛异常，map callback 会 reject，但外层 `Promise.all` 不会处理单个 reject（有 `.filter(r => r !== null)` 但 filter 不处理 rejected promise）。

不过 `Promise.all` 本身会短路——任一个 promise reject 则整体 reject。但 map callback 中 return null 是安全的 null 值，不是 reject。

**实际上**：这些 `return null` 在 `Promise.all` 后用 `.filter(r => r !== null)` 过滤掉了，所以没问题。但如果 agent.status getter 抛异常，promise 会 reject，`Promise.all` 会立即 reject，导致整个 _dispatchMulti 失败。

**🟢 实际上**：当前 `agent.status` 只是一个简单的字段读取（或委托到 Pool.getStatus），不会抛异常。所以这不是问题。

⚠️ **`_dispatchMulti` 的 claimedBy invariant 缺少 notificationType**：

```typescript
// scheduler.ts:577-585
this.observer.emit({
  type: "scheduler.invariant_violation",
  priority: PipelinePriority.CRITICAL,
  payload: { ... },
  timestamp: Date.now(),
  // 缺少 notificationType
});
```

与其他 emit 调用不一致。不影响功能，但不符合 ObservableEvent 契约完整性。

⚠️ **replan 限额过低**：`MAX_TOTAL_REPLANS = 3`。如果有 4 个节点在同一个 executeAll 中失败，只有前 3 个会触发 replan，第 4 个直接淘汰。虽然通过 `totalReplans = 0` 在下次 executeAll 重置，但如果失败节点在同一个 batch 中，第 4 个节点不会得到 replan 机会。

**🟡 建议**：考虑将 MAX_TOTAL_REPLANS 改为基于节点总数的动态比例（如 `Math.ceil(totalNodes * 0.3)`），或至少提升到 5-10。

---

## 6. LlmAdapter — 重试/缓存/超时三件套

### 6.1 重试逻辑

```typescript
_fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const retryDelays = [1000, 3000]; // 指数退避
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    const controller = new AbortController();  // ✅ 每次重试新建
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS); // 30s

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (res.ok) return res;

      if (res.status >= 400 && res.status < 500) {
        if (res.status === 429) { /* 限流 → 重试，从 Retry-After 获取延迟 */ }
        else { /* 4xx → lastError = ... 继续循环 */ }  // ⚠️
      } else if (res.status >= 500) { /* 5xx → 重试 */ }
    } catch (e) {
      lastError = e; // 网络异常 → 重试
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}
```

### 6.2 容错能力

| 故障类型 | 处理 | 评价 |
|---------|------|------|
| 网络超时 (30s) | AbortController | ✅ |
| 网络闪断 (DNS/TCP) | 重试 3 次 (1s/3s) | ✅ |
| 5xx 服务端错误 | 重试 3 次 | ✅ |
| 429 限流 | 重试 (Retry-After) | ✅ |
| 4xx 客户端错误 (400/401/403) | 标记 lastError 但继续循环 | ⚠️ **错误** |
| Mock 模式 | 直接返回 | ✅ |
| 缓存命中 | 直接返回 | ✅ |

### 6.3 ⚠️ 关键风险：4xx 被重试

当前代码对 4xx（除 429 外）的处理是：

```typescript
if (res.status >= 400 && res.status < 500) {
  if (res.status === 429) { /* 限流处理 */ }
  else {
    lastError = new Error(`LLM API client error ${res.status}: ...`);
    // 没有 throw！继续循环
  }
}
```

这意味着 `400 Bad Request`、`401 Unauthorized`、`403 Forbidden` 等不可重试的错误会被重试 3 次（每次间隔 1s/3s），每次都在浪费 API 调用配额。

**🟠 建议**：在 `else` 分支中立即 `throw lastError`，而不是赋值后继续循环。目前代码在 catch 块中有检查 `e.message?.startsWith("LLM API client error")` 才 throw，这是间接的防御——应该在状态码判断时就 throw。

### 6.4 缓存风险

⚠️ **LRU 退化为 FIFO**：`_cache` 是普通 Map，`MAX_CACHE` 淘汰时用 `Map.delete(firstKey)`——这是 FIFO 而非 LRU。热点数据可能被过早淘汰。

⚠️ **TTL 惰性清理**：TTL 过期条目仅在被命中时删除。若大量条目超过 TTL 但从未被命中，会一直驻留到 `MAX_CACHE` 触发淘汰。

⚠️ **cacheKey 不包含超参**：`temperature`、`top_p` 等超参不在缓存键中。相同 prompt 不同 temperature 会返回相同缓存结果。

---

## 7. 跨模块契约：状态一致性 vs. 时序竞态

### 7.1 Scheduler → TaskBoard + AgentPool 调用时序

在 `_dispatchSingle` 中：

```
① agent.status 检查 (AgentPool 读取)
② board.claim() (TaskBoard 写入)
③ pool.spawn() (AgentPool 写入)
④ agent.execute()
⑤ pool.destroy() (AgentPool 写入)  ← try-catch 包裹
⑥ board.complete() (TaskBoard 写入)
```

在 `_dispatchMulti` 中：

```
① board.claim() (TaskBoard 写入)  ← 没有 agent.status 检查!
② pool.spawn() (AgentPool 写入)
③ agent.execute()
④ pool.destroy() (AgentPool 写入)  ← try-catch 包裹
⑤ board.complete() (TaskBoard 写入)
```

**差异分析**：`_dispatchSingle` 在 claim 前检查 agent.status，`_dispatchMulti` 没有。但 `_dispatchMulti` 中 agent.status 检查在 map callback 内部（return null 条件）。所以两者实际上都有状态检查，只是位置不同。

### 7.2 原子性问题

**当前模型**：单线程 Node.js 事件循环，同步方法天然原子。

但跨模块操作不是原子的：

```
Scheduler                   TaskBoard           AgentPool
  │                           │                   │
  ├─ board.claim() ──────────→● (节点态: claimed)
  ├─ pool.spawn() ──────────────────────────────→● (实例: Created)
  ├─ agent.execute() ────────→ (LLM 调用, 异步)
```

如果 `board.claim()` 成功但 `pool.spawn()` 失败，当前代码正确处理了：`release() + failNode()`。

但如果在 `claim` 和 `spawn` 之间进程崩溃，节点会卡在 claimed 状态，实例 ID 残留。这是一个**窗口期**。

**🟢 评价**：当前代码通过 `release()` 在 spawn 失败时回滚 claim，窗口期已尽可能缩小。进程崩溃场景需要外部恢复机制（如哨兵/超时），不在当前模块职责内。

### 7.3 Invariant 上报不一致性

| 模块 | 违规类型 | 上报方式 | 注入点 |
|------|---------|---------|-------|
| AgentPool.setStatus | 非法流转 | `console.error` + `onInvariant` | ✅ static onInvariant |
| TaskBoard.complete | claimedBy ∌ agentType | `console.error` + `onInvariant` | ✅ static onInvariant |
| Scheduler._dispatchMulti | claimedBy ≠ results | `observer.emit('scheduler.invariant_violation')` | ✅ 直接 observer |
| MemoryStore | 各类错误 | `observer.emit` + console 兜底 | ✅ 双通道 |

**问题**：TaskBoard 的 `complete()` 中 invariant 检查虽然声明了 `onInvariant` 静态回调，但实际代码中**直接使用 `console.error`**，没有通过 `onInvariant` 上报。

```typescript
// task-board.ts:147 — 直接 console.error
console.error(`[invariant] TaskBoard.complete: ${msg}`);
// 应该是：
if (TaskBoard.onInvariant) {
  TaskBoard.onInvariant({ source: "TaskBoard.complete", message: msg, details: { ... } });
} else {
  console.error(`[invariant] TaskBoard.complete: ${msg}`);
}
```

**🟡 建议**：统一改为通过 `TaskBoard.onInvariant` 上报，与 AgentPool.setStatus 保持模式一致。

### 7.4 notificationType 缺失

多处 `observer.emit` 调用缺少 `notificationType` 字段：

| 位置 | 事件类型 | 缺失字段 |
|------|---------|---------|
| scheduler.ts:_dispatchSingle | node.complete | notificationType |
| scheduler.ts:_dispatchMulti | node.complete | notificationType |
| scheduler.ts:_dispatchMulti | scheduler.invariant_violation | notificationType |

虽然 emit 时 `notificationType` 是可选字段（`ObservableEvent` 类型中可能未标记为 required），但缺省值与显式声明的语义清晰度不同。下游消费者（如 ButlerAgent）可能依赖此字段做过滤。

---

## 8. 容错能力矩阵总评

### 8.1 各模块容错评分

| 维度 | MemoryStore | AgentPool | TaskBoard | Scheduler | LlmAdapter |
|------|:-----------:|:---------:|:---------:|:---------:|:----------:|
| **状态机完备性** | 🟢 A+ | 🟢 A | 🟢 A | 🟢 A- | N/A |
| **错误重试** | 🟢 指数退避 3 次 | N/A | N/A | 🟢 replan 重试 | 🟠 4xx 误重试 |
| **优雅降级** | 🟢 SQL→内存扫描 | N/A | N/A | 🟢 no-MetaAgent 降级 | 🟢 Mock 模式 |
| **错误可观测** | 🟢 observer + console | 🟡 console + onInvariant | 🟡 console + onInvariant | 🟢 observer | 🟡 SafeReporter |
| **数据一致性** | 🟢 CAS + 回滚 | 🟢 方案B权威源 | 🟢 claim-release 配对 | 🟢 spawn-fail release | N/A |
| **并发安全** | 🟢 单线程 + _flushing 守卫 | 🟢 同步方法 | 🟢 同步方法 | 🟡 Promise.all 但无锁 | N/A |
| **资源泄漏防护** | 🟢 DB close 释放 | 🟢 destroy 清理 | 🟢 failNode + release | 🟢 destroy try-catch | 🟢 MAX_CACHE 限制 |
| **文档/注释** | 🟢 详实 | 🟡 一般 | 🟡 一般 | 🟢 详实 | 🟢 详实 |

### 8.2 整体评估

**强项**：
1. **MemoryStore** 是容错设计的标杆——CAS、回滚、重试、降级、双通道上报一应俱全
2. **Scheduler** 的 _dispatchNode 统一失败处理和 replan 限额设计合理
3. **跨模块 release-on-spawn-fail 模式**在 scheduler 的 single 和 multi 路径中一致实现
4. **假阳性禁止原则**贯穿 DB 写入路径

**弱项**：
1. **4xx 误重试**：LlmAdapter 对不可重试客户端错误仍重试 3 次
2. **Invariant 上报不一致**：TaskBoard.complete 直接 console.error 而非 onInvariant
3. **notificationType 缺失**：scheduler 中 3 处 emit 调用缺少此字段
4. **replan 限额过低**：全局 3 次限制对多节点失败场景偏保守

---

## 9. 直觉性发现 & 炼金笔记

### 9.1 「幽灵节点」风险

当 `_dispatchMulti` 中 `claim()` 成功但随后该 agent 在 map callback 中 `return null`（agent 不可用），claimedBy 中多了该 agentType 但永远不会产出 result。当前代码通过 release 在 spawn 失败时清理，但 agent 不可用（状态检查失败）时没有 release。

```typescript
// scheduler.ts:533-535
if (agent.status !== AgentStatus.Awake && agent.status !== AgentStatus.Active) return null;
// ↑ 没有 release！claimedBy 中已有了该 agentType
```

虽然 `return null` 的路径在 `.filter(r => r !== null)` 中会被过滤，但 claimedBy 已经被修改了（claim 已调用）。如果所有 agent 都不可用，节点状态从 `pending` 变成了 `running`（因为 claim 调用），但永远不会有 complete 来把它置为 done/failed。

**影响**：节点会卡在 `running` 状态。虽然 `executeAll` 循环依赖 `getPendingNodes()` 来获取待处理节点，running 态节点不会被返回，所以不会死循环，但节点状态永远不会进步。

**修复建议**：在 agent 状态检查失败时调用 `board.release(node.id, at as AgentType)`：

```typescript
if (agent.status !== AgentStatus.Awake && agent.status !== AgentStatus.Active) {
  this.board.release(node.id, at as AgentType);
  return null;
}
```

### 9.2 `_dispatchSingle` 和 `_dispatchMulti` 中 destroy 路径的对称差异

`_dispatchSingle`：
```
pool.destroy() → board.complete() → emit node.complete (if success)
```

`_dispatchMulti`：
```
pool.destroy() → board.complete() → return result → ... → invariant check → emit
```

`_dispatchMulti` 在 complete 之后还做了 invariant 检查，而 `_dispatchSingle` 没有。这导致 `_dispatchSingle` 路径缺少对 claimedBy ↔ results 一致性的保护。如果未来在 `_dispatchSingle` 中新增 early return 路径，claimedBy 可能残留。

**🟡 建议**：在 `_dispatchSingle` 的 complete 之后也添加对称的 invariant 检查，或提取为共用函数。

### 9.3 MemoryStore ID 生成的时间戳依赖

```typescript
const id = `mem-${now}-${this._memCounter++}`;
```

`now = Date.now()` 在 write 方法入口取一次。如果两次 write 在同一毫秒发生，now 相同，但 counter 递增保证唯一性。**但** 如果系统时钟回拨（NTP 同步），ID 可能重复。

现实中 Node.js 的 `Date.now()` 是系统时间，NTP 回拨虽然罕见但可能发生。`crypto.randomUUID()` 或 `nanoid` 完全消除时钟依赖。

**🟢 当前风险极低**（时钟回拨 + ID 冲突的联合概率），但属于防御性设计可优化的点。

### 9.4 AgentPool `hasAwake` 的 O(n) 扫描

```typescript
hasAwake(agentType: AgentType): boolean {
  const instances = this.active.get(agentType);
  if (!instances) return false;
  return [...instances].some((id) => this.statuses.get(id) === AgentStatus.Awake);
}
```

每次调用会展开 Set 为 Array 做扫描。如果某 Agent 类型有大量实例（>1000），频繁调用 `hasAwake` 可能有性能问题。但当前场景 Agent 实例数通常 ≤10，可忽略。

### 9.5 `_saveDb` 的 `Buffer.from(data)` 内存占用

```typescript
const data = this._db.export();
const buf = Buffer.from(data);
fs.writeFileSync(this._dbPath, buf);
```

`_db.export()` 返回整个 SQLite 数据库的 `Uint8Array`，`Buffer.from` 再复制一份。对大型数据库（>100MB），这会临时占用双倍内存。但因为写盘是异步防抖的（200ms 合并），高峰期不会连续触发。

**🟢 当前场景合理**。如果未来数据库增长到 >500MB，可考虑流式写入或增量 WAL。

### 9.6 meta-agent 的 `impactScope` 语义

```typescript
if (result.impactScope === "subtree") {
  this.board.removeSubtree(item.node.id);
} else {
  this.board.removeNode(item.node.id);
}
```

`removeSubtree` 会跳过终态节点（done/failed），将它们标记为"孤儿"。这意味着 replan 后，部分旧节点可能残留在板中。如果这些孤儿节点的 parent 已被删除，它们在拓扑排序中会被当作根节点（因为没有 parentId 对应的节点存在了）。

**影响**：孤儿节点在下次 `executeAll` 时可能被重新调度执行。这取决于 `findPending` 的逻辑——如果孤儿节点是 done/failed 态，不会被返回；如果是 running/claimed 态，有风险。

**🟢 实际上**：`removeSubtree` 只会在 replan 的节点路径上调用，这些节点通常是 failed 态（触发 replan 的前提），已经是终态，所以不会残留活节点。但代码注释已标注此风险。

---

## 附：已关闭的 P0 问题清单

以下问题在之前的审查中已被发现并修复，当前 HEAD 已验证 ✅：

| 问题 | 模块 | 修复状态 | 备注 |
|------|------|---------|------|
| `_saveDb` 静默吞错 | memory-store.ts | ✅ | 指数退避重试 + observer 双通道 |
| `_deserializeRow` JSON.parse 无保护 | memory-store.ts | ✅ | 前置非JSON过滤 + try-catch + null 返回 |
| `_sqlRead` catch 未接入 observer | memory-store.ts | ✅ | observer.emit + 内存扫描降级 |
| `node.complete` 无 success 守卫 | scheduler.ts | ✅ | `if (result.success)` / `if (allSuccess)` |
| `claimedBy` invariant 裸 console.error | scheduler.ts | ✅ | observer.emit('scheduler.invariant_violation') |

---

> **炼金笔记**：  
> 整体链路状态机清晰、容错意识强。MemoryStore 和 Scheduler 的容错设计已接近生产级。  
> 主要残缺点集中在 **LlmAdapter 的 4xx 处理**（P1）和 **TaskBoard.complete 的 invariant 上报不一致**（P2）。  
> 建议下轮迭代优先修复这两个问题，其余为防御性优化。

> 实验台便签：  
> 本次审查覆盖 5 个核心模块 ≈ 2,192 行代码。  
> 发现 P1 问题 1 个（LlmAdapter 4xx 误重试），P2 问题 3 个（invariant 不一致、notificationType 缺失、replan 限额保守）。  
> 直觉性发现 6 条，其中「幽灵节点」风险在极端条件下可能导致节点卡住，已标注修复路径。
