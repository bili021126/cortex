# 遥测基础设施设计原则

> 定位：原则五（统一可观测）的工程化落地纲领。不描述实现，只定义"遥测层自身必须遵守什么"——从七原则推导出的遥测子约束。
> 此文档回答：什么该观测、什么不该、三层如何分工、与 PipelineObserver 的关系、插桩的边界。

---

## 零、原则五原文重读

> 交互流、治理流、规划-执行流、技能-工具流、记忆流中的关键状态变更必须通过 `PipelineObserver.emit()` 上报。不得使用裸 `console.log` 替代结构化事件。事件类型闭合枚举（`PipelineEventType`），payload 类型通过 `EventPayloadMap` 映射。

### 从中提取的核心约束

| 约束 | 含义 |
|------|------|
| 全流覆盖 | 不是只观测执行流——五流都要有事件 |
| 单一管道 | 不是多个 emit 通道——全走 PipelineObserver |
| 闭合枚举 | 不能随意新增字符串——必须加 PipelineEventType |
| 类型映射 | payload 必须有 EventPayloadMap 条目 |

---

## 一、遥测层自身的五流定位

遥测基础设施不是第六流——它是**横切约束**。在五流模型中，遥测横跨所有流，但不参与任何流的命令路径。

```
              遥测层（横切——不参与命令流）
              ┌──────────────────────────┐
              │ PipelineObserver.emit()  │
              │ AuditTrail               │
              │ MetricCounter            │
              └──────────────────────────┘
                    ↑        ↑        ↑
              交互流    治理流  ... 记忆流
```

**遥测层的三轴定位**：
- 不参与事轴（命令自上而下）
- 不参与权轴（约束自下而上）
- 属于横切——监督，但不阻断

---

## 二、从七原则推导出的遥测子原则

### 遥测子原则 1：全流覆盖（源自原则五）

> PipelineObserver 当前只覆盖了规划-执行流（Agent 执行、Scheduler 调度）和部分技能-工具流（工具调用审计）。
> **遥测基础设施的核心目标是补全其余三流（交互流、治理流、记忆流）的观测缺口。**

```
当前覆盖                        Phase 0 补全
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
规划-执行流 ✅                  不改
技能-工具流 ✅（工具审计）       不改
交互流 ❌                       配置：覆盖/热加载/校验
                                 启动/停止生命周期
治理流 ❌                       信号路由决策
                                 修宪管线阶段
                                 降级状态变更
记忆流 ❌                       检索策略选择
                                域门控切换
                                预热/遗忘/清理
```

---

### 遥测子原则 2：单管道 + 后置分流（源自原则三 + 原则五）

> 原则三要求"边界集中"——所有工具调用走 `Toolkit.execute()`。
> 遥测层同样必须集中：**所有事件先走 PipelineObserver.emit()，再由下游（AuditTrail / MetricCounter / NotificationPipe）各自消费。**

```
❌ 错误模式                         ✅ 正确模式
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ConfigRegistry                     ConfigRegistry
  ├→ AuditTrail.record()              │
  ├→ MetricCounter.inc()              ▼
  └→ console.log()               PipelineObserver.emit()
                                      │
                                ┌─────┼─────┐
                                ▼     ▼     ▼
                           AuditTrail Metric Notification
                                       Counter  Pipe
```

**规则**：
- 所有插桩点的第一行永远是 `PipelineObserver.emit()`。
- AuditTrail 和 MetricCounter 是 PipelineObserver 的**订阅者**，不是替代管道。
- 如果 PipelineObserver 不可用（尚未初始化），事件进入**待发队列**，不丢弃、不走裸 console。

---

### 遥测子原则 3：观测不可阻断（源自原则一 + 原则五自身）

> 原则一是"不可逆操作必须经确认门阻断"——它定义的是阻断点。
> **遥测层相反——观测永远不能成为阻断点。**

```
确认门逻辑                        遥测逻辑
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
emit 前判定可否放行               emit 不判定——只记录
L2/L3 阻断                        所有级别不阻断
用户确认 → 继续                   无用户确认
```

**规则**：
- `PipelineObserver.emit()` 是 fire-and-forget。调用方不等待结果。
- 如果 emit 失败，**不抛异常给调用方**——只内部记录遥测自身故障。
- 遥测层的故障不得导致业务路径终止。

但——这产生一个自反性问题：遥测自身的故障如何被观测？

---

### 遥测子原则 4：自观测——遥测必须观测自身（源自原则七）

> 原则七是"治理流修改宪法时必须遵守自身子约束"——自指涉。
> **遥测层同样必须自指涉——遥测的故障（emit 失败、队列满、flush 失败）必须自身可观测。**

```
遥测自观测
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MetricCounter.inc_telemetry_error(level)
  └→ 超过阈值 → emit 'TelemetryHealthDegraded'
       └→ 这是一个特殊的"元事件"
           它的 emit 失败 → 写文件（硬降级）
```

**规则**：
- 遥测层的内部错误通过 MetricCounter 自计数。
- 元事件 `TelemetryHealthDegraded` 不仅通过 PipelineObserver 发送，还写入一个独立的健康检查文件——因为如果 PipelineObserver 本身已经崩了，它也需要一条告警路径。
- 这形成遥测层的"最后防线"——文件写入是同步的、无依赖的。

---

### 遥测子原则 5：事件语义收敛——五流共用一个事件命名体系

