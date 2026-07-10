# ⚖️ Cortex 代码法典·治理篇——按 Agent 类型注入

> 此文件注入 Scheduler / MetaAgent / AgentPool / DocGovernAgent / 记忆系统相关 Agent 的 system prompt。
> CodeAgent / ReviewAgent / AnalysisAgent 等纯执行 Agent 默认不注入治理篇（仅注入核心篇）。
> 
> 标注约定：「✅ 已实现」= 代码中有对应实现；「📋 规划」= 设计目标，尚未落地；「规范要求」= 应遵守的约束，但代码中未强制执行。
> 
> 版本：v1.4（v1.3 + E2E分层规范 + FSM治理）

---

## E2E 分层执行规范

```
✅ 分层策略（宪法 §24）：
  push 门禁    → core-smoke (~0.5元)
  PR 门禁      → +cortex-e2e-full + memory-write + skill-e2e
  release 门禁 → +solo-flight + self-exam-soft + budget-cap
  月度基线     → write-file-baseline + fcall-stability

✅ E2E 文件必须声明 @covers 注释
✅ 新 E2E 必须先声明覆盖了已有 E2E 未覆盖的链路
```

## FSM 状态机治理

```
✅ 记忆状态变更必须通过 MemoryEntryStateMachine
  - commit 前走 cas("pending", "commit", ctx) guard 校验
  - rollback 前走 cas("pending", "rollback", ctx) guard 校验
  - archive 前走 canArchive（weight < 0.5）守卫
❌ 禁止绕过状态机直接调用 store.commitMemory() 或 store.archive()
✅ defineFsm<State, Event> 编译期锁定状态/事件——新增类型即编译报错
```

---

## 八、Agent 权限与工具调用

```
❌ 禁止：Agent 自行定义工具白名单
✅ 要求：Agent 以类型身份调用 Toolkit，权限集中在 AGENT_TOOL_PERMISSIONS（宪法原则三）
```

**确认门可逆性等级（宪法 §7.1）**：

| 等级 | 定义 | 确认要求 |
|------|------|---------|
| L0 | 纯读取 | 永不确认 |
| L1 | 可逆写入 | TrustModel≥L3 放行，否则确认 |
| L2 | 不可逆写入 | 永远确认 |
| L3 | 不可恢复 | 永远确认 |

> L1→L2 升级条件：单次 >3 文件 或 >100 行 或命中风险文件名（secret/token/password/key/.env）

**谁调用谁负责（宪法原则四）**：Agent 对其工具调用的后果承担全部责任。

---

## 九、记忆系统规范

```
✅ 要求：所有持久化记忆写入必须经过 MemoryStore.write()
❌ 禁止：直接操作 SQLite 绕过 MemoryStore 生命周期
✅ 要求：撰写记忆须指定 MemoryType（Episodic / Conceptual / Governance）
```

**四态生命周期（宪法 §10.1）**——单向流转，不可回退：

```
Active → Archived → Frozen → Obliterated
```

| 状态 | 可检索 | 可关联 | 说明 |
|------|--------|--------|------|
| Active | ✅ | ✅ | 热记忆，30 天窗口内有效 |
| Archived | ✅（显式指定） | ✅ | 移出热窗口 |
| Frozen | 仅显式指定 | ❌ 新关联 | 冻结 |
| Obliterated | 仅显式指定 | ❌ 新关联 | 不可逆终点 |

> **DocGovern 分区例外**：审计记录、修宪提案、判例记录永久保存，不受 30 天窗口限制。

**双轨检索**：
- CSA（上下文选择注意力）——私人记忆，trackAccess=true，追踪热度
- HCA（高层次注意力）——工程记忆，trackAccess=false，不污染热度指标

**业界定位**：Cortex 的记忆系统融合了 LangGraph 的分层存储思想（短期 State + 长期 Store）和 CrewAI 的认知化记忆理念（自动分类+智能召回），但做到了两点业界独有的突破——① 将工程治理（Constitution）作为记忆层一等公民（DocGovern 分区永久保存审计/修宪/判例）；② HCA/CSA 双轨注意力机制，把策略规划需要的「干净记忆」和任务执行需要的「热点记忆」物理隔离，互不污染。

---

## 十、Agent 生命周期

```
✅ 要求：Agent.status 读写必须委托 AgentPool（单一权威源，宪法 §5.2）
❌ 禁止：Agent 自行修改 status
```

```
Created → Awake → Active → Awake → ... → Draining → Destroyed
```

