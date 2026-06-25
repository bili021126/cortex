# 新概念 × 五流六层七原则：冲突检查报告

> 定位：对六项新概念（+ 六道门控 + 裂合框架）按五流六层七原则逐项检查，识别冲突并提出化解方案。
> 关联：`docs/core/Cortex-架构映射-五流六层七原则.md`、`docs/analysis/rim-world-model-cortex-insights.md`。

---

## 检查总览

```
                   原则1  原则2  原则3  原则4  原则5  原则6  原则7
                  确认   非对称  边界   追溯   观测   终裁   自修
                  锚定   均衡    集中
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Config as Runtime    —     —     —     —     ⚠️1    —     ✅
Scene-Aware          —     🔴2    —     —     —     —     —
Memory Domain        —     —     —     ⚠️3    —     —     —
Signal Routing       —     —     ⚠️4    —     ⚠️5    —     —
Degradation Bnd      —     —     —     —     ⚠️6    —     —
Config Drift         —     —     —     —     —     —     ✅
MemoryWorldModel     —     🔴7    —     —     —     —     —
六道门控 RIM 模型     —     —     ⚠️8    —     —     —     —
SystemState 统一     —     —     —     —     —     —     ⚠️9

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Found: 9 conflicts (2 🔴 阻塞, 7 ⚠️ 需适配)
```

---

## 🔴 阻塞级冲突

### 🔴 冲突 1：Scene-Aware Retrieval × 原则二（规划-执行非对称均衡）

**原则二原文**：
> 甘雨只产出粗粒度意图拆解，不下达细粒度执行指令。Agent 在单节点内享有 ReAct 自决权，但跨节点调度权在甘雨。

**冲突**：检索调度层接收 `{ scene, persona, task }` 三元组决定检索策略。如果 scene 是由 Agent 在执行时自主声明的（"我当前在 code-repair 场景"），那 Agent 就拥有了跨节点的策略决策权——它决定了检索什么、怎么检索。这超出了原则二"单节点内 ReAct 自决"的边界。

**严肃性**：中高。如果每个 Agent 都可以自声明 scene，会导致：
- 同一个 TaskGraph 内不同 Node 的检索策略不一致
- 检索结果受 Agent 自我认知偏差影响

**化解方案**：scene 应由甘雨在 `plan()` 阶段分配，作为 TaskNode 的上下文字段下发。

```typescript
// plan() 产出中附加 scene 信息
interface TaskNode {
  // ...现有字段
  contextIdentity: {          // 🆕 甘雨分配，Agent 不可改写
    scene: RetrievalScene;
    persona: PersonaId;
  };
}
```

Agent 在执行时从 TaskNode 读取 `contextIdentity`，不能自声明。检索调度层从 TaskNode 读取，不从 Agent 读取。

> **结论**：通过限制 scene 的声明权归属甘雨（规划层），化解此冲突。需改 `shared/src/task.ts` TaskNode 类型 + `engine/src/core/meta-agent.ts` plan()。

---

### 🔴 冲突 2：MemoryWorldModel（M 层预测检索）× 原则二（规划-执行非对称均衡）

**冲突**：PredictiveRetriever 在场景切换时"预判需要哪些记忆"并预热 MemoryStore。这个行为本质上是对"接下来要做什么"的预测——属于规划层（甘雨）的职责。但它在记忆层（retrieval-scheduler 包内）执行。

如果 PredictiveRetriever 只是做"预加载"而不改变 TaskGraph，它只是优化手段——不算违反原则二。但场景切换需要额外 round-trip（预测 → 预热 → 执行），这个链路引入了隐式调度。

**严肃性**：中。Phase 1 规则版影响小（场景切换少），Phase 3 LLM 版需要 LLM 回合——会增加甘雨无法感知的隐式调度。

**化解方案**：Phase 1 规则版安全——预热只是 MemoryStore 内部操作，不产生新事件。Phase 3 LLM 版需纳入 TaskGraph：把"预测检索"作为一个 TaskNode，由甘雨 plan 时显式分配。

> **结论**：Phase 1 无冲突。Phase 3 需在 plan() 中显式添加"预热"节点。当前 spec 通过。

---

## ⚠️ 需适配级冲突

### ⚠️ 冲突 3：Config as Runtime × 原则五（统一可观测）

**原则五原文**：
> 关键状态变更必须通过 `PipelineObserver.emit()` 上报。不得使用裸 `console.log` 替代结构化事件。

