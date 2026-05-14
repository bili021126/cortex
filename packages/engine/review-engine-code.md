# 引擎代码审查报告 —— 刻晴·玉衡

**审查范围**: `packages/engine/`, `packages/llm/`, `packages/shared/`, `packages/testing/`  
**审查聚焦**: 逻辑正确性、边界条件、线程安全、资源泄漏、破坏性变更、错误处理完整性  
**审查日期**: 2026-07-16  
**查阅档案**: MemoryStore 前人审查记录（四态状态机 CAS 回滚、假阳性禁止原则均已落地）

---

## 目录

1. [🔴 严重缺陷（可能导致数据损坏/逻辑错误）](#1-严重缺陷)
2. [🟠 中等问题（边界条件/异常路径不完整）](#2-中等问题)
3. [🟡 设计问题/不必要的复杂性](#3-设计问题不必要复杂性)
4. [⚪ 不符合规范的代码风格/注释问题](#4-代码规范问题)

---

## 1. 🔴 严重缺陷

### D1. StrategistAgent 状态管理完全重复了 PoolAwareState

**文件**: `packages/engine/src/strategist-agent.ts`  
**位置**: `_setStatus()` 和 `status` getter（约 30 行）

**问题**: `StrategistAgent` 自行实现了与 `PoolAwareState` 完全相同的状态管理逻辑：
- `_localStatus` / `_pool` / `_instanceId` 字段
- `status` getter 的 Pool 委托 + 本级降级逻辑
- `_setStatus()` 中有完整的 `VALID_LOCAL` 流转表 + 校验

**为什么严重**: 治理判例 **NG-2026-0511-CopyPaste-StateMachine** 正是针对此问题而设——消除 Agent 间复制的状态管理代码。`PoolAwareState` 已在 `base-agent.ts` 中成功使用，`StrategistAgent` 未复用。这导致：
1. 状态管理逻辑有两份源码，后续修改需同步两处
2. `StrategistAgent` 新增了一个叫做 `VALID_LOCAL` 的独立流转表（与 `AgentPool.VALID_TRANSITIONS` 语义相同但实例不同）

**预期**: 应像 `BaseAgent` 一样使用 `PoolAwareState` 组件。

---

### D2. react-helper.ts 与 components/react-loop.ts 代码完全重复

**文件**: 
- `packages/engine/src/react-helper.ts`
- `packages/engine/src/components/react-loop.ts`

**问题**: 两个文件包含几乎完全相同的 `runReActLoop` 函数实现（~70 行）。仅签名不同：
- `react-helper.ts`: `runReActLoop(callerType, llm, toolkit, systemPrompt, node, model, maxLoops)`——平铺参数
- `components/react-loop.ts`: `runReActLoop(ctx: ReActContext, node, model)`——上下文封装

`index.ts` 将旧版导出为 `runReActLoopLegacy`——这意味着新旧两版仍在代码库中共存。

**为什么严重**: 
1. 任何 ReAct 循环的逻辑修复（TOOL_DISCIPLINE 文本、强制收束策略、tool call 错误处理）必须修改两处，容易遗漏
2. 旧版 `DEFAULT_MAX_LOOPS = 64` 硬编码，新版从 `ReActContext.maxLoops` 获取——两者行为可能不一致

**预期**: 删除 `react-helper.ts`，所有调用方迁移到 `ReActContext` 签名。

---

### D3. MemoryStore read() 无关闭保护

**文件**: `packages/engine/src/memory-store.ts`

**问题**: `write()` 方法有关闭检查：
```typescript
if (this._persistence.lifecycle !== "active") {
  throw new Error(`MemoryStore 已关闭...`);
}
```
但 `read()` 没有。关闭后的 `read()` 会在 `persistenceRead()` 中尝试 SQL 查询时失败（DB 已关闭），退化到内存扫描——但此时 `_storage` 的状态不确定（`close()` 不清理 `storage.memories`）。

**为什么严重**: 关闭后调用 `read()` 不会抛异常，但结果不可预期。退化路径的 `MemorySqlDegraded` 日志可能误导排错方向。

**输入触发**: 
```typescript
await store.close();
const results = store.read({ ... });  // 不会抛异常，但结果不可信
```

**预期**: `read()` 应在 `lifecycle !== "active"` 时抛异常，或明确标记降级原因。

---

### D4. MemoryStoreMonitor.stop() 会误删其他组件的 handler

**文件**: `packages/engine/src/memory/monitor.ts`

**问题**: `stop()` 方法调用：
```typescript
this.observer.off(PipelinePriority.CRITICAL);
this.observer.off(PipelinePriority.HIGH);
this.observer.off(PipelinePriority.NORMAL);
```
而 `PipelineObserver.off(priority)` 的实现是：
```typescript
off(priority: PipelinePriority): void {
  this.handlers.delete(priority);  // 删除整个优先级的 handler 列表
}
```
这会移除该优先级下 **所有** handler，不仅仅是 MemoryStoreMonitor 自己注册的。

**为什么严重**: 如果有其他组件（Sentinel、管家等）在同一优先级上注册了 handler，调用 `monitor.stop()` 会导致这些 handler 也被清除。

**预期**: `off()` 应支持按 handler 引用精确移除。`PipelineObserver` 的 `off` 方法签名应改为 `off(priority, handler?)`。

---

### D5. link() 方法中 `_creatorId` 参数声明但未使用

**文件**: `packages/engine/src/memory-store.ts`  
**位置**: `link(sourceId, targetId, linkType, _creatorId)`

**问题**: 参数以 `_creatorId` 命名（下划线前缀暗示 unused），但这是一个 **公开 API** 的参数。从契约角度看：
- 调用方传入了 `_creatorId` 值但不会被记录——静默的无操作
- `MemoryLink` 接口中没有 `creatorId` 字段，存了也没地方放
- 参数的存在误导调用方认为链路创建者会被追踪

**为什么严重**: 契约缺口。调用方如 `executeWithMemoryPipeline` 中 `memory.link(memId, ctxMemId, LinkType.ProducedBy, agentType)` 传入了 `agentType` 但未实际存储。

**预期**: 要么移除参数（破坏性变更，需标注迁移指南），要么在 `MemoryLink` 中添加 `creatorId` 字段并实际写入。

---

### D6. AgentPool/TaskBoard 的双通道 invariant 上报模式维护成本高

**文件**: `packages/engine/src/agent-pool.ts`, `packages/engine/src/task-board.ts`

**问题**: 每种违规上报都写三重 fallback：
```typescript
if (AgentPool.onInvariant) {
  AgentPool.onInvariant(...);
} else if (this._observer) {
  this._observer.emit(...);
} else if (!process.env.VITEST) {
  console.error(...);
}
```

**为什么严重**: 
1. 约 8-15 行样板代码在每个 emit 点重复，全代码库约 6 处
2. 优先级不明确——`onInvariant` 静态字段和 `_observer` 实例字段的关系未文档化
3. `destroy()` 中，如果 `_observer` 和 `onInvariant` 都存在，只有 `_observer` 路径走（因为 `onInvariant` 仅在 `_observer` 未设置时检查 `else if`），与"互补双通道"矛盾

**预期**: 简化为单通道：所有 invariant 统一走 `this._observer`。`static onInvariant` 应废弃。

---

## 2. 🟠 中等问题

### M1. ConfirmGate.handleTimeout L2/L3 永远不回收 pending

**文件**: `packages/engine/src/confirm-gate.ts`

**问题**: 对 L2/L3 等级，`handleTimeout` 执行 `return false` 但不清理 pending 条目：
```typescript
if (level === RL.L0 || level === RL.L1) {
  this.pending.delete(requestId);
}
// L2/L3: 不做删除
return false;
```
这些 pending 请求永久挂在 Map 里。如果 `waitFor()` 未设置 `timeoutMs`，且 `bridge.confirm()` 永不返回，则条目永久泄露。

**影响**: 内存泄漏 + `hasPending()` 永远返回 true。

**预期**: L2/L3 超时时也应移除 pending 条目并返回 false。

---

### M2. MemoryPersistence.runBatch 非真实批处理

**文件**: `packages/engine/src/memory/persistence.ts`

**问题**: `runBatch()` 实现是逐行 `stmt.run(params)`，而非使用 better-sqlite3 的事务或批量绑定：
```typescript
for (const params of rows) {
  stmt.run(params);
}
```
对于 `MemoryStore.read()` 阶段 3 的 access tracking 批量更新（可能数十条记录），每次 `stmt.run` 都是独立事务。

**影响**: 访问追踪写入性能不佳。大量并发读操作时 WAL 文件增长更快。

**预期**: 使用 better-sqlite3 的 `transaction` API：
```typescript
const batchUpdate = db.transaction((rows) => {
  for (const params of rows) stmt.run(params);
});
```

---

### M3. 向量维度校验缺失

**文件**: `packages/engine/src/memory-store.ts`（write）

**问题**: `schema.ts` 定义 `EMBEDDING_DIM = 384`，但 `MemoryStore.write()` 不校验传入 `input.embedding` 的长度是否为 384。`vectorRecall()` 中检测维度不匹配时会静默跳过召回，但错误维度的数据已污染存储。

**预期**: `write()` 中若 `embedding` 存在则校验 `embedding.length === EMBEDDING_DIM`，不符则抛异常。

---

### M4. FileLockManager 无界内存增长

**文件**: `packages/engine/src/file-lock-manager.ts`

**问题**: `locks` Map 的清理完全依赖于 `_cleanStaleLock(filePath)`（在 `acquire`/`isLocked` 时按路径触发）和 `cleanStaleLocks()`（需外部定时器调用）。若长时间无新 `acquire` 调用且无定时器，过期锁条目永久驻留。

**影响**: 在大量文件被短暂锁定后 holder 消失（无 `release`）的场景下，Map 无限制增长。

**预期**: 在构造函数中启动周期性清理定时器，或在 `release` 中主动触发全局清理。

---

### M5. MemoryStore.read() accessCount 回滚不完整

**文件**: `packages/engine/src/memory-store.ts`  
**位置**: read() 阶段 3，`updateAccessTracking` 失败回滚

**问题**: 回滚使用：
```typescript
m.accessCount = originalAccessCounts.get(m.id) ?? m.accessCount;
m.lastAccessedAt = originalLastAccessed.get(m.id) ?? m.lastAccessedAt;
```
`originalLastAccessed.get(m.id) ?? m.lastAccessedAt` 中，如果 Map 中没有该条目（不应发生但无保障），`m.lastAccessedAt` 已在前面的循环中被更新为 `now`，因此回滚不会恢复到原始值。

**预期**: 使用更安全的结构保存原始值副本：
```typescript
const originals = new Map(results.map(m => [m.id, { accessCount: m.accessCount, lastAccessedAt: m.lastAccessedAt }]));
```

---

### M6. search_code rg 回退路径错误吞没

**文件**: `packages/engine/src/toolkit.ts`  
**位置**: `search_code` handler

**问题**: `rg` 抛异常时（非 exit=1），调用 `_grepFallback()`。但若 `_grepFallback` 内部也抛出（如权限错误），内层 try-catch 只 `console.warn` 而不传播，外层 catch 返回模糊的 "搜索失败"。

**预期**: `_grepFallback` 的错误应传播，或外层 catch 中包含原始 rg 错误信息。

---

### M7. PoolAwareState 的 _tag getter 隐藏异常

**文件**: `packages/engine/src/pool-aware.ts`

**问题**: 若 `_tagProvider()` 抛出，默认返回 `"Agent"`：
```typescript
private get _tag(): string {
  try { return this._tagProvider(); } catch (e) { 
    console.warn(`[PoolAware] tagProvider threw: ${String(e)}`); 
    return "Agent"; 
  }
}
```
所有来自该 Agent 的错误上报都以模糊的 "Agent" 来源发出——排错时找不到问题 Agent。

**预期**: 不应吞没异常——尽早抛出以便发现问题。

---

### M8. MemoryPersistence 的 WAL checkpoint 失败后脏状态标记

**文件**: `packages/engine/src/memory/persistence.ts`  
**位置**: `flush()` 方法

**问题**: 当 `wal_checkpoint(TRUNCATE)` 失败时，`_dirty` **不会**被清除（保持 true），下次 `scheduleFlush()` 会延迟重试。但失败后 `_flushFailStreak` 指数退避。若连续失败超过 `MAX_FLUSH_FAIL_STREAK`（3次），延迟可达 200ms × 2^4 = 3.2s。但在此期间 `_lifecycle` 若已切为 "closing"，`scheduleFlush()` 会跳过且不清除 `_dirty`。

**影响**: 内存中的脏标记永远为 true，导致下次 `open()` 后第一个 `flush()` 认为有脏数据但实际无可刷新内容。这是一个假阳性，不影响正确性但浪费一个 checkpoint 调用。

---

## 3. 🟡 设计问题/不必要的复杂性

### C1. Agent 双轨制：BaseAgent + createAgent 工厂并存

**文件**: `packages/engine/src/`（base-agent.ts, agents/*.ts, components/agent-factory.ts, index.ts）

两套创建 Agent 的方式同时导出。`CodeAgent` 等类标记 `@deprecated` 但仍存在。MetaAgent 和 StrategistAgent 未重构。

**影响**: 新增 Agent 的开发者不知道该用哪种模式。BaseAgent 的修改需同步到组合式工厂路径。

**建议**: v2.2 中完全移除 BaseAgent 继承路径。

---

### C2. AGENT_TAGS 标签重叠

**文件**: `packages/shared/src/agent.ts`

**问题**: `Code` 的标签包含 `"review"` 和 `"analysis"`，与 `Review` 和 `Analysis` Agent 重叠。注释说不应有语义矛盾的重叠，但现实存在。`tags=["review"]` 的节点匹配 Code（密度 2/8=0.25）和 Review（密度 2/2=1.0），靠密度打破平局——这是隐式依赖。

**建议**: Code/Api/Data 的标签中移除 `"review"` 和 `"analysis"`（破坏性变更，需发行说明标注）。

---

### C3. MemoryStore 构造函数硬编码子组件

**文件**: `packages/engine/src/memory-store.ts`

Constructor 直接 `new MemoryStorage/MemoryPersistence/MemoryLifecycle/MemoryQueryEngine`，无法在测试中注入 mock。

**影响**: 测试只能通过 `(store as any)` 劫持内部属性来模拟失败场景。

**建议**: 添加可选注入参数：
```typescript
constructor(observer?: PipelineObserver, deps?: { storage?: MemoryStorage; persistence?: MemoryPersistence })
```

---

### C4. MemoryStoreMonitor 告警粒度粗糙

**文件**: `packages/engine/src/memory/monitor.ts`

所有 memory.* 事件（含 access_count 更新等 Normal 级别事件）共享同一个窗口计数器。大量正常事件可能导致误告警（"高频异常"）。

**建议**: 按事件类型分计数器，或只对 `criticalTypes` 做阈值检测。

---

### C5. SkillRegistry 的 unregister 在 for-of 中修改 Map

**文件**: `packages/shared/src/skill-registry.ts`

`unregister()` 中使用 `for...of` 遍历 `this._byTag` 同时调用 `this._byTag.delete(tag)`。虽然 JavaScript 的 `Map` 迭代器在删除当前条目时安全（跳过但不崩溃），但这是脆弱模式——未来重构若改为 `for...in` 或 `forEach` 则会引发运行时错误。

**建议**: 收集待删除的 key 到数组，遍历完后统一删除。

---

### C6. MemoryStore 的 MONITOR 引用未与 MemoryStore 生命周期对齐

`MemoryStoreMonitor` 在 `start()` 中订阅事件，`stop()` 中取消。但 `MemoryStore` 的 `close()` 不会调用 `monitor.stop()`。如果 `MemoryStore` 被关闭后重新 `init()`，monitor 仍持有旧 observer 的 handler 引用。

---

## 4. ⚪ 代码规范问题

### S1. process.env.VITEST 环境检查散落 4 处

`agent-pool.ts`, `task-board.ts`, `pool-aware.ts`, `strategist-agent.ts` 中均有 `!process.env.VITEST` 判断。

测试行为应在测试配置或 mock 中控制，而非在产品代码中判断环境变量。

### S2. 注释中"方案B"未定义术语

`agent-pool.ts`, `base-agent.ts` 等文件多处引用 "方案B"/"方案A"，但无文档说明方案A是什么、B 解决了什么、为什么选择 B。

### S3. MemoryPersistence JSDoc 引用已改名方法

`run()` 的 JSDoc 写 "安全的 DB 写入封装。治理判例 NG-2026-0509-Persist-False-Positive……" 但注释中引用的是旧名 `_safeDbRun`（v2.1 前的方法名）。

### S4. type DatabaseType 使用 InstanceType

```typescript
type DatabaseType = InstanceType<typeof Database>;
```
这绕过了 better-sqlite3 的类型导出。虽然可行，但隐式依赖 `typeof Database` 的运行时类型。若 better-sqlite3 升级修改了内部类结构，此类定义可能断裂。

---

## 📊 统计总结

| 严重度 | 数量 | 关键影响 |
|--------|------|----------|
| 🔴 严重 | 6 | 数据损坏/逻辑错误/契约缺口 |
| 🟠 中等 | 8 | 异常路径不完整/性能/资源泄漏 |
| 🟡 设计 | 6 | 可维护性/扩展性 |
| ⚪ 规范 | 4 | 代码质量 |
| **合计** | **24** | |

### 优先级建议

1. **D1, D2** — 立即修复（代码重复导致维护隐患，修改一处另一处必漏）
2. **D3, D4** — 高优先级（数据安全/功能完整性）
3. **D5, M1, M2, M3, M4** — 纳入 v2.2 迭代
4. **C1~C6** — 纳入 v2.2 重构计划，标注在架构路线图中

---

*审查结论: 无明显架构级缺陷被遗漏——24 项发现中 6 项严重、8 项中等、6 项设计问题、4 项规范问题。核心数据路径（Scheduler→AgentPool→MemoryStore→Persistence）的设计总体上可靠，问题集中于代码冗余和异常边界覆盖不足。*
