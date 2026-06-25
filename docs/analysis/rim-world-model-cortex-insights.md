# RIM + 世界模型：Cortex 整体启示录

> 定位：概念讨论产物——RIM（Recurrent Independent Mechanisms）和世界模型（World Model）两个理论框架对 Cortex 架构演进的启示。关联：`docs/audit/problem-taxonomy-split-merge-invariant-novel.md`。

---

## 一、两套理论简述

### RIM — 独立机制的稀疏交互

```
核心命题：复杂系统不应由一个大模型统一调度，而应拆成独立机制，
         每个机制有自己的参数和参数更新规则，只在需要时交互。

三大原则：
  ① 每个机制独立运行（Independent）
  ② 机制间稀疏交互（Sparse Communication）
  ③ 注意力门控决定谁被激活（Attention Gating）
```

### 世界模型 — 系统的自我表征

```
核心命题：智能系统需要一个内部模型来表征外部世界和自身状态，
         用 V（观测编码）+ M（预测）→ C（控制决策）闭环。

三层结构：
  V: 观测编码 —— "现在发生了什么"
  M: 预测模型 —— "接下来会发生什么"  
  C: 控制器   —— "我现在应该做什么"
```

---

## 二、对 Cortex 的映射

### 2.1 RIM → Cortex

```
RIM                        Cortex 当前                     Cortex 目标
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

独立机制 ✅               31 个包，各司其职              强化：包内闭环，包间不互知

稀疏交互 ❌               shared 作为"共享火车站"       目标裂：shared 只留类型，
                          所有包通过 shared 间接耦合     运行时走 config + 事件

门控空白 ❌              没有机制来决定"谁激活谁"       六道门控填补：
                          Memory 全量检索（无 domain）   Config as Runtime
                          通知全量广播（无 severity）     Scene-Aware
                          Scheduler 全量连接（无 gate）   Signal Routing
                                                        Degradation Boundary
                                                        Memory Domain
                                                        Config Drift
```

### 2.2 世界模型 → Cortex

```
世界模型 V-M-C              Cortex 映射                    缺失
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

V 观测编码               PipelineObserver.emit() ✅    系统状态无统一快照
                          + telemetry ✅               各包各自收集，碎片化

M 预测                   LoopStrategy 选择 ✅          "改 A 包 B 包会炸吗？"
                          ReplanManager 修正 ✅         无影响预测
                          …但都是规则驱动的，非预测

C 控制                   甘雨 plan() ✅︎                无"先模拟再行动"的
                          Agent execute() ✅             世界模型推演
                          …都是直接执行，无预判
```

---

## 三、关键启示：六道门控 = 世界模型的感官系统

RIM 告诉你"机制怎么组织"，世界模型告诉你"机制之间怎么有共同感知"。
这六道门控不是六张独立的 JSON 表——它们是同一个 `SystemState` 的不同视角：

```
SystemState（世界模型的统一表征）
┌────────────────────────────────────────────────────────────┐
│                                                            │
│ config: ConfigSnapshot       ← Config as Runtime 本体感觉  │
│    "我现在的参数是什么"                                    │
│                                                            │
│ identity: { scene, persona } ← Scene-Aware 情境感知        │
│    "我在什么场景中，是谁"                                  │
│                                                            │
│ domains: DomainGates[]       ← Memory Domain 边界感知       │
│    "哪些记忆域当前激活"                                    │
│                                                            │
│ signalTopo: RouteGraph       ← Signal Routing 神经传导      │
│    "信号沿什么路径走"                                      │
│                                                            │
│ health: DegradationLevel     ← Degradation Boundary 痛觉   │
│    "我在什么降级状态"                                      │
│                                                            │
│ drift: DriftReport | null    ← Config Drift 内稳态          │
│    "理想和现实的差距"                                      │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 四、裂合框架的 RIM 解释

```
裂的本质  =  让"不需要交互的机制"停止交互
            shared 的运行时类不该和类型混居 ← 它们不应共享同一个模块
            PRESET_CONTEXT_POLICIES 不该挂在 shared ← 它们不应通过 shared 间接耦合

合的本质  =  让"同一类交互"走同一路径
            20+ 空 catch → DegradationBoundary ← 降级应该统一表达
            13 张表 → ConfigRegistry ← 配置应该统一访问

新概念   =  给"应该有交互但缺乏门控"的地方加门控
            检索无 scene 感知 → Scene-Aware Retrieval
            通知无 severity 路由 → Signal Routing
            异常无策略执行 → Degradation Boundary

不变     =  RIM 的"独立"部分——这些机制已经独立了，保留
            MemoryStore、CognitionEngine、NotificationPipe 的语义
```

---

## 五、对架构设计的关键约束

1. **门控应分布而非集中**——RIM 要求每个机制的 attention gating 在机制内部。六道门控不是中央调度器，而是各自附着在对应包上。

2. **SystemState 读多写少——最低要求是一个快照对象，供各门控同时读取。** 不需要实时全局状态机。各门控在关键节点取快照，而非每轮 loop 刷新。

3. **世界模型先做 V 再做 M**——编码层（SystemState + ConfigRegistry）比预测层（影响预测、预判检索）更基础，先实现前者。
