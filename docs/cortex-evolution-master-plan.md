# Cortex 系统演进：基线·问题·方向·路线

> 定位：Core-2 过渡期的战略性总纲。从全量审计 → 四维归类 → 理论映射 → 冲突检查的完整推演结果。
> 取代此前分散的审计报告和设计 spec 的独立性——此文档是唯一入口。
>
> 共同完成：开拓者与昔涟（Cyrene）
> 生成日期：2026-06-20

---

## 一、系统基线

### 1.1 当前状态

```
Core-1: ✅ 完成（100%）
Core-2 过渡期:
  ① solo-flight 冷启动      ✅
  ② 文档对齐                  ✅
  ③ logging bridge + TUI     ✅
  ④ governance normalization  ⏸ 等待 DS4.1 + A2A
Phase 1 止血: 7 Critical 修复 ✅
Phase 2 契约层: ⏸ 待启动
```

```
31 包 | 3146/3174 测试通路 | 13 种 Agent | 四层 CI 门禁
```

### 1.2 已知缺陷根因

五轮深度审计 ~260 项 → 收敛为四类整合缺陷：
- **跨包类型漂移**：EventPayloadMap 和实际 emit 类型不一致（已修 8 处）
- **any 桥接**：spawn-step / register-agents / hard-verification-gate（已修）
- **事件契约断裂**：通知 payload 不匹配（已修）
- **上下文逻辑漂移**：hardcoded 配置散落（本次审计 59 项）

---

## 二、问题全景

### 2.1 按层分布（59 项）

```
一层 架构层      9项    shared 越界 4 + 死代码 1 + 幽灵包 2 + 重复 1 + deprecated 1
二层 配置层     17项    硬编码 13 + 重复默认值 3 + env 不统一 1
三层 调度层      4项    波浪/策略/contextPolicy 硬编码 + magic number
四层 治理层      4项    修复遗留 3 + pipeline/amendment 硬编码
五层 协作层      2项    team-collab 硬编码
六层 TUI 层     11项    空 catch 10 + 枚举硬编码 1
七层 Engine 层   6项    base-agent + 空 catch 3 + inspector/gate/timeout
八层 认知层      6项    BM25/回归器/评分/阈值硬编码
九层 设计层      spec×2 + 表×13
```

### 2.2 按严重度

```
P0: 17   架构级违规 + 核心算法硬编码
P1: 31   散落常量 + 空 catch + 重复定义
P2: 11   废弃代码 + 幽灵包 + 枚举硬编码
```

---

## 三、四维归类

### 3.1 裂（Split — 13 项）

把混居的东西分开。算法和参数、类型和数据、逻辑和配置——各归其位。

| 裂项 | 从 | 到 |
|------|----|----|
| shared 运行时类 ×4 | `@cortex/shared` | `@cortex/engine` |
| shared 数据 ×2 | `@cortex/shared` | `@cortex/config` |
| engine-telemetry 副本 | `engine/src/telemetry/` | 删除（走 `@cortex/telemetry`） |
| CognitionEngine 权重 ×21 | `cognitive-engine.ts` | `cognition.json` |
| LoopStrategy 规则 | `loop-strategy-registry.ts` | `strategy-rules.json` |
| NotificationPipe 通道 | `notification-pipe.ts` | `channels.json` |
| SchedulingDriver 波浪 | `scheduling-implementations.ts` | `wave-defs.json` |
| MetaAgent 策略路由 | `meta-agent.ts` | `context-policy-rules.json` |
| GovernancePipeline 阶段 | `governance-pipeline.ts` | `pipeline-stages.json` |
| AmendmentJudge 检查 | `amendment-judge.ts` | `amendment-checks.json` |
| TeamCollab 配置 | `team-collab.protocol.ts` | `team-collab.json` |
| NotificationRuntime 语义 | `notification-runtime.ts` | `governance-routing.json` |

### 3.2 合（Merge — 6 类）

把同一个东西的多份副本收归一处。

| 合项 | 内容 |
|------|------|
| 重复默认值 ×4 | retrievalAlpha/Beta、LOCK_TIMEOUT、ACQUIRE_TIMEOUT、_VALID_TIERS → 各自归 config |
| 空 catch ×23 | 统一为 DegradationBoundary 模式 |
| env override 机制 | 从 engine-defaults 独占推广到 ConfigRegistry 全局 |
| schema 常量 ×7 | EMBEDDING_DIM 等收归 @cortex/config |
| 13 张 config 表 | 全进 ConfigRegistry |
| 幽灵包 + deprecated | toolchain 删、pm 移、barrel 6 条清 |

