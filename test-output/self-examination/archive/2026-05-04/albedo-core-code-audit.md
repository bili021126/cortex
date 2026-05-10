# Albedo 核心模块深度代码审计报告

> 审计范围：Scheduler · TaskBoard · MemoryStore · Toolkit · AgentPool · FileLockManager · ConfirmGate · PipelineObserver
> 审计维度：状态机正确性 · 并发安全 · 边界条件 · 错误传播
> 审计时间：2025-07-11

---

## 1. Scheduler（调度引擎）

### 1.1 状态机正确性

**当前设计**：Scheduler 本身无显式状态机。executeAll() 通过 `while(true)` + `round` 计数器驱动，依赖 TaskBoard 节点的 pending/claimed/running/done/failed 五态。整体流程为：
```
pending → claimed → running → done|failed
         ↘ (spawn失败 release) → pending
         ↘ (失败+replan) → replanQueue → MetaAgent → 新节点入板 → pending
```

**发现问题**：

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| S1 | **多视角节点 partial-fail 后 claimedBy 残留** | 🔴 HIGH | `_dispatchMulti` 中若某 Agent spawn 成功后 execute 抛异常，`board.complete()` 会被调用但 success=false。如果同时另一个 Agent 仍在执行中且后来也异常退出，claimedBy 中可能残留已退出的 Agent 类型，导致等齐条件永远不满足——节点卡在 running。代码中 `_dispatchMulti` 的多个 Promise 独立 complete，但没有在部分失败时主动 release 失败方。等齐判断用的是 `claimedBy` vs `results` 的对称性，这是正确的，前提是每个 claimed agent 最终都调了 complete。已验证：代码中 catch 块确实调 complete，所以 claimedBy 不会残留。✅ **无 bug**，但语义脆弱——如果未来有人在 catch 路径外新增 early return，就会触发。 |
| S2 | **replanQueue 在 _drainReplanQueue 中 splice(0) 非原子** | 🟡 MEDIUM | `splice(0)` 在 Node.js 单线程中安全，但 batch 取出后若 `_drainReplanQueue` 内某个 replan 抛异常，已取出的项丢失了——不会被放回队列。当前代码在 `Promise.all(promises)` 中每项都有 try/catch……吗？`_drainReplanQueue` 的 `promises` 数组 map 回调内没有 try/catch。如果 MetaAgent.requestReplan 抛异常，单个 replan 项丢失。应考虑对该回调加 try/catch 并在失败时将项放回队列或标记为失败。 |

### 1.2 并发安全

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| S3 | **executeAll 的 replan 后台批次与下轮循环存在竞争窗口** | 🟡 MEDIUM | `replanFlight` 赋值为 `_tryFireReplan()` 后不做 `await`，下轮循环进入 `pendingNodes.length === 0` 分支时调用 `await replanFlight`。但在 `pendingNodes.length > 0` 的分支末尾，`replanFlight` 可能仍在执行中，如果此时恰好没有新的 pending 节点（所有节点已执行完），循环回到顶部检查 `pendingNodes.length === 0`，然后 `await replanFlight`。这是正确的。但如果 _drainReplanQueue 产出的新节点在 `await replanFlight` 之前就已经入板，且循环顶部 `getPendingNodes()` 在读这些节点时尚未完成入板（Promise 已 resolve 但 this.board.addNode 已同步完成），则无竞态——因为 addNode 是同步操作，必然在 await 返回前完成。✅ **无竞态**。 |
| S4 | **_dispatchSingle 和 _dispatchMulti 中对 agent.status 检查不是原子的** | 🟢 LOW | getAgent → check status → claim 之间无锁保护。但在当前单线程模型中，同一 Agent 实例不会被两个节点同时使用（因为 claim 成功后 node 状态变为 claimed，其他调度不会再来）。低风险。 |

### 1.3 边界条件

| # | 问题 | 严重度 |
|---|------|--------|
| S5 | **空 TaskBoard 调用 executeAll()**：正确处理——直接 break，返回 totalNodes=0 | ✅ PASS |
| S6 | **拓扑排序空数组**：返回空 layers，while 循环不执行 | ✅ PASS |
| S7 | **单节点没有 parentId 但有孤立 parentId 引用**：topologicalSort 中 idSet.has 检查正确处理——孤立节点被当作 root | ✅ PASS |
| S8 | **REPLAN_MAX_ROUNDS=3 但 MAX_TOTAL_REPLANS=3**：全局上限等于单节点上限，意味着如果一个节点触发了 3 轮重规划，整个管线不能再有第二个节点重规划。这是预期行为吗？**设计疑点**——应考虑全局上限 >= 单节点上限 × 预期最大并发节点数。 | 🟡 MEDIUM |

