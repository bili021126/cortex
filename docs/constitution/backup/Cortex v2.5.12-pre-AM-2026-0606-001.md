# Cortex 概念顶层设计 v2.5

**版本**：v2.5.12 → v2.5.11（AM-2026-0515-001：将六条不可变原则扩展为七条，新增原则七（系统自我修改的宪法约束），纳入六项子约束与首个判例；2026-05-17；来源：DocGovernAgent——自审视审计 2026-05-15——发现宪法缺少系统自我修改的约束框架。修宪管线已建成但无宪法层面的规则制约。） → v2.5.12（AM-2026-0515-002：新增 §8.2 通知管线条款——三轨语义分层（FYI/WARNING/DECISION_REQUIRED），ObservableEvent 新增 notificationType 字段，ButlerAgent 三路分发策略入宪；2026-05-17；来源：DocGovernAgent——治理闭环审查 2026-05-15——发现宪法 §8 缺少通知分发规则。ButlerAgent 的事件通知职责仅有模糊描述，缺乏宪法级分发契约。PipelineObserver 管道统一了事件采集，但未定义呈现规则。）
**状态**：Core-1 协约化与稳固化——物理归位收束（consistency/ 独立子目录 + memory/ 委托模式物理落地 + components/ 桶导出规范化 + Scheduler 技能管道订阅者化解耦）
**性质**：LLM 驱动的个人工具链——工程化宪法
**前置**：v1.1（大脑隐喻，已废弃）→ v2.0（工具链隐喻）→ v2.1（Core-1 物理落地）→ v2.2（Core-1 反思：Agent 扩展+权限集中+状态机）→ v2.3（Core-1 反思：记忆四态 CAS + HCA/CSA 注意力区分）→ v2.4（Core-1 终局反思：工程全量对账——SafeErrorReporter / AgentPool 权威源 / MemoryStore 安全写 / 编译时治理 / 阶段模型同步）→ v2.5（Core-1 自审视终局：软约束权限例外入宪 / DeepSeek 4.1 多模态预留 / 三轮圆桌审阅 / 自审视委员会主体地位确认）→ v2.5.1（Agent 阶段归属修宪：StrategistAgent 明确 Core-2+ 预留，barrel 归位 / 数据库升级裁定：better-sqlite3 留 Core-1d）→ v2.5.2（infra 拆解分析：LlmAdapter 独立 LLM 适配层入宪 / Toolkit+FileLockManager+CLIAdapter 归入基础设施 / 包结构 3→4）→ v2.5.3（原则六修订：Agent 圆桌协商常态化——多 Agent 并行产出须先经圆桌收束再呈用户裁决）→ v2.5.4（甘雨定位变更：MetaAgent 从规划中枢变更为战术中枢——甘雨负责战术调度"怎么拆怎么排"，钟离负责战略把关"方向对不对契约有没有破"）→ v2.5.5（技能机制预实现：SkillRegistry 类型+类落地 / 圆桌优化：材料清单制度化 + 归因分析无主题圆桌）→ v2.5.6（协约化与稳固化：包结构修正 + ApiAgent/DataAgent 升级 + 双轨协议入宪 + 圆桌优化入宪 + ci-gate 自声明入宪 + vitest.ci.config 消解 + llm 纳入 CI + 状态机噪音治理 + DB 清理边界确认 + GitHub Actions CI workflow）→ v2.5.7（记忆系统委托模式拆解：God Object→Facade + 7 组件族 / 管道去重：base-agent._executeWithMemory + _executeAndRemember → executeWithMemoryPipeline / 检索模板化：makeMemoryQuery 工厂 / 功能柱概念正式废止）→ v2.5.8（闭环协作实验实证增补：闭环协作模式从[设计]升级为[已验证] / §7.5 新增读取安全边界条款——read_file/search_code/list_files 在非隔离部署中必须实施路径越界防护 / §9.9 新增记忆认知共享层条款——MemoryStore 确认为跨 Agent、跨 run 的共享认知基础设施）→ v2.5.9（合并测试实证收束：包结构 4→9 + CLI 物理落地 + FixAgent/希格雯入宪 + 基础设施 CLIAdapter/@cortex/cli 关系澄清 + 记忆缓存 95.17% 实证 + 闭环自愈链路验证增强）

---

## 一、Cortex 是什么

Cortex 是一个 LLM 驱动的个人工具链。它以 MetaAgent 为战术中枢，以 11 种 Agent 为执行单元，以确认门和安全规则引擎为护栏，以管家为个人助手。

核心隐喻从 v1.1（大脑/神经系统）变更为**工具链**。工具链意味着：
- 每个组件是可替换的、可验证的、职责清晰的工具
- 不存在"数字生命体"的不可知性——每个行为可审计
- 用户是工具的使用者和最终裁决者

---

## 二、七条不可变原则

| 原则 | 内容 | 不可变性 |
|------|------|---------|
| **原则一** | 确认这个动作永远在用户手里。任何 L2/L3 不可逆操作必须经用户确认 | 不可变 |
| **原则二** | 规划与执行分离。MetaAgent 只规划不执行，Agent 只执行不规划 | 不可变 |
| **原则三** | 安全边界在 Toolkit 调用层。Toolkit 按 Agent 类型集中校验权限，Agent 以身份调用，不持有权限定义 | 不可变 |
| **原则四** | 谁调用谁负责。Agent 对其工具调用的后果承担全部责任 | 不可变 |
| **原则五** | 所有可观测事件走 PipelineObserver 统一管道。SafeErrorReporter 作为上层协议定义 fatal / degraded / silent 三档错误上报标准，杜绝静默吞错 | 不可变 |
| **原则六** | 用户是最终裁决者。多 Agent 并行产出须先经圆桌协商收束为统一视图，再呈用户裁决。Agent 之间协商不替代用户最终决策——用户始终保有否决权和最终裁量权 | 不可变 |
| **原则七** | 系统自我修改受宪法约束。Cortex 对自己的代码和文档的任何修改必须遵守以下六项子约束 | 不可变 |

### 原则七 六项子约束

1. **宪法依据**：修改必须显式引用目标宪法条款。提案须声明修改哪一条款、为何修改、修改后的文本。
2. **完整修改记录**：每一次修改必须记录——旧逻辑缺陷、新逻辑补足、涉及的文件与行号、执行者（Agent/人）、时间戳。修改记录写入治理分区（MemoryType.Governance）。
3. **最小改动**：仅修改必须改的那一行/段，禁止扩大修改范围。修宪提案的 before/after 差异必须精确——不允许顺手重构相邻段落。
4. **架构保护**：修改不得损害系统的拓展性、稳定性。必须保持抽象层级、接口契约与扩展预留。breaking change 需在 impact.breaking 中显式标记。
5. **独立审计与最终裁决**：修宪提案作为灰色议题——由凝光审计合规性，监理追踪执行，开拓者最终裁决（批准/驳回/修正）。凝光只提案不动宪法，昔涟评判不裁决，开拓者拍板。
6. **阶段限定**：仅限当前激活阶段内修改。禁止跨阶段修改预埋内容。阶段门禁（Core-1→Core-2 等）应作为修宪的硬截止线。

**首个判例（NG-2026-0515-Self-Modification）**：2026-05-15，凝光（DocGovernAgent）在自审视中发现宪法 v2.5.10 缺少系统自我修改的约束框架。生成修宪提案 AM-2026-0515-001，经昔涟评判（APPROVED，6 项检查全过），开拓者裁决通过，applyAmendment 写入宪法。新增原则七六项子约束。此判例作为原则七的首个引用案例，证明修宪自动化管线可在宪法约束下安全运行。

---

## 三、系统架构

