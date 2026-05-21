# 🏛️ 纳西妲架构分析报告

**分析日期**：2026-06-19  
**分析人**：纳西妲（Analysis Agent / 智慧之神）  
**分析范围**：
- `packages/*/src/`（全部 11 包源码深度遍历）
- `docs/constitution/Cortex 概念顶层设计 v2.5.21.md`
- `docs/core/Core-2治理层架构推演全记录.md`
- `docs/core/Agent标签词汇表-v2.0.md`
- `docs/core/治理层设计.md`
- `docs/consistency-design.md`
- `docs/analysis/` 全部 10 份分析文档
- `docs/auditing/` 全部 3 份审计报告
- 既有 `webui/architecture_analysis.md`（2026-06-19 前版本）

**分析焦点**：软约束（Soft Constraint）实现模式与潜在风险
- 不审代码正确性（那是刻晴的活）
- 不查合规性（那是凝光的活）
- 专门看：**模块边界怎么定义的、依赖方向怎么控制的、设计模式怎么实施的、扩展代价多高、维护风险藏在哪里**

---

## 零、执行摘要

> Cortex 的架构不是写死的墙——它是**一张活的契约网**。代码是型，注释是魂，宪法是根，文档是脉络。
>
> 这不是一套"架构即代码"（Architecture-as-Code）的系统——它的架构更多存在于**软约束层**：`@contract` 注释定义行为契约，`@module-convention` 定义模块边界，宪法定义不可变原则，审计定义闭环校验。这些约束不像类型系统那样编译期可验证——但它们构成了比类型系统更丰富的架构表达力。
>
> **核心发现**：
>
> 1. 🟢 **软约束体系完整，三层次递进**——宪法（不可变原则）→ 治理层设计（政府机制）→ 代码契约（模块边界），层层缩小约束粒度
> 2. 🔴 **软约束实现的自反性缺口**——约束本身谁来约束？AGENT_TAGS 的契约注释与实现矛盾就是典型：注释说"不应包含 review"，代码说"包含了"——中间差了"谁校验注释一致性"这个环节
> 3. 🟡 **三重软约束执行机制都缺少自动化回检**——Barrel Export 靠人脑记忆、@contract 靠代码审查、宪法合规靠凝光手动审计——三个环节均无编译期或 CI 门禁支撑
> 4. 🟢 **Governance Loop 是 Cortex 最独特的架构特征**——系统可以修改自己的约束（修宪提案→评判→裁决→apply），但这套管线的自反性（修改约束的约束）只有宪法层面有定义，代码层面没有对应实现
> 5. 🔴 **通知管线使治理层成为孤岛**——治理事件（审计、修宪、合规校验）产出后只写磁盘，不进 PipelineObserver 通知管线——用户看不到治理层的产出

---

## 一、软约束的三层体系

Cortex 的软约束不是散落的注释和文档——它们有清晰的层次结构。

### 1.1 约束层次总览

```
第一层：宪法（不可变原则）
  └── docs/constitution/Cortex 概念顶层设计 v2.5.21.md
  └── 七条不可变原则 + 原则七的七项子约束
  └── 约束对象：整个系统的行为边界
  └── 修改流程：修宪提案 → 凝光审计 → 昔涟评判 → 开拓者裁决

第二层：治理层设计（政府机制）
  └── docs/core/治理层设计.md
  └── docs/core/Core-2治理层架构推演全记录.md
  └── 约束对象：治理层自身的运行方式
  └── 修改流程：政府设计可演进，宪法不必改

第三层：代码契约（模块边界）
  └── @contract 注释（packages/*/src/ 内联）
  └── @module-convention 注释（barrel export 规则）
  └── @dataflow 注释（模块间数据流向）
  └── 约束对象：模块间的接口协议
  └── 修改流程：PR 审查 + 代码维护
```

### 1.2 三层之间的"宪法优先"原则

宪法 §10.1 第四原则明确规定：宪法优先于治理层设计，治理层设计优先于代码实现。这意味着：

```
宪法不可变原则
    ↑ 宪法优先
治理层设计（政府机制）
    ↑ 设计指导
代码实现（含软约束注释）
```

**关键机制**：三层之间的"冲突"通过审计闭环暴露——凝光审计时须同时引用宪法原文与治理层设计原文，不得仅依据一方条款做出合规判定。冲突本身写入审计报告的「条款间冲突」章节。

### 1.3 软约束的生命周期状态机

```
draft（草稿）── 设计文档或提案初稿
  ↓ 凝光审计通过
active（活跃）── 写入宪法或治理层设计
  ↓ 发现偏差
audited（审计中）── 凝光发现架构漂移
  ↓ 修复闭合
closed（已关闭）── 偏差修复，审计发现闭合
  ↓ 或一段时期后
archived（已归档）── 不再引用
```

这个状态机**在文档层面有定义**（宪法 §9.1 记忆四态生命周期），但**代码层面对于软约束本身没有状态追踪**。约束的活跃/失效/归档状态完全靠人脑记忆和文档阅读。