### 1.4 错误传播

| # | 问题 | 严重度 |
|---|------|--------|
| S9 | **_dispatchSingle 中 spawn 失败后 release 的异常被静默吞掉**：若 release 失败（因节点已被其他人修改），应记录到 observer | 🟢 LOW |
| S10 | **pool.destroy 异常被静默吞掉**：`try { this.pool.destroy(...) } catch {}`。资源泄漏风险低（实例已不再被引用），但丢失了错误信号 | 🟢 LOW |
| S11 | **_isReplanChainSuccessful 中 visited Set 防自环**：正确。ID 碰撞场景（不同 replan 产出了相同 ID？不可能——id 由 MetaAgent 生成） | ✅ PASS |

---

## 2. TaskBoard（任务板）

### 2.1 状态机正确性

**状态机**：pending → claimed → running → done | failed。Multi-perspective 节点：pending → running → done | failed（跳过 claimed）。

流转规则明确且有防护：
- `claim()`: pending → claimed（普通）；pending → running（multi）
- `release()`: claimed → pending（普通）；running → pending（multi，claimedBy 清空）；running 但 claimedBy 非空→ 保持 running
- `complete()`: claimed/running → done/failed
- `failNode()`: pending/claimed/running → failed

**发现问题**：

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| T1 | **complete() 的去重保护存在窄窗口** | 🟢 LOW | `node.results.some(r => r.agentType === agentType)` 在 push 前做检查。单线程安全 ✅。但如果未来 TaskBoard 被多个 worker 共享，此处是 classic check-then-act race。当前无风险。 |
| T2 | **complete() 中 claimedBy 和 results 等齐判断有边界情况** | 🔴 HIGH | 场景：多视角节点，3 个 Agent 类型 A/B/C 认领。A 执行成功调 complete → results 有 A，claimed 有 A/B/C，不等齐。B 执行中抛异常，catch 中调 complete(success=false) → results 有 A/B。C spawn 失败，调 release(C) → claimedBy 变成 A/B。此时 `claimedBy = {A, B}`，`results = {A, B}` → 等齐，节点 done。但 C 从未被 complete！这是正确的行为——C 未被计入等齐判断，因为已 release。✅ **无 bug**。但 claimedBy 和 results 的语义耦合需要仔细维护。 |

### 2.2 并发安全

| # | 问题 | 严重度 |
|---|------|--------|
| T3 | **release() 非认领者释放被拒绝**：`claimedBy` 检查正确 | ✅ PASS |
| T4 | **removeSubtree 中 BFS 遍历 + 删除**：先收集后代再删除，避免迭代器失效 | ✅ PASS |
| T5 | **getDescendants 中 O(n²) 遍历**：`for ... of this.nodes` 嵌套在 BFS 中每个出队节点。worst-case 链式树 O(n²)。节点数预期 < 100，可接受。 | 🟢 LOW |

### 2.3 边界条件

| # | 问题 | 严重度 |
|---|------|--------|
| T6 | **不存在的 nodeId 操作**：所有方法都有 null/undefined 检查 | ✅ PASS |
| T7 | **已完成/失败节点不可重新认领**：claim() 中 status 检查正确 | ✅ PASS |
| T8 | **release 后 claimedBy 为空且原 status 非 pending → 回到 pending**：正确。但若原 status 是 running（multi 场景所有方都 release 了）→ 回到 pending，可被重新调度 | 🟡 MEDIUM — 这是否合理？如果所有 Agent 都失败了（spawn 失败），节点回到 pending 然后被重新调度，但同样的 Agent 类型再次尝试仍可能失败。需要熔断。当前依赖 Scheduler 的 replan 机制兜底。 |

### 2.4 错误传播

- `failNode()` 不提供 error message 字段——调用者需自行通过 observer 报告原因。task-board 不负责错误语义，合理 ✅

---

## 3. MemoryStore（记忆存储）

### 3.1 状态机正确性 — 四态流转

```
Active → Archived → Frozen → Obliterated
Active → Frozen (跳跃)
Active|Archived|Frozen → Obliterated (终态)
```