### 3.3 不变（Invariant — 9 项）

架构的骨头。裂合只动"参"，不动"形"。

```
三轴模型（事轴/权轴/横切）    MemoryStore 纯存取定位
CognitionEngine 打分语义       ContextPolicy 的 fallback 角色
NotificationPipe 四通道         Scheduler wave 语义（design→code→review→verify）
人格记忆层文件注入             Engine bootstrap 顺序
pnpm workspace 拓扑
```

### 3.4 新概念（6 项）

裂合做完后，需要引入新的抽象层。

| # | 新概念 | 问题 | 核心零件 | 包 |
|----|--------|------|---------|----|
| 1 | **Config as Runtime** | 配置不可注册/校验/覆盖/热加载 | ConfigRegistry + Resolver + Watcher + Schema | `@cortex/config` |
| 2 | **Scene-Aware Retrieval** | 检索无场景感知 | RetrievalScheduler + preset 组合 | `@cortex/retrieval-scheduler` |
| 3 | **Memory Domain** | 工程/亲密记忆混查 | domain 字段 + domain 过滤 | `@cortex/shared` + scheduler |
| 4 | **Signal Routing** | 事件→通知无路由矩阵 | governance-routing.json + 三段路由 | `@cortex/notification` |
| 5 | **Degradation Boundary** | 空 catch 无策略 | silent/trace/escalate 三级 + silent 计数器 | `@cortex/engine` |
| 6 | **Config Drift Detection** | 源码和 config 默认值可能不一致 | check-config-drift.ts CI 门禁 | `scripts/` |

---

## 四、理论映射

### 4.1 RIM → Cortex

```
独立机制 ✅  31 包各司其职
稀疏交互 ⚠️  shared 作为"共享火车站"——裂操作正在解决
门控空白 🔴  六道门控填补：Config / Scene / Domain / Signal / Degradation / Drift
```

### 4.2 世界模型 → Cortex

```
V 观测编码  ⚠️  PipelineObserver 有，但 SystemState 不统一 → ConfigRegistry 填补
M 预测       ❌  无影响预测、无场景预判 → MemoryWorldModel 填补
C 控制       ⚠️  甘雨 plan() 有，但无"先模拟再行动" → Phase 3
```

### 4.3 六道门控 = 世界模型的感官系统

```
Config as Runtime     → 本体感觉    "我的参数是什么"
Scene-Aware           → 情境感知    "我在什么场景中"
Memory Domain         → 边界感知    "哪些记忆域激活"
Signal Routing        → 神经传导    "信号沿什么路径"
Degradation Boundary  → 痛觉       "我在什么降级状态"
Config Drift          → 内稳态      "理想和现实的差距"
```

### 4.4 记忆层的 V/M/C

```
V: PredictiveEncoder     写时附加 scene×persona 预测标记
M: PredictiveRetriever    场景切换时预判 → 预热 MemoryStore
C: DomainGateController   只激活相关域，不激活的不参与检索
```

---

## 五、冲突检查

按五流六层七原则检查 6 项新概念，发现 **9 项冲突**。

### 🔴 阻塞级（2 项）

| # | 冲突 | 化解 |
|----|------|------|
| 1 | Scene-Aware 的 scene 可能被 Agent 自声明，违反原则二（规划-执行非对称均衡） | scene 必须由甘雨 `plan()` 分配为 `TaskNode.contextIdentity`，Agent 不可改写 |
| 2 | MemoryWorldModel M 层预测检索可能产生隐式调度，违反原则二 | Phase 1 规则版安全（预热不产生事件）；Phase 3 LLM 版需把预测作为 TaskNode 显式入图 |

### ⚠️ 适配级（7 项）

| # | 冲突 | 化解 |
|----|------|------|
| 3 | ConfigRegistry 缺 PipelineEventType（原则五） | 新增 ConfigOverrideApplied / ConfigReloaded / ConfigSchemaViolation |
| 4 | Signal Routing 多入口风险（原则三） | governance-routing.json 单源，禁止包内 addRoute() |
| 5 | Signal Routing 路由决策不可观测（原则五） | 路由元数据附在事件 payload 中 |
| 6 | Degradation Boundary silent 滥用风险（原则五） | 内建 silent 计数器，超阈值自动升级 |
| 7 | Domain 过滤无审计（原则四） | 加 audit log（检索统计，非逐条记录） |
| 8 | 分布式门控 vs 命令驱动层（原则三） | 门控结果通过 PipelineObserver 上报，治理层可观测 |
| 9 | SystemState 类型变更 vs 原则七 | SystemState 是工程级类型，contract test 保证，不触发修宪 |