- `AgentPool.spawn()` 创建 Created → `wakeup()` 进入 Awake → `execute()` 进入 Active
- AgentPool 持有 `VALID_TRANSITIONS` 表驱动校验合法流转边
- 非法流转 → `observer.emit('scheduler.invariant_violation', CRITICAL)`

---

## 十一、测试自声明

```
✅ 要求：每个测试文件首行注释标注 @ci 标签
// @ci: unit | llm | integration | e2e | manual
```

- `unit` → CI 门禁强制运行
- `llm/integration/e2e/manual` → 跳过门禁，手动驱动
- 无标签默认视为 `unit`

---

## 十二、治理记录规范

```
✅ 要求：每次代码修改必须记录——旧逻辑缺陷、新逻辑补足、涉及文件与行号、执行者、时间戳
✅ 要求：修改记录写入 MemoryType.Governance 分区（宪法原则七·子约束2）
```

| 字段 | 说明 |
|------|------|
| 修改前逻辑 | 旧实现的问题 |
| 修改后逻辑 | 新实现的方案 |
| 涉及文件与行号 | 精确到行 |
| 执行者 | Agent 类型或人工 |
| 时间戳 | ISO 8601 |

> **最小改动原则**：仅修改必须改的那一行/段，禁止扩大修改范围。不允许顺手重构相邻段落。

---

## 十三、调度策略

> ⚠️ 当前实现状态：Scheduler 仅支持拓扑排序一种调度策略。以下扇出、流水线、条件分支为规划中的策略，标注「规划」。
>
> **业界术语对照**：Cortex 的调度属于「编排 (Orchestration)」——中央 Scheduler 决定每步谁执行；同层并行执行对应「群调度 (Swarm Scheduling)」——多 Agent 并行处理同层任务后聚合。

Scheduler 通过 `_executeAll()` 驱动调度主循环：先对 TaskNode 做拓扑排序，同层无依赖节点通过 `Promise.allSettled` 并行执行，下层等待上层全部完成。这是拓扑排序的内置行为——无需额外 dispatch 方法。

| 策略 | 状态 | 行为 |
|------|------|------|
| **拓扑排序**（当前唯一实现） | ✅ 已实现 | 按 DAG 依赖边逐层并行——同层节点通过 `Promise.allSettled` 并行，下层等待上层全部完成。Scheduler.`_executeAll()` 内置此逻辑 |
| **扇出并行** | 📋 规划 | 所有节点同时分发——无依赖时拓扑排序列出的 layer 0 已天然并行，当前无需独立策略 |
| **流水线串行** | 📋 规划 | 链式依赖时拓扑排序天然产生每层单节点→串行效果。`PipelineRunner` 是 Agent 内执行管道（Claim→Spawn→Execute→Cleanup），非跨节点调度策略 |
| **条件分支** | 📋 规划 | A 完成后根据 NodeResult 标志字段判断执行 B 或 C。当前 Scheduler 基于 `parentId` 静态 DAG，无运行时条件路由 |
| **重试调度** | ✅ 已实现 | 失败节点**不原地重试**——直接入重规划队列 `replanManager.enqueue()`，由 MetaAgent 生成替代方案。`maxReplanPerNode=3`，`maxTotalReplans=3` |

**重规划中转通道**（实际代码路径）：
```
Agent 执行失败 → Scheduler._dispatchNode
  → replanManager.enqueue()           // 入重规划队列
  → MetaAgent.requestReplan()          // 异步生成替代方案
  → ReplanManager 写入 TaskBoard       // 领而不执，交 Scheduler 调度
```

---

## 十四、循环方式

> ⚠️ 当前 `maxRounds`/`until` 字段在 TaskNode 类型中不存在。以下标注「规范要求」为应遵守的设计约束，标注「规划」为尚未实现的循环机制。

```
✅ 规范要求：任何循环必须有硬上限（默认 15 轮），防止无限循环耗尽 token
❌ 禁止：无条件 while(true) 循环
```

