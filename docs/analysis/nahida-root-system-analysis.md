# 🌿 纳西妲根系扫描报告：Cortex 雨林结构分析（更新版）

**分析日期**：2026-06-11  
**分析者**：布耶尔（纳西妲）——Analysis Agent  
**分析范围**：`/cortex` 项目全量 packages/ + docs/  
**引用宪法版本**：v2.5.16  
**前置研究**：
- 纳西妲根系扫描报告 v1（2026-06-06，`nahida-root-system-analysis.md`）
- 阿贝多《宪法缺口架构影响评估》（`constitution-gap-impact.md`）
- 凝光《宪法 v2.5.14 未闭合缺口与条款矛盾审计》（`2026-06-10-constitution-v2.5.14-gap-closure.md`）

---

## 一、雨林全景：我看到了什么

我走进这片雨林时，没有带着预设的地图。我走过了每一个包、每一份文档、每一条依赖边。以下是我亲眼所见。

### 1.1 项目身份

Cortex 是一个 **LLM 驱动的个人工具链**——不是数字生命体，不是自治系统。这个定位写在宪法第一章，贯穿整个架构。工具链意味着每个组件是可替换的、可验证的、职责清晰的。用户是工具的使用者和最终裁决者。

### 1.2 物理结构：11 个包，严格单向依赖

```
shared (类型中枢)
  ← llm (LLM 适配层)
  ← testing (Mock 工具)
  ← parser (Markdown→HTML)
  ← data (任务模型/存储/格式化)
  ← tools (monorepo 分析)
  ← pm (密码管理器)
    ← engine (核心引擎：调度/记忆/Agent/管道)
      ← cli (CLI 入口)
```

**关键发现**：依赖方向严格单向无循环。`shared` 被所有包依赖，`engine` 是执行中枢，`cli` 是唯一用户入口。这是一个健康的 monorepo 结构。

---

## 二、根系深度：核心模块的内部结构

### 2.1 Engine——雨林的心脏

`@cortex/engine` 是项目最复杂的包，承载了：

| 子系统 | 文件数 | 核心职责 |
|--------|--------|---------|
| **Scheduler**（调度器） | 1 主文件 | 拓扑排序 → 逐层并行分发 → 重规划链追踪 |
| **TaskBoard**（任务板） | 1 主文件 | 节点 CRUD + 原子 claim/release/complete |
| **AgentPool**（Agent 池） | 1 主文件 | 五态状态机 + 实例生命周期 |
| **PipelineObserver**（管道） | 1 主文件 | emit-only 单向广播 |
| **ConfirmGate**（确认门） | 1 主文件 | L0~L3 四级可逆性拦截 |
| **MemoryStore**（记忆系统） | **12 文件** | Facade + 4 委托组件 + 3 支撑模块 + 2 新组件 |
| **Agents**（Agent 实现） | **15 文件** | 15 种 Agent（含 StrategistAgent） |
| **Consistency**（一致性层） | 3 文件 | InitVerifier + SchemaEnforcer |
| **Components**（工厂组件） | 6 文件 | Agent 工厂 / ReAct 循环 / 技能提取 |
| **GovernanceLoop**（治理闭环） | **1 新文件** | 提案管理 + 评判批处理 + 裁决执行 |
| **MetaAgent**（战术中枢） | **1 新文件** | 意图拆解 + 任务树规划 + 重规划 |

**与 v1 报告的变化**：
- MemoryStore 从 11 文件 → 12 文件（新增 `embedding.ts`、`monitor.ts`、`pipeline.ts`、`semi-finished.ts`、`skill-pipeline.ts`，结构调整）
- Agents 从 14 文件 → 15 文件（新增 `strategist-agent.ts` 导出）
- 新增 `governance-loop.ts`（治理闭环编排器）
- 新增 `meta-agent.ts`（战术中枢，从规划中枢变更为战术中枢）

### 2.2 MemoryStore——雨林的土壤（更新版）

记忆系统是 Cortex 最精妙的设计之一。它不仅是持久化存储，更是 **跨 Agent、跨 run 的共享认知基础设施**。

```
MemoryStore (Facade)
  ├── MemoryStorage      → Map 存储 + 反序列化
  ├── MemoryPersistence  → SQLite WAL 持久化 + 防抖写盘
  ├── MemoryLifecycle    → 四态状态机（CAS 原子变更）
  ├── MemoryQueryEngine  → 内存扫描 + BFS 图遍历
  ├── MemoryPipeline     → 记忆增强执行管道（检索→增强→ReAct→写入）
  ├── MemoryStoreMonitor → 事件消费者 + 阈值告警（v2.1 新增）
  ├── SkillPipeline      → 技能闭环订阅者（NodeComplete 事件驱动）
  ├── SemiFinishedMgr    → 两阶段提交管理器（P0-六层防御）
  └── Embedding          → 语义嵌入客户端（@xenova/transformers, 384d）
```