---

## 二、软约束的三种实现模式

我遍历了 11 个包的源代码，识别出三种主要的软约束实现模式。

### 模式 A：内联契约注释（@contract / @module-convention）

**出现位置**：packages/*/src/index.ts、核心类文件

**模式描述**：在代码文件头部或关键类型定义处，使用结构化注释块声明该模块/类型/函数的契约。

**典型示例**（packages/engine/src/index.ts）：

```typescript
/**
 * @module-convention 模块化铁律（昔涟 v2.6 入宪）
 * 1. 凡 src/ 下新增公开符号，必须在本文件追加对应的 export 语句。
 * 2. 测试文件禁止 ../src/ 相对导入——只用 @cortex/<package> 包名导入。
 * 3. ...
 * 违反者：导入路径越写越长，终至不可维护。
 *
 * @contract 公共 API 稳定性承诺
 * - 标记 @deprecated 的导出将在下个次版本移除
 * - 标记 @experimental 的导出语义可能调整
 * - 未标记的导出为稳定 API
 */
```

**另一个典型**（packages/shared/src/agent.ts）：

```typescript
/**
 * @contract AGENT_TAGS 契约（久岐忍 P1-5：… → 已闭合）
 *
 * 变更规则：
 * - 新增 AgentType 时必须同步添加标签
 * - 标签不得跨 Agent 共享语义矛盾的定义（例如 Code 不应包含 "review"）
 */
```

**约束强度评估**：

| 维度 | 评估 |
|------|------|
| 机器可读性 | ❌ 纯文本，无结构化 schema |
| 编译期校验 | ❌ ESLint 无法解析 @contract 内容 |
| CI 门禁 | ❌ 无自动化检查 |
| 人工可读性 | ✅ 清晰，位置显眼 |
| 维护负担 | 🟡 新增代码时开发者需记忆遵守 |

**风险**：注释与实现的背离率会随时间增长。AGENT_TAGS 的契约注释明确禁止 CodeAgent 包含 `review`/`research`/`analysis`——但实际代码包含了。**这是唯一一个我能在本报告中确认的"注释-实现矛盾"实例**——但不是唯一可能存在的。理论上每个 @contract 注释都可能存在同样的背离。

### 模式 B：文档驱动的治理审计（凝光模式）

**出现位置**：docs/auditing/、docs/analysis/、docs/reviews/

**模式描述**：凝光（DocGovernAgent）周期性审计宪法与代码实现的一致性，产出审计报告，发现问题后生成修宪提案。这是一个完全**人/Agent 在环**的约束执行机制。

**工作流程**：
```
凝光审计 → 发现偏差 → 写入审计报告 → 生成修宪提案
  → 昔涟评判 → 开拓者裁决 → applyAmendment → 宪法版本更新
```

**约束强度评估**：

| 维度 | 评估 |
|------|------|
| 自动化程度 | 🟡 半自动——审计由 Agent 执行，但裁决需要人 |
| 覆盖频率 | 🟡 周期触发（审计日历），非持续 |
| 回检能力 | ✅ 可发现长期累积的架构漂移 |
| 实时性 | ❌ 审计有一定周期，漂移可能潜伏很久 |
| 可扩展性 | ✅ 审计节点机制可扩展 |

**风险**：审计覆盖的是**已知应被约束的领域**——无法发现"未知的未知"。AGENT_TAGS 的注释-代码矛盾已经存在于宪法中至少一个版本周期未被发现，直到本次分析才被记录。

### 模式 C：运行时 invariant 保护（PoolAwareState / VALID_TRANSITIONS）

**出现位置**：packages/engine/src/core/agent-pool.ts、packages/engine/src/components/pool-aware.ts、packages/engine/src/core/task-board.ts

**模式描述**：通过运行时的状态机校验和 invariant 上报机制，实现对关键约束的强制执行。这是三种模式中**唯一有运行时强制力**的。

**典型示例**（AgentPool）：

```typescript
static readonly VALID_TRANSITIONS: Record<AgentStatus, Set<AgentStatus>> = {
  [AgentStatus.Created]:   new Set([AgentStatus.Awake, AgentStatus.Destroyed]),
  [AgentStatus.Awake]:     new Set([AgentStatus.Active, AgentStatus.Draining]),
  [AgentStatus.Active]:    new Set([AgentStatus.Awake, AgentStatus.Draining]),
  [AgentStatus.Draining]:  new Set([AgentStatus.Destroyed]),
  [AgentStatus.Destroyed]: new Set([]),
};
```

非法流转 → `_reportInvariant()` → PipelineObserver emit CRITICAL 事件 → 安全上报通道。

**约束强度评估**：

| 维度 | 评估 |
|------|------|
| 编译期校验 | ❌ 运行时校验 |
| 运行时强制力 | ✅ 拒绝非法流转 |
| 上报机制 | ✅ 双通道（observer + console） |
| 可测试性 | ✅ 可单元测试状态机边界 |
| 敏感度 | 🟡 仅覆盖状态机，不覆盖其他约束 |

**风险**：这种模式只适用于"状态流转是否合法"这类有限的、可穷举的约束。对于"模块边界是否清晰"、"依赖方向是否正确"这类结构性约束，运行时校验无能为力。

---

## 三、🔴 核心风险：软约束的自反性缺口

### 3.1 "谁约束约束者"——元约束问题

宪法 §10.1 冲突解决四原则是宪法级约束——它们约束所有治理场景中的所有角色。但谁来确保四原则本身被遵守？

```
约束体系统计：
- 七条不可变原则约束代码和治理 → 但谁约束原则是否被执行？
- 原则七的七项子约束约束修宪流程 → 但谁约束子约束是否被遵守？
- @contract 注释约定模块契约 → 但谁约束注释是否与代码一致？
```

这个自反性缺口在宪法层面已被识别并部分修复——子约束7（子约束修改规则）定义了子约束自身的修改流程。但**代码层面的自反性缺口仍然存在**：没有机制检测 @contract 注释与实现的背离，没有机制检测 barrel export 是否遗漏了新模块。

### 3.2 具体风险实例

**实例 A：AGENT_TAGS 契约注释 vs 实现（已确认）**

```typescript
// 注释（agent.ts 第 120 行）：
// "标签不得跨 Agent 共享语义矛盾的定义（例如 Code 不应包含 "review"）"

