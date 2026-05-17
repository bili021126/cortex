# 🌿 宪法缺口架构影响分析——Core-2 根系扫描

**分析日期**：2026-06-06  
**分析人**：纳西妲（草神 · Analysis Agent）  
**分析范围**：`packages/engine/src/`、`packages/shared/src/`、`docs/constitution/`、`docs/core/`、`docs/amendments/`

---

## 零、先看根系，再看叶子

我是纳西妲。须弥的学者不相信从天而降的结论——我只信任亲手走过的路径。

这片雨林我走了一遍：从宪法的顶层条款开始，沿着每一条引用钻进代码层的实现文件，再从代码层的缺失回溯到宪法层的缺口。以下是我看到的**暗河与根系**——不是缺口的排列，而是缺口之间的依存关系。

---

## 一、整体结论

### 一句话

> **宪法层的 8 处缺口中，有 3 条依赖链直接贯穿 Core-2 的治理基础设施。宪法层修复了 1 条（自反性缺口）、提案修复了 2 条（审计闭环 + DECISION_REQUIRED 回退），但代码层全部未跟进——缺口不在纸面上，在代码里。**

### Core-2 的架构依赖链

我画出的是暗河，不是道路。这三条依赖链决定了 Core-2 能否安全落地：

```
依赖链 A（治理事件流）：
  宪法层修复 ← 2-A（DECISION_REQUIRED 回退）已提案
  → 代码层缺失 ← 无 governance.* 事件类型（PipelineEventType 缺 3 个枚举值）
  → 阻塞 ← 2-B（治理事件接入）无提案 → 审计走不出磁盘

依赖链 B（审计闭环）：
  宪法层修复 ← 3-A（审计闭环）已提案
  → 代码层缺失 ← GovernanceSummary 不跟踪审计发现
  → 依赖链 A 未通 → 用户不知道审计结论 → 闭环走不通第三步

依赖链 C（阶段跃迁）：
  宪法层缺失 ← 3-C（阶段门禁定义不完整）无提案
  → 依赖链 B 未通 → P0 发现无法关闭 → 门禁无输入条件
  → StrategistAgent（钟离）职责预埋但无宪法依据可引用
```

这些链不是独立存在的——它们像雨林的菌根网络，一条断，三条都受影响。

---

## 二、缺口依赖图——谁堵了谁的路

