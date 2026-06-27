# 🌱 事件总线（PipelineObserver）根系追踪报告

> 分析者：纳西妲  
> 分析范围：`packages/scheduler/src/core/pipeline-observer.ts` + `packages/shared/src/infra.ts` + 订阅链路  
> 方法论：读源码 → 追引用 → 验证声明 → 标记偏差

---

## 一、三级优先级——✅ 确认

**声明**：`CRITICAL(0)` / `HIGH(1)` / `NORMAL(2)` 三级优先级

**代码位置**：`infra.ts` L11-14

```typescript
export enum PipelinePriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
}
```

**验证**：枚举值明确，emit() 只匹配相同优先级的 handler——测试用例 `"只调用事件优先级匹配的 handler"` 验证了分派逻辑。✅

---

## 二、类型化事件枚举——✅ 确认

**声明**：封闭的 `PipelineEventType` 枚举 + `EventPayloadMap` 按事件类型锁定 payload

**代码位置**：`infra.ts` L20-236（事件枚举） + L240-398（Payload Map）

**统计**：**56 个事件类型**，分布在 9 个域：

| 域 | 数量 | 事件名示例 |
|---|---|---|
| AgentPool | 2 | AgentPoolInvariantViolation, AgentPoolDestroyBypass |
| Scheduler | 7 | SchedulerLayerStart, SchedulerLoopCrashed, SchedulerDone... |
| Node | 7 | NodeStart, NodeComplete, NodeFailed, NodeReplan... |
| Pool | 1 | PoolDestroyFailed |
| MemoryStore | 8 | MemoryDbWriteFailed, MemoryWriteBlocked... |
| Error system | 2 | ErrorReported, ErrorSilentUpgraded |
| Governance | 8 | ConstitutionViolation, GovernanceAuditReport... |
| RLM/ManifoldGate | 10+ | RlmDecompose, ManifoldGateWaitStart... |
| Interact/Mem/Exec/Tele | 10+ | InteractConfigOverrideApplied, MemMemoryWritten... |

**验证**：每个枚举成员在 `EventPayloadMap` 中都有对应条目。`ObservableEvent` 接口通过泛型 `T extends PipelineEventType` 实现编译期类型安全——emit 时 type 和 payload 必须匹配。✅

---

## 三、SafeErrorReporter——✅ 确认

**声明**：统一错误上报回调，三档 severity（fatal/degraded/silent）

**代码位置**：
- 接口定义：`infra.ts` L435-454
- 实现：`pipeline-observer.ts` L108-148（`createSafeReporter()` → `_reportError()`）

**三档行为**：

| severity | Pipeline 优先级 | 效果 |
|---|---|---|
| `fatal` | CRITICAL | 立即 emit `error.reported`，计数器重置 |
| `degraded` | HIGH | 立即 emit `error.reported`，计数器重置 |
| `silent` | 不 emit（先记） | 写入死信队列 + 累计计数器 |

测试文件 `pipeline-observer-reporting.test.ts` 覆盖了全部 6 个用例。✅

---

## 四、死信环形缓冲区——✅ 确认

**声明**：`deadLetterRing` 环形缓冲，满时覆盖最老条目

**代码位置**：`pipeline-observer.ts` L36-54

```typescript
private deadLetterRing: Array<{ id: string; type: string; timestamp: number; spanId?: string }> = [];
private deadLetterIndex = 0;
private static readonly DEAD_LETTER_MAX = 1000;
```

**`recordDeadLetter()` 行为**：
- 未满：push 追加
- 已满：`deadLetterRing[deadLetterIndex % DEAD_LETTER_MAX]` 环形覆盖

**emit 时检查死信**：`_findUpstreamInDeadLetter(spanId)` 在 causalChain 中追溯上游事件——silent 吞掉的事件不会彻底消失，因果链仍可复原。✅

---

## 五、silent 升级机制——✅ 确认

**声明**：同一 source 连续 silent ≥ 3 次 → 自动升级为 degraded 并 emit

**代码位置**：`pipeline-observer.ts` L117-130

```typescript
const count = (this._silentCounters.get(ctx.source) ?? 0) + 1;
this._silentCounters.set(ctx.source, count);
if (count >= PipelineObserver.SILENT_UPGRADE_THRESHOLD) {  // 3
  this._silentCounters.delete(ctx.source);
  this.emit({ type: PipelineEventType.ErrorSilentUpgraded, priority: PipelinePriority.HIGH, ... });
}
```

**重置规则**：非 silent 错误（fatal/degraded）→ `this._silentCounters.delete(ctx.source)`，计数器清空。

测试用例 2-3-6 验证了：
- 2 次 silent → 不升级 ✅
- 3 次 silent → 升级 ✅
- degraded 后 silent 计数器重置 ✅

---

## 六、递归防护——✅ 确认

**声明**：`_reentrancyDepth` 防递归，上限 3 层

**代码位置**：`pipeline-observer.ts` L28-29

```typescript
private _reentrancyDepth = 0;
private static readonly MAX_REENTRANCY_DEPTH = 3;
```