```
Cortex
│
├── Engine (容器)
│   ├── MetaAgent (规划中枢)
│   ├── Agent池 (11 Agent)
│   ├── TaskBoard (任务板，并发控制)
│   ├── ConfirmGate (确认门)
│   ├── PipelineObserver (可观测管道 + SafeErrorReporter)
│   ├── ConsistencyLayer (P1-六层防御——记忆-现实一致性校验层 Facade)
│   │   └── 内部组件（consistency/ 子目录）
│   │       ├── InitVerifier (启动校验——遍历 Active 记忆校验文件引用一致性)
│   │       └── SchemaEnforcer (结构校验——写入输入的结构完整性校验 + 默认字段注入)
│   ├── MemoryStore (运行时记忆，30天窗口，委托模式 Facade——337行)
│   │   └── 内部委托组件（memory/ 子目录，8 组件族）
│   │       ├── MemoryStorage (Map 存储 + 反序列化)
│   │       ├── MemoryPersistence (SQLite WAL 持久化 + 防抖写盘)
│   │       ├── MemoryLifecycle (四态状态机：CAS / archive / freeze / obliterate)
│   │       ├── MemoryQueryEngine (内存扫描 + BFS 图遍历展开)
│   │       ├── MemoryPipeline (记忆增强执行管道：executeWithMemoryPipeline + makeMemoryQuery)
│   │       ├── MemoryStoreMonitor (事件消费 + 阈值告警)
│   │       ├── Schema (共享常量：SCHEMA_VERSION / LINK_WEIGHTS / FLUSH_DEBOUNCE_MS)
│   │       └── SkillPipeline (技能闭环订阅者——NodeComplete 事件驱动的技能提取+注册+持久化)
│   └── Scheduler (Agent 调度，拓扑排序 → 逐层并行，技能闭环已解耦为独立订阅者)
│
├── LLM 适配层 (独立于 Engine，在基础设施之上)
│   └── LlmAdapter (API 适配、缓存、重试、流式、指纹匹配)
│
├── 基础设施 (独立于 Engine)
│   ├── Toolkit (工具目录与权限校验)
│   ├── FileLockManager (文件级锁)
│   ├── CLIAdapter (CLI 平台桥接，实现 PlatformBridge——@cortex/cli 为具体 CLI 实现，独立于基础设施层)
│   ├── Core-2 预留：TrustModel (信任模型)
│   ├── Core-2 预留：Sentinel (安全规则引擎)
│   └── SkillRegistry (技能注册表——类型+类已预实现，Core-2 Full SkillExecutor 预留)
│
├── 管家 (独立进程，常驻)
│   ├── Core-2 预留：消息源插件
│   ├── Core-2 预留：周期性汇总简报
│   └── ConfirmGate 用户交互通道
│
└── 治理层 (高于工具链的自律框架)
    ├── 宪法 (本文档——国家结构)
    ├── 治理层设计 (配套政府设计文档)
    ├── DocGovernAgent (自动审计引擎)
    ├── 阶段门禁检查表
    └── DocGovern 分区 (永久审计记录)
```

> **治理层定位**：治理层不参与工具链执行循环。它高于工具链，负责审计、审查和裁决。宪法定义国家结构（大脑），治理层设计定义政府运行方式。委员会体系、纪检委监督链、监理封驳权等政府机制见配套文档 [`治理层设计`](./core/治理层设计.md)。

> **物理包结构（v2.5.9）**：9 个包，严格依赖倒置单向无循环。
>
> | 包 | 职责 | workspace 依赖 |
> |---|------|---------------|
> | `@cortex/shared` | 全部类型定义 + SafeErrorReporter 协议 + Toolkit / FileLockManager / CLIAdapter 基础设施 | 无 |
> | `@cortex/parser` | Markdown→HTML 解析器，零运行时依赖 | 无 |
> | `@cortex/pm` | 密码管理器 (AES-256-GCM)，零 workspace 依赖 | 无 |
> | `@cortex/data` | 数据处理层（Task 模型 / 存储适配器 / 格式化器），零 workspace 依赖 | 无 |
> | `@cortex/tools` | monorepo 分析工具（monorepo-analyzer / configuration-drift），零 workspace 依赖 | 无 |
> | `@cortex/llm` | LLM 适配层：LlmAdapter——API 适配、缓存、重试、流式、指纹匹配 | shared |
> | `@cortex/engine` | Engine 执行引擎：Scheduler / MemoryStore / AgentPool / PipelineObserver / ConfirmGate / MetaAgent / 全部 Agent | shared, llm |
> | `@cortex/cli` | CLI 命令行工具（md-to-html），Markdown→HTML 命令行转换器 | parser |
> | `@cortex/testing` | Mock 基础设施 | shared |
>
> 依赖方向：shared ← (llm / testing / parser / pm / data / tools)，llm ← engine，parser ← cli。`@cortex/infra` 包在当前代码中实际不存在——Toolkit/FileLockManager/CLIAdapter 归于 shared 层，infra 独立拆分留待 Core-2。Meso-Lite 中曾独立存在的 `@cortex/memory`、`@cortex/meta-agent`、`@cortex/scheduler`、`@cortex/doc-govern` 四个包已删除，功能并入 engine。

---

## 四、MetaAgent——战术中枢

策与执之间唯一的战术调度层。职责：

1. **拆解**：用户意图 → 拆解为任务树节点 → 发布到 TaskBoard
2. **标注**：为每个节点打 `type` + `tags` 标签，Agent 据此自描述匹配
3. **仲裁**：Agent 执行失败 → requestReplan(nodeId, reason) → 修改受影响节点
4. **聚合**：多 Agent 并行产出 → 聚合为统一视图 → 交管家呈现
5. **重规划**：最多 3 轮，超限交用户裁决

MetaAgent **不做**：不调用工具执行任何操作，不替用户做最终决策，不自行修改 Agent 产出。

> **战术 vs 战略分工**：甘雨（MetaAgent）负责战术调度——"这个需求拆成几个任务、怎么排顺序";钟离（StrategistAgent）负责战略把关——"这个方向对不对、架构契约有没有破坏、长期会出什么问题"。战术回答怎么执行，战略回答该不该执行。

---

## 五、Agent 池——11 种执行单元

Agent 定义：**扫描 TaskBoard → 自描述匹配节点标签 → 认领 → 执行 → 产出 NodeResult**。

Agent 池按复杂度伸缩：简单项目仅注册 CodeAgent 即为单 Agent 全栈模式；复杂项目全量注册即为多 Agent 专业化分工。

### 5.1 Agent 类型

| Agent | 允许工具 | 认领标签 | 模式 | 落地阶段 |
|-------|---------|---------|------|---------|
| **MetaAgent** | 只读+search_code | 战术中枢，不认领任务节点 | 常驻 | Core-1 |
| **ButlerAgent** | 无（仅转述，不调工具） | 不认领节点 | 常驻 | Core-1 |
| **CodeAgent** | 读+写+run_shell+search_code | 见标签词汇表 | 按需唤醒 | Core-1 |
| **ReviewAgent** | 只读+search_code | 见标签词汇表 | 按需唤醒 | Core-1 |
| **AnalysisAgent** | 只读+search_code+run_shell | 见标签词汇表 | 按需唤醒 | Core-1 |
| **OpsAgent** | run_shell+读+写+search_code | 见标签词汇表 | 按需唤醒 | Core-1 |
| **LoopAgent** | 只读+search_code | 见标签词汇表 | 按需唤醒 | Core-1 |
| **DocGovernAgent** | 只读+search_code | 见标签词汇表 | 按需唤醒 | Core-1 |
| **InspectorAgent** | tsc+madge+AST+grep（确定性工具，非 LLM 推理） | inspector_* | 按需唤醒 | Core-1 |
| **ApiAgent** | 只读+search_code | api, api_design, api_integration, endpoint | 按需唤醒 | Core-1（审视参与） |
| **DataAgent** | 只读+search_code | data, data_model, migration, storage, schema | 按需唤醒 | Core-1（审视参与） |
| **BrowserAgent** | browser_*+read_file+search_code | browser_test/ui_test | 按需唤醒 | Core-1 |
| **FixAgent** | 读+写+run_shell+search_code | fix, bugfix, repair, patch | 按需唤醒 | Core-1 |

> **FixAgent（希格雯）**：代码已实现（`packages/engine/src/fix-agent.ts`）——类型已定义、AGENT_TAGS 已配置、barrel 已导出。在合并测试（`merge-from-solo-flight.ts`）中，希格雯成功修复了刻晴审查发现的全部 24 个缺陷，验证了五层闭环（审查→诊断→修复→测试→验证）的完整链路。修复逻辑基于刻晴审查报告中的缺陷编号，逐项定位源码→应用修复→验证闭合。
>
> **Core-1 审视参与**：ApiAgent（久岐忍）和 DataAgent（艾尔海森）代码已实现、类型已定义、AGENT_TAGS 已配置、barrel 已导出。两轮自审视中两者均成功完成审视任务（API 契约设计 / 数据层设计）。在常规任务调度中参与标签匹配，在圆桌中入席发言。不属于启-2 预留。
>
> **Core-2+ 预留**：StrategistAgent（钟离）——战略 MetaAgent，契约守护者。职责为阶段跃迁判定（Core-1→Core-2）+ 长期架构方向评估。代码已实现、类型已定义、barrel 已导出——但不注册 Scheduler、不参与自动调度。仅在 Core-2 启动后显式激活。导出无害：它是未来的地基，提前暴露便于圆桌引用和手动验证。
>
> **OpsAgent（北斗）职责扩展**：除已有 ops/deploy 标签对应的运维操作外，北斗承担测试完备性与适配性检测职责。跑测试不仅是执行，还包括审查测试本身的覆盖完整性（核心路径/边界条件/失败路径）和适配性（代码变更后测试是否同步跟进）。此职责通过 `test` 标签触发——MetaAgent 为测试质量检查类节点同时打 `test` 和 `ops` 标签即可匹配北斗。