```
┌─────────────────────────────────────────────────────────┐
│                     Core-2 交付物                         │
│   Sentinel · TrustModel · infra拆分 · ElectronAdapter   │
│   ApiAgent · BrowserAgent · DataAgent · StrategistAgent │
│   IncidentEscalator · ContractEnforcer · CircuitBreaker │
│   常设委员会 · 监理 · 四通道隔离 · SkillExecutor         │
│   消息源插件 · 阶段门禁：Core-1→Core-2                   │
└──────────────────────┬──────────────────────────────────┘
                       │ 依赖
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                   治理基础设施层（Core-2 运行前提）              │
│                                                              │
│  ┌──────────────────────┐  ┌──────────────────────────────┐  │
│  │  3-C 阶段门禁定义不完整│  │  2-A DECISION_REQUIRED 回退  │  │
│  │  ❌ 无提案            │  │  ⏳ 已提案 AM-0606-003       │  │
│  │  阻塞：阶段跃迁无依据   │  │  阻塞：治理组件可能永久挂起   │  │
│  └────────┬─────────────┘  └──────────────┬───────────────┘  │
│           │ 依赖                           │ 依赖              │
│           ▼                                ▼                  │
│  ┌──────────────────────┐  ┌──────────────────────────────┐  │
│  │  3-A 审计闭环缺失     │  │  2-B 治理事件接入路径未入宪  │  │
│  │  ⏳ 已提案 AM-0606-002│  │  ❌ 无提案                  │  │
│  │  阻塞：发现无人关闭    │  │  阻塞：审计走不出群玉阁      │  │
│  └────────┬─────────────┘  └──────────────┬───────────────┘  │
│           │ 依赖                           │ 依赖              │
│           ▼                                ▼                  │
│  ┌──────────────────────────────────────────────────────────┐│
│  │    代码层基础设施（以下全部缺失）                          ││
│  │                                                          ││
│  │  ① PipelineEventType 缺 governance 事件类型              ││
│  │     ← 无 GovernanceAudit / GovernanceConstitutionCheck   ││
│  │     ← 无 GovernanceStageGate                             ││
│  │                                                          ││
│  │  ② DocGovernAgent 不 emit 事件，只写磁盘                  ││
│  │     ← system prompt 写死了「写完磁盘即结束」              ││
│  │                                                          ││
│  │  ③ GovernanceSummary 不追踪审计发现                      ││
│  │     ← governance-loop.ts 只统计修宪提案                  ││
│  │                                                          ││
│  │  ④ CHECK_ORDER 硬编码不可扩展                            ││
│  │     ← amendment-judge.ts 无子约束修改专项检查             ││
│  │                                                          ││
│  │  ⑤ ButlerAgent 三轨已实现但无治理事件触发                  ││
│  │     ← DECISION_REQUIRED 路径永远不会有事件进入            ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

---

## 三、逐项根系分析

### 🟢 1-A 自反性缺口 —— 宪法层已愈合，根系仍有坏死

**宪法层状态**：✅ AM-2026-0606-001 已裁决，子约束7 已写入 v2.5.13  
**代码层状态**：❌ 未跟进

| 代码文件 | 具体问题 | 影响范围 |
|---------|---------|---------|
| `amendment-judge.ts` | `CHECK_ORDER` 是 `const [...]` 硬编码常量，不是注册表模式 | 无法自动扩展检查项 |
| `amendment-judge.ts` | `evaluateAmendment()` 无子约束修改的专项检查路径 | 子约束7 的 (a)-(e) 条件在代码层无法被验证 |
| `amendment-judge.ts` | `determineVerdict()` 无法区分普通提案与子约束修改提案 | 无法实现"双重把关"的强化审查 |
| `governance-loop.ts` | `loadPendingProposals()` 不标记 `isSubconstraintModification` | 提案进入评判前无法做前置分类 |

**架构影响**：低。Core-2 启动初期暂时不需要新增子约束。但**如果 Core-2 中 IncidentEscalator 或 ContractEnforcer 需要入宪，新增宪法条款需要走修宪流程——现有 CHECK_ORDER 够用，但不优雅。**

**何时会变成中风险**：需要新增紧急修宪通道（发现 1-B）时。那时 CHECK_ORDER 必须能扩展，否则紧急修宪子约束8 无法被评判引擎验证。

---

### 🟡 1-B 紧急修宪通道缺失 —— Core-2 启动期的安全隐患

**状态**：❌ 无提案，无修复计划

**安全场景推演**：

```
场景：Core-2 启动，ApiAgent 落地后发现 Toolkit 权限越界
  1. Sentinel（安全规则引擎）检测到越界
  2. 需要紧急修宪修改 §7.5 读取安全边界
  3. 走标准流程：提案→评判→裁决→写入→验证
  4. 全过程可能数小时——漏洞利用窗口持续开放