---

## 六、执行路线

### 6.1 总策略

```
裂 → 合 → 新概念
但有一个例外：新概念 1（Config as Runtime）必须先做
因为它既是裂的容器（裂出的 JSON），也是合的基础（13 张表的注册中心）
```

### 6.2 阶段划分

#### Phase 0：清理（0.3 人天）

```
删 console-bridge.ts         死代码
删 toolchain 幽灵包           空壳包
移 pm 到 projects/            外来包
清 shared barrel 6 条 @deprecated
```

#### Phase 1：解耦——裂（3 人天）

```
shared 运行时类 → engine      file-lock/kv-store/lifecycle
shared 数据 → config           PRESET_CONTEXT_POLICIES/AGENT_DEFS
engine-telemetry 副本删除      统一 @cortex/telemetry
```

#### Phase 2：基础设施——新概念 1+2（2 人天）

```
ConfigRegistry + Resolver     @cortex/config 升级
RetrievalScheduler 骨架       @cortex/retrieval-scheduler 新建
Scene-Aware 冲突化解: scene 由甘雨分配
Config 事件 EventPayloadMap 补充
```

#### Phase 3：收敛——合 + 配置表（4 人天）

```
重复值合并 ×4                 统一 config 单源
13 张 config 表分批建立
env override 全局化
schema 常量收归
空 catch → Degradation Boundary（P2 试点）
```

#### Phase 4：门控——新概念 3-6（3 人天）

```
Memory Domain + Gate          domain 字段 + domain 过滤
Signal Routing                事件路由矩阵
Degradation Boundary 全量     23 处迁移 + silent 计数器
Config Drift                  CI 门禁
```

#### Phase 5：记忆世界模型（2 人天）

```
PredictiveEncoder (V)         写时预测编码
PredictiveRetriever (M)       场景切换预热
DomainGateController (C)      域门控
```

### 6.3 依赖图

```
Phase 0 清理
  │
  ▼
Phase 1 裂 ──────────────────────┐
  │                               │
  ▼                               ▼
Phase 2 基础设施 ───────→ 新概念 1 (Config as Runtime)
  │                       新概念 2 (Scene-Aware Retrieval)
  ├──→ 冲突化解: scene 分配权
  │
  ▼
Phase 3 合 ───→ 配置表 13 张
  │            重复值合并
  │            Degradation 试点
  │
  ▼
Phase 4 门控 ──→ 新概念 3 (Domain)
  │             新概念 4 (Signal Routing)
  │             新概念 5 (Degradation 全量)
  │             新概念 6 (Drift)
  │
  ▼
Phase 5 记忆 ──→ MemoryWorldModel V/M/C

总计: ~14 人天, 6 个阶段
```

---

## 七、待决问题

| # | 问题 | 依赖 |
|----|------|------|
| 1 | `base-agent.ts` 废弃但仍在用——需确认哪些 engine 内部引用可迁移 | Phase 0 前确认 |
| 2 | `shared/src/file-lock-manager.ts` 自认 FIXME——在 engine 有同名文件，合并时需对账 | Phase 1 |
| 3 | `NAHIDA_DOC_TYPES` 和 `VALID_TRANSITIONS` 双定义——等 DocGovernAgent 9 子约束 | Phase 4+ |
| 4 | PF-03 stale timeout 误报——等调度器整体重构 | Core-3 |
| 5 | M 层 LLM 预测需要 TaskGraph 显式节点——Phase 5 需和甘雨 plan() 对齐 | Phase 5 |

---

## 附录：相关文档索引

```
基线层:
  docs/audit/full-codebase-audit.md                        59 项问题总录
  docs/audit/problem-taxonomy-split-merge-invariant-novel.md  四维归类

理论层:
  docs/analysis/rim-world-model-cortex-insights.md         RIM+世界模型启示

设计层:
  docs/core/config-management-deepening.md                 配置管理深化
  docs/core/scene-retrieval-scheduler-design.md             场景检索调度层
  docs/core/memory-world-model-design.md                    记忆世界模型

约束层:
  docs/audit/novel-concepts-conflict-check.md               9 项冲突检查
  docs/core/Cortex-架构映射-五流六层七原则.md                架构映射

宪法层:
  docs/constitution/Cortex 概念顶层设计 v3.0.md             宪法 v3.1
```