Agent 类型按权限边界划分。权限表集中在 Toolkit 层（`AGENT_TOOL_PERMISSIONS`），Agent 以类型身份调用，不自行定义工具白名单。

标签词汇表为封闭集合，匹配规则见 `Agent标签词汇表-v2.0.md`。

### 5.1.1 自审视模式权限例外

**原则**：自审视是元系统对自身的审查。当 Cortex 审视自身代码时，常规权限边界与审查需求存在天然矛盾——ReviewAgent 没有 `write_file` 就无法产出审查报告，InspectorAgent 没有 `run_shell` 就无法搜索全量目录树。

**条款**：

| 项目 | 常规模式 | 自审视模式（`--soft`） |
|------|---------|----------------------|
| Agent 工具权限 | 宪法 §5.1 表所示 | 临时提升至 `FULL_TOOLSET` |
| 写入路径 | 全局受限 | 硬约束于 `test-output/self-examination-soft/` |
| 源码修改 | 不允许 | 不允许（只读） |
| run_shell | 部分 Agent 无 | 全开放（构建/测试/诊断必需） |
| 生效范围 | — | 仅自审视脚本运行期间，不写入 Agent 配置文件 |

**归因**：凝光（DocGovernAgent）在自审视审计中发现了 5 项文档-代码权限偏差（D-01~D-05，见凝光治理审计报告 §3.1.3）。经归因分析确认：这不是宪法与实现不一致的 bug，而是元系统自审视的天然需求——审视工具和限制工具是同一把扳手，镜子照镜子时镜子不能先把自己涂黑。

**保障**：自审视结束即恢复常规模式权限。此例外不构成先例——常规运行时 Agent 权限仍严格遵循 §5.1 权限表。

### 5.1.1bis 软约束/硬约束双轨协议

**原则**：自审视支持两种约束模式——硬约束（`--hard`，默认）与软约束（`--soft`）。硬约束以现存共识清单为强制基线，逐项验证修复闭合；软约束取消预设清单，Agent 自由探索，从自由发现中驱动共识分类。双轨互补——硬约束防退化，软约束发现盲区。

**条款**：

| 维度 | 硬约束（默认） | 软约束（`--soft`） |
|------|--------------|-------------------|
| Phase 0 基线 | 读取上轮共识清单作为强制验证基线 | HCA 预读上轮共识清单仅作参考锚点，不强制对照 |
| Agent 探索方向 | 按 verification-templates.json 预设模板逐项验证 | 按 verification-templates-soft.json 自由探索，无预设待办清单 |
| Phase 5 圆桌注入 | 报告摘要写入 MemoryStore 种子记忆，圆桌 Agent 从 MemoryStore 回溯 | 报告摘要直接拼入 topic 字符串注入，不经过 MemoryStore 中转 |
| 圆桌产出 | 对照清单逐项判定闭合/遗留/新增 | 自由发现经交叉表态→凝光分类收束→P0-P3 共识清单 |
| 共识基线 | 上轮清单为强制锚点——闭合项不得重新列出 | 无强制基线——本轮圆桌产出即为下一轮硬约束的基线 |

**归因**：硬约束模式的"逐项对照"能发现"宣称已修复但实际未修"的偏差，但前提是清单本身覆盖了所有已知问题。软约束模式取消预设清单，释放 Agent 的发现自由度——让盲区自己浮现。两者形成闭环：软约束发现新问题→写入共识清单→下一轮硬约束逐项验证。

**选择规则**：默认硬约束。以下场景使用软约束：（1）首次自审视——无现存清单可对照；（2）怀疑清单本身有盲区——需要自由探索补充发现；（3）架构评估——不适用逐项 checklist 的开放性审视。

### 5.1.2 圆桌会议材料清单与无主题会议

**原则**：圆桌会议的价值取决于入席者看到什么材料。材料不全的会议产出不可靠。

**条款**：

| 机制 | 说明 |
|------|------|
| 材料清单（MaterialChecklist） | 每次圆桌启动前，凝光按 [`MATERIAL_CHECKLIST`](./packages/engine/tests/manual/config/roundtable-config.ts) 校验材料完备性。缺失必需材料（required=true，如 Agent 审视报告、根因归簇分析报告、宪法全文）则阻断会议，缺失可选材料则标记警告。清单版本化管理——每次圆桌后按需更新。 |
| 归因分析圆桌（第二阶段·无主题） | 与标准三轮圆桌（有预设议题、分类决策）不同——本会议不设固定议题。材料为 AI 归因引擎产出的根因归簇分析报告 + 钟离战略评估报告。Agent 从归因报告中自由提取讨论点——可以深入任一归因簇、质疑归簇逻辑、发现跨簇关联。唯一硬约束：发言必须有据——引用归因报告发现编号或审视报告原文。凝光不引导方向，动态记录共识点/分歧点，讨论自然收束后输出「归因共识纪要」。 |
| 会议不设主题 | 归因分析圆桌不预设「待分类项」、不强制「必修/延后」判断。Agent 的发言方向由归因报告的内容驱动，不由议题框架驱动。凝光在此阶段不充当议题设定者——仅充当记录者和共识收束者。 |

**归因**：审视报告堆积了 206+ 条发现——仅通过第一轮圆桌的「逐项分类」无法看清根因结构。AI 归因引擎跨报告去重归簇，产出 6 个根因簇地图——但这张地图本身需要审视委员会集体验证和修正。无主题会议给了 Agent 不被议题框架限制的自由度，让他们能从根因层面重新审视第一轮圆桌的结论。

**与第一轮圆桌的关系**：第一轮圆桌（软约束共识圆桌）产出 P0-P3 修复清单——按发现逐项定级。归因分析圆桌产出归因共识纪要——对根因地图的集体确认或修正。两者的产出互相独立但互相参照：纪要可以标记修复清单中「治标不治本」的项，修复清单可以引用纪要中的根因作为定级依据。

**单轮合并优化**：软约束共识圆桌原为三轮（发现陈述→交叉验证→凝光收束），实际运行中合并为单轮——发现陈述、交叉表态、凝光收束在同一轮内依序完成（minTurns: 3, maxTurns: 5）。此优化的配套机制：
- DSA 门控：`queryMode: "hca"` 控制圆桌 Agent 的记忆检索广度，避免发言上下文膨胀
- Between-round context reset：每轮收束后将实质发言压缩为 Conceptual 记忆摘要（HCA weight=4），清空 Episodic 堆栈——防止跨轮记忆污染
- 共识晋升：凝光收束发言经 `extractConsensusItems` 解析为 P0-P3 条目 → 写入 Conceptual 记忆（P0 weight=10, P1=8, P2=6, P3=4），链接 DerivedFrom（凝光发言）和 ConfirmedUseful（全体参会 Agent 末轮发言）——形成 FSA 闭环
- BrowserAgent 移除：软约束圆桌不再包含 BrowserAgent（宵宫），入席者 12 人（刻晴/阿贝多/纳西妲/凝光/莫娜/安柏/北斗/久岐忍/艾尔海森/甘雨/托马/钟离）

### 5.2 Agent 状态机

```
Created → Awake → Active → Awake → ... → Draining → Destroyed
  │        │        │                   │
  │        │        │                   └─ shutdown() 开始
  │        │        └─ execute() 执行中
  │        └─ wakeup() 完成，等待任务
  └─ 构造完毕，未唤醒
```

| 状态 | 含义 | 可接收 execute？ |
|------|------|----------------|
| Created | 实例存在，未建立 LLM 连接 | 否 |
| Awake | 已唤醒，Toolkit 注入完毕，等待任务 | 是 |
| Active | 正在执行 | 否（已在执行中） |
| Draining | 正在关闭，完成当前事务后退出 | 否（拒绝新请求） |
| Destroyed | 已销毁 | 否 |

**AgentPool 单一权威源**：Agent.status 读写必须委托 AgentPool。Agent 不自行修改 status。AgentPool 持有 `VALID_TRANSITIONS` 表驱动校验合法流转边。非法流转触发 `observer.emit('scheduler.invariant_violation', CRITICAL)`，由 SafeErrorReporter 上报。