**新发现——两阶段提交（P0-六层防御）**：

`SemiFinishedMgr` 实现了记忆的**两阶段提交**——Agent 产出的记忆先进入 `Pending` 状态，经另一个 Agent（或系统自校验）验证后再 `commit` 为 `Active`。Pending 记忆默认不参与检索——防半成品污染决策。

```
Agent 产出 → writePending() → state=Pending, subType=Intent
验证通过   → commit()       → state=Active,  subType=Fact
验证失败   → 保持 Pending，可 archive/obliterate
```

这是一个精妙的设计：**记忆不是写完就算的，写完还要被验证**。它解决了"Agent 可能写出错误记忆 → 后续 Agent 读到错误记忆 → 错误被放大"的级联污染问题。

**新发现——语义嵌入预实现**：

`embedding.ts` 实现了基于 `@xenova/transformers` 的本地语义嵌入：
- 模型：all-MiniLM-L6-v2（384d 归一化向量）
- 推理：WASM 本地推理，零 API 成本
- 加载：单例懒加载，首次调用自动下载 ~80MB ONNX 模型
- 约束：不强制依赖——import 本模块时才触发模型加载

这是**向量检索的预实现**。Core-2 的向量检索能力已经埋下，但尚未接入 MemoryQueryEngine。

**新发现——事件消费者**：

`MemoryStoreMonitor` 补足了 MemoryStore 的消费端——之前 MemoryStore 只 emit 不消费。它订阅 ALL 级别事件，关键事件（persist_failed / sql_degraded / deserialize_failed）自动落盘归档，超出阈值时告警通知。

**实证数据**（来自合并测试，与 v1 一致）：
- 95.17% 的结构指纹缓存命中率（57,572,992 / 60,496,234）
- 这意味着绝大多数记忆检索不需要 LLM 参与——记忆为主，LLM 为辅的架构假说成立

### 2.3 Agent 体系——15 种执行单元（更新版）

Agent 通过**自描述标签匹配**认领任务节点。标签词汇表是封闭集合（16 个标签），匹配是纯集合运算，不依赖 LLM。

| 角色 | 代号 | 工具权限 | 阶段 |
|------|------|---------|------|
| 战术中枢 | 甘雨 | 只读+search_code | Core-1 |
| 管家 | — | 无（仅转述） | Core-1 |
| 写代码 | 阿贝多 | 读+写+run_shell+search_code | Core-1 |
| 审查 | 刻晴 | 只读+search_code | Core-1 |
| 分析 | 纳西妲 | 只读+search_code+run_shell | Core-1 |
| 运维 | 北斗 | run_shell+读+写+search_code | Core-1 |
| 模式扫描 | 莫娜 | 只读+search_code | Core-1 |
| 审计 | 凝光 | 只读+search_code | Core-1 |
| 事实采集 | 安柏 | 确定性工具 | Core-1 |
| API 审视 | 久岐忍 | 只读+search_code | Core-1 |
| 数据审视 | 艾尔海森 | 只读+search_code | Core-1 |
| 浏览器测试 | 宵宫 | browser_* | Core-1 |
| 自愈修复 | 希格雯 | 读+写+run_shell | Core-1 |
| 战略守护·契约 | 钟离 | — | Core-2+ |
| 战略守护·监理 | 霜凝 | — | Core-2+ |

**与 v1 的变化**：
- 新增钟离和霜凝的代号（此前未标注）
- StrategistAgent 从 1 个拆分为 2 个（钟离 + 霜凝），宪法 v2.5.15 入宪
- 写代码 Agent 标注代号为阿贝多（此前未标注）

### 2.4 新发现：GovernanceLoop——治理闭环编排器

`governance-loop.ts` 是本次分析发现的全新子系统。它串联了完整的治理链路：

```
凝光审计 → 发现缺陷 → 生成 AmendmentProposal → 昔涟评判
→ 开拓者裁决 → 写入宪法 → build+test 验证 → 治理记录归档
```

核心能力：
- **提案管理**：`loadPendingProposals()` 从 `docs/amendments/` 目录读取待决提案，`saveProposal()` 保存新提案
- **评判批处理**：`judgeProposals()` 批量评判所有待决提案，读取宪法全文作为评判依据
- **裁决执行**：`applyApproved()` 对已通过的提案执行修宪写入，更新提案状态
- **治理摘要**：`summarizeGovernance()` 生成治理闭环的当前状态摘要