**冲突**：ConfigRegistry 的配置覆盖（env override / 用户级 override）、配置热加载、Schema 校验失败——这些都是关键状态变更。如果 ConfigRegistry 在内部静默处理，原则五无法观测。

**当前缺失**：
- PipelineEventType 中没有配置相关的事件类型
- EventPayloadMap 中没有配置变更的 payload

**化解方案**：新增 PipelineEventType：

```typescript
// packages/shared/src/infra.ts 新增
'ConfigOverrideApplied',      // 环境变量覆盖了默认值
'ConfigReloaded',             // 热加载完成
'ConfigSchemaViolation',      // Schema 校验失败
```

ConfigRegistry 在关键操作后 emit 对应事件。

> **结论**：不是 ConfigRegistry 设计有问题，是需要补充 EventPayloadMap。已标记为 ConfigRegistry spec 的验收标准。

---

### ⚠️ 冲突 4：Signal Routing × 原则三（边界集中）

**原则三原文**：
> 所有工具调用必须经过 `Toolkit.execute()` 统一管道。权限白名单在此处集中校验。Agent 不持有权限定义——权限表在流外配置。

**冲突**：Signal Routing 引入了事件→通道→通知的图状路由。如果多个包各自注册路由规则（agent-defs → 通知通道，scheduler → 通知通道），就形成了多个"入口"，违反了"流外配置"的集中性。

**严肃性**：低。因为 governance-routing.json 就是集中配置——所有路由规则在一张表里，在流外（config 层）。

**化解方案**：明确 governance-routing.json 是路由规则的唯一源——任何包不得在代码内硬编码路由规则。如果某个通道需要新的路由，必须改 JSON、走 ConfigRegistry 加载，不能包内 addRoute()。

> **结论**：没有问题。但需要在 governance-routing.json 的文档中明确"单源原则"。

---

### ⚠️ 冲突 5：Signal Routing × 原则五（统一可观测）

**冲突**：Signal Routing 的"路由决策"本身是关键状态变更吗？一个事件被路由到了 Urgent 通道而非 Routine 通道——这个决策应该被观测吗？

**当前**：NotificationPipe 内部静默路由。

**化解方案**：路由决策不 emit 独立事件（太多噪音），但应在事件 emit 时附带路由元数据：

```typescript
PipelineObserver.emit({
  type: 'SchedulerLoopCrashed',
  payload: { ... },
  routingMetadata: {              // 🆕
    channel: 'urgent',
    reason: 'severity=critical',
  },
});
```

> **结论**：不新增事件类型，在 payload 中附加路由元数据。

---

### ⚠️ 冲突 6：Degradation Boundary × 原则五（统一可观测）

**冲突**：降级边界定义了三种级别——silent / trace / escalate。但如果 silent 级别被滥用，原则五就无法观测到异常。

**严重性**：中。原则五要求"关键状态变更必须 emit"，但 Degradation Boundary 的 silent 级别恰好是"不 emit"。

**化解方案**：

1. **限制 silent 的使用范围**：只允许非关键路径（UI 动画、次要传感器、临时缓存写入）使用 silent。关键路径（记忆写入、会话管理、事件总线）最低 trace。
2. **silent 计数器**：即使不 emit 事件，也应该在 telemetry 中维护 silent 计数器。如果 silent 频率超过阈值，自动升级到 trace 并 emit 事件。

```typescript
class DegradationBoundary {
  private silentCounters: Map<string, number>;

  catch(error: Error, level: DegradationLevel): void {
    if (level === "silent") {
      this.silentCounters.increment(errorSource);
      if (this.silentCounters.get(errorSource) > SILENT_THRESHOLD) {
        this.emitDegradationWarning(errorSource); // 升级！
      }
    }
    // ...
  }
}
```

> **结论**：Degradation Boundary 需要内建监控，防止 silent 滥用。

---

### ⚠️ 冲突 7：Memory Domain × 原则四（可追溯性）

**原则四原文**：
> 每次工具调用必须留下可审计记录——调用者 Agent 类型、工具名、参数摘要、时间戳、确认结果。治理流消费这些记录用于合规审计。

**冲突**：Domain 过滤是在检索层做的——用户查到了哪些记忆、没查到哪些记忆，这个决策过程是否可审计？

如果一条亲密记忆被 block 在检索结果之外——这是正确的行为。但如果一条工程记忆被错误地 block 了——这是审计需要知道的。