**唤醒策略**：
- 常驻（始终 Awake）：ButlerAgent、MetaAgent
- 按需唤醒（有匹配标签时 wakeup，干完 shutdown 回 Created）：CodeAgent、ReviewAgent、AnalysisAgent、OpsAgent、LoopAgent、DocGovernAgent、InspectorAgent、BrowserAgent
- AgentPool.spawn() 创建 Created 实例 → Scheduler 发现标签匹配 → wakeup() → execute() → shutdown() 回到 Created

### 5.3 自描述匹配

Agent 自描述为固定标签集。匹配规则：`node.tags ∩ agent.tags ≠ ∅` → 匹配。无 Agent 匹配 → MetaAgent 告警，重新打标签或拆节点。

### 5.4 并发控制

- TaskBoard.claim() 原子操作：已认领节点拒绝再次认领
- FileLockManager：写锁排斥所有读写锁，读锁可共存
- L2/L3 确认等待期间**不持文件锁**
- Scheduler：每种 Agent 类型保留至少 1 个实例配额，防饥饿

---

## 六、ButlerAgent（管家）——唯一用户交互出口

Agent 池正式成员，`AgentType.Butler`。常驻 Awake，不认领任务节点，不调用工具。

### 6.1 五大法定职责

| # | 职责 | 说明 |
|----|------|------|
| ① | 唯一交互出口 | 所有 Agent 输出、ConfirmGate 请求、MetaAgent 结果、PipelineObserver 通知 → ButlerAgent 格式化 → 呈现用户。用户输入 → ButlerAgent 接收 → 路由 |
| ② | 决策中转 | InspectorAgent 事实报告 → ButlerAgent 解释为可理解选项 → 用户选择 → 归档 DocGovernAgent |
| ③ | 闲时采集 | 管线空闲时自然对话。聊到项目 → 决策原因归档。聊到技术 → Agent 互相争论 → 用户旁听学习 |
| ④ | 事件通知 | Agent 状态变更 → 状态灯刷新。管线事件 → 必要时打断（失败/确认需求）或静默通知 |
| ⑤ | 入口适配 | 无项目：全屏对话入口。有项目：IDE 三栏布局（文件树+编辑器+对话面板） |

### 6.2 非其职责

不创造、不审查、不部署、不审计。只转述、解释、采集、通知。

### 6.3 消息源插件（Core-2 预留）

管家支持插件化个人域消息源（邮箱/RSS/GitHub通知等），个人数据存入管家专用存储区，不入 MemoryStore。**Core-1 未实现**，纳入 Core-2。

### 6.4 崩溃降级

管家崩溃 → Engine 继续运行 → 用户通知降级为 stdout 原始输出 → 管家恢复后批量补推。

---

## 七、确认门与安全

### 7.1 可逆性等级

| 等级 | 定义 | 确认要求 |
|------|------|---------|
| L0 | 纯读取 | 永不确认 |
| L1 | 可逆写入 | TrustLevel ≥ L3 放行，否则确认 |
| L2 | 不可逆写入 | 永远确认 |
| L3 | 不可恢复 | 永远确认 |

L1→L2 升级：单次 >3文件 或 >100行 或命中风险文件名（secret/token/password/key/.env 等）。

### 7.2 ConfirmGate

Agent 调用工具 → ConfirmGate 拦截 → 查 TrustModel → 判定 → 如需确认则经管家弹窗 → 用户响应。

L2/L3 超时 = 阻塞等待（不替用户决策），L1 超时 = 默认拒绝。

### 7.3 TrustModel（Core-2 预留）

按 (Agent类型, 风险域) 二维聚合接受率。冷启动从 L1 起。疲劳确认防护、信任衰减、模型变更重置——**Core-1 未实现**，纳入 Core-2。

### 7.4 Sentinel（Core-2 预留）

安全规则引擎，4 种检测模式（不可逆未确认 / 异常事件高频 / 信任骤降 / 确认门冲击）。**Core-1 未实现**，纳入 Core-2。

### 7.5 读取安全边界（v2.5.8 新增）

纯读取操作（L0——`read_file` / `search_code` / `list_files` / `list_dir`）在闭域测试环境（E2E 沙箱）中可全域访问项目文件系统。但在任何**非隔离部署**（CLI / GUI / 管家常驻）中，L0 工具必须实施与写入同级的路径越界防护——**白名单制，默认拒绝越界访问**。

**实证依据**：2026-05 闭环协作实验（`closed-loop-collab.ts`）证实——Agent 可通过 `..` 或绝对路径穿出 `PROJECT_DIR`，以 `path.resolve(projectRoot, relativePath)` 解析读取任意文件系统路径。测试环境中此为意图内行为（Agent 需读取 `packages/` 源码进行跨包分析），但生产环境中同机制构成数据泄露向量。

**白名单范围**：
- `$PROJECT_DIR/**`（项目工作区）
- `$PROJECT_DIR/../packages/**`（monorepo 兄弟包，如存在）
- 拒绝：任何绝对路径指向项目外、任何 `..` 链超出上述范围

**适用边界**：此条款不约束闭域 E2E 测试脚本——仅约束用户可交互的部署形态（CLI/管家/Electron）。闭域测试中读取全域是实验设计的必要组成部分。

---

## 八、PipelineObserver——可观测管道

所有可观测事件走统一管道。

```
PipelineObserver {
  on(event, handler, priority)
  emit(event, payload, priority?)

  优先级:
    CRITICAL → 同步执行，立即持久化
    HIGH     → 异步优先队列, 批量 1s
    NORMAL   → 异步普通队列, 批量 5s

  数据结构:
    Observation { source, type, payload, timestamp, priority }
}
```

### 8.1 SafeErrorReporter——统一错误上报协议

建于 PipelineObserver 之上。三档严重性，杜绝静默吞错：

| 严重性 | 含义 | Pipeline 优先级 | 典型场景 |
|--------|------|----------------|---------|
| **fatal** | 操作失败，无法继续 | CRITICAL，立即 emit | DB 写入失败、状态机非法流转 |
| **degraded** | 操作部分成功，降级运行 | HIGH | SQL 回退到内存扫描、文件锁排队超时 |
| **silent** | 静默异常，自动追踪 | NORMAL（计数累加） | catch 块中无 emit 的吞错 |

**静默计数器自动升级**：同一 `(source, event)` 在一次执行中静默累计 ≥ 3 次 → 自动升级为 `degraded` 并 emit。防止隐蔽故障长期积累。

注入方式：`BaseAgent.setSafeReporter()` 和 `LlmAdapter.setSafeReporter()` 在 bootstrap 上层统一注入，所有 Agent 和 LLM 适配器共享同一安全上报通道。

### 8.2 通知管线——三轨语义分层

PipelineObserver 发出的事件经优先级分流后，进入通知管线进行语义分层。通知管线将事件按语义分为三轨，由 ButlerAgent 按轨执行不同分发策略。

| 轨道 | 语义 | 触发条件 | ButlerAgent 分发行为 |
|------|------|---------|---------------------|
| **FYI** | 信息通知 | NORMAL 优先级 + 非用户决策事件 | 静默记录→写入通知队列→闲时（管线空闲）合并摘要呈现 |
| **WARNING** | 警告通知 | HIGH 优先级 / 降级事件（degraded）/ 静默计数器升级 | 状态灯变更 + 通知面板标记，不打断当前操作 |
| **DECISION_REQUIRED** | 需要决策 | CRITICAL 优先级 / ConfirmGate 拦截 / MetaAgent 重规划超限 | 打断当前 UI→弹出决策界面→阻塞等待用户响应 |

**ObservableEvent 协议扩展**：`Observation` 数据结构新增可选字段 `notificationType?: "FYI" | "WARNING" | "DECISION_REQUIRED"`。emit 侧根据优先级和事件类型自动推导默认值，emitter 可显式覆盖。

**与 §6.1 的关系**：三轨语义分层是对 ButlerAgent 职责④（事件通知——"必要时打断或静默通知"）的具体化。此前"必要时"的判断标准模糊，现以语义三轨替代——DECISION_REQUIRED=必要打断，WARNING=必要通知但不打断，FYI=不必要立即通知。管家不再自行判断"是否必要"，而是按轨执行预定义分发策略。

**与 §8.1 的关系**：SafeErrorReporter 的三档严重性（fatal/degraded/silent）属于**错误维度**的分类——关注的是"系统哪里出了问题"。通知管线的三轨语义分层属于**呈现维度**的分类——关注的是"用户需要看到什么、何时看到、如何响应"。两者正交互补：
- fatal 错误通常触发 DECISION_REQUIRED（系统不可继续，用户必须决策）
- degraded 事件触发 WARNING（系统降级运行，用户应知晓）
- silent 计数器升级触发 WARNING（静默异常累积至阈值，升级告警）