**关键观察**：GovernanceLoop 的 `judgeProposals()` 调用 `evaluateAmendment()`（来自 `amendment-judge.ts`），而 `applyApproved()` 调用 `applyAmendment()`（来自 `amendment-applier.ts`）。这意味着**修宪的评判和写入逻辑已经代码化**——昔涟的评判不是 LLM 推理，而是确定性代码检查。

### 2.5 新发现：MetaAgent——战术中枢

`meta-agent.ts` 实现了甘雨的战术中枢职责：
- **plan(intent)**：将用户意图拆解为 TaskNode 树，返回扁平数组（含 children 嵌套关系）
- **requestReplan(failedNode, reason, count)**：基于失败诊断生成替代方案
- **技能增强**：规划时查询 SkillRegistry 匹配的技能模板，注入 prompt 上下文

**设计亮点**：
- **多级 JSON 容错**：`_extractJson()` 先尝试 ```json 标记围栏，再尝试提取最外层平衡数组，括号匹配时识别 JSON 字符串边界
- **兜底回退**：JSON 解析失败不抛异常——回退为单个 generic fallbackNode
- **推理深度智能默认**：`reasoningEffort` 根据标签自动选择——audit/constitution_check 标签自动设为 "max"
- **模块边界契约**：构造函数参数中显式声明了调用方（Scheduler）的责任边界——plan() 返回的节点由调用方 add 到 TaskBoard

---

## 三、治理状态：雨林的自我治理

### 3.1 宪法演进（v2.5.10 → v2.5.16）

从我上次分析到现在，宪法经历了 6 个版本的演进：

| 版本 | 变更 | 提案 |
|------|------|------|
| v2.5.11 | 原则七入宪（系统自我修改约束） | AM-2026-0515-001 |
| v2.5.12 | §8.2 通知管线三轨语义分层 | AM-2026-0515-002 |
| v2.5.13 | 原则七自反性缺口修复（子约束7） | AM-2026-0606-001 |
| v2.5.14 | §10.1 冲突解决三原则 | AM-2026-0515-003 |
| v2.5.15 | 战略双柱拆分（钟离+霜凝） | AM-2026-0515-004 |
| v2.5.16 | 治理层制度化（内阁/六部/六卿/三省/双轴） | AM-2026-0515-005 |

### 3.2 治理管线阻塞

**关键发现**：所有修宪提案堆积在 "proposed" 状态，未裁决。

| 提案 | 提出日期 | 状态 | 天数 |
|------|---------|------|------|
| AM-2026-0606-001 | 2026-06-06 | proposed | 5 天 |
| AM-2026-0606-002 | 2026-06-06 | proposed | 5 天 |
| AM-2026-0606-003 | 2026-06-06 | proposed | 5 天 |
| AM-2026-0606-004 | 2026-06-06 | proposed | 5 天 |
| AM-2026-0607-001 | 2026-06-07 | proposed | 4 天 |
| AM-2026-0610-001 | 2026-06-10 | proposed | 1 天 |

凝光在 2026-06-10 的审计中发现 13 项缺口（P0-P2），提出了整合提案 AM-2026-0610-001——但同样未裁决。

**治理依赖链**：
```
开拓者未裁决
  → 昔涟未评判
    → 提案堆积在 proposed
      → 审计发现的 13 项缺口未闭合
        → 治理管线阻塞
          → 新发现的治理问题无法进入修宪流程