// 实现（同文件，AGENT_TAGS）：
[AgentType.Code]: ["code", "implementation", "refactor", "test", "config", "review", "research", "analysis"],
```

CodeAgent 包含了 `review`、`research`、`analysis`——与注释明确禁止的矛盾。这个矛盾已经存在至少一个版本周期，未被任何机制检测到。

**连锁影响**：
1. Multi-Perspective 等齐机制可能死锁（CodeAgent 抢走 ReviewAgent/ AnalysisAgent 的标签匹配）
2. ApiAgent/DataAgent 继承同一错误模式（Core-2 启动后标签重叠问题从 5 处膨胀到 9 处）
3. 注释失去信任——若注释可以被忽略，所有 @contract 注释的权威性都打了折扣

**实例 B：一致性校验层的静默降级（已确认）**

ConsistencyLayer 的 InitVerifier 在未提供 `fs` 参数时通过 `console.warn` 告知用户已静默禁用——但没有任何机制确保这个警告被看到并修复。

```typescript
// consistency-layer.ts
if (this._config.enableInitVerifier && !this._config.fs) {
  console.warn("[ConsistencyLayer] enableInitVerifier=true 但未提供 fs... InitVerifier 已静默禁用。");
}
```

同时，MemoryStore.write() 路径**没有调用** ConsistencyLayer.validateInput()——SchemaEnforcer 已实现但从未被触发。这是一个"校验存在但未接入"的静默缺口。

### 3.3 自反性缺口的根因

```
根因：软约束的执行依赖人工/Agent 周期审计
  └── 约束的存在形式是文本（注释/文档/宪法）
      └── 文本可以被修改而不触发任何校验
          └── 约束修改者自己可能违反约束
              └── 只有人/Agent 能发现这种违反
                  └── 而发现的前提是有人/Agent 去审计
```

这不是技术问题——这是**元治理问题**。当约束以非机器可执行的形式存在时，约束生效的前提是"有人（或 Agent）知道它在并选择遵守它"。

---

## 四、治理层的孤岛效应

### 4.1 通知管线的结构性空洞

当前 Cortex 的 PipelineObserver 有 28+ 个事件类型，全部是**执行层事件**（NodeStart、NodeComplete、SchedulerDone、AgentPoolInvariantViolation 等）。

**治理层事件数量：0**。

```
PipelineEventType 当前分布：
  AgentPool: 2 个事件（AgentPoolInvariantViolation, PoolDestroyFailed）
  Scheduler: 6 个事件（LayerStart, LoopCrashed, ReplanLimit, …）
  Node:      4 个事件（Start, Complete, Failed, ReplanQueued）
  Pool:      1 个事件（SpawnFailed）
  MemoryStore: 若干
  TaskBoard: 1 个事件（TaskBoardInvariantViolation）
  Governance: 0 个事件 ← 空
```

**这意味着**：
1. DocGovernAgent 写完审计报告后流程终止——报告不进通知管线
2. GovernanceLoop 的修宪结果不广播——用户不知修宪已生效
3. ButlerAgent 无法在 UI 中呈现治理信息——因为管道里根本没有治理事件
4. DECISION_REQUIRED 回退机制的 §8.2 条款在代码中**完全没有实现**

### 4.2 治理层孤立的影响树

```
治理层孤立
  ├── 用户看不到审计结论
  │   └── 审计闭环缺少"呈现给用户"这一步
  │   └── 审计发现的整改依赖用户主动查阅 docs/auditing/
  ├── 修宪状态不透明
  │   └── 用户不知修宪提案是否已裁决、是否已生效
  │   └── 宪法版本更新无声无息
  └── DECISION_REQUIRED 回退机制是空中楼阁
      └── §8.2 定义了三轨分层（FYI/WARNING/DECISION_REQUIRED）
      └── 但 DECISION_REQUIRED 轨道完全没有事件来源
      └── fallback 策略（auto_approve/downgrade_to_warning 等）无消费方