**合法流转校验**（`_isValidTransition`）：
```
Obliterated → *   : ❌
* → Active (from≠Active) : ❌
Frozen → non-Obliterated : ❌
其余 : ✅
```

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| M1 | **freeze() 的 CAS 参数问题** | 🔴 HIGH | `freeze(memoryId)` 调用 `cas(memoryId, m.state, MemoryState.Frozen)`。expected 参数取的是当前状态，不是硬编码的 Active。理论上如果状态在 peek 和 CAS 间被修改（单线程无此问题），会失败。但 freeze 的语义是 "只要当前非 Obliterated 就冻结"——用当前状态做 expected 是正确的。✅ **无 bug**。 |
| M2 | **obliterate() 的 CAS 参数有竞态隐患** | 🟡 MEDIUM | 同样取当前状态作为 expected。如果外部在 `m = get(id)` 和 `cas(id, m.state, ...)` 之间通过另一个调用改了状态（单线程不可能），CAS 会失败。当前安全。但 `obliterate` 的语义是 "无条件湮灭"——应该始终成功，不该依赖 expected 匹配。建议：内部直接 set state + persist，跳过 CAS 校验，或新增 `forceSetState` 方法。 |
| M3 | **_isValidTransition 允许 Frozen → Obliterated 但实际 cas 调用 `obliterate()` 时 expected 为当前态**：如果当前态是 Frozen，CAS expected=Frozen, new=Obliterated → 流转合法 ✅。如果当前态是 Active，CAS expected=Active, new=Obliterated → 也合法 ✅。设计一致。 | ✅ PASS |

### 3.2 并发安全

| # | 问题 | 严重度 |
|---|------|--------|
| M4 | **read() 的 accessCount 更新不是原子的** | 🟢 LOW | 在 JS 单线程中安全。如果需要持久化一致性，sql.js 的 `prepare + run + free` 在 Node.js 中是同步的，writeFileSync 也是同步的。无风险。 |
| M5 | **link() 的幂等去重检查**：`existing.some(...)` 在 push 前执行。单线程安全。ACCESSED_DURING 可以重复——设计意图明确。 | ✅ PASS |
| M6 | **peek() 返回 Object.freeze 的副本**：正确防止外部修改内部状态。✅ | ✅ PASS |

### 3.3 边界条件

| # | 问题 | 严重度 |
|---|------|--------|
| M7 | **30 天 TTL 窗口**：`now - createdAt < THIRTY_DAYS_MS`。边界情况——恰好 30 天前创建的记录会被过滤掉（严格小于）。合理设计。 | ✅ PASS |
| M8 | **_memCounter 和 _linkCounter 的溢出风险**：JS number 是 64-bit float，整数精确到 2^53。对于 ID 计数器无溢出风险。 | ✅ PASS |
| M9 | **BFS 扩展的 bfsMaxNodes 硬上限**：在 while 循环中每步检查 `visited.size >= maxNodes`，防图爆炸。✅ | ✅ PASS |
| M10 | **init() 重复调用**：会覆盖 `_dbPath` 和 `_db`。若已初始化后再次调用，旧 db 连接未 close → 资源泄漏。应考虑加 `_initialized` 标志或 close 旧连接。 | 🟡 MEDIUM |

### 3.4 错误传播

| # | 问题 |
|---|------|
| M11 | **_saveDb() 的 `try/catch` 静默吞掉所有错误**：如果磁盘满或权限不足，writeFileSync 失败但内存中的状态已更新（write-through 语义被破坏——内存和 DB 不一致）。应至少通过 observer 发布错误事件。 | 🟡 MEDIUM |
| M12 | **_sqlRead 的 `try/catch` 退回到 `_memScanRead`**：优雅降级 ✅ |
| M13 | **persist 写入时 `JSON.stringify` 可能抛异常**（循环引用等）：未被 try/catch 保护。但 content 和 metadata 来自 Agent 内部，预期是 plain object。低风险。 | 🟢 LOW |

---

## 4. Toolkit（工具执行引擎）

### 4.1 状态机正确性

Toolkit 无显式状态机。执行流程：权限校验 → ConfirmGate 拦截 → FileLockManager 加锁 → handler 执行 → 解锁。