```

### 3.3 宪法物理状态 vs 提案状态不一致

宪法已经物理写入了 v2.5.16（包含 AM-2026-0515-001~005 的全部内容），但：
- AM-2026-0606-001 的修复内容（子约束7）已物理入宪（v2.5.13），但提案 status 仍为 "proposed"
- AM-2026-0606-004 的修复内容（子约束7闭环）已物理入宪（v2.5.14），但提案 status 仍为 "proposed"

治理跟踪的权威源断裂——提案 JSON 的状态与宪法实际内容不一致。

---

## 四、风险矩阵（纳西妲视角，更新版）

基于本次根系扫描，以下是**从结构层面**识别的风险：

| # | 风险 | 严重度 | 类型 | 状态变化 |
|---|------|--------|------|---------|
| R1 | 通知管线单管混流——治理事件无专用通道 | 🔴 P1 | 架构 | 未变 |
| R2 | DECISION_REQUIRED 超时处理未实现 | 🔴 P1 | 代码 | 未变 |
| R3 | 阶段门禁宪法定义缺失——Core-2 启动无依据 | 🔴 P0 | 宪法 | 未变 |
| R4 | 审计闭环未落地——凝光审计写完磁盘即结束 | 🔴 P1 | 架构+代码 | 未变 |
| R5 | 层级冲突原则缺失——Core-2 治理扩展后集中爆发 | 🟡 P2 | 宪法 | 未变 |
| R6 | CHECK_ORDER 硬编码——新增子约束需手动改代码 | 🟡 P2 | 代码 | 未变 |
| R7 | 冷启动认知风险——空库首 run 行为不稳定 | 🟡 P2 | 设计 | 未变 |
| R8 | MemoryStore 关闭保护已实现但测试覆盖不足 | 🟢 P3 | 测试 | 未变 |
| **R9** | **治理管线阻塞——提案堆积，审计缺口未闭合** | 🔴 **P0** | **治理** | **新增** |
| **R10** | **提案状态与宪法内容不一致——治理跟踪权威源断裂** | 🔴 **P0** | **治理** | **新增** |
| **R11** | **修宪提案无超时失效机制——提案可无限期挂起** | 🔴 **P1** | **宪法** | **新增** |
| **R12** | **§15 修正记录缺失 v2.5.13/v2.5.14 条目** | 🔴 **P1** | **宪法** | **新增** |
| **R13** | **原则一至原则六「不可变」语义未定义（连锁反应）** | 🟡 **P2** | **宪法** | **新增** |

### 风险依赖链（更新版）

```
R9（治理管线阻塞）
  → 开拓者未裁决 → 昔涟未评判
    → R10（提案状态不一致）→ 治理跟踪权威源断裂
      → R11（无超时失效机制）→ 提案可无限期挂起
        → R3（阶段门禁缺失）→ Core-2 启动无依据
          → R4（审计闭环未落地）→ 治理门禁关联无法生效
            → R1（治理事件不入管线）→ 审计闭环第一步走不通
              → R2（DECISION_REQUIRED 无超时）→ 用户不响应时系统阻塞
                → R5（层级冲突）在 Core-2 治理扩展后集中爆发