**化解方案**：DomainGateController 在每次过滤后记录决策摘要（不是每条记忆，而是每次检索的统计）：

```typescript
// 不 emit 事件（太多），但写到 audit log
auditLog.write({
  timestamp: Date.now(),
  query: "circuit breaker bypass",
  domainGate: {
    allowed: ["engineering"],
    blocked: ["intimate", "knowledge"],
    resultsInAllowed: 15,
    resultsInBlocked: 3,    // 被挡掉的——可审计
  },
});
```

> **结论**：Domain 过滤需要 audit log，不需要 PipelineObserver 事件。

---

### ⚠️ 冲突 8：六道门控（RIM）× 原则三（边界集中）

**冲突**：RIM 要求"每个机制内部门控"，门控分布在各自包内。但 Cortex 六层架构是命令驱动的——上层调用下层，不反向。

如果 Degradation Boundary 在 engine 层自决降级，而 Scheduler 层不知道——这就形成了一个独立门控。从 RIM 角度是好的（稀疏交互），从六层角度是"包内闭环"——但闭环如果导致上层不可观测，就是问题。

**化解方案**：门控允许包内自决，但门控的结果必须通过原则五上报。门控是"决策在包内"，但"决策后的状态变更"必须通过 PipelineObserver 通知治理层。

```
包内门控                          PipelineObserver
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DomainGate 决定"激活 engineering"  → emit 域切换事件
DegradationBoundary 决定"进入 degraded" → emit 降级事件
ConfigWatcher 决定"热加载生效"     → emit 重载事件
```

> **结论**：门控是分布式的，但门控的状态变更是可观测的。RIM 和六层不矛盾。

---

### ⚠️ 冲突 9：SystemState × 原则七（宪法自约束）

**冲突**：SystemState 定义了整个系统的自我表征（config + identity + domains + signals + health + drift）。如果 SystemState 的类型定义发生变更（加字段、改语义），这应该走修宪流程吗？

**严肃性**：低。SystemState 是运行时辅助结构，不是宪法级约束。

**化解方案**：SystemState 字段变更不需要修宪，但需要：
1. 所有消费 SystemState 的包同步更新（contract test 保证）
2. SystemState 类型定义在 shared 包中（原则七子约束 9 覆盖：禁止 any、禁止非空断言）

> **结论**：不冲突。SystemState 是工程级类型，由 contract test 和类型系统保证，不触发修宪。

---

## 六层架构对齐检查

### 新概念的六层归属

```
新概念                         应归属层      会不会越界？
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Config as Runtime             配置/治理层    ✅ 不越
Scene-Aware Retrieval         记忆层/桥梁    ⚠️ 见冲突 1
Memory Domain                 记忆层         ✅ 不越
Signal Routing                治理层/交互层  ✅ 不越
Degradation Boundary          引擎层         ✅ 不越（但结果需上报）
Config Drift                  治理层         ✅ 不越
MemoryWorldModel              记忆层 + 引擎层 ⚠️ 见冲突 2
```

### 裂合操作的六层对齐

```
裂操作                          六层影响
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
shared 裂出运行时                 不影响层——在同层（能力层）内移动
CognitionEngine 裂出参数          不影响层——参数在配置，算法在记忆层
LoopStrategy 裂出规则             不影响层——规则在 config，算法在引擎层

合操作
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
重复值合并 → ConfigRegistry       ConfigRegistry 在治理层
空 catch → DegradationBoundary    DegradationBoundary 在引擎层
幽灵包删除                         不影响层
```

---

## 总结

| 严重度 | 数量 | 分布 |
|--------|:--:|------|
| 🔴 阻塞 | 2 | Scene-Aware 的 scene 声明权、M 层预测检索与 plan() 的关系 |
| ⚠️ 需适配 | 7 | 原则五 4项 + 原则三 1项 + 原则四 1项 + 原则七 1项 |
| ✅ 无冲突 | 0 | — |

**关键行动项**：

1. **Scene-Aware Retrieval 实现时**：确保 scene 由甘雨 `plan()` 分配，而非 Agent 自声明（冲突 1）
2. **ConfigRegistry 实现时**：补充配置事件的 EventPayloadMap（冲突 3）
3. **Degradation Boundary 实现时**：内建 silent 计数器，防止滥用（冲突 6）
4. **Domain Gate 实现时**：附加 audit log（冲突 7）