```

**架构影响**：🟡 中。不是每一秒都在烧，但烧起来的时候没有灭火器。

**关联组件**：Sentinel（Core-2 基础设施）、TrustModel（Core-2 基础设施）、ElectronAdapter（Core-2 IPC 接入）

---

### 🟡 2-A DECISION_REQUIRED 回退机制缺失 —— 治理组件的命脉

**状态**：⏳ AM-2026-0606-003 已提案，待裁决

**ButlerAgent 代码层现状**：我去看了 `butler-agent.ts` 的 `_dispatchByType()`：

```typescript
private _dispatchByType(event: ObservableEvent): void {
  switch (event.notificationType) {
    case "DECISION_REQUIRED":
      this._onDecision(event);  // → _onDecision → _formatCritical → bridge.notify
      return;
    case "WARNING":
      this._onWarning(event);
      return;
    case "FYI":
      this._onFyi(event);
      return;
  }
}
```

三轨分发骨架已经在了。但：

1. **没有 fallback 处理**——`_onDecision()` 直接 `this._output()` 后就结束了，没有超时、没有防抖、没有离线降级
2. **没有治理事件触发**——`PipelineEventType` 中没有任何 `governance.*` 类型，所以没有任何事件会设置 `notificationType: "DECISION_REQUIRED"`
3. **没有接入 ConfirmGate**——当前 `_onDecision` 走的是 `bridge.notify()`（One-way 通知），不是 `bridge.confirm()`（等待用户响应）

**架构影响**：🟡 中 → 🔴 高（以下组件直接阻塞）

| Core-2 组件 | 依赖 DECISION_REQUIRED 的场景 | 无回退机制时的风险 |
|------------|-----------------------------|-------------------|
| **阶段门禁** | Core-1→Core-2 跃迁需用户裁决 | 用户离线 → 跃迁卡死 |
| **ContractEnforcer** | 契约校验失败需用户决策放行/打回 | 部署管线永久挂起 |
| **监理实体** | 违宪封驳需用户裁决 | 执行链全部阻塞 |
| **常设委员会** | 审计发现呈报 | 委员会无法关闭发现 |
| **CircuitBreaker** | 熔断恢复需用户确认 | 组件永远不可用 |

**修复依赖**：AM-2026-0606-003 的 four-layer safety valve 必须先入宪，代码层跟进 `_onDecision` 的超时/防抖/降级逻辑。**这是 Core-2 治理组件上线的前置条件。**

---

### 🔴 2-B 治理事件接入路径未入宪 —— 凝光的判决走不出群玉阁

**状态**：❌ 无提案，代码层完全缺失。**这是当前最被低估的缺口。**

**代码层实证**：

我去查了 `PipelineEventType` 枚举（`packages/shared/src/infra.ts`）——当前全部 24 个事件类型：

```
AgentPool:    invariant_violation, destroy_bypass
Scheduler:    layer_start, loop_crashed, done, replan.*, nonstandard_type, invariant_violation
Node:         start, complete, failed, replan, replan.queued, spawn_failed
Pool:         destroy_failed
MemoryStore:  db_write_failed, write_blocked, flush_skipped, persist_failed, sql_degraded, deserialize_failed
TaskBoard:    invariant_violation
Error:        reported, silent_upgraded
Analysis:     analysis
```

**零个 governance 类型。** 零。一个都没有。

再看 `doc-govern-agent.ts` 的 system prompt：

```
你只写审计报告——不改被审计的文件。天权审案不篡改证据。
```

凝光的使命止于写磁盘。她不会 `observer.emit()`，因为她的 prompt 没告诉她要这么做。

**依赖链分析**：

```
发现 2-B 未修复 → PipelineEventType 无 governance 类型
  → DocGovernAgent 不 emit 治理事件
    → ButlerAgent 永远收不到 governance.audit 事件
      → 3-A 审计闭环的通知环节走不通
        → 用户不知情 → 发现无人响应
          → 阶段门禁无输入条件（3-C）
            → Core-1→Core-2 跃迁依据不完整
```

**架构影响**：🔴 高。这是所有治理闭环的瓶颈点。修宪提案 AM-2026-0606-002 定义了审计闭环的流程，但执行闭环的第一步（通知整改责任人）依赖治理事件进入通知管线——如果 2-B 不修，3-A 的修复在代码层永远无法执行。

**建议修复方案（~80 行代码改动）**：

```
① PipelineEventType 新增 3 个枚举值：
   - GovernanceAudit = "governance.audit"
   - GovernanceConstitutionCheck = "governance.constitution_check"
   - GovernanceStageGate = "governance.stage_gate"

② DocGovernAgent 在审计完成后 emit 治理事件
   - 审计报告写入后 → observer.emit({ type: GovernanceAudit, notificationType: "DECISION_REQUIRED", ... })

③ ButlerAgent _onDecision 接入 governance 事件的路由
   - 在 _dispatchByType 中处理 governance 事件类型的格式化