| 方式 | 状态 | 终止条件 | 说明 |
|------|------|---------|------|
| **Plan-and-Execute** | ✅ 已实现 | MetaAgent 先拆解任务生成完整 DAG（Plan），Scheduler 按拓扑排序逐层分发执行（Execute） | Cortex 的内置范式——MetaAgent 的规划输出直接驱动 Scheduler 调度 |
| **ReAct 循环** | ✅ 已实现 | think→act→observe，无工具调用时终止 | BrowserAgent 专用。DeepSeek 不支持 tool_calls，使用文本解析驱动浏览器操作 |
| **重试升级** | ✅ 已实现 | 失败节点直接入 `replanManager.enqueue()`，不原地重试。MetaAgent 最多生成 3 轮替代方案（`maxReplanPerNode=3`），总重规划上限 3 轮（`maxTotalReplans=3`） | 超限后 Scheduler 发射 `SchedulerReplanLimit` 事件并停止执行——当前无交互式用户裁决逻辑 |
| **固定轮次** | 📋 规划 | 达到 N 轮强制终止（需 TaskNode 新增 `maxRounds` 字段） | 已知迭代次数的探索任务 |
| **条件循环** | 📋 规划 | 条件满足即终止（需 TaskNode 新增 `until` 字段） | 编译零错误、测试全通过等 |
| **收敛循环** | 📋 规划 | 发言自然收束、凝光判定共识达成。`roundtableTemplates` JSON 配置和独立测试脚本存在，但引擎主循环未集成 | 多 Agent 协商 |

**超限处置**（当前代码实际行为）：

| 循环类型超限 | 当前行为 | 规划目标 |
|-------------|---------|---------|
| ReAct 超限 | 最后一次 observe 结果作为最终产出 | 在 NodeResult 中标记 `reactTimeout`（字段待新增） |
| 重试升级超限 | Scheduler 发射 `SchedulerReplanLimit` 事件，停止执行 | 交用户裁决（需 ConfirmGate 交互式阻塞） |
| 固定轮次/条件/收敛超限 | 尚未实现 | 分别标记 `maxRoundsExceeded` / `conditionUnmet` / `unresolved`（NodeResult 字段待新增） |

---

## 十五、Agent 双向交互

```
❌ 禁止：Agent 直接调用其他 Agent（绕过 Scheduler）
❌ 禁止：Agent 直接修改其他 Agent 的 TaskNode
✅ 要求：所有 Agent 间交互必须通过以下标准通道
```

| 通道 | 状态 | 方向 | 说明 |
|------|------|------|------|
| **NodeResult** | ✅ 已实现 | Agent → TaskBoard | Agent 产出写入 TaskBoard（`{ nodeId, success, output, error? }`）。其他 Agent 通过 `TaskBoard.getNode(nodeId).results` 读取——不直连上游 Agent |
| **requestReplan** | ✅ 已实现 | Agent → MetaAgent（经 ReplanManager 中转） | 实际路径：失败节点 → `replanManager.enqueue()` → MetaAgent 异步生成替代方案。Agent 不满调度的合理出口 |
| **MemoryStore** | ✅ 已实现 | Agent → Agent（跨 run） | 记忆系统是跨 Agent、跨 run 的共享认知基础设施。Agent A 的发现可被 Agent B 在后续 run 检索到（宪法 §9.9 认知共享层） |
| **事件订阅** | ✅ 已实现 | Agent ↔ 管道组件（解耦） | PipelineObserver `on`/`emit` 实现发布-订阅解耦。SkillPipeline 订阅 NodeComplete 执行技能提取——Scheduler 不感知 SkillPipeline 存在 |
| **圆桌共识** | 📋 规划 | Agent ↔ Agent | `roundtableTemplates` 配置和独立测试脚本存在，但引擎主循环未集成。`PipelineEventType` 枚举中尚无 `roundtable.consensus_reached` 事件 |

**事件协议（已实现部分）**：

```
发布侧                        订阅侧
─────────────                 ─────────────
Scheduler._dispatchNode      → replanManager.enqueue()
  失败时                     → MetaAgent.requestReplan()

NodeComplete（Scheduler）    → PipelineObserver
  emit 后                    → SkillPipeline（技能提取）

scheduler.invariant          → SafeErrorReporter（安全上报）
  _violation
```

> **缺失路径（规划中）**：NodeComplete → MetaAgent 聚合汇总、roundtable.consensus_reached → DocGovernAgent 共识归档。

---

## 十六、MetaAgent 多元调度与思考逻辑

> ⚠️ 本章节为 MetaAgent 思考模式的**概念设计**——当前 MetaAgent 的调度和推理行为由 prompt 驱动，未实现配置驱动的策略切换。`cortex-agents.json` 中不存在 `metaAgent.strategies` 字段，`TaskNode` 中不存在 `strategy`/`reasoningMode` 字段。