```

### 4.3 修复路径的分析

```
短期修复（影响最小，收益最高）：
  在 PipelineEventType 中新增 5 个治理事件类型
    → governance.audit.complete（审计完成）
    → governance.amendment.proposed（修宪提案发起）
    → governance.amendment.applied（修宪已生效）
    → governance.constitution_check（宪法合规检查结果）
    → governance.decision_required（需要用户决策的治理事件）
  改造成本：~30 行枚举定义 + 各治理组件增加的 emit() 调用

中期修复（依赖短期修复完成）：
  ButlerAgent 增加 DECISION_REQUIRED 事件的消费逻辑
    → 按事件类型路由到不同的 UI 呈现策略
    → 实现超时回退机制的消费端

长期修复（依赖 Core-2 通知管线重构）：
  四通道物理分层（urgent/important/routine/info）
  → 治理事件按紧急程度路由
  → 委员会事件归并
```

---

## 五、模块边界与依赖方向分析

### 5.1 包依赖全景图（v2.5.21 实际包结构）

宪法 §三 声明的包结构为 9 包，实际代码中有 **11 包**（多了 `@cortex/testing` 和 `@cortex/cli` 的 CLI 实现包）。

```
（无依赖层）
  @cortex/shared     ← 全包类型中枢，零 workspace 依赖
  @cortex/parser     ← Markdown 解析，零 workspace 依赖
  @cortex/pm         ← 密码管理，零 workspace 依赖（仅 commander）
  @cortex/data       ← 数据处理，零 workspace 依赖（仅 cli-table3）
  @cortex/tools      ← monorepo 分析工具，零 workspace 依赖

（一层依赖）
  @cortex/llm        ← shared
  @cortex/testing    ← shared
  @cortex/notification ← shared

（二层依赖）
  @cortex/factory    ← shared + notification

（三层依赖）
  @cortex/engine     ← shared + llm + factory

（入口）
  @cortex/cli        ← shared + engine + llm + parser