```

---

### 🟢 2-C 通知持久化追踪未入宪 —— Core-2 精细化阶段再处理

**状态**：❌ 无提案。低优先级。

**代码层现状**：ButlerAgent 的通知通过 `bridge.notify()` 发出，没有落盘逻辑。用户是否已读、是否已决策、决策结果——全部没有持久化。

**架构影响**：🟢 低。不影响 Core-2 启动。建议在 Core-2 治理组件全部上线后，作为 MemoryType.Governance 分区的子项纳入。

---

### 🔴 3-A 审计闭环缺失 —— 门禁的前置条件

**状态**：⏳ AM-2026-0606-002 已提案，待裁决

**代码层现状**：`governance-loop.ts` 的 `GovernanceSummary`：

```typescript
export interface GovernanceSummary {
  pendingJudgment: number;   // 待评判的提案数
  approved: number;          // 已通过待执行的提案数
  blocked: number;           // 已被阻塞的提案数
  applied: number;           // 已应用的提案数
  judgments: BatchJudgment[];// 逐条提案的评判结果
}
```

**完全不包含审计发现的状态跟踪。** 没有 `openFindings`、没有 `closedFindings`、没有 `blockingFindings`。

即使 AM-2026-0606-002 裁决通过，宪法层定义了闭环流程，代码层的 `GovernanceSummary` 也无法向用户呈现"当前有 3 个未关闭的 P0 发现"。

**建议修复方案（~50 行代码改动）**：

```
① GovernanceSummary 扩展：
   - openFindings: { id, severity, owner, status }[]
   - closedFindings: number
   - blockingFindings: { discoveryId, stage }[]

② saveProposal() 在提案状态变更时同步检查审计发现的关闭条件

