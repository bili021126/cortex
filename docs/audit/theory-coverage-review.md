# 理论覆盖审查 + 新问题推导

> 定位：将遥控测设计原则（9 条子原则）+ 原子事实链 + 记忆操作事件——对照七阶段路线图逐阶段检查覆盖度，并推导引入原子事实链后产生的新问题。
> 关联：`docs/cortex-evolution-master-plan.md`、`docs/core/telemetry-design-principles.md`、`docs/core/memory-world-model-design.md`。

---

## 一、覆盖度矩阵

```
阶段     核心内容               遥测覆盖           原子事实链   记忆操作事件
                              （子原则 1-9）                    （Mem:*）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Phase 0 遥测基础设施             ✅ 全部覆盖          ✅ #9        —
         EventBus + AuditTrail   （自身定义）

Phase 1 清理                   ⚠️ 部分               —           —
        删死代码/幽灵包         事件前缀尚未分配
                                给清理操作（Tele:Cleanup）

Phase 2 裂                     ⚠️ 部分               —           —
        shared→engine           迁移操作可观测
                                但未定义 Exec:Relocated 事件

Phase 3 基础设施                ✅ 已覆盖             ⚠️          —
        ConfigRegistry          Config:* 事件         causalChain
        Scene-Aware             冲突 3 已化解         字段未强制

Phase 4 合                     ✅ 已覆盖             —           —
        重复值合并              Config:* 事件覆盖
        Degradation 试点        但 silent 吞事件→因果链断裂

Phase 5 门控                   ✅ 已覆盖             ✅           ✅
        Domain Gate             Mem:DomainGateUpdated 带 causalChain
        Signal Routing          Gov:SignalRouted      含因果链
        Degradation 全量        子原则 9：吞事件继承链
        Config Drift            —                     漂移检测结果应 emit

Phase 6 记忆世界模型            ✅ 已覆盖             ✅           ✅
        V/M/C 三层             Mem:Written / StrategySelected
                                ObliterationTriggered

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 21   ⚠️ 3   — 5
```

### 三个覆盖缺口

| # | 缺口 | 严重度 | 说明 |
|----|------|--------|------|
| G1 | Phase 1/2 清理和裂操作无观测事件 | P2 | 删除死代码、迁移文件——这些是低频操作，但结果影响后续阶段。建议加 `Tele:StructuralChange` 通用事件。 |
| G2 | Config Drift 检测结果无 emit | P1 | 漂移检测在 CI 跑，但结果不进事件流——凝光无法感知。应 emit `Gov:ConfigDriftDetected`。 |
| G3 | causalChain 字段在各 event payload 中未强制 | P1 | 子原则 9 说"可选"，但权轴 Agent 依赖的事件必须强制。需标注哪些事件类型是强制 causalChain 的。 |

---

## 二、引入原子事实链后推导出的新问题（8 项）

### 🔴 P0 — 阻塞级（2 项）

#### NP-1：spanId 的生成权归属

**问题**：谁负责生成 `spanId`？

候选：
- A）甘雨在 `plan()` 时生成 spanId，下发给每个 TaskNode
- B）遥测基础设施生成（PipelineObserver 内部）
- C）每个发起操作的 Agent 自行生成

**分析**：如果 C，同一个 TaskGraph 内的不同 Node 会有不同 spanId，无法跨节点追踪。如果 B，遥测层太厚重。**推荐 A**——spanId 应该是 plan 阶段的产物，甘雨分配，作为 TaskNode 的字段下发。

**影响**：Phase 0 实施前必须决策。否则后续所有 causalChain 的 spanId 没有约定。

**化解**：spanId 写入 `TaskNode.contextSpanId`。Agent 不生成 spanId——从 TaskNode 读取。非 TaskGraph 操作（如配置热加载）由 ConfigRegistry 自行生成，前缀 `cfg-`。

---

#### NP-2：因果链断裂风险——Degradation Boundary 吞事件导致链不完整

**问题**：子原则 9 要求"被 silent 吞掉的事件的因果链不能断，下一个未吞的事件必须继承"。但这需要 Degradation Boundary 和因果链之间有耦合——它必须知道哪些事件被吞了，并且在下一次非 silent emit 时把被吞链附加回去。

这违反了子原则 3（观测不可阻断——emit 是 fire-and-forget）和子原则 7（插桩解耦——Degradation Boundary 不应知道因果链的存在）。

**严肃性**：高。如果不解决，silent 降级会在因果链中形成"黑洞"——凝光看到下游事件，但它的 `upstreamEvents` 缺了几个环节。

**化解方案（三选一，待决策）**：

| 方案 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| A | silent 事件不 emit——但在被吞的调用方内部记录 pending causalChain，下一个 emit 统一继承 | 链完整 | Degradation Boundary 需要维护 pending 链 |
| B | silent 事件仍然 emit 到死信队列——不通知订阅者，但 AuditTrail 静默记录 | 链完整 + 不耦合 Degradation | 死信队列增大存储 |
| C | 允许因果链不完整——断了的环节标注为 `"dropped"` | 最简单 | 权轴 Agent 需要处理不完整链 |

**初步推荐**：B（死信队列）。因为死信本身就是遥测基础设施可以处理的——和 Degradation Boundary 解耦。

---

### ⚠️ P1 — 适配级（4 项）

#### NP-3：因果链 payload 对 EventBus 的性能影响

**问题**：当前 PipelineObserver 的事件 payload 平均数十字节。加了 causalChain（spanId + 3-5 个上游事件 ID）后，每个事件增加 ~200 bytes。对于高频事件（检索、打分），这个开销需要考虑。