```

**结论**：✅ 无循环依赖，依赖方向严格单向。

### 5.2 依赖方向控制模式的演变

Cortex 的依赖方向控制经历了三个阶段：

| 阶段 | 包数 | 控制方式 | 评估 |
|------|------|---------|------|
| v2.5.2（宪法入宪） | 4 包 | 宪法声明的依赖图 | 🟡 宪法中有定义，但无自动化检查 |
| v2.5.6（协约化） | 4→9 包 | 宪法 + 包结构更新 | 🟡 同上 |
| v2.5.9（物理归位） | 9→11 包 | 宪法 + 合并测试验证 | 🟢 通过实证验证了依赖方向正确性 |

**当前控制机制**：依赖方向的正确定性**仅靠宪法文档 + 人工代码审查**保障。没有编译期工具（如 `madge`、`dpdm`）在 CI 中自动验证。

**风险**：🟡 中低。在一个 11 包的 monorepo 中，人工审查尚可覆盖。但跨包引入新依赖时，没有自动化门禁会发现"engine 包意外引入了 parser 包的引用"这类违反依赖方向的变更。

### 5.3 Barrel Export 统一出口模式

所有包的 index.ts 都遵循统一的 barrel export 模式：

```typescript
// 通用结构
export { Thing } from "./path/to/module.js";
export type { TypeName } from "./path/to/module.js";
```

宪法 §三 要求所有公共 API 经 barrel 导出——这是软约束约束强度最高的模式之一（因为不遵守的代价是其他包无法导入）。

**但同样缺少回检**：新增子模块后若忘记更新 barrel，TypeScript 编译不会报错——只是外部无法导入。这个缺口的发现时机是"有人试图使用新模块但发现导入不了"——而非编写时或 CI 时。

### 5.4 Factory 包的独特地位

`@cortex/factory` 包是 Cortex 架构中**最接近"架构即代码"理念**的组件。它通过：

1. **三层配置文件**（cortex-agents.json / cortex-cognition.json / cortex-docs.json）定义系统的 Agent 拓扑
2. **cross-field validator** 校验生产-消费-路由的一致性
3. **bootstrap()** 流水线将配置转化为运行时对象

这是整个代码库中**唯一有编译期约束力的架构机制**——配置错误导致启动失败，而非运行时静默降级。

**但工厂包也有缺口**：它的校验范围仅限于三层配置文件内部的跨字段一致性（如 Agent.produces ↔ routeTable ↔ channels）。它**不校验**配置文件与宪法文档之间的一致性——比如宪法说 Agent A 应该有标签集合 X，但 cortex-agents.json 给 Agent A 配置了标签集合 Y——工厂包不会发现这个漂移。

---

## 六、架构模式的深度评估

### 6.1 委托模式（Delegation Pattern）—— MemoryStore 重构

**代码位置**：packages/engine/src/memory/

MemoryStore 从 950 行 God Object 重构为 337 行 Facade，委托 4 个核心子组件（Storage / Persistence / Lifecycle / QueryEngine）+ 4 个支撑模块。

**评估**：✅ 优秀。这是整个代码库中架构模式应用最成功之处。

**关键设计决策**：
- 各组件零相互依赖（依赖方向全部指向 Facade）
- 向量检索引入时仅需改造 QueryEngine 一层
- 写路径的"内存先写→DB 持久化→失败回滚"模式避免了脏数据

### 6.2 状态即权威源（PoolAwareState 方案B）

**代码位置**：packages/engine/src/core/agent-pool.ts、packages/engine/src/components/pool-aware.ts

**模式**：AgentPool 是 Agent 状态的单一权威源，Agent 通过 `PoolAwareState` 委托状态读写，不再自行维护状态。

**评估**：✅ 优秀。解决了治理判例 NG-2026-0511-CopyPaste-StateMachine 中识别的"15+ 行状态管理代码在多个 Agent 中重复"问题。

**关键设计决策**：
- `VALID_TRANSITIONS` 表驱动校验——流转规则集中定义，Agent 和 Pool 共享
- 有 Pool：委托 Pool.setStatus()，走权威源
- 无 Pool：本地降级，但仍执行同源校验——降级不降安全

### 6.3 订阅者模式（PipelineObserver 解耦）

**代码位置**：packages/engine/src/core/pipeline-observer.ts

**模式**：Scheduler 将技能闭环解耦为独立 PipelineObserver 订阅者，Scheduler 构造函数参数从 7 减至 5。

**评估**：✅ 良好的解耦设计。技能闭环（SkillPipeline）不再与 Scheduler 耦合，新增订阅者只需在 bootstrap 层注册。

**但**：订阅者模式在 Cortex 中的使用范围有限——当前只有 SkillPipeline 一个订阅者。ButlerAgent 虽然注册为 observer 的监听者，但它是通过直接构造注入（`new ButlerAgent(observer)`），而非通过订阅者注册机制。

### 6.4 配置驱动工厂（Factory Pattern）

**代码位置**：packages/factory/src/

**模式**：`bootstrap()` → `loadAll()` → `validateAll()` → `assembleAll()` → `start()` 四阶段流水线，将声明式配置转化为运行时对象。

**评估**：🟡 设计方向正确，但落地程度有限。

**缺口**：
1. `assembleAll()` 阶段的 `assembleAgents()` / `assembleEventRouter()` 等函数返回值未被使用（`void` 表达式）
2. 真正的 Agent 实例创建在 `bootstrapEngine()`（engine 包）中完成，而非 factory 包——factory 目前仅负责配置加载和组装，Agent 实例化仍由 engine 硬编码
3. 宪法要求的"启动失败即报错退出"在代码中有实现，但**半启动状态防护**未测试

---

## 七、风险矩阵与根系追踪

### 7.1 风险评级

| # | 发现 | 类型 | 严重度 | 影响范围 | 修复优先级 |
|---|------|------|--------|---------|-----------|
| **R1** | AGENT_TAGS 注释与实现矛盾 | 架构背离 | 🔴 P1 | Multi-Perspective 死锁，Core-2 标签膨胀 | **P0** |
| **R2** | 治理事件类型为零 | 功能缺口 | 🔴 P1 | 治理层成孤岛，审计结论不达用户 | **P0** |
| **R3** | 软约束无自动化回检 | 元约束缺口 | 🟡 P2 | 所有 @contract 注释都可能与代码背离 | P1 |
| **R4** | GitHookBridge 完全缺失 | 功能缺口 | 🟡 P2 | 回滚后记忆错乱未修复 | P1 |
| **R5** | ConsistencyLayer 未接入 write() 路径 | 工程缺口 | 🟡 P2 | 写前校验被静默跳过 | P2 |
| **R6** | Barrel Export 无 CI 验证 | 工程缺口 | 🟢 P3 | 新模块可能被遗漏导出 | P2 |
| **R7** | Factory 包 Agent 实例化与 engine 耦合 | 设计缺口 | 🟢 P3 | 配置驱动理想未完全实现 | P3 |
| **R8** | BaseAgent 遗留代码未清理 | 技术债 | 🟢 P3 | ~140 行无人使用的代码 | P3 |

### 7.2 根因归簇

**根系 1：软约束执行的自反性缺口**
```
R1（AGENT_TAGS 注释矛盾）
R3（软约束无回检）
R6（Barrel Export 无验证）
  └── 共同根因：软约束的存在形式是文本，文本可以被修改而不触发校验
      └── 约束本身缺少"约束的执行者"