**归因**：当前 PipelineObserver (§8) 统一了事件管道，SafeErrorReporter (§8.1) 统一了错误上报的三档严重性协议。但管道产出的通知如何按语义分发至 ButlerAgent 并呈现给用户，尚无法定条款。ButlerAgent (§6.1) 的"事件通知"职责（④）仅描述了"必要时打断或静默通知"，未提供具体分发规则。三轨语义分层将优先级语义、事件类型与 UI 行为绑定为宪法级契约——确保 CRITICAL 事件不会静默消失（自动升级为 DECISION_REQUIRED），NORMAL 事件不会打扰用户（归入 FYI 闲时呈现）。

---

## 九、记忆系统

### 9.1 四态生命周期

单向流转，不可回退：

```
Active → Archived → Frozen → Obliterated
  │                    │         │
  └────────────────────┘         │
  │                              │
  └──────────────────────────────┘
```

| 状态 | 含义 | 可检索 | 可关联 | 去向 |
|------|------|--------|--------|------|
| Active | 热记忆，30 天窗口内有效 | ✅ | ✅ | → Archived / Frozen / Obliterated |
| Archived | 已归档，移出热窗口 | ✅（states 显式指定） | ✅ | → Frozen / Obliterated |
| Frozen | 冻结，不再参与检索和规划 | 仅显式指定 | ❌ 新关联 | → Obliterated |
| Obliterated | 湮灭，不可逆终点 | 仅显式指定 | ❌ 新关联 | 无 |

流转规则：
- Active → Archived：`archive(id)` — CAS 保护
- Active|Archived → Frozen：`freeze(id)` — CAS 保护
- 任何非 Obliterated 态 → Obliterated：`obliterate(id)` — 不可逆，CAS 保护
- Obliterated → 任何态：永不允许
- Frozen / Archived → Active：不允许

### 9.2 CAS 原子状态变更

所有四态流转通过 `cas(id, expected, newState)` 原子比较并交换。单线程 JS 事件循环保证同步 `get()` → `set()` 之间无竞态窗口。

### 9.3 MemoryStore 委托模式安全写架构

MemoryStore 采用委托模式（Delegation Pattern）：对外保持单一 Facade API 不变，内部委托 4 个核心子组件各司其职。

```
MemoryStore (Facade, 337 行——原 950 行 God Object)
  ├── MemoryStorage      → Map 存储 + 反序列化
  ├── MemoryPersistence  → SQLite WAL 持久化 + 防抖写盘 + 生命周期
  ├── MemoryLifecycle    → 四态状态机（CAS 原子变更 + archive/freeze/obliterate）
  └── MemoryQueryEngine  → 内存扫描 + BFS 图遍历展开
```

各组件可独立测试、独立演进。向量检索引入时仅需改造 MemoryQueryEngine 一层——Storage/Persistence/Lifecycle 不受波及。

#### 委托组件职责边界

| 组件 | 职责 | 不负责 |
|------|------|--------|
| **MemoryStorage** | Map<id, MemoryEntry> CRUD、反序列化（JSON.parse 含错误处理）、链接管理（addLink/removeLastLink/getLinks）、快照（peek: structuredClone+deepFreeze） | 持久化、查询过滤、状态机 |
| **MemoryPersistence** | SQLite WAL 连接管理（init/open/close）、表创建、数据加载、防抖写盘（200ms + 指数退避，最大失败连续 3 次）、SQL 查询（仅返回原始行，反序列化由调用方负责）、访问追踪批量写、生命周期状态机（active/closing/closed） | Map 内存操作、反序列化、查询编排 |
| **MemoryLifecycle** | 四态转移规则校验（isValidTransition）、CAS 原子状态变更（含 persistFn 回调注入的持久化回滚）、archive/freeze/obliterate 便捷方法 | 持久化（通过 persistFn 回调由 MemoryStore 注入）、查询、BFS |
| **MemoryQueryEngine** | 纯内存扫描读取（memScanRead）、BFS 图遍历展开（bfsExpand：出边+入边广度遍历，decay=0.7^depth）、入边反向邻接表构建（buildReverseAdjacency） | SQL 查询（MemoryPersistence.sqlRead）、结果排序/限量（MemoryStore.read 编排） |

#### 生命周期状态机

MemoryPersistence 持有三态生命周期（与 MemoryStore 生命周期共享）：

```
active → closing → closed
```

- **active**：正常服务。所有读写路径开放。
- **closing**：正在关闭。拒绝新写入（observer emit memory.write_blocked 或 console.warn 兜底），等待进行中的写操作完成。
- **closed**：已关闭。所有路径拒绝。DB 连接已释放。

MemoryStore 通过 `_persistence.lifecycle` 读取当前状态，通过 `_persistence.close()` 触发状态流转。

#### 统一安全写入口

所有 DB 写入经过 MemoryPersistence.run(sql, params, opName)：

1. 检查 lifecycle：非 active → 拒绝写入（emit MemoryWriteBlocked 事件或 console.warn 兜底）
2. 执行 prepare().run()（better-sqlite3 v11+）
3. 失败处理：emit MemoryDbWriteFailed CRITICAL → rethrow → 调用侧回滚内存状态

不使用 observer.emit 直调——统一走 SafeErrorReporter。

#### 写路径 DB 失败回滚

MemoryStore 的 7 条写路径（write / archive / freeze / obliterate / link / unlink / 批量操作）遵循统一模式：

1. **内存先写**：先更新内存 Map（乐观写入）
2. **持久化**：通过 MemoryPersistence.run 写入 SQLite
3. **失败回滚**：run 抛异常 → 调用侧 catch → 内存状态回滚到写入前

此模式保证：DB 故障时，内存状态始终正确——不产生脏数据。

#### NG-2026-0509-Persist-False-Positive 判例

持久化操作不允许假阳性。若 DB 写入失败，操作必须传播为失败——不得出现"DB 失败了但操作返回成功"的情况。这是首条跨模块工程判例，所有持久化操作必须遵守。

### 9.4 HCA/CSA 注意力区分

| 模式 | 调用方 | 行为 | `trackAccess` |
|------|--------|------|---------------|
| **HCA**（高层次注意力） | MetaAgent 规划扫描 | 检索但不累加 accessCount，不刷新 lastAccessedAt | `false` |
| **CSA**（上下文选择注意力） | Agent 执行检索 | 检索并累加 accessCount，刷新 lastAccessedAt | 默认 `true` |

MetaAgent 规划时广度扫 50 条记忆，不等于 50 条都被用过。热度应反映 Agent 执行时的真实引用。

### 9.5 DocGovern 分区

持久化治理记录。DocGovernAgent 写入。存储：审计报告、规划审查记录、阶段门禁结论、宪法一致性检查记录。

### 9.6 管家存储

独立于 MemoryStore 和 DocGovern。存储：个人消息源数据、偏好配置、冷启动观察期数据。

### 9.7 记忆增强执行管道

Agent 执行时，记忆检索与写入遵循统一管道 `executeWithMemoryPipeline`：

```
检索记忆 → 增强上下文 → ReAct 执行 → 成功时写入记忆
```

**管道去重**：此前 base-agent.ts 中存在 `_executeWithMemory` + `_executeAndRemember` 两个私有方法（~80 行），与 `memory-pipeline.ts` 的 `executeWithMemoryPipeline` 功能完全相同。v2.5.7 将 base-agent 改为一律调用 `executeWithMemoryPipeline`，删除两私有方法——消除并行重复实现，base-agent.ts 从 206 行精简至 135 行。

管道位于 `memory/pipeline.ts`，接受 `ReActContext`（agentType / llm / toolkit / systemPrompt / maxLoops / memory）作为参数，无需实例化 Agent。

### 9.8 记忆检索策略模板化

新增 `makeMemoryQuery(node, opts)` 工厂函数，统一 11 个 Agent 的关键词提取逻辑：

```typescript
makeMemoryQuery(node, {
  memoryTypes: [MemoryType.Episodic],
  linkTypes?: LinkType[],
  bfsDepth?: 2,
  limit?: 5,
}) → MemoryQuery
```

各 Agent 覆写 `getMemoryQuery` 时可简化为调用 `makeMemoryQuery` + 自定义 opts，避免各处重复构造 MemoryQuery 对象。默认实现 `defaultMemoryQuery` 保留 CJK bigram + 拉丁词提取逻辑，向后兼容。

### 9.9 记忆认知共享层（v2.5.8 新增）

MemoryStore 不但是持久化存储层，也是 Agent 之间的**共享认知基础设施**——跨 Agent、跨 run 的知识在此沉淀、交叉引用、经受验证。