> 当前 `PipelineEventType` 和 `EventPayloadMap` 是闭合枚举，但事件命名没有统一规则。
> **遥测基础设施必须定义事件命名的前缀规范，让五流的事件一眼可辨识。**

```
前缀         流           示例
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Exec:*       规划-执行流   Exec:NodeFailed
Skill:*      技能-工具流   Skill:ToolExecuted
Interact:*   交互流       Interact:ConfigOverrideApplied
Gov:*        治理流       Gov:AmendmentPassed
Mem:*        记忆流       Mem:RetrievalStrategySelected
Tele:*       遥测自身     Tele:HealthDegraded
```

**规则**：新增 `PipelineEventType` 时必须使用前缀。已有事件（无前缀的）保持兼容，不强制迁移。

---

### 遥测子原则 6：分级存储——不是所有事件都需要磁盘（性能约束）

> 原则五要求"关键状态变更必须 emit"。但"关键"是一个量化问题——每毫秒都发生的事情不应该是事件。

```
事件频率         存储策略          示例
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
高频（>10/s）    MetricCounter     检索延迟、缓存命中
                 （仅内存，定期 flush）

中频（1-10/s）   EventBus           策略选择、域门控切换
                 （emit 但不持久化每条）

低频（<1/min）   AuditTrail          配置覆盖、降级告警
                 （持久化每条 + 可查询）

单次             EventBus + Audit   启动、Schema 校验致命错误
```

**规则**：
- 高频统计不 emit 事件——只走 MetricCounter，每 N 秒 flush 一次统计摘要。
- 审计级事件才写磁盘——AuditTrail 是 JSONL 追加写入。
- EventBus 是内存事件流——不保证持久化。

---

### 遥测子原则 7：插桩解耦——被观测方不知观测者（源自裂 + 合）

> 从裂合框架衍生：遥测插桩和业务逻辑必须裂开。

```
❌ 耦合模式                          ✅ 解耦模式
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MemoryStore.write() {               MemoryStore.write() {
  auditTrail.record(...)              PipelineObserver.emit('Mem:Written', ...)
  metricCounter.inc(...)            }
}                                   
                                    // AuditTrail 和 MetricCounter 
                                    // 作为 PipelineObserver 的订阅者
                                    // MemoryStore 不知道它们的存在
```

**规则**：插桩点只调用 `PipelineObserver.emit()`。不知道 AuditTrail 和 MetricCounter 的存在。订阅关系在 telemetry 包内部配置，不在业务包中。

---

## 三、三层（EventBus / AuditTrail / MetricCounter）的分工

```
              实时性          持久性        查询性         故障模式
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EventBus      实时            不保证        不查询         丢失容忍
              emit 即消费      内存事件流    不支持查询     新事件可能丢

AuditTrail    准实时          保证          支持           写失败退出
              追加写入        JSONL 磁盘    按时间/category  磁盘满告警

MetricCounter 实时（内存）    不保证        支持           重启丢失
              原子 ++         定期 flush    当前值查询      可接受
```

---

## 四、与 PipelineObserver 的关系——扩展，不替换

```
PipelineObserver（已有）
  │
  ├── emit(type, payload)    — 已有接口，不改
  │
  ├── 订阅者模型扩展：
  │   ├── NotificationPipe    — 已有（治理信号）
  │   ├── AuditTrail          — 🆕（审计日志）
  │   └── MetricCounter       — 🆕（实时计数）
  │
  └── 自观测：
       ├── emit 失败计数       — MetricCounter
       └── 队列满告警          — Tele:HealthDegraded
```

**不改**：`PipelineObserver.emit()` 的接口（type + payload）和调用方代码。

**新增**：PipelineObserver 的内部订阅机制——支持多个 listener 同时消费同一个事件。

**新增**：待发队列——在 PipelineObserver 初始化之前的事件先入队，初始化后批量回放。

---

## 五、遥测子原则总览

| # | 子原则 | 源自 | 核心约束 |
|----|--------|------|---------|
| 1 | 全流覆盖 | 原则五 | 补全交互/治理/记忆三流事件 |
| 2 | 单管道 + 后置分流 | 原则三 + 五 | 所有事件先走 PipelineObserver，再分流到 AuditTrail/MetricCounter |
| 3 | 观测不可阻断 | 原则一 | emit 是 fire-and-forget，失败不抛给调用方 |
| 4 | 自观测 | 原则七 | 遥测自身故障必须可观测（Tele:HealthDegraded） |
| 5 | 事件语义收敛 | 原则五 | 五流共用前缀命名体系 |
| 6 | 分级存储 | 原则五（性能） | 高频 → Counter，中频 → EventBus，低频 → AuditTrail |
| 7 | 插桩解耦 | 裂+合 | 被观测方只调 emit()，不知 AuditTrail/MetricCounter 存在 |

---

## 六、与 PipelineObserver 现有实现的差距

| 当前能力 | Phase 0 需要 | 差距 |
|---------|-------------|------|
| emit(type, payload) | 不改 | — |
| 单一订阅者（NotificationPipe） | 多订阅者（+ AuditTrail + MetricCounter） | 需扩展 |
| 无初始化前队列 | 启动前的 bootstrap 事件也要记录 | 需加待发队列 |
| 无自观测 | emit 失败计数 + 健康检查文件 | 需加 MetricCounter 自计数 |
| 无事件前缀规范 | Exec:/Skill:/Interact:/Gov:/Mem:/Tele: | 需约定 |