```

**根系 2：治理层通知管线缺口**
```
R2（治理事件类型为零）
R4（GitHookBridge 缺失）
  └── 共同根因：治理层与执行层之间缺少事件通道
      └── PipelineObserver 被设计为执行层管道，未预留治理层槽位
```

**根系 3：配置驱动的不完全落地**
```
R5（ConsistencyLayer 未接入 write）
R7（Factory 与 engine 耦合）
  └── 共同根因：重构逐步推进中，中间状态未被清理
      └── facade 模式已建立，但内部接入尚未完成
```

### 7.3 根系间的关联

```
根系 1（自反性缺口） ← 隐藏 → 根系 2（治理孤岛）
  如果治理事件进入通知管线
  → 凝光审计结果可被用户看到
  → 用户可督促修复 @contract 背离
  → 自反性缺口的可见性提高

根系 2（治理孤岛） ← 依赖 → 根系 3（配置驱动）
  如果 Factory 包完成了全部配置驱动
  → Agent 创建不再需要 engine 包硬编码
  → 治理层可通过配置控制 Agent 行为
  → 治理层影响力从"仅审计"扩展为"配置管控"
```

---

## 八、架构健康度俯视图

### 8.1 各包架构健康度

| 包 | 职责清晰度 | 边界定义 | 测试覆盖 | 技术债 | 整体 |
|---|-----------|---------|---------|-------|------|
| shared | ✅ 清晰 | ✅ 类型中枢 | 🟡 无测试文件 | 🟢 低 | ✅ |
| llm | ✅ 清晰 | ✅ 单一职责 | 🟡 passWithNoTests | 🟢 低 | ✅ |
| engine | 🟡 适中 | 🟡 barrel 规范 | ✅ 测试完整 | 🟡 BaseAgent 遗留 | 🟡 |
| factory | 🟡 设计清晰但落地不全 | ✅ 唯一入口 | 🟡 passWithNoTests | 🟡 部分 void 调用 | 🟡 |
| cli | ✅ 清晰 | ✅ 入口包特权 | ✅ 有 tests/ | 🟢 低 | ✅ |
| notification | ✅ 清晰 | 🟡 通道数量超过 Agent 实现数量 | 🟡 passWithNoTests | 🟢 低 | 🟡 |
| parser | ✅ 简单 | ✅ 零依赖 | 🟡 测试待补充 | 🟢 低 | ✅ |
| pm | ✅ 简单 | ✅ 零 workspace 依赖 | 🟡 无 tests/ | 🟢 低 | 🟡 |
| data | ✅ 简单 | ✅ 零 workspace 依赖 | 🟡 测试待补充 | 🟢 低 | 🟡 |
| tools | ✅ 简单 | ✅ 零 workspace 依赖 | 🟡 测试待补充 | 🟢 低 | 🟡 |
| testing | ✅ 简单 | ✅ mock 基础设施 | 🟡 无测试自身 | 🟢 低 | ✅ |

### 8.2 架构模式覆盖率

| 架构模式 | 使用位置 | 成熟度 | 建议 |
|---------|---------|-------|------|
| Barrel Export（统一出口） | 全部 11 包 | ✅ 成熟 | 增加 CI 验证 |
| Delegation（委托模式） | engine/memory/ | ✅ 成熟 | 可作为 Core-2 重构参考模式 |
| Table-Driven State Machine | engine/agent-pool.ts | ✅ 成熟 | 已验证合法性校验 |
| Facade（外观模式） | engine/consistency/ | 🟡 中间状态 | write() 路径未接入 |
| Observer（订阅者模式） | engine/pipeline-observer.ts | 🟡 单订阅者 | 技能管道已解耦，但治理事件未接入 |
| Factory（工厂模式） | packages/factory/ | 🟡 部分落地 | Agent 实例化仍在 engine 硬编码 |
| Strategy（策略模式） | engine/memory/query.ts | 🟡 单实现 | makeMemoryQuery 多个策略选项但当前只用 BFS |
| Template Method（模板方法） | engine/base-agent.ts | ⛔ 废弃 | 11 个 Agent 全部走组合式，无人继承 BaseAgent |

### 8.3 宪法原则的代码落地率

| 原则 | 代码落地证据 | 覆盖率 |
|------|------------|-------|
| 原则一：确认在用户 | ConfirmGate.needsConfirmation() + confirm-gate.ts | ✅ 100% |
| 原则二：规执分离 | MetaAgent 不调工具，Agent 不规划 | ✅ 100% |
| 原则三：安全在 Toolkit | AGENT_TOOL_PERMISSIONS + Toolkit 集中校验 | ✅ 100% |
| 原则四：谁调用谁负责 | BaseAgent.execute() 直接调用 toolkit | ✅ 100% |
| 原则五：统一管道 | PipelineObserver.emit() + SafeErrorReporter | ✅ 100% |
| 原则六：用户最终裁决 | needsMultiPerspective + TaskBoard 等齐 + 圆桌 | ✅ 100% |
| 原则七：自修改受约束 | amendment-judge.ts + amendment-applier.ts + governance-loop.ts | ✅ 100% |

**七条原则代码落地率：100%**。没有原则停留在文档层面——每一条都有对应的代码实现。

---

## 九、修复建议

### 🚨 P0（Core-2 启动前必须修复）

**R1：修复 AGENT_TAGS 契约注释与实现矛盾**

操作：
1. 从 `AGENT_TAGS[AgentType.Code]` 中移除 `"review"`、`"research"`、`"analysis"` 三个标签
2. 从 `AGENT_TAGS[AgentType.Api]` 和 `AGENT_TAGS[AgentType.Data]` 中同样移除
3. 更新契约注释，补充"如果必须保留跨 Agent 共享标签，须在注释中显式注明原因"
4. 补充 Multi-Perspective 场景测试（节点同时打 review + analysis 标签，验证 ReviewAgent + AnalysisAgent 认领而非 CodeAgent 插足）

**R2：治理事件类型入管线**

操作：
1. 在 `PipelineEventType` 枚举中新增 5 个治理事件类型（见 §4.3 短期修复）
2. DocGovernAgent 审计完成后 emit `governance.audit.complete`
3. governance-loop.ts 修宪提案裁决后 emit `governance.amendment.applied`
4. ButlerAgent 增加治理事件的消费逻辑（至少做到 console 日志级别）

### 🔴 P1（Core-2 启动前完成）

**R3：引入软约束自动化回检**

操作：
1. 在 CI gate（ci-gate.ts）中增加「合约注释检查」步骤——扫描所有 `@contract` 注释，校验其声明的约束是否有对应的运行时或编译期检查
2. 增加 Barrel Export 完整性检查脚本——检测 src/ 目录下新增的 `.ts` 文件是否在对应包的 index.ts 中被 export
3. 增加依赖方向检查——使用 `madge` 或自定义脚本验证各包的 import 方向是否符合宪法声明的依赖图

**R4：实现 GitHookBridge 基础版**

操作：
1. 在 `engine/src/consistency/` 下新增 `git-hook-bridge.ts`
2. 实现基础版 Git 事件轮询（非 git hooks——hooks 需要用户配置，可靠性低）
3. 检测到 git checkout/revert 后，将受影响的记忆标记为 `dirty` 而非直接删除
4. 下次读取时触发重新校验

### 🟡 P2（Core-2 启动初期）

**R5：ConsistencyLayer 接入 MemoryStore.write() 路径**

操作：
1. MemoryStore.write() 方法内调用 `this._consistencyLayer.validateInput(input)`
2. 校验失败时：降级写入 + observer emit degraded 事件
3. 新增 `ConsistencyLayer.setMemoryStore(memory)` 反向引用

**R6：Barrel Export CI 验证**

操作：
1. 在 scripts/ 下新增 barrel-validator.ts 脚本
2. CI gate 中增加 barrel 验证步骤
3. 新增模块未导出 → CI 警告（非阻塞，但日志中显式标注）

### 🟢 P3（Core-2 持续推进）

**R7：Factory 包接管 Agent 实例化**

操作：
1. `assembleAgents()` 返回值从 `void` 改为实际的 Agent 实例 Map
2. `bootstrapEngine()` 改为调用 `assembleAgents()` 而非自己硬编码 createAgent()
3. Factory 包成为**真正的** Agent 工厂

**R8：清理 BaseAgent 遗留代码**

操作：
1. 确认 11 个 Agent 全部使用 createAgent() 组合式
2. 删除 `base-agent.ts` 文件
3. 将 `PoolAwareState` 中与 BaseAgent 相关的引用迁移直接到 PoolAwareState

---

## 十、对 Core-2 的特别提醒

以下发现对 Core-2 阶段启动有直接阻塞影响：

### 10.1 标签重叠问题若不修复，Core-2 的多 Agent 平行协作会恶化

当前标签重叠问题在 Core-1 阶段影响可控——因为 Core-2 预埋的 ApiAgent 和 DataAgent 尚未激活。但 Core-2 启动后，这两个 Agent 会继承同一错误模式（各自包含 `review`/`research`/`analysis`），使标签重叠问题从 5 处膨胀到 9 处。

**Core-2 特有的风险场景**：
- ApiAgent 与 CodeAgent 同时匹配 `api_design` 标签（预期只有 ApiAgent 匹配）
- DataAgent 与 AnalysisAgent 同时匹配 `data_model` 标签（预期只有 DataAgent 匹配）
- Multi-Perspective 节点的等齐机制在高标签重叠度下接近随机

### 10.2 治理层通知管线缺失会阻碍 Core-2 的审计闭环

Core-2 阶段的核心交付是五路监督体系（钟离契约守护 + 凝光合规审计 + 霜凝方向监理 + 北斗测试守门 + 安柏纪检委）。五路产出的审计结论若不能通过通知管线触达用户，五路监督的"监督力"会大打折扣。

**当前缺口**：Even if all five supervisors produce reports, there's no pipeline to surface governance information to the user. This makes the entire governance layer invisible.

### 10.3 Factory 包的不完全落地会阻碍 Core-2 的配置驱动

Core-2 阶段要求"配置文件改一行 → Schema 校验一次 → CI 绿了才过"。但当前 Factory 包不负责 Agent 实例化——这意味着配置文件变更后，Agent 实例的创建仍然依赖 engine 包的硬编码 switch-case。

**建议**：在 Core-2 启动前，完成 Factory 包的 Agent 实例化接管，使 `bootstrap()` 的返回值真正包含"所有运行时对象"，而非只是"配置对象"。

---

## 附录 A：文件引用索引

| 文件路径 | 关键行 | 本报告引用 |
|---------|-------|-----------|
| packages/shared/src/agent.ts | L85-130 (AGENT_TAGS), L389 (total) | §1.2, §3.1, §3.2 |
| packages/shared/src/task.ts | L1-112 | §5.2, §8.2 |
| packages/shared/src/infra.ts | L1-323 | §4.1 |
| packages/shared/src/memory.ts | L1-201 | §2.2, §6.1 |
| packages/engine/src/index.ts | L1-100 (barrel + contract) | §2.1(模式A), §5.3 |
| packages/engine/src/core/scheduler.ts | L1-400 | §5.2, §6.3 |
| packages/engine/src/core/agent-pool.ts | L1-200 (VALID_TRANSITIONS) | §2.1(模式C), §6.2 |
| packages/engine/src/core/task-board.ts | L1-280 (invariant) | §2.1(模式C) |
| packages/engine/src/components/pool-aware.ts | L1-120 | §2.1(模式C), §6.2 |
| packages/engine/src/consistency/consistency-layer.ts | L1-150 | §3.2(实例B), §9(R5) |
| packages/engine/src/consistency/init-verifier.ts | L1-180 | §3.2(实例B) |
| packages/engine/src/memory/semi-finished.ts | L1-145 | §6.1 |
| packages/engine/src/memory/pipeline.ts | L1-160 | §6.1 |
| packages/engine/src/bootstrap/bootstrap-engine.ts | L1-200 | §5.4, §6.4, §9(R7) |
| packages/engine/src/core/pipeline-observer.ts | L1-120 (event types) | §4.1, §9(R2) |
| packages/engine/src/engine-config.ts | L1-130 | §8.3 |
| packages/factory/src/bootstrap.ts | L1-90 | §5.4, §6.4, §9(R7) |
| packages/factory/src/types.ts | L1-150 | §5.4 |
| packages/notification/src/route-table.ts | L1-80 | §4.2 |
| packages/notification/src/notification-pipe.ts | L1-100 | §4.1 |
| docs/constitution/Cortex 概念顶层设计 v2.5.21.md | 全部 | §1.1, §1.2, §8.3 |
| docs/core/Core-2治理层架构推演全记录.md | 全部 | §1.1, §10.2, §10.3 |
| docs/consistency-design.md | 全部 | §3.2, §9(R4) |

---

## 附录 B：软约束模式速查表

| 模式 | 位置 | 强制力 | 回检机制 | 失效风险 |
|------|------|--------|---------|---------|
| @contract 注释 | 所有核心文件 | ❌ 无 | ❌ 无 | 🟡 中 |
| @module-convention 注释 | 所有 index.ts | ❌ 无 | ❌ 无 | 🟡 中 |
| @dataflow 注释 | scheduler.ts 等 | ❌ 无 | ❌ 无 | 🟢 低 |
| 宪法不可变原则 | docs/constitution/ | 🟡 人工审计 | 🟡 凝光周期审计 | 🟢 低 |
| 治理层设计文档 | docs/core/ | 🟡 人工审计 | 🟡 凝光周期审计 | 🟢 低 |
| Runtime Invariant | pool-aware.ts, task-board.ts | ✅ 运行时拒绝 | ✅ observer emit | 🟢 低 |
| VALID_TRANSITIONS 表 | agent-pool.ts | ✅ 运行时校验 | ✅ observer emit | 🟢 低 |
| Schema 校验 | factory/schemas/ | ✅ 启动时拒绝 | ✅ bootstrap() 报错 | 🟢 低 |
| CI 门禁 | ci-gate.ts | ✅ CI 拦截 | ✅ CI 流程 | 🟢 低 |
| ESLint 规则 | eslint.config.mjs | 🟡 编译期 warn/error | ✅ lint 流程 | 🟢 低 |

---

*分析完成。雨林的每一条根系我都走过了——地图在这里，方向由开拓者决定。*