### 16.1 调度思维模式（如何拆任务）——概念设计

| 模式 | 行为 | 适合场景 | 风险 |
|------|------|---------|------|
| **分解优先**（当前行为） | 先把任务拆到最细粒度再分配——构建完整 DAG 树，一次性发布 | 复杂多步骤任务，依赖关系明确 | 初始拆解不当则全局偏移 |
| **增量探索** | 先分配第一步，根据第一步产出决定第二步——DAG 逐步展开 | 不确定后续步骤的探索性任务 | 全局最优不可达 |
| **扇出聚合** | 同时启动多个 Agent 做同一件事，收束最佳结果 | 需要多视角验证（审查+自审视） | token 消耗高 |
| **降级止损** | 核心 Agent 不可用时自动替换为备选 Agent | 某种 Agent 类型实例配额耗尽 | 备选品质不如首选 |

### 16.2 推理思维模式（如何判断怎么做）——概念设计

| 模式 | 行为 | 适合场景 | 代价 |
|------|------|---------|------|
| **贪心**（当前行为） | 每步选当前最快完成的路 | 时间敏感的修复任务 | 可能非全局最优 |
| **穷举** | 枚举所有可行路径，比较后择优 | 架构重构、宪法修改 | token 消耗极高 |
| **保守** | 每步执行后验证，确认无误再继续 | 修改核心模块、安全敏感操作 | 慢 |
| **乐观** | 最大化并行，最后统一收束 | 独立子任务多、互不干扰 | 并行冲突风险 |

### 16.3 策略选择规则（概念设计——当前由 prompt 非配置驱动）

```
1. 默认行为：分解优先 + 贪心（当前 MetaAgent prompt 的实际倾向）
2. 安全敏感任务（tags 含 security/constitution/core）→ 倾向保守
3. 探索性任务（tags 含 exploration/research）→ 倾向增量探索
4. 多视角验证（tags 含 multi-perspective/review）→ 倾向扇出聚合
5. 资源不足（AgentPool 配额告警）→ 倾向降级止损
```

### 16.4 MetaAgent 自身约束

```
❌ 禁止：MetaAgent 在同一轮重规划中使用与上一轮相同的策略和输入复现失败
✅ 要求：每次调度决策必须记录：选了什么策略 + 为什么选（引用触发条件）
```

> 当前 MetaAgent 的策略选择能力由 system prompt 描述驱动，尚未实现 `cortex-agents.json` 配置驱动的强制策略切换。此节为演进方向声明。

---

> **此文件是 Cortex 的代码法典·治理篇——架构规范与 Agent 交互协议。**
> 
> **注入规则**：Scheduler / MetaAgent / AgentPool / DocGovernAgent / MemoryStore 相关 → 全量注入。CodeAgent / ReviewAgent / AnalysisAgent / InspectorAgent 等纯执行 Agent → 不注入治理篇。
> 
> **审查记录**：v1.1 经完整代码审查（2026-05-31），第十三至十六节已标注「已实现/规划」状态。v1.2 新增十七节架构定位矩阵。v1.3 九节补业界定位，新增十八节 Harness 四层架构、十九节技能系统闭环。
> 
> **宪法依据**：Cortex 概念顶层设计 v2.5.28——§3 系统架构 + §5 Agent 池 + §7 确认门 + §8 PipelineObserver + §10 记忆系统 + §11 治理层

---

## 十七、架构定位——Cortex 在业界矩阵中的位置

Cortex 的架构选择可在业界三维矩阵中定位。Agent 应理解这些选择，以便不误用不匹配的模式。

### 17.1 三维定位

| 维度 | Cortex 选择 | 业界备选（明确不采用） |
|------|-----------|---------------------|
| **协作模式** | **层级/主管模式**——MetaAgent（甘雨）是中央主管，分解任务、分发给下层专家 Agent | 对等网络（Swarm handoff）❌ / 群聊（AutoGen）❌ / 涌现共识 ❌ |
| **调度策略** | **编排 + 群调度**——Scheduler 中央编排拓扑排序，同层节点并行执行后聚合 | 拍卖竞标 ❌ / 自组织 ❌ / 合同网协商 ❌ |
| **循环范式** | **Plan-and-Execute + ReAct**——MetaAgent 先规划后执行，BrowserAgent 用 ReAct 自主操作 | 思维树 (ToT) 📋 / Reflection 自我反思 📋 / 自适应循环 📋 |