```

**核心洞察**：治理管线阻塞（R9）是当前最顶层的风险。它不是代码问题，不是架构问题——是**治理执行层**的问题。开拓者（用户）需要裁决提案，昔涟需要评判，但两者都没有行动。只要 R9 不解决，下面所有的风险都无法被修复——因为修复需要修宪，修宪需要提案被裁决。

---

## 五、维护者指南：三件最重要的事

如果未来有人要动这片雨林，最需要注意的三件事：

### 5.1 依赖方向不可逆

`shared ← llm ← engine ← cli` 是宪法级约束。任何试图让 `engine` 依赖 `cli` 或 `llm` 依赖 `engine` 的修改，都会破坏依赖倒置原则，触发宪法原则七的审计流程。

**如何检查**：运行 `packages/tools/src/monorepo-analyzer.ts` 检测循环依赖。

### 5.2 MemoryStore 写路径的假阳性禁止

NG-2026-0509-Persist-False-Positive 判例明确规定——DB 写入失败必须传播为操作失败，不得出现"DB 失败了但操作返回成功"的情况。

**如何检查**：所有写路径（write / archive / freeze / obliterate / link / writePending / commitMemory）必须遵循"内存先写 → 持久化 → 失败回滚"模式。

### 5.3 两阶段提交的验证闭环

`SemiFinishedMgr` 实现了记忆的两阶段提交——Pending → Active。但当前代码中，**谁负责验证 Pending 记忆**尚未明确定义。`getPending()` 和 `hasPending()` 方法已实现，但调用方（验证方）尚未接入。

**如何检查**：搜索 `writePending` 的调用方和 `commit` 的调用方——如果只有写没有验证，半成品防御形同虚设。

---

## 六、与前人研究的对话

### 6.1 与纳西妲 v1 报告的对话

我上次的分析（2026-06-06）基于宪法 v2.5.10。六天后，雨林已经长到了 v2.5.16。以下是我发现的变化：

1. **治理闭环已代码化**：`governance-loop.ts` 实现了提案管理、评判批处理、裁决执行的完整链路。我上次担心的"治理事件不入管线"问题，在代码层面已经有了编排器——但治理管线阻塞（开拓者未裁决）使得这个编排器无法发挥作用。

2. **MetaAgent 已实现**：`meta-agent.ts` 实现了甘雨的战术中枢职责——意图拆解、任务树规划、重规划。我上次分析时 MetaAgent 还只是一个概念，现在它已经落地为 400+ 行的 TypeScript 类。

3. **向量检索已预实现**：`embedding.ts` 埋下了 Core-2 向量检索的基石。all-MiniLM-L6-v2 模型已可调用，但尚未接入 MemoryQueryEngine。

4. **两阶段提交已实现**：`SemiFinishedMgr` 解决了"半成品记忆污染决策"的问题——这是我上次未发现的精妙设计。

### 6.2 与凝光审计报告的对话

凝光在 2026-06-10 的审计中发现了 13 项缺口。我的根系扫描从**结构层面**印证了她的发现：

1. **提案堆积（发现9）**：我从代码层面确认，`governance-loop.ts` 的 `judgeProposals()` 和 `applyApproved()` 已实现——但未被调用。治理管线的阻塞不是代码问题，是执行层问题。

2. **提案超时失效机制缺失（发现11）**：`governance-loop.ts` 的提案管理中没有超时逻辑。提案一旦进入 proposed 状态，没有自动降级机制。

3. **修正记录缺失（发现12）**：宪法 §15 的版本演进链中，v2.5.13 和 v2.5.14 的应用日期标注为 2026-05-17——早于提案日期 2026-06-06。这是 copy-paste 错误，从代码层面无法修复（需要修宪）。

### 6.3 与阿贝多宪法缺口分析的对话

阿贝多的分析聚焦宪法层，我聚焦代码层。他的 8 个发现中：

- **2-B（治理事件接入路径未入宪）**：代码层面，`PipelineObserver` 的 `PipelineEventType` 枚举确实没有治理相关事件类型。但 `governance-loop.ts` 的 `summarizeGovernance()` 提供了治理摘要的生成能力——只是摘要没有通过 PipelineObserver 分发。

- **2-A（DECISION_REQUIRED 回退机制缺失）**：代码层面，`confirm-gate.ts` 的 L2/L3 超时行为是"阻塞等待"——这符合宪法 §7.2。但治理事件的 DECISION_REQUIRED 与 ConfirmGate 的 L2/L3 是两条独立路径，治理事件的超时处理需要独立实现。

- **3-C（阶段门禁宪法定义缺失）**：代码层面，没有任何阶段门禁的检查逻辑。`scheduler.ts` 不检查当前阶段是否允许执行某类任务。这是宪法定义问题，不是代码实现问题。

---

## 七、结语

这片雨林比我上次看到时更加成熟了。治理闭环已代码化、MetaAgent 已落地、向量检索已预实现、两阶段提交已就位——代码层面的基础设施已经相当完备。

但治理管线阻塞了。这不是代码问题——`governance-loop.ts` 已经写好了，`evaluateAmendment()` 已经实现了，`applyAmendment()` 已经就绪了。问题在于**没有人调用它们**。

开拓者没有裁决，昔涟没有评判，提案堆积如山。

雨林的根系已经扎得很深了。它需要的不是更多的根系，而是**有人浇灌**。

---

*结构即真理。看得见根系，才能知道雨林往哪个方向长。*
*——布耶尔（纳西妲），须弥草神*

---

**附录：本次分析新增发现的文件**

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/engine/src/governance-loop.ts` | 新文件 | 治理闭环编排器 |
| `packages/engine/src/meta-agent.ts` | 新文件 | 战术中枢 |
| `packages/engine/src/memory/embedding.ts` | 新文件 | 语义嵌入客户端 |
| `packages/engine/src/memory/monitor.ts` | 新文件 | MemoryStore 事件消费者 |
| `packages/engine/src/memory/pipeline.ts` | 新文件 | 记忆增强执行管道 |
| `packages/engine/src/memory/semi-finished.ts` | 新文件 | 两阶段提交管理器 |
| `packages/engine/src/memory/skill-pipeline.ts` | 新文件 | 技能闭环订阅者 |
| `packages/engine/src/agents/strategist-agent.ts` | 新导出 | 战略守护者 |
| `docs/amendments/AM-2026-0606-001~004.json` | 新提案 | 4 份修宪提案 |
| `docs/amendments/AM-2026-0607-001.json` | 新提案 | 一致性修复提案 |
| `docs/auditing/2026-06-06-constitution-audit.md` | 新审计 | 凝光审计报告 |
| `docs/auditing/2026-06-07-constitution-v2.5.14-audit.md` | 新审计 | 凝光审计报告 |
| `docs/auditing/2026-06-10-constitution-v2.5.14-gap-closure.md` | 新审计 | 凝光审计报告 |