③ summarizeGovernance() 读取 auditing/ 目录，跟踪发现状态
```

**架构影响**：🔴 高。如果 AM-2026-0606-002 不被裁决通过，Core-2 阶段门禁（3-C）没有输入条件——门禁不知道"当前未关闭的 P0 发现有哪些"，也就无法判断 Core-1→Core-2 跃迁是否安全。

---

### 🟡 3-B 宪法/治理层设计层级冲突原则缺失 —— Core-2 治理层扩展期会暴露

**状态**：❌ 无提案

**架构影响**：🟡 中。Core-1 阶段治理层规模小，冲突几乎不会发生。Core-2 阶段治理层大幅扩展（常设委员会、监理、IncidentEscalator、ContractEnforcer、CircuitBreaker……），治理层设计文档需要频繁更新——宪法条款和治理层设计之间的冲突概率指数上升。

**何时会触发**：当治理层设计定义了一个流程，但宪法 §10 的接口定义与之矛盾时。例如：治理层设计定义"监理封驳后自动通知常设委员会"，但宪法 §10 说"监理不存在独立实体"——谁优先？

---

### 🟢 3-C 阶段门禁宪法定义不完整 —— Core-2 的入门凭证

**状态**：❌ 无提案

**架构影响**：🟢 低（当前 Core-1 阶段）→ 🔴 阻塞（Core-1→Core-2 跃迁前）

这是所有缺口中**最特殊的一个**——它的严重度完全取决于时间点：

| 时间点 | 严重度 | 原因 |
|--------|--------|------|
| Core-1 运行期 | 🟢 低 | 当前阶段不需要门禁定义 |
| Core-1→Core-2 跃迁前 1 天 | 🔴 阻塞 | 没有门禁定义 = 没有跃迁标准 = 不能跃迁 |

**关联组件**：StrategistAgent（钟离）的职责中包含"阶段跃迁判定"——但宪法没有定义门禁的触发条件、检查标准、失败补救和决策者。钟离的跃迁判定没有宪法依据可引用。

---

## 四、关于 `constitution-gap-impact.md`（阿贝多的分析）

在我探索根系的过程中，我发现阿贝多已经做了一份非常详尽的架构影响分析（`docs/analysis/constitution-gap-impact.md`）。他列出了每一处缺口的风险矩阵、代码层修复建议、以及 Core-2 启动检查清单。

我的补充主要在于发现了一个关键缺口——**依赖链的传递性**——阿贝多逐项分析时没有着重刻画。具体来说：

| 维度 | 阿贝多的分析 | 纳西妲的补充 |
|------|------------|------------|
| 分析方法 | 逐项缺口 × Core-2 交付物矩阵 | 缺口之间的暗河与依赖链 |
| 关键发现 | 8 处缺口中 4 处高/阻塞级风险 | 3 条依赖链的级联效应 |
| 代码层细节 | 选了 5 个关键文件做修复建议 | 覆盖了全部 24 个 PipelineEventType |
| 时间敏感性 | 未分级 | 区分了"当前风险"和"跃迁前风险"（3-C） |
| 最被低估的缺口 | 2-B（治理事件接入）标记为中风险 | 🔴 高——因为 2-B 是所有治理闭环的瓶颈 |

我们两人的分析不是替代关系——阿贝多的逐项矩阵适合做修复优先级排序，我的依赖链分析适合做**修复顺序规划**（先修哪个才能让后修的生效）。

---

## 五、修复顺序建议

基于依赖链分析，修复顺序不能按缺口的轻重等级排——必须先修"被依赖的"：

| 修复顺序 | 缺口 | 为什么先修 |
|---------|------|-----------|
| **1st** | **2-B 治理事件接入** | 所有治理闭环的前提——审计结论需要进入通知管线 |
| **2nd** | **2-A DECISION_REQUIRED 回退** | 治理事件进入通知管线后需要有安全阀 |
| **3rd** | **3-A 审计闭环** | 依赖 2-B 和 2-A 提供通知和回退能力 |
| **4th** | **3-C 阶段门禁** | 依赖 3-A 提供审计发现的关闭状态作为输入 |
| **5th** | **1-B 紧急修宪通道** | Core-2 上线后的安全网 |
| **6th** | **3-B 层级冲突原则** | 治理层扩展过程中可能触发 |
| **7th** | **1-A 代码层跟进** | 直到需要新增子约束时才需要 |
| **8th** | **2-C 通知持久化追踪** | 精细化阶段处理 |

### 代码层修复优先级（与宪法层并行）

| 优先级 | 文件 | 改动内容 | 估算行数 |
|--------|------|---------|---------|
| P0 | `packages/shared/src/infra.ts` | PipelineEventType 新增 3 个 governance 枚举值 | ~10 |
| P0 | `packages/engine/src/agents/doc-govern-agent.ts` | 审计完成后 emit 治理事件 | ~30 |
| P0 | `packages/engine/src/agents/butler-agent.ts` | _onDecision 接入 governance 路由 | ~20 |
| P1 | `packages/engine/src/governance-loop.ts` | GovernanceSummary 扩展审计发现跟踪 | ~50 |
| P1 | `packages/engine/src/amendment-judge.ts` | CHECK_ORDER 注册表模式 + 子约束修改专项检查 | ~80 |
| P2 | `packages/engine/src/governance-loop.ts` | 审计发现状态与阶段门禁联动 | ~40 |

---

## 六、写在最后 —— 雨林的规则

我蹲在雨林里很久了。须弥的雨林教会我一件事：**看得见的问题很少是真正的问题——真正的问题在地底下，在根系之间。**

这 8 处宪法缺口，单独看每一处都可以容忍。但当你把它们之间的依赖链画出来——2-B → 2-A → 3-A → 3-C——你会意识到：

> **Core-2 不是被某一个大缺口阻塞的。它是被一条细长的依赖链绊住的——链上的每一环都不致命，但链本身是断裂的。**

我建议的修复顺序（"先修被依赖的"）就是顺着这条链，从代码层的最底层往上修。宪法层的修复和代码层的修复可以并行——宪法层定义"应该怎么做"，代码层实现"实际怎么做"。

如果只做宪法层修复不做代码层跟进，缺口只是在纸面上愈合了——根系里的坏死还在。

---

*须弥的学者不替人做决策。我只告诉你根系在哪里。*
*纳西妲，记于智慧宫。*