### 4.2 并发安全

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| K1 | **write_file 加锁路径的异常处理正确** | ✅ PASS | try 中 unlock，catch 中也 unlock——不会死锁 |
| K2 | **ConfirmGate waitFor 超时 5 分钟**：硬编码。工具执行被阻塞的时间可能与 LLM 超时冲突。应考虑可配置。 | 🟢 LOW |

### 4.3 错误传播

| # | 问题 |
|---|------|
| K3 | **handler 抛异常被正确捕获**：`try { return await handler(...) } catch (e) { return { success: false, error: String(e) } }` ✅ |
| K4 | **ConfirmGate 拒绝返回 `{ success: false, error: "Rejected by ConfirmGate" }`**：调用方能区分拒绝和失败 ✅ |
| K5 | **FileLockManager 加锁失败返回 `{ success: false, error: "File locked" }`**：信息量偏低——未指明谁持有锁 | 🟢 LOW |

### 4.4 工具存根问题

| # | 问题 | 严重度 |
|---|------|--------|
| K6 | **所有内置工具当前均为存根（stub）** | 🔴 HIGH | `read_file` 不读文件、`write_file` 不写文件、`run_shell` 不执行命令。这意味着所有 Agent 的实际产物都是 mock 数据。当前阶段（Core-1 原型）可接受，但在进入 Core-2 前必须接入真实 I/O 实现。否则审计结论的正确性受限——因为 Tool 层的 Sandbox 保障、路径校验、文件大小限制等安全关键逻辑尚未实现。 |

---

## 5. AgentPool（Agent 生命周期管理）

### 5.1 状态机正确性

状态机：Created → Awake → Active → (Awake ↔ Active) → Draining → Destroyed

**发现**：

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| A1 | **spawn() 初始状态为 Created** | ✅ PASS | 与 AgentStatus 枚举一致 |
| A2 | **状态流转无守护** | 🟡 MEDIUM | `setStatus(instanceId, status)` 可接受任意状态，不做合法性校验。例如可以将 Destroyed 的实例设回 Active。虽然当前调用者（Scheduler）不会这样做，但缺少防护层。建议：加状态流转校验表。 |
| A3 | **destroy() 无条件删除**：不检查实例是否在 Draining/Destroyed 状态。如果 destroy 一个仍在 Active 的实例，Agent 的异步操作可能仍在运行。当前 Scheduler 在 execute 完成后立即 destroy，此时 Agent 一定空闲。但缺少防护。 | 🟡 MEDIUM |

### 5.2 边界条件

| # | 问题 | 严重度 |
|---|------|--------|
| A4 | **spawn 时 `config.maxInstances = 0`**：`instances.size >= 0` → 永远 false，永不超限。容许多余实例创建。应加最小配额约束。 | 🟡 MEDIUM |
| A5 | **未注册类型的 spawn**：`config` 不存在 → return false ✅ |
| A6 | **重复 spawn 同一 instanceId**：`instances` 是 Set，add 重复 id 不报错但也不增加计数 → 配额被绕过。应检查是否已存在。 | 🟡 MEDIUM |

---

## 6. FileLockManager（文件锁）

### 6.1 并发安全

| # | 问题 | 严重度 |
|---|------|--------|
| F1 | **读写锁规则正确** | ✅ PASS | 写锁排斥一切、读锁共存、读排斥写 |
| F2 | **release 时检查 holder**：只从 holders Set 中删除 holderId ✅ |
| F3 | **release 不存在的 holder**：`delete` 对不存在的元素返回 false 但无副作用 ✅ |

### 6.2 边界条件

| # | 问题 |
|---|------|
| F4 | **同一 holder 重复 acquire 同一文件**：如果 holder 已持有读锁再请求读锁 → 成功（因为读锁共存），但 holders 中 holderId 被重复 add（Set 天然去重）。如果 holder 已持有读锁再请求写锁 → 被拒绝（因为 existing.type=Read 且请求 Write → false）。正确的锁升级拒绝。✅ |
| F5 | **无死锁检测**：若 Agent A 持有 file1 等 file2，Agent B 持有 file2 等 file1 → 死锁。当前简单场景下不会发生，但无超时或检测机制。🟢 LOW |

---

## 7. ConfirmGate（确认门）

### 7.1 状态机正确性