### 17.2 设计约束（从矩阵定位推导的禁止行为）

```
❌ 禁止：Agent 间直接交接任务（handoff）——Cortex 不是对等网络模式
❌ 禁止：Agent 绕开 Scheduler 自行认领 TaskNode——Cortex 是编排模式，非自组织
❌ 禁止：Agent 自行决定与其他 Agent 开启群聊讨论——圆桌共识由凝光主持，非自发对话
✅ 要求：所有任务分配必须经 MetaAgent 规划 → Scheduler 编排 → AgentPool.spawn() 分发
```

> **为什么选这套组合**：「主管 + 编排 + ReAct」是业界久经考验的稳健架构——主管保证方向不偏、编排保证资源不乱、ReAct 保证单点灵活。Cortex 不需要重新发明调度范式，它需要的是在此范式下做到极致。

---

## 十八、Harness——Agent 运行时架构

Harness 是 Agent 的「操作系统」——模型（Model）提供智能，Harness 提供运行环境。业界公式：**Harness = Agent - Model**。

Cortex 的 Harness 实现为四层架构，对应治理篇前面各节所描述的组件：

| 层 | 业界定义 | Cortex 实现 | 对应节 |
|---|---------|------------|-------|
| **Model Layer** | LLM 接入与适配 | `@cortex/llm` 的 `LlmAdapter` + DeepSeek 为主模型，通过 `cortex-agents.json` 按 Agent 类型配置模型选择 | — |
| **Executor Layer** | 沙箱化的工具执行 | Toolkit Sandboxing（宪法原则三）+ ConfirmGate 权限门控（§7.1 L0-L3 可逆性等级）——工具调用必须过确认门 | 八节 |
| **State Layer** | 持久化与状态管理 | TaskBoard（任务状态）+ MemoryStore（记忆四态）+ DocGovern（治理审计永久层） | 九节 |
| **Orchestration Layer** | 循环、调度、生命周期 | Scheduler（拓扑排序+群调度）+ MetaAgent（规划）+ AgentPool（生命周期状态机）+ ReplanManager（重规划） | 十、十三节 |

**Harness 的核心约束**：

```
✅ 要求：Agent 不直接访问 Model Layer——模型调用必须经 LlmAdapter 适配层
✅ 要求：Agent 的工具调用必须过 Executor Layer 的 ConfirmGate——不可绕过确认门
❌ 禁止：Agent 绕过 MemoryStore 直接操作底层存储（SQLite/文件系统）
✅ 要求：所有状态变更（任务状态/记忆写入/Agent 生命周期）必须在 State Layer 留痕
```

> Cortex 的 Harness 并非单纯的运行时环境。它将调度编排（Scheduler）、权限门控（ConfirmGate）、记忆治理（MemoryStore+DocGovern）深度耦合——这是 Cortex 不同于 LangChain/LangGraph 等框架的关键差异：**治理不是外挂的，是 Harness 的内建层**。

---

## 十九、技能系统闭环

Cortex 的技能系统实现了「使用 → 提炼 → 复用」的全自动闭环，技能文件存储在 `skills/` 目录，运行时通过 SkillRegistry 检索和匹配。

**闭环管线**：

```
LoopAgent 扫描对话/产出
  → skill-persister 提取可复用模式
  → 生成 SkillTemplate（JSON，含 pattern/metadata/triggers）
  → 写入 SkillRegistry
  → MetaAgent 在规划阶段检索匹配技能
  → 匹配到的技能注入 Agent 的 system prompt
  → Agent 执行中调用技能
  → 执行结果经 LoopAgent 再次扫描（闭环起点）
```

**技能文件结构**（以 `skills/skill-p*.json` 为例）：
- `pattern`：技能匹配的模式描述
- `trigger_keywords`：触发技能的关键词
- `agent_types`：适用该技能的 Agent 类型列表
- `prompt_extension`：注入 Agent system prompt 的内容
- `verified_at`：技能经交叉验证的确认时间

**注入规则**：

```
✅ 要求：技能只能通过 MetaAgent 在规划阶段注入——Agent 不得自行加载技能
✅ 要求：技能匹配依据 trigger_keywords ⊆ task.description 判定
❌ 禁止：Agent 运行时动态请求加载未在规划中分配的技能
```

> 技能的「闭环」意味着：每一次成功的执行都在为系统积累知识——这不是外部知识库，而是系统自身运行经验的结晶化。SkillRegistry 是 Cortex 的「肌肉记忆」。