**实证依据**（2026-05 闭环协作实验，`closed-loop-collab.ts`）：

1. **跨 run 缺陷追踪**：刻晴（ReviewAgent）在 run-1 审查 `configuration-drift.ts` 时发现的 P0 trim 缺陷写入 MemoryStore；run-2 中同一 Agent 通过记忆检索召回该记录，对照当前代码判定"❌ 仍然存在"并附证据。希格雯（FixAgent）在 run-2 读取刻晴的审查记忆后应用修复，安柏（InspectorAgent）在后续 run 中验证闭合。

2. **知识继承与加速**：莫娜（LoopAgent）从代码库中提取的 15 种架构模式写入 MemoryStore 后，后续 Agent 无需重新扫描全库即可获取已确认的模式分析。这使认知成本随 run 数增长而**递减**——每次新 run 建立在所有前人的分析基础上，而非从空白开始。从成本视角看，这是一种**认知摊销**——首 run 高昂的分析成本被后续 run 的零成本经验继承所分摊。

3. **共识验证**：当多个 Agent 在不同 run 中交叉引用同一条记忆且验证结论一致时，该记忆的 weight 自然升高——记忆系统的图谱 BFS + 时间衰减机制在此形成**自动化的真理筛选**。被反复验证的记忆存活，孤立写入从未被回读的记忆自然衰减。

**与检索策略的关系**：四维检索（关键词 + 语义 + 图谱 BFS + 时间衰减）是这种认知共享的命脉。若无图谱 BFS 的方向控制，跨 run 引用会淹没在噪音中；若无时间衰减，早期孤立写入的错误记忆将持续污染新 run 的决策。检索策略不是性能优化——它决定了 Agent 在看到什么记忆后执行任务。看到什么，决定了做出什么。

**冷启动风险**：认知共享层的成立依赖记忆积累。全新项目（MemoryStore 空库）无跨 run 经验可继承，首个 run 的 Agent 行为不稳定，且该 run 产生的任何错误写入将构成后续 Agent 的"脏土壤"。冷启动治理（种子记忆注入、首 run 人工陪同验证）留待 Core-2。

### 9.10 合并测试实证——缓存命中率与闭环自愈（v2.5.9 新增）

**实证来源**：2026-05 合并测试（`merge-from-solo-flight.ts`）——9 Agent × 17 节点 × 10 层调度，从 3 个源（solo-flight 当前、solo-flight 归档、closed-loop-test 归档）合并代码至主仓，全程 ~70 分钟。

**缓存命中率实证**：

| 指标 | 数值 |
|------|------|
| 结构指纹缓存命中 | 57,572,992 / 60,496,234（95.17%） |
| LLM 调用次数（兜底） | 2,923,242 |
| 平均每 Agent 缓存复用 | ~6,397,000 次 |

这意味着：**95.17% 的记忆检索不需要 LLM 参与**——MemoryStore 的语义相似度匹配（结构指纹）独立完成了几乎全部的认知检索任务。LLM 仅作为兜底认知 oracle，在指纹无法匹配时才被调用。此数据实证了 Cortex 最核心的架构假说——**记忆为主，LLM 为辅**——在真实大规模多 Agent 协作场景中成立。

**闭环自愈链路实证**：

合并测试完整验证了五层闭环：

```
刻晴审查（24 缺陷） → 希格雯诊断（根因定位） → 希格雯修复（逐项 patch）
    → 测试验证（354 测试全绿） → 安柏最终验证（构建/测试/CLI/兼容性四维度）
```

修复结果：

- **24 个缺陷全部闭合**，涉及 engine 核心文件 6 个（memory-store.ts / react-helper.ts / strategist-agent.ts / confirm-gate.ts / pipeline-observer.ts / monitor.ts）及 shared 层 1 个（skill-registry.ts）
- **0 个修复引入的新缺陷**——354 测试在修复后全部保持绿色
- **closed-loop-test 目录删除**（23 文件，-5,341 行）——证明外挂测试已被 monorepo 原生测试体系完全吸收，不再需要独立测试项目

**与 v2.5.8 §9.9 的关系**：v2.5.8 的闭环协作实证（`closed-loop-collab.ts`）验证了单缺陷的跨 run 追踪与认知共享。v2.5.9 的合并测试实证更进一步——验证了**大规模多缺陷场景下的批量修复闭环**：24 个缺陷在单次调度中全部诊断、全部修复、全部验证闭合，且修复过程未引入新缺陷。这是闭环协作从"单缺陷单 run"到"多缺陷单 run 批量修复"的跃迁。

---

## 十、治理层

治理层是工具链的自律框架——不参与执行循环，高于工具链，负责审计、审查和裁决。

治理层的完整设计见配套政府设计文档：[`治理层设计`](./core/治理层设计.md)。本文档（宪法）定义国家结构（大脑），治理层设计定义政府运行方式。二者分属国家/政府两个层级——同一国家结构可承载不同政府形式，政府可演进，宪法不必改。

宪法仅在此章定义治理层与工具链的两个接口：
- **DocGovernAgent**：作为审计引擎的宪法地位，详见 5.1 Agent 类型表（Core-1 落地，三大审计节点：plan_review / doc_audit / constitution_check）
- **DocGovern 分区**：持久化治理记录的存储边界，详见 9.5

委员会体系（常设委员会=治理审计、临时委员会=执行裁决）、纪检委监督链、监理封驳权、四层逐级上报、MetaAgent 权力边界——均属于政府设计，定义在治理层设计文档中，不纳入宪法。

---

## 十一、任务流转

```
用户意图
  → MetaAgent 规划 → 打标签 → 发布到 TaskBoard
  → DocGovernAgent 审查规划 (如果是 plan_review 节点)
  → MetaAgent 修正（如需要）
  → Agent 扫描 TaskBoard → 自描述匹配 → claim 认领
  → Think→Act→Observe 循环
     → 工具调用 → ConfirmGate 拦截 → (如需确认) 管家弹窗 → 用户响应
     → FileLockManager 排队
  → 产出 NodeResult → MemoryStore
  → (如失败) MetaAgent.requestReplan → 重规划 → 重新发布
  → 管家汇总呈现
```

---

## 十二、技能记忆（Core-2 预留，预实现已完成）

LoopAgent 扫描已完成节点 → 发现可重复模式 → 生成 SkillTemplate → 写入 SkillRegistry。

MetaAgent 规划时检查 SkillRegistry：匹配当前节点的技能模板 → 标注 skillId。

试用期：自动沉淀技能默认试用，连续采纳 5 次自动应用，连续拒绝 3 次终止。

**预实现状态（v2.5.5）**：
- **类型定义**：[SkillTemplate](./packages/shared/src/agent.ts) 与 [SkillRegistry](./packages/shared/src/skill-registry.ts) 接口/类已落地 `@cortex/shared`。SkillRegistry 提供 register / unregister / queryByTags / queryByAgent 完整 CRUD。
- **验证模板**：[verification-templates.json](./packages/engine/tests/manual/config/verification-templates.json)（硬约束验证）与 [verification-templates-soft.json](./packages/engine/tests/manual/config/verification-templates-soft.json)（软约束探索）已在自审视脚本中通过 `templatesLoaded` 分支加载，覆盖 7-9 位 Agent 的验证/探索方向指引。
- **管道订阅者化（v2.5.10）**：技能提取与持久化已从 Scheduler 内嵌调用解耦为独立 PipelineObserver 订阅者——`registerSkillPipeline(observer, skillRegistry, memoryStore)` 订阅 NodeComplete 事件，任何 Agent 的成功输出均可触发技能提取。订阅者在 bootstrap 层注册，Scheduler 不感知技能闭环的存在。
- **待 Core-2**：SkillExecutor（步骤执行引擎 + 反馈闭环——连续采纳/拒绝自动升降级）、LoopAgent 自动技能沉淀管线。当前技能模板为人工维护 JSON，尚未进入自动提炼闭环。

---

## 十三、阶段模型

| 阶段 | 核心交付 |
|------|---------|
| **Nano+** | LLM→工具→确认门 单链路验证 |
| **Meso-Lite** | 多 Agent 协作 + Scheduler + 记忆检索 |
| **Meso 反思** | 全量审查 + 架构反思 + 宪法 v2.0 |
| **Core-1** | Engine 重构 + 10 Agent + MemoryStore + Scheduler + PipelineObserver + SafeErrorReporter（170+ 测试全通过，自审视 7 Agent 并行验证通过，P0 全部闭合） |
| **Core-2** | Sentinel + TrustModel + SkillRegistry + StrategistAgent（钟离，阶段跃迁判定）+ 向量检索 |