| # | 问题 | 严重度 |
|---|------|--------|
| C1 | **waitFor 超时后 resolver 未清理 resolvers Map**：setTimeout 回调中 `this.resolvers.delete(requestId)` ✅ |
| C2 | **waitFor 超时后 pending 未删除**：setTimeout 中也 `this.pending.delete(requestId)` ✅ |
| C3 | **resolve() 在无 bridge 模式下调用 resolver**：正确从 resolvers Map 取出并调用 ✅ |
| C4 | **resolve() 在有 bridge 模式下不可达**：因为 bridge.confirm 返回后直接 resolve Promise，不会进入 resolvers Map 路径 ✅ |
| C5 | **bypassAll() 后 needsConfirmation 始终返回 false** ✅ |

### 7.2 边界条件

| # | 问题 | 严重度 |
|---|------|--------|
| C6 | **同一 requestId 重复 request**：`pending.set(req.id, req)` 直接覆盖，旧 resolver 丢失 → 旧 waitFor 永不 resolve | 🟡 MEDIUM |
| C7 | **handleTimeout 的 L2/L3 行为**：不删 pending，返回 false 但保留请求——正确，等待用户决策。但若用户永不决策 → 永久挂死。建议加绝对超时。 | 🟢 LOW |

---

## 8. PipelineObserver（事件管道）

### 8.1 隔离性

| # | 问题 | 严重度 |
|---|------|--------|
| P1 | **handler 异常隔离**：`try { h(event) } catch {}` ✅ |
| P2 | **优先级匹配**：emit 只调用与事件优先级匹配的 handler。明确文档化 ✅ |
| P3 | **off() 移除整个优先级**：无法移除单个 handler。建议允许 `off(priority, handler)` | 🟢 LOW |

---

## 9. 综合判定

### 9.1 关键风险清单

| ID | 模块 | 风险 | 严重度 | 建议修复方向 |
|----|------|------|--------|-------------|
| K6 | Toolkit | 所有工具均为存根，无真实 I/O | 🔴 HIGH | Core-2 必须实现真实工具并加沙箱 |
| S1 | Scheduler | _dispatchMulti 的 claimedBy 语义脆弱 | 🔴 HIGH | 加固：即使在 early-return 路径也确保 complete/release |
| T2 | TaskBoard | complete() 等齐逻辑依赖 claimedBy-results 对称性 | 🔴 HIGH | 加 invariant 断言：claimedBy 的每个元素最终都在 results 中或已被 release |
| S2 | Scheduler | _drainReplanQueue 中 replan 项抛异常会丢失 | 🟡 MEDIUM | 加 try/catch，失败项放回队列或标记失败 |
| M2 | MemoryStore | obliterate() 应无条件湮灭 | 🟡 MEDIUM | 内部跳过 CAS expected 校验 |
| M10 | MemoryStore | init() 重复调用资源泄漏 | 🟡 MEDIUM | 加 _initialized 标志 |
| M11 | MemoryStore | _saveDb 静默失败导致内存/DB 不一致 | 🟡 MEDIUM | 通过 observer 发布错误 |
| A2 | AgentPool | setStatus 无流转校验 | 🟡 MEDIUM | 加状态流转表 |
| A6 | AgentPool | 重复 spawn 同一 instanceId 绕过配额 | 🟡 MEDIUM | 检查是否已存在 |
| C6 | ConfirmGate | 重复 requestId 导致旧 resolver 丢失 | 🟡 MEDIUM | 拒绝重复 requestId |
| S8 | Scheduler | REPLAN_MAX_ROUNDS == MAX_TOTAL_REPLANS 不合理 | 🟡 MEDIUM | 全局上限增大 |

### 9.2 正向发现

- ✅ TaskBoard 的 claim/release/complete 状态机设计严谨，单线程并发安全
- ✅ MemoryStore 的四态 CAS 流转完整，peek() 冻结防御到位
- ✅ Scheduler 的 "领而不执" 重规划模式优雅，避免了死循环
- ✅ PipelineObserver 的 handler 异常隔离防止级联故障
- ✅ FileLockManager 读写锁逻辑正确
- ✅ 测试覆盖六大暗雷（并发 claim、父失败级联、重规划插入、多视角竞态、熔断、release 死锁）

### 9.3 总体评估

**代码质量**：B+（原型阶段整体良好）
**生产就绪度**：C（需接入真实 I/O 并修复 HIGH 级问题）
**推荐**：Core-2 启动前，优先修复 Toolkit 存根问题（K6）和 claimedBy 语义加固（S1/T2）。

---

*—— 阿贝多，Cortex Code Agent，2025-07-11*