**量级估算**：如果每次 `Mem:RetrievalStrategySelected` 携带 5 个上游事件，一小时 1000 次检索 → 额外 200KB。对于内存事件流影响小，但如果开启了 AuditTrail 全量持久化——每天 5MB 额外存储。

**化解**：高频事件（Mem:RetrievalStrategySelected）只携带 `spanId`，不携带完整 `upstreamEvents`。需要完整链时，AuditTrail 按 `spanId` 聚合。这与子原则 6（分级存储）一致。

---

#### NP-4：类型爆炸——50+ EventPayloadMap 条目需加 causalChain

**问题**：新增 `causalChain` 字段后，所有 EventPayloadMap 条目都需要更新类型。当前 ~50 个事件类型。

**化解**：causalChain 不作为每个 payload 的独立字段——作为 `PipelineObserver.emit()` 的第二个可选参数，和 payload 解耦：

```typescript
// 不耦合到 payload
PipelineObserver.emit(type, payload, { causalChain: { spanId, ... } });
                                                    // ↑ 可选参数
```

这样 EventPayloadMap 不需要全局修改——只需扩展 `emit()` 签名。

---

#### NP-5：权轴 Agent 的因果链查询 API 为空

**问题**：凝光收到 `ConfigSchemaViolation`，她知道 `spanId`。然后呢？她如何查询"这个 span 内完整的事件链"？

当前没有这样的 API。

**化解**：AuditTrail 新增 `queryBySpan(spanId: string): AuditEntry[]` 方法，按 spanId 聚合所有事件。这是存储层的能力，不需要改事件流。

---

#### NP-6：跨进程因果链——Electron/Node 双进程

**问题**：Cortex 未来有 Electron（UI）和 Node（引擎）两个进程。每个进程有独立的 PipelineObserver。A 进程的 spanId 在 B 进程中无法查询。

**当前**：不阻塞。Phase 0-6 全部单进程。但需要预留跨进程 spanId 的格式约定——例如 `{ processId }-{ localSpanId }`。

**化解**：spanId 格式约定为 `{process}:{uuid}`。当前单进程时 `process` 固定为 `"main"`。不增加代码量——仅命名约定。

---

### 🔵 P2 — 观察级（2 项）

#### NP-7：因果链与事件消费的竞态

**问题**：A 事件触发 B 事件，但 B 的订阅者可能先于 A 被调用（Node.js EventEmitter 是同步的，但 on 的注册顺序不确定）。B 的 causalChain 指向 A，但 A 可能尚未被该订阅者看到。

**影响**：小。权轴 Agent 不需要实时消费——它们可以通过 AuditTrail 回溯。EventBus 不保证顺序。

**化解**：权轴 Agent 不使用 EventBus 实时消费因果链——使用 AuditTrail 按 spanId 查询完整链。这与子原则 6（EventBus 不保证持久化/顺序）一致。

---

#### NP-8：原子事实存储增长——AuditTrail 保留策略

**问题**：Mem:* 事件如果全进 AuditTrail，写入频率远高于当前的配置事件。每天的数万条记忆操作可能产生 GB 级审计日志。

**化解**：
- Mem:* 事件不单独进 AuditTrail——只在 `spanId` 结束时写入一条聚合摘要（N 次检索 → 1 条摘要）。
- 或 Mem:* 只进 MetricCounter（统计类），不进 AuditTrail（审计类）。
- 只有权轴 Agent 明确需要的操作才进 AuditTrail（如 ObliterationTriggered）。

---

## 三、覆盖缺口修复建议

| 缺口 | 修复 | 目标阶段 |
|------|------|---------|
| G1 Phase 1/2 无观测 | 新增 `Tele:StructuralChange` 事件 | Phase 0（和遥测同期建） |
| G2 Config Drift 无 emit | 新增 `Gov:ConfigDriftDetected` + EventPayloadMap | Phase 5（config-drift 实现时） |
| G3 causalChain 未强制 | 标记权轴 Agent 依赖事件为强制 causalChain | 子原则 9 文档补充 |

---

## 四、受影响spec 的变更点

| 文档 | 变更 |
|------|------|
| `telemetry-design-principles.md` | ✅ 已更新——子原则 9 |
| `memory-world-model-design.md` | ✅ 已更新——原子操作事件 |
| `telemetry-infrastructure-deepening.md` | ⚠️ 需更新——causalChain 作为 emit() 可选参数而非 payload 字段（NP-4） |
| `novel-concepts-conflict-check.md` | ⚠️ 需补充——Degradation Boundary vs 因果链断裂（NP-2） |
| `cortex-evolution-master-plan.md` | ⚠️ 需更新——Phase 0 增加 spanId 生成决策（NP-1） |

---

## 五、总结

```
覆盖度：21/29 节点 ✅ | 3 覆盖缺口 | 5 个 spec 待微调

新问题：8 项
  🔴 P0 ×2    spanId 生成权（需甘雨分配） + 因果链断裂（需死信队列）
  ⚠️ P1 ×4    性能影响 / 类型爆炸 / 查询 API 为空 / 跨进程
  🔵 P2 ×2    竞态 / 存储增长

关键结论：
  ① 原子事实链不改变 Phase 0 遥测的优先级——但 Phase 0 实施时必须决定 spanId 生成权
  ② Degradation Boundary 和因果链的冲突（NP-2）是最棘手的设计决策——需要在遥测原则文档中明确
  ③ causalChain 不应耦合到 payload——应作为 emit() 的可选参数（NP-4）
```