> **DeepSeek 4.1 多模态预留**：DeepSeek 4.1 预计 2026-06 发布，将支持多模态能力（图像/音频/视频理解）。Core-2 阶段需为此预埋伏笔：
> - BrowserAgent 将获得截图→视觉理解闭环（当前仅 DOM 操作）
> - InspectorAgent 可分析设计稿/架构图直译（当前仅文本 AST/grep）
> - 宪法 §八 PipelineObserver 事件 schema 需预留 `Observation.payloadType: "text" | "image" | "audio"` 字段
> - Agent 工具调用协议需支持 `image` 类型的工具输入参数
> - 多模态能力的具体落地范围与优先级，在 Core-2 启动前由自审视委员会三轮圆桌讨论收束

> **数据库升级（sql.js → better-sqlite3）裁定**：按议题五 Core-1d 规划，better-sqlite3 升级属于 Core-1 末尾步骤（在向量检索、Committee 三级收束、冻结/湮灭流转之后）。当前处于宪法债修复阶段（过度阶段→Core-1 之间），MemoryStore 基于 sql.js 的稳定性基线已通过自审视 7 Agent 并行验证（550s+ 全链路零崩溃）。升级前置条件：（1）向量检索 + Committee 收束 + 四态流转三项 Core-1 前置步骤全部达成；（2）出现 sql.js 可测量的性能瓶颈（BFS 三跳 P99 > 100ms 或写盘延迟 > 50ms）；（3）对比测试：sql.js 导出为 better-sqlite3 兼容格式 → 同等查询负载下验证延迟不高于 sql.js 基线。未满足前不提前升级。
| **Core-3** | 自迭代 + 跨会话连续性 + 冷启动退出 |
| **Full** | Electron 桌面 + Worker Threads + 完整功能 |

---

## 十四、附则：编译时治理

以下 ESLint 规则作为宪法工程化强制手段，违者编译不通过：

| 规则 | 级别 | 宪法依据 | 说明 |
|------|------|---------|------|
| `no-console` | warn | 原则五（可观测事件走 PipelineObserver） | console.log/warn/error 绕过统一管道，不允许 |
| `no-empty` | error | 原则四（谁调用谁负责） | 空 catch 块静默吞错，违宪 |

ESLint 是 TypeScript 运行时能在编译期做到的强制力上限——不能阻止 `import fs from 'fs'`，但能在 CI 中拦截可检测的违宪模式。

### 十四·一 测试门禁自声明

`scripts/ci-gate.ts` 实现了测试文件的动态分类与门禁自动化：

- **自声明机制**：每个测试文件在第一行注释中标注 `// @ci: unit | llm | integration | e2e | manual`，无标签默认视为 `unit`
- **动态扫描**：ci-gate.ts 自动遍历所有包的 tests/ 目录，按标签分类——`unit` 入 CI 门禁，`llm/integration/e2e/manual` 跳过
- **统一入口**：`pnpm ci`（标准门禁）/ `pnpm ci:all`（全量）/ `pnpm ci:dry`（干跑扫描）——本地与 CI 行为完全一致
- **门禁流程**：build → typecheck → test → lint，按依赖顺序逐包执行
- **职责分离**：GitHub Actions 负责触发（push/PR → `pnpm ci`），北斗（OpsAgent）负责 CI 失败后的诊断归因与修复分派——北斗不负责触发，她的战场在 CI 红了之后

---

## 十五、宪法修正记录