**行为**（`_reportError()` 入口）：
1. `if (_reentrancyDepth >= MAX_REENTRANCY_DEPTH)` → console.error + 丢弃（不递归）
2. `this._reentrancyDepth++`
3. try { ... } finally { `this._reentrancyDepth--` }

**防止场景**：handler 异常 → `_reportError` → emit → 新 handler 异常 → `_reportError` → ... 栈溢出。上限 3 层后切断。✅

---

## 七、订阅关系——⚠️ 部分偏差

### 7.1 Sentinel → CRITICAL ✅（但不是 CRITICAL + HIGH）

**代码**：`bootstrap-engine.ts` §6.2.3

```typescript
observer.on(PipelinePriority.CRITICAL, sentinelHandler);
```

实际只订阅了 **CRITICAL**。HIGH 没有直接订阅——但 `SentinelSignalFilter.filter()` 内部会检查 `l2EventTypes` 列表，如果收到 HIGH 事件也会处理。不过没有注册 HIGH handler，所以不会收到 HIGH 事件。

**结论**：声明"Sentinel → CRITICAL + HIGH" → **实际为 CRITICAL only** ⚠️

### 7.2 MemoryStore → ALL（CRITICAL + HIGH + NORMAL）❓不可验证

`MemoryStorePlugin` 中创建 `new MemoryStore(backend, observer, ...)`——observer 作为构造函数参数传入，但 `@cortex/memory-store` 不在本仓库的 packages 中（外部依赖）。无法确认它是否在内部注册了 observer subscription。

从可见代码看，MemoryStore 使用 observer 来 **emit** 事件（如 MemoryDbWriteFailed, MemoryPersistFailed），而非订阅。

**结论**：声明无法通过本仓库源码验证。❓

### 7.3 管家（ButlerAgent）→ HIGH + NORMAL ❌ 实际为 CRITICAL + HIGH + NORMAL

**代码**：`butler-agent.ts` L69-71

```typescript
this.observer.on(PipelinePriority.CRITICAL, this._boundCritical);
this.observer.on(PipelinePriority.HIGH, this._boundHigh);
this.observer.on(PipelinePriority.NORMAL, this._boundNormal);
```

管家订阅了**全部三级优先级**，包括 CRITICAL。

**结论**：声明少了 CRITICAL。**实际为 ALL（CRITICAL + HIGH + NORMAL）** ⚠️

### 7.4 实际订阅全景

| 订阅者 | CRITICAL | HIGH | NORMAL | 来源 |
|---|---|---|---|---|
| Sentinel handler | ✅ | ❌ | ❌ | bootstrap-engine.ts §6.2.3 |
| StrategistAgent | ❌ | ✅ | ❌ | bootstrap-engine.ts §7.1 |
| MetaAgent (NodeComplete) | ❌ | ✅ | ❌ | meta-agent.ts setObserver() |
| MetaAgent (NodeFailed) | ✅ | ❌ | ❌ | meta-agent.ts setObserver() |
| ButlerAgent (管家) | ✅ | ✅ | ✅ | butler-agent.ts wakeup() |

---

## 八、其他发现

### 8.1 递归防护也有死信记录

`_reportError()` 在 silent 路径中调用 `recordDeadLetter()`——即使 silent 错误不 emit 事件，也会被记录在死信队列中供因果链回溯。✅

### 8.2 PipelineObserver 实现了 `IPipelineObserver` 接口

接口定义在 `infra.ts` L415-421，包含 `emit`、`on`、`off` 三个方法。实现完全匹配——可替换性良好。✅

### 8.3 `off()` 支持精确移除

按 handler 引用精确移除（D4 fix），避免误删其他组件的 handler。MetaAgent 的 `_unsubscribe()` 和 ButlerAgent 的 `shutdown()` 都利用了此能力。✅

### 8.4 PipelineObserverPlugin 是零依赖根插件

`dependencies = []`——被所有治理/基础设施插件依赖。在插件生命周期中最早 init。✅

---

## 九、总结

| 特征 | 状态 |
|---|---|
| 三级优先级 | ✅ 确认 |
| 类型化事件枚举（56 个） + EventPayloadMap | ✅ 确认 |
| SafeErrorReporter（三档 severity） | ✅ 确认 |
| 死信环形缓冲（1000 上限） | ✅ 确认 |
| silent 升级（≥3 次 → degraded） | ✅ 确认 |
| 递归防护（上限 3 层） | ✅ 确认 |
| 订阅：Sentinel → CRITICAL + HIGH | ⚠️ 实际仅 CRITICAL |
| 订阅：MemoryStore → ALL | ❓ 无法验证（外部依赖） |
| 订阅：管家 → HIGH + NORMAL | ⚠️ 实际为 ALL（含 CRITICAL） |

**整体评价**：事件总线的核心实现（优先级、类型安全、错误上报、死信、升级、递归防护）全部符合声明——设计的骨架是健康的。订阅关系的声明有些小偏差（管家的 CRITICAL 订阅被遗漏，Sentinel 的 HIGH 被夸大了），这些偏差不大但建议更新注释使其与实际代码一致。