| 版本 | 主要变更 |
|------|---------|
| v1.0 → v1.1 | 国家/政府分层，八裂缝归入政府层 |
| v1.1 → v2.0 | **全面重写**：大脑隐喻→工具链，19柱→6Agent，事件总线→PipelineObserver，三省六部→治理层，交融→开会，8修宪条款消解为1 |
| v2.0 → v2.1 | Core-1 实施：包结构从 10 包精简为 3 包（shared/engine/testing），Scheduler 从基础设施移入 Engine，4 空壳包删除 |
| v2.1 → v2.2 | Core-1 反思：Agent 池从 6 种扩展至 12 种（Core-1 落地 8 种）；原则三修正为 Toolkit 集中管控权限；管家从独立进程改为 ButlerAgent 纳入 Agent 池；新增 Agent 状态机五态模型 |
| v2.2 → v2.3 | Core-1 反思：记忆系统新增四态生命周期（Active/Archived/Frozen/Obliterated）与 CAS 原子状态机；新增 HCA/CSA 注意力区分 |
| v2.3 → v2.4 | **Core-1 终局反思——工程全量对账**：原则五补充 SafeErrorReporter 三档错误上报协议（fatal/degraded/silent + 静默计数器 N=3 自动升级）；AgentPool 作为 status 单一权威源 + VALID_TRANSITIONS 表驱动；MemoryStore 新增生命周期状态机（active/closing/closed）+ `_safeDbRun` 统一安全写入口 + 7 写路径 DB 失败内存回滚 + NG-2026-0509-Persist-False-Positive 判例；系统架构图全量同步（ToolRegistry→Toolkit，Agent 数 6→10，TrustModel/Sentinel/SkillRegistry 标注 Core-2）；新增编译时治理（ESLint no-console/no-empty）；阶段模型测试数 58→170+；BrowserAgent 确认 Core-1 落地；治理层拆分——委员会体系/纪检委监督链/监理封驳权移入独立 [`治理层设计`](./core/治理层设计.md)，宪法第十章改为指针 |
| v2.4 → v2.5 | **Core-1 自审视终局修宪**：§5.1.1 新增自审视模式权限例外条款——自审视模式下 Agent 工具权限临时提升至 FULL_TOOLSET，写入硬约束于 test-output/self-examination-soft/，归因于元系统自审视的天然矛盾（凝光审计 D-01~D-05）；§十三 DeepSeek 4.1 多模态预留（2026-06 发布，多模态能力预理 PipelineObserver schema / 工具协议 / BrowserAgent 视觉闭环）；三轮圆桌代码审阅作为自审视标准流程入宪——每轮每人 5-7 次发言、必须收束结论、全部 10 位 Agent 作为圆桌主体参与、甘雨从 MetaAgent 秘书转为圆桌参与者；宪法版本号 v2.4→v2.5 |
| v2.5 → v2.5.1 | **Agent 阶段归属 + 数据库升级裁定修宪**：§5.1 Core-2 预留明确 StrategistAgent（钟离）为 Core-2+ 阶段预留——阶段跃迁判定+战略契约守护，Core-1 不导出、不注册、不参与调度；barrel 导出移除 StrategistAgent，仅保留 ApiAgent/DataAgent 为 Core-2 预埋。§十三阶段模型表 Core-2 行新增 StrategistAgent。§十三新增数据库升级（sql.js → better-sqlite3）裁定：升级留 Core-1d，前置条件为向量检索+Committee 收束+四态流转全部达成 + 可测量性能瓶颈出现。宪法版本号 v2.5→v2.5.1 |
| v2.5.1 → v2.5.2 | **infra 拆解分析 + LlmAdapter 独立层 + StrategistAgent 归位修宪**：§三系统架构新增 LLM 适配层——LlmAdapter 从 Engine 拆离为独立层，位于 Engine 之下、基础设施之上。理由：（1）零 Engine 运行时依赖——仅依赖 shared 类型 + node:crypto，与 Agent/Scheduler/MemoryStore 全部通过依赖注入松耦合；（2）稳定性需求——HTTP 重试策略、超时配置、缓存策略为关键基础设施，出 bug 影响全体 Agent；（3）优化独立性——缓存（exact vs fingerprint）、DeepSeek 模型切换（V4→V4.1）、流式协议变更迭代频繁，不应触碰 Engine。§三基础设施层新增 CLIAdapter（CLI 平台桥接），与 Toolkit/FileLockManager 并列。物理包结构 3→4：shared / infra / llm / engine / testing，依赖方向 shared ← infra ← llm ← engine ← testing。§5.1 StrategistAgent（钟离）从"不导出"更正为"已导出但不注册"——它是未来的地基，代码已实现、类型已定义，提前暴露便于圆桌引用和手动验证，导出无害。barrel 恢复 `export { StrategistAgent }`。修正不涉及运行时逻辑变更——仅宪法分层归位 + 桶导出解锁，物理拆分留待 Core-2。宪法版本号 v2.5.1→v2.5.2 |
| v2.5.2 → v2.5.3 | **原则六修订——Agent 圆桌协商常态化**：随着项目复杂程度上升，多 Agent 并行产生的独立报告加重用户认知负荷。原则六"Agent 之间不协商统一"从防线变为瓶颈。修订为：多 Agent 并行产出须先经圆桌协商收束为统一视图，再呈用户裁决。Agent 之间协商不替代用户最终决策——用户始终保有否决权和最终裁量权。此修订将已在自审视中验证的三轮圆桌审阅机制从自审视特例提升为多 Agent 协作的常态化协议。宪法版本号 v2.5.2→v2.5.3 |
| v2.5.3 → v2.5.4 | **甘雨定位变更——MetaAgent 从规划中枢变更为战术中枢**：甘雨（MetaAgent）原本定义为规划中枢，但在实际运作中，其职责始终是战术调度——拆解意图、分配兵种、编排时序、仲裁失败。钟离（StrategistAgent）在 Core-2+ 负责战略把关（方向判断、契约守护）。此次修宪将甘雨正式定位为战术中枢，与钟离形成战术/战略双层分工——甘雨回答"怎么拆怎么排"，钟离回答"方向对不对契约有没有破"。此变更在代码中已有基础：strategist-agent.ts 早已标注"甘雨：战术规划 / 钟离：战略把关"，本次修宪使宪法术语与此一致。宪法版本号 v2.5.3→v2.5.4 |
| v2.5.4 → v2.5.5 | **技能机制预实现 + 圆桌优化修宪**：(1) SkillRegistry 从"Core-2 预留"提升为"预实现"——类型定义（SkillTemplate/SkillRegistry 接口）已在 agent.ts 落地，SkillRegistry 类（register/unregister/queryByTags/queryByAgent CRUD）已在 shared/src/skill-registry.ts 实现，verification-templates.json 双模式（硬约束/软约束）已在自审视脚本中通过 templatesLoaded 分支加载。待 Core-2：SkillExecutor 执行引擎 + LoopAgent 自动技能沉淀管线。(2) 圆桌会议新增材料清单（MaterialChecklist）——凝光在圆桌启动前按 MATERIAL_CHECKLIST 校验材料完备性，缺失必需材料阻断会议。清单含 8 项：Agent 审视报告、共识修复清单、根因归簇分析报告、钟离战略评估、宪法全文、标签词汇表、意图响应体系设计、自由审视摘要。(3) 新增归因分析圆桌（第二阶段·无主题会议 ATTRIBUTION_ROUNDTABLE）——不设预设议题，Agent 从根因归簇报告中自由提取讨论点，发言必须有据（引用发现编号/审视报告原文），凝光仅记录不收束方向。宪法版本号 v2.5.4→v2.5.5 |
| v2.5.5 → v2.5.6 | **协约化与稳固化修宪**：(1) §三包结构修正——移除不存在的 @cortex/infra，修正为实际 4 包 shared ← llm ← engine ← testing，标注 infra 独立拆分留待 Core-2。(2) §5.1 ApiAgent/DataAgent 从"Core-2 预埋"升级为"Core-1（审视参与）"——参与软约束自审视，拥有只读+search_code 权限。(3) §5.1.1bis 软约束/硬约束双轨协议入宪——5 维度差异表（Phase 0 基线 / 探索方向 / Phase 5 注入 / 圆桌产出 / 共识基线）。(4) §5.1.2 圆桌共识优化入宪——单轮合并优化（DSA 门控 / context reset / 共识晋升 / BrowserAgent 移除），入席者 12 人。(5) §十四·一 ci-gate 测试自声明入宪——@ci 标签自声明 / 动态扫描 / 统一入口 / 门禁流程 / 职责分离（触发 vs 诊断）。(6) 代码稳固化——vitest.ci.config 硬编码 exclude 消解（改为 ci-gate.ts 动态注入）、llm 包纳入 CI 扫描、agent_pool 状态机噪音治理（Created→Destroyed 合法流转）、DB 清理边界注释确认、GitHub Actions CI workflow（push/PR 触发 → pnpm install → ci-gate.ts 统一门禁）。宪法版本号 v2.5.5→v2.5.6 |
| v2.5.6 → v2.5.7 | **记忆系统委托模式拆解修宪**：(1) MemoryStore 从 950 行 God Object 重构为 337 行 Facade（委托模式）——内部拆分为 4 核心组件（MemoryStorage / MemoryPersistence / MemoryLifecycle / MemoryQueryEngine）+ 2 支撑模块（MemoryPipeline / MemoryStoreMonitor）+ 共享常量（schema.ts）。物理边界：`memory/` 子目录。(2) 管道去重——base-agent.ts 删除 `_executeWithMemory` + `_executeAndRemember`（~80 行），统一调用 `executeWithMemoryPipeline`。base-agent.ts 从 206 行精简至 135 行。(3) 检索策略模板化——新增 `makeMemoryQuery(node, opts)` 工厂函数统一 11 个 Agent 的关键词提取，导出至 barrel。(4) 功能柱概念正式废止——§十三 Meso-Lite 行移除"3 柱协作"描述。宪法版本号 v2.5.6→v2.5.7 |
| v2.5.7 → v2.5.8 | **闭环协作实验实证增补**：(1) 闭环协作模式（规划→执行→审查→修复→验证）在 10 Agent × 开放意图 × MemoryStore 持久化场景下通过 `closed-loop-collab.ts` 实证验证——状态从 [设计] 升级为 [已验证]。(2) §7.5 新增读取安全边界条款——L0 操作（read_file/search_code/list_files/list_dir）在非隔离部署中必须实施路径越界防护（白名单制，默认拒绝越界访问），实证依据为 Agent 可通过 `..` 穿出 PROJECT_DIR 读取任意文件系统路径。(3) §9.9 新增记忆认知共享层条款——MemoryStore 确认为跨 Agent、跨 run 的共享认知基础设施；跨 run 缺陷追踪、知识继承与认知摊销、共识验证机制均通过实证确认；四维检索策略（关键词+语义+图谱 BFS+时间衰减）被认定为认知共享的命脉——检索策略决定 Agent 看到什么记忆，看到什么决定做出什么；冷启动风险（空库首 run 认知不稳定 + 错误记忆污染）识别并留待 Core-2 治理。宪法版本号 v2.5.7→v2.5.8 |
| v2.5.8 → v2.5.9 | **合并测试实证收束**：(1) §三 物理包结构从 4 包更正为 9 包（新增 cli/parser/pm/data/tools），补充完整依赖关系表——合并测试中从 3 个源搬运 ~74K TypeScript + ~10.8K 测试行，凝光合规审计裁定全部 9 包在命名/workspace/tsconfig/脚本四维度合规。(2) §三 基础设施 CLIAdapter 与 @cortex/cli 关系澄清——CLIAdapter 为平台桥接抽象（在 shared 层），@cortex/cli 为具体 CLI 实现（独立包），二者非替代而是抽象与实现关系。(3) §五 FixAgent（希格雯）入宪——代码已实现（`fix-agent.ts`），合并测试中修复了刻晴审查的全部 24 个缺陷，354 测试保持全绿，闭环自愈链路完整验证。(4) §9.10 新增合并测试记忆实证——95.17% 结构指纹缓存命中率（57,572,992/60,496,234）实证了"记忆为主、LLM 为辅"架构假说在 9 Agent 大规模协作中成立；闭环自愈链路从 v2.5.8 的单缺陷单 run 跃迁至多缺陷单 run 批量修复（24 缺陷全部闭合，0 新缺陷）。宪法版本号 v2.5.8→v2.5.9 |
| v2.5.9 → v2.5.10 | **物理归位收束**：(1) §三 新增 ConsistencyLayer——P1-六层防御的 InitVerifier + SchemaEnforcer 从 MemoryStore 中间件归位为独立 consistency/ 子目录，ConsistencyLayer Facade 统一暴露校验入口。Engine 桶导出 `ConsistencyLayer`。(2) §三 MemoryStore 委托组件从 7 组件族扩展为 8 组件族——新增 SkillPipeline（技能闭环订阅者），位于 memory/ 子目录。(3) §三 components/ 目录加桶导出（`components/index.ts`）——agent-factory / react-loop / skill-extractor / skill-persister 统一对外接口，封装边界显式化。(4) Scheduler 技能管道订阅者化解耦——Scheduler 不再持有 `skillRegistry`/`memoryStore` 引用、不再内部调用 `extractAndPersistSkills`。技能闭环改为独立 PipelineObserver 订阅者（`registerSkillPipeline(observer, skillRegistry, memoryStore)`），在 bootstrap 层注册。Scheduler 构造函数参数从 7 减至 5（board/pool/observer/gate/metaAgent）。NodeComplete 事件 payload 新增 `output` 字段。宪法版本号 v2.5.9→v2.5.10 |

---

**文档状态**：v2.5.10。替代 v2.5.9 作为 Core 阶段准入依据。v2.5.9 已归档保留。
