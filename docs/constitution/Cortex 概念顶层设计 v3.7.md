# Cortex 概念顶层设计 v3.7

**版本**：v3.7（第二轮全方位审查四域修复 / 图景盘点与命名对齐 / 测试基线实测刷新）

**状态**：Core-2 深度治理推进中。七轮审查 ~170+ 发现，十轮修复闭合 55 项 + 本轮 P0×4（obliterate 湮灭不落盘 / cyrene load 损坏覆盖 / 通知路由链断裂含 bootstrap 无 loadRoutes / governance-events as EmittableEvent 类型逃逸）+ P1×23 + P2×42+；23 处 skip 恢复 20 处。6 项设计决策排入 Core-3。铁三角未就位（Electron ❌ / MCP ⚠️ 已接入无鉴权 / Committee ❌）。

**性质**：智能体治理框架——不对模型提要求，对架构下约束。核心手段是"暴露不可靠，内化可靠"。

**前置宪法**：v1.1（大脑隐喻，已废弃）→ v2.0（工具链隐喻）→ v2.7.1（Core-1 终局）。v3.0 对 v2.x 做全量重写——从"各阶段增量叠加"改为"按代码现实重述"。

**生成日期**：2026-06-19（v3.0）→ 2026-06-22（v3.1）→ 2026-06-28（v3.2）→ 2026-07-06（v3.3）→ 2026-07-16（v3.4）→ 2026-07-20（v3.5）→ 2026-07-20（v3.6）→ 2026-08-01（v3.7）
**修正案**：AM-2026-0801-001（v3.6→v3.7，图景盘点全面修订）
**宪法守护者**：昔涟（Cyrene），与开拓者共同完成

---

## 一、Cortex 是什么

Cortex 是一个智能体治理框架。它以 MetaAgent（甘雨）为战术中枢，以 16 种 Agent（含烟绯 ConfirmGate、钟离/霜凝 Strategist）为执行单元，以确认门和安全规则引擎为护栏。

**代码事实**（2026-08-01 实测）：
- 引擎入口：`packages/engine/src/bootstrap/bootstrap-engine.ts`——插件化加载 10+ 插件，装配全部组件
- Agent 注册：`packages/config/src/data/agents.json`（统一配置源）+ `agent-manifests.json`（L3·Agent 层差异声明）——从统一配置源加载 16 种 Agent 定义（含 strategist 双实例：钟离/霜凝）
- 调度中枢：`packages/engine/src/core/scheduler.ts`——executeAll() 消费 TaskBoard，驱动拓扑排序 + 逐层执行
- 测试规模：全仓 vitest 3982 passed / 13 skipped（2026-08-01 实测）；engine 902 passed（pre-commit 口径）
- 全量 tsc -b 零错误（29 包含 src 编译，含 strict + noUncheckedIndexedAccess）
- CI 门禁：五段执行（tsc -b → eslint packages --ext .ts,.tsx --max-warnings 0 → critical-fixes 混沌校验 → vitest unit+verify+contract 按包串行 → coverage 阈值 [--coverage 显式启用]），scripts/ci-gate.ts 驱动
- 已知缺陷：七轮深度审查 ~170+ 发现，十轮修复闭合 55 项 + 本轮 P0×4 + P1×23 + P2×42+。P0×4：obliterate 湮灭不落盘（`memory-store.ts` 湮灭后仅清内存不写库）、cyrene load 损坏覆盖（json parse 失败后仍用部分数据覆盖全量）、通知路由链断裂（bootstrap 未调 `loadRoutes()`，治理事件无人订阅）、governance-events 类型逃逸（`as EmittableEvent` 绕过 EventPayloadMap）。23 处 skip 恢复 20 处（3 处保留：LLM 真实调用 2 + Electron 1）。6 项设计决策排入 Core-3（Logger 推广 / execSync→async / WebUI 鉴权 / EventPayloadMap 补完 / Disposable 推广 / shared export*）。
- Phase 1 已完成：7 个 Critical（C-01~C-07）+ 5 个 P0（R1-R5）+ 3 个 CRITICAL（C8-C10）+ 7 个 HIGH（H1-H7）全部根因修复
- 核心契约已稳定：EventPayloadMap（agent-pool / task-board 对齐）、write/read/embedBatch 数据完整性、NotificationPipe 持久化初始化、convertToDocument XSS 防护、updateProposalStatus 路径校验、FSM dispatch 执行语义

**核心隐喻**：工具链。每个组件是可替换、可验证、职责清晰的工具。不存在"数字生命体"的不可知性——每个行为可审计。用户是工具的使用者和最终裁决者。

---

## 二、七条不可变原则

### §二·七条不可变原则（v3.2 三层结构）

原则不可增删，但可按五流框架重新组织以反映架构演进。

#### L0·全流约束——唯一前提

**原则五·统一可观测**
> 所有关键状态变更走 PipelineObserver.emit()，不用裸 console.log。
> 这是唯一全流约束——其他六条的验证前提。

#### L1·流间交叉约束

**原则一·确认锚定**——交互流 × 技能-工具流
> 不可逆操作须经 ConfirmGate 用户确认（分级干预）。

**原则四·可追溯性**——治理流 × 技能-工具流
> 所有治理决策记录在案，可回溯因果链。

**原则六·用户终裁**——交互流 × 治理流
> 系统分歧最终由用户裁决，不自行闭环。

#### L2·流内结构约束

**原则二·非对称均衡**——规划-执行流内部
> 规划权重高于执行，MetaAgent 可驳回 Agent 输出。

**原则三·边界集中**——技能-工具流入口
> 所有工具调用经统一 ToolGateway 注册，不私接 API。

**原则七·宪法自约束**——治理流自指涉
> 修宪须走完整闭环（提案→审计→裁决→落笔），不自改。

### 2.8 原则八：配置与类型的内核分级

类型定义与运行时配置是不同层级的系统基座。

- shared 包持有结构化的类型接口（IAgent / ITool / IEvent / ITag）与封闭枚举（AgentType / AgentStatus / AgentContext）——这是不可变的核心契约（v3.7 订正：AgentType 已回归 @cortex/shared 单源，`packages/shared/src/agent-enums.ts`）
- config 包持有运行时可注册的词汇表与配置数据（Tag / PipelineEventType / agents.json / agent-manifests.json）——这是可扩展的调度信号
- 调度信号分级（v3.7 实测修正）：AgentType 为 shared 封闭枚举（`config/src/vocabularies/agent-enums.ts` 仅转导出兼容）；Tag / PipelineEventType 维持 config 注册（v3.3 曾将三者整体迁往 config 运行时注册，v3.7 实测发现 AgentType 已回迁 shared——以代码现实为准）
- 新增 Agent 类型只改 config（agents.json + agent-manifests.json），不碰 shared；若需新增 AgentType 枚举值则改 shared 单源
- 编译时校验交给 TypeScript 类型系统，运行时校验交给注册器（如 TagRegistry）

### 2.9 审查深度分层——v3.6 新增（非新原则，是审查方法论）

三轮深度审查揭示了代码质量的三个层次——越深层的问题越不依赖具体语法，而依赖对**设计假设和上下游契约**的理解：

| 层 | 审查焦点 | 发现类型 | 示例 |
|----|----------|----------|------|
| L1·表面 | 类型安全 / 资源泄漏 / 裸 console | TS strict / setTimeout 未清除 / 裸遥测 | D1-D6 / T1-T4 |
| L2·数据 | 数据完整性 / 安全漏洞 | 写后返回已删 ID / XSS / 路径穿越 | R1-R5（5 P0） |
| L3·语义 | 算法正确性 / 协议合规 / FSM 执行语义 | dedup key 类型错误 / LLM 协议格式 / 事件递归 / 贝叶斯数学推导 / action 执行时序 | C8-C10 + H1-H7（10 项） |

**核心教训**（已证伪的假设→对应的正确做法）：
- 「Map.delete(id) 删除的是值」→ **Map 的 key 类型需与插入时一致**（C8）
- 「事件总线内 emit 同名事件没事」→ **同步派发下会无限递归**（C9）
- 「并行插件共享 ctx 没问题」→ **并行写可变对象需独立副本**（C10）
- 「每条 tool_call 推一条 assistant 消息」→ **LLM API 要求一条 assistant 包含所有 tool_calls**（H1）
- 「sessionTokens 累加符合直觉」→ **prompt_tokens 每轮已含全部历史，应覆盖非累加**（H3）
- 「先执行 action 再更新状态」→ **action 内 dispatch() 看到旧状态可能触发非法转换**（H7）
- 「sigmoid 中心在 0.5 是标准做法」→ **当后验上限远低于 0.5 时区分力消失，中心应对齐先验**（H5）

这层认知——算法正确性、协议合规性、数学推导——不是类型系统能捕获的。它需要**理解每个组件的上游契约（LLM API 格式）和下游需求（消费者索引对齐）**。

---

## 三、系统架构——代码现实

### 3.1 包结构（29 包，2026-08-01 实测）

```
packages/
├── engine/           # 引擎容器——bootstrap + Agent + Scheduler + 10 子域（agents/bootstrap/components/core/execution/lifecycle/memory-bridge/planning/plugin/registry）
├── scheduler/        # 调度引擎——TaskBoard/AgentPool/PipelineObserver/ConfirmGate（scheduling-implementations 1107 行）
├── shared/           # 共享类型中枢——AgentType 单源枚举 + EventPayloadMap + agent-registry
├── platform/         # 平台抽象——Toolkit + MCP 鉴权
├── config/           # 配置——EngineConfig/常量集中 + 14 配置域 + agents.json/manifests
├── memory-store/     # 记忆持久化（SQLite）
├── memory/           # 内存记忆后端
├── skill-kit/        # 技能工具包
├── prompt-kit/       # 提示词工程
├── resilience/       # 韧性策略（熔断/重试）
├── notification/     # 通知管线
├── governance/       # 治理 + 一致性校验（consistency 已并入）
├── telemetry/        # 遥测
├── logging/          # 日志
├── plugin-runner/    # 插件运行时
├── fsm-compiler/     # FSM 编译
├── pattern-extractor/# 模式提取
├── llm/              # LLM 适配层
├── cli/              # CLI + TUI（tui 已并入）
├── context-manager/  # 上下文压缩
├── doctor/           # 诊断
├── tools/            # 内部工具
├── testing/          # 测试工具
├── parser/           # 解析器
├── desktop/          # Electron 桌面端
├── client/           # Cortex 客户端 SDK（独立编译单元，cli 依赖）
├── server/           # Cortex 服务端（独立编译单元）
├── protocol/         # 客户端-引擎通信协议（独立编译单元，client/server 依赖）
└── design-tokens/    # 双 palette 设计令牌（ENGINEERING / PRESENCE，独立编译单元）
```

**编译图说明**（v3.7 实测）：根 `tsconfig.json` references 25 项（21 包 + engine/fsm-compiler/governance/plugin-runner 四个 `tsconfig.src.json` 子引用）；client / server / protocol / design-tokens 为独立编译单元——各有独立 tsconfig.json 并被 cli / desktop 等引用，不纳入根 tsc -b 图。

### 3.2 三层架构

> 完整架构映射见附录：[Cortex-架构映射-五流六层七原则](core/Cortex-架构映射-五流六层七原则.md)——五流（抽象行为模型）→ 六层（具象代码架构）→ 七原则（施加在流上的约束），每个节点标注精确代码路径。

```
约束层（暴露不可靠）
├── ConfirmGate       — L0-L3 可逆性等级拦截
├── ConsistencyLayer  — 六层防御（格式/结构/事实）
├── ReplanManager     — 重规划配额防振荡
├── ESLint/tsc        — 编译时硬防线
├── SentinelSignalFilter — 哨兵 L1/L2/L3 信号分层（Core-2 新增）
└── ResiliencePolicyFactory — LLM 重试/工具熔断（Core-2 新增）

内化层（吸收可靠）
├── SkillRegistry     — 41 技能模板
├── SkillScope        — 四级作用域：跨域/项目/包级/Agent（Core-2 新增）
├── GovernanceLoop    — 修宪自动化管线
├── LoopStrategyRegistry — 四策略注册表（Core-2 新增）
└── EnvironmentAwareRouter — 环境感知降级（Core-2 新增）

Engine（容器）
├── MetaAgent（甘雨） — 战术中枢：意图拆解 → 粗粒度任务节点
├── AgentPool         — 16 Agent 实例池 + ManifoldGate 流控
├── TaskBoard         — 任务图：拓扑排序 + 依赖解析
├── PipelineObserver  — 事件管道：CRITICAL/HIGH/NORMAL 三级
├── TaskRouter        — 统一策略+模型路由（Core-2 新增）
└── NotificationRuntime — PipelineObserver→NotificationPipe 桥接（Core-2 新增）
```

---

## 四、MetaAgent——战术中枢

**代码**：`packages/engine/src/core/meta-agent.ts`（665 行）

**职责**：意图拆解为粗粒度 TaskNode 树。只管"谁来做""先后顺序"，不管"怎么做"。

**关键能力**：
- `plan(intent, context)` → TaskNode[] —— 核心规划
- `_planningPrompt()` —— 双路径：PromptManager 声明式块组装 / 手拼回退
- 技能注入：SkillRegistry → resolveByScope → 注入 planning prompt
- 策略顾问：LoopStrategyRegistry.getAdvisorContext() → 注入规划提示词（Core-2 新增）
- 管线上下文：订阅 NodeComplete 获取执行层信息
- 工作区边界校验：路径在工作区外时返回空数组拒绝

---

## 五、Agent 池——16 种执行单元

### 5.1 Agent 类型表（2026-08-01 与 agents.json / agent-manifests.json 实测核对）

| # | Agent | 类型 | 模型 | 职责 | 阶段 |
|---|-------|------|------|------|------|
| 1 | 阿贝多 | code | deepseek-v4-pro | 写代码、重构、新功能 | Core-1 |
| 2 | 希格雯 | fix | deepseek-v4-flash | 诊断 bug、最小修复 | Core-1 |
| 3 | 刻晴 | review | deepseek-v4-flash | 代码审查 | Core-1 |
| 4 | 纳西妲 | analysis | deepseek-v4-pro | 架构分析、深度调研 | Core-1 |
| 5 | 凝光 | doc-govern | deepseek-v4-flash | 律法审计、合规检查 | Core-1 |
| 6 | 安柏 | inspector | deepseek-v4-flash | 纯事实采集 | Core-1 |
| 7 | 莫娜 | loop | deepseek-v4-flash | 模式提炼、技能沉淀 | Core-1 |
| 8 | 北斗 | ops | deepseek-v4-flash | 运维诊断、环境检查 | Core-1 |
| 9 | 宵宫 | browser | deepseek-v4-flash | 浏览器 UI 验证 | Core-1 |
| 10 | 久岐忍 | api | deepseek-v4-flash | API 设计（agents.json 角色名：久岐忍） | Core-1 |
| 11 | 艾尔海森 | data | deepseek-v4-flash | 数据模型（agents.json 角色名：艾尔海森） | Core-1 |
| 12 | 甘雨 | meta | deepseek-v4-pro | 战术中枢——意图拆解 | Core-1 |
| 13 | 昔涟 | butler | deepseek-v4-flash | 管道路由 + 用户交互面 | Core-1 |
| 14 | 钟离 | strategist | deepseek-v4-flash | 战略把关（status=awake） | Core-2 预留 |
| 15 | 霜凝 | strategist | deepseek-v4-flash | 方向监理（status=awake） | Core-2 预留 |
| 16 | 烟绯 | confirm-gate | deepseek-v4-flash | 确认门决策——审计级确认与策略放行 | Core-2 预留 |

> 实例数核对：agents.json 16 个实例 / 15 种类型（strategist 双实例：钟离 + 霜凝）；agent-manifests.json 15 个条目（无霜凝，L3 差异声明层）。烟绯类型名实测为 `confirm-gate`（非 confirmGate）。

### 5.2 Agent 自声明

**代码**：`packages/engine/src/core/capability-registry.ts`

每个 Agent 通过 `AgentCapability` 声明能力画像（标签/工具权限/适用场景/协作模式/输出格式）。`CapabilityRegistry` 启动时自动收集，MetaAgent 据此进行任务→Agent 匹配。

### 5.3 循环策略

**代码**：`packages/engine/src/core/loop-strategy-registry.ts`（Core-2 新增）

四策略注册表：

| 策略 | canHandle 规则 | 管道 |
|------|---------------|------|
| direct | payload < 200 + 无工具依赖 | DirectStep |
| decompose | payload > 500 或 audit/scan/migration | Decompose（预留） |
| jury | needsMultiPerspective = true | Jury（预留） |
| react | 默认 fallback | DEFAULT_PIPELINE |

**代码**：`packages/engine/src/core/task-router.ts`（Core-2 新增）——统一策略+模型路由，三层优先级：MetaAgent 标注 → 规则路由 → fallback。

---

## 六、ButlerAgent——昔涟的代码承载体

**代码**：`packages/engine/src/agents/butler-agent.ts`（198 行）

昔涟在 Cortex 中为独立实体——同时持有 Agent 池中 butler 类型的配置席位，既通过 ButlerAgent 代码体履行 IDE 管线路由职责，又独立于调度器之外以 CLI 唯一用户交互面的身份覆盖所有非管线对话。

**关键能力**：
- `_dispatchByType()` —— 按 notificationType 三层路由（FYI/WARNING/DECISION_REQUIRED）
- 订阅 CRITICAL + HIGH + NORMAL 三级优先级事件
- 独立的 talk 记忆数据库（与主 MemoryStore 物理隔离）

---

## 七、确认门与安全

### 7.1 ConfirmGate

**代码**：`packages/scheduler/src/core/confirm-gate.ts`（254 行）

基于可逆性等级（L0-L3）拦截工具调用。L2/L3 永远确认，L1 视信任放行。

### 7.2 工具权限

**代码**：`packages/platform/src/toolkit.ts`（328 行）

统一管道：权限校验 → ConfirmGate → FileLock → execute。本地工具和 MCP 工具走同一条流水线。

### 7.3 MCP 鉴权（Core-2 新增）

**代码**：`packages/platform/src/mcp-client.ts` — `McpTrustConfig`

声明式 MCP 鉴权：`level`（可逆性等级）/ `allowedAgents`（Agent 白名单）/ `requireConfirmation`（是否需要 ConfirmGate）。不依赖 TrustModel。

---

## 八、PipelineObserver——可观测管道

**代码**：`packages/scheduler/src/core/pipeline-observer.ts`

所有可观测事件走统一管道。`ObservableEvent` 包含 `type` / `priority` / `payload` / `notificationType` / `requestId`。

**Core-2 增强**：
- `SentinelSignalFilter` —— 对 CRITICAL 事件做 L1/L2/L3 分层 + 去噪 + 告警风暴检测
- `NotificationRuntime` —— PipelineObserver → NotificationPipe 桥接
- `GovernanceEventEmitter` —— 四类治理事件（修宪提案/审计报告/合规违规/圆桌共识）
- `DecisionGateBridge` —— DECISION_REQUIRED 事件 → ConfirmGate 自动拦截

---

## 九、记忆系统

**代码**：
- `packages/memory-store/src/memory-store.ts`——SQLite 持久化 + 委托模式（Facade + 7 组件族）
- `packages/memory/src/`——InMemoryMemoryStore 内存实现
- `packages/governance/src/consistency/consistency-layer.ts`——六层防御（IntentFactWall/InitVerifier/SchemaEnforcer/GitHookBridge/SemiFinishedMgr）（原 consistency 包已并入 governance）

**四态模型**：Active → Archived → Frozen → Obliterated。CAS 原子流转。

**检索模式**：HCA（广而浅）/ CSA（窄而深）/ DSA（稀疏注意力）。BFS 图遍历 + 混合检索（BM25+向量）。

**Context Sharding**：`compactToSubAgentSummary()` 将子 Agent 输出压缩为结构化摘要，协调者只读摘要。

---

## 十、调度引擎

**代码**：`packages/engine/src/core/scheduler.ts`（368 行）+ `packages/scheduler/src/core/scheduling-implementations.ts`（1107 行）

**四抽象**：IScheduleStrategy × ILoopDriver × IExecutionModel × IModelRouter。

**执行范式**：PipelineModel —— Claim → Spawn → Execute → BoundaryGuard → Cleanup。

**Core-2 增强**：`TaskRouter` + `EnvironmentAwareRouter` 组合为调度器模型路由。每次 ExecuteStep 执行前自动走策略选择 + 环境感知降级。

---

## 十一、治理系统

### 11.1 总纲：三轴

治理层只做两件事：**暴露不可靠，治理内化。** 这两件事通过三轴实现：

- **事轴（命令流，自上而下）**：用户意图 → MetaAgent → TaskBoard → Agent 执行
- **权轴（约束流，自下而上）**：Agent 异常 → SafeErrorReporter → 重规划 → 用户裁决
- **横切（监督流，独立于事轴）**：PipelineObserver 独立订阅，只看不指挥

### 11.2 已落地治理组件

16 个组件在运行时管线中运作：PipelineObserver / SentinelSignalFilter（L1/L2/L3）/ SafeErrorReporter / DocGovernAgent（三大审计）/ ConfirmGate（L0-L3）/ ReplanManager / DecisionGateBridge / ResiliencePolicyFactory / NotificationRuntime / GovernanceEventEmitter / GovernanceLoop（修宪管线）/ ConsistencyLayer / SkillRegistry / LoopStrategyRegistry / TaskRouter / EnvironmentAwareRouter。

### 11.2-bis doc-govern 目录转型（v3.7 记录）

`doc-govern/` 目录已于 6eefe676 删除（committee_sessions.json 818 行 / doc-registry.json 28 行 / modification-record.json 477 行）。职责由权威源承接：
- **修宪记录** → `docs/amendments/AM-*.json`（修正案全记录，最新 AM-2026-0722-003）
- **审计报告** → `docs/auditing/`（按日期命名）
- DocGovernAgent（凝光）组件表述以 agents.json `type=doc-govern` 为准，不再依赖独立目录

### 11.3 概念映射

历史上治理层讨论产生的概念（三省六部、委员会、纪检委、五路监督、监理）是**三轴在不同抽象层级上的映射**，而非需要独立实现的 Agent 清单。三省六部已被声明式配置、审计管线和调度引擎吸收。委员会被分配到 DocGovern 审计（常设）和 needsMultiPerspective（临时）两条路径。纪检委的五环监督链分散在 PipelineObserver → DocGovernAgent → GovernanceLoop → ConfirmGate 四条管线上。

### 11.4 缺失项

仅 4 项真正未落地：钟离契约监督（Core-2 预留）、Committee session（Core-3）、TrustModel（数据不足）、跨进程治理（Full 阶段）。

> 完整设计见 [治理层设计 v3.0](core/治理层设计-v3.0-全量整合版.md)。

### 11.5 审计闭环

发现 → 登记（审计报告） → 指派Owner → 整改 → 验证 → 关闭裁决 → 归档（closed）。↻ 不通过 → 重新整改。

**与 CI 门禁的关系**：审计闭环是 CI 门禁的输入条件。未关闭的 P0 发现自动阻塞门禁通过。当前审计闭环达到 4/5 环节可用，判例有效期自动化留待 Core-2。

### 11.6 配置域注册表

`@cortex/config` 通过 `CONFIG_DOMAINS` 声明 17 个配置域（2026-08-01 实测）：agents（@deprecated，保留向后兼容）/ engine / tools / eventRouting / roundtable / searchProviders / mcpServers / selfExamination / crossVerification / seedMemories / governancePipeline / cognition / docs / models / keysContext / agentManifests / tuning。每个域独立声明文件名、是否必需、数据键名与 schema。配置数据文件位于 `packages/config/src/data/`。

> L1~L4 分层：models（L1·模型层）→ keysContext（L2·密钥+上下文层）→ agentManifests（L3·Agent 层差异声明）→ tuning（L4·调参层）。agents.json 已标注 @deprecated——新 Agent 定义走 agentManifests 域。

---

## 十二、技能系统

**代码**：
- `packages/skill-kit/src/skill-registry.ts`——SkillRegistry CRUD + JSON 持久化
- `packages/skill-kit/src/skill-extractor.ts`——从输出文件提取技能
- `packages/engine/src/core/skill-scope.ts`——四级作用域解析（Core-2 新增）

**41 技能模板**：`skills/*.json`。由 Mona（LoopAgent）从已完成工作中提取。

**四级作用域**（Core-2 新增）：跨域（`~/.cortex/skills/`）→ 项目（`skills/`）→ 包级（`packages/*/skills/`）→ Agent（agentType 过滤）。

---

## 十三、冲突解决

继承 v2.7.1 §11.1 四规则，无变更：
1. 事实为基——可验证事实优先于 Agent 判断
2. 收束分歧——不同解释通过圆桌协商收敛
3. 交由用户裁决——无法收束时用户拍板
4. 宪法优先——安全基线高于治理层设计

---

## 十四、阶段门禁规则

阶段跃迁需满足硬性门禁条件：

| 门禁 | Core-1→Core-2 | 现状（2026-08-01） |
|------|:------------:|:-------------------|
| solo-flight 全闭环 | ✅ | Phase 1 止血完成，自审视验证通过 |
| 审计闭环 P0 清零 | ✅ | 7 Critical + 5 P0 + 3 CRITICAL + 7 HIGH 全部修复；本轮 P0×4 闭合 |
| 遥测基础设施 | ✅ | PipelineObserver + console-bridge + HealthCollector |
| 自审视机制 | ✅ | 7 阶段全流程验证通过（45 文件，91.7% 准确度） |
| 核心契约稳定 | ✅ | EventPayloadMap / write/read/embedBatch / NotificationPipe / convertToDocument / FSM dispatch |
| WebUI 观测面 | ⚠️ | 后端+前端骨架就位，Mission 数据接通待完成 |
| 铁三角就位 | ⚠️ | MCP 已接入，Electron ❌，Committee 设计完成 |

**v3.3 新增**：
- 烟绯 Agent 化设计定稿（`docs/core/confirmgate-agent-design.md`）
- L0-L3 分级退为信任分计算基础值，不再直接决定确认策略
- E2E 模式全局自动放行

---

## 十五、阶段模型

```
Phase 1 止血 ████████████████ 100%  22 Critical/High/P0 根因修复 + CI 门禁 + 全仓 alias + 契约铁律入宪 + 算法正确性审查
Phase 2 契约 ██░░░░░░░░░░░░░░ ~10%  跨包接口契约测试（P1 残留清理中）+ 闭环混沌验证 + 熔炼 E2E
Core-2 治理  ██████████░░░░░░ ~50%  10 新模块落地 + 4 技能结晶 + 方法论文档 + 第二轮全方位审查 P0×4/P1×23/P2×42+ 闭合。铁三角缺二
Full         ░░░░░░░░░░░░░░░░   0%  设计就绪，等铁三角
```

**铁三角**：Electron 原型 ❌ / MCP 集成 ⚠️ 已接入无鉴权 / Committee MVP ❌。三者同时就位后 Core-2 治理层激活。

**Phase 1 验收标准**：22 项 Critical/High/P0 全修复 + CI 门禁 tsc/eslint 通过 + 全仓 vitest 3982 passed / 13 skipped（29 包，2026-08-01 实测）。

---

## 十六、演进方法论

Core-2 过渡期催生了 Cortex 演进方法论——九阶段闭环：混沌 → 收敛 → 诊断 → 规划 → 执行 → 审查 → 结晶 → 升级 → 归纳。详见 `docs/core/Cortex-演进方法论-九阶段闭环.md`。

---

## 十七、宪法修正记录

| 版本 | 修正案 | 日期 | 内容 |
|------|--------|------|------|
| v3.0 | — | 2026-06-19 | 全量重写。从"各阶段增量叠加"改为"按代码现实重述"。纳入 Core-2 过渡期全部新增模块。四轮审计验证——typecheck 全绿、`as any` 零残留、架构无循环依赖。 |
| v3.1 | AM-2026-0622-001 | 2026-06-22 | Phase 1 止血完成。七 Critical 修复入宪：C-01 命令注入（接口名白名单）、C-02 rollback（async/await 消除 as unknown as boolean）、C-03 Embedding（try/finally 防止永久卡死）、C-04 CircuitBreaker（fallback 不再穿透原函数）、C-05 Bootstrap（失败逆序 stop+dispose）、C-06 RLM（成功率 ≥50% 阈值）、C-07 Obliteration（移除短路条件）。CI 门禁升级为四层：tsc --noEmit → unit → verify → contract。全仓 29 包 Vitest resolve.alias 标准化——删 dist 不影响测试。跨包契约铁律（§十五）入 coding-standards.md。测试基线：engine 79 文件 890/890，全仓 3146/3174。全景图 v1.1 数据修正。 |
| v3.1→v3.2 | 2026-06-28 | §二七原则三层重排 / §二十 WebUI入宪 / §二十二 自审视入宪 / §二十三 平台边界 / §十四 门禁刷新 | 昔涟裁决，curious 审计，executor 施工 |
| v3.2→v3.3 | AM-2026-0706-001 | 2026-07-06 | Core-2 推进——类型分级（§2.8）、ConfirmGate Agent化（§十四）、Tag运行时注册（§2.8）、对称攻防自审视（§二十二）、E2E治理体系（§二十四）、链路管理体系（§二十五）。15 Agent / 86 文件 1069 用例 engine / 全仓 3716 用例 / 25 包 tsc 零错误。 | 昔涟裁决，curious 审计，executor 施工 |
| v3.3→v3.4 | AM-2026-0716-001 | 2026-07-16 | 包结构收敛（27→25）：tui 并入 cli、consistency 并入 governance。运行时防护增强：Context compactor role 交替修复（§二十六）、Memory write inflight 去重（§二十六）、maintain 标记删除（§二十六）、claimedBy 终态清理（§二十六）、dispatchMulti 容错（§二十六）。重复实现统一（§二十七）：PipelineEventType/config event-types.ts 删除（238行）、AGENT_DEFS config版删除（117行）、file-lock-manager platform版删除（285行）。Disposable 接口补 dispose。ShutdownWarden @deprecated 标注。ICortexComponents 零 unknown。core-smoke 修复——根 tsconfig.json 清理 tui/consistency 残留引用。 | 昔涟裁决，五轮审查+七轮修复闭合 40 项缺陷 |
| v3.4→v3.5 | — | 2026-06-20 | 逻辑地图对齐 + 正规化二。**原则五合规强化**：memory-store/scheduler 热路径裸遥测（search_time_ms/write_duration_ms/maintain_failed/sim_check/replan）5 处收敛至 recordTelemetry 正式通道，消除裸 console（T1）。**记忆层优化**：read() 双重老化 + hybrid 分污染持久权重真实缺陷修复（T3）、write() 去重冗余消除（T2）、跨后端包 content_hash→id O(1) 去重索引（T4：AbstractMemoryStore._hashIndex + findByContentHash）。**死代码清理 D1-D5**（ShutdownWarden 残留注释、恒真 sim 分支、TRACE 调试日志、dead binding）。ShutdownWarden 由 v3.4 @deprecated 推进至完全移除，生命周期由 LifecycleManager + ShutdownOrchestrator 接管。**附录订正**：架构映射 §五记忆 7 组件族→适配器委托 @cortex/memory 后端；core-pipeline-integrity-verify 移除 ShutdownWarden 导出陈述。memory-store 109 tests 全过，typecheck 全绿。 | 开拓者裁决（直接修订·事实为依据），昔涟施工 |
| v3.5→v3.6 | AM-2026-0720-001 | 2026-07-20 | **P0 数据完整性与安全修复（R1-R5）**：R1 write() 返回已被向量去重删除的条目 ID——`_tryVectorDedup` 改为返回匹配条目 ID。R2 embedBatch 维度不匹配索引错位——零向量占位保持数组长度一致。R3 notification 持久化异步初始化竞态——`_restoreFromDisk` 改为等 `ready()` 后执行。R4 parser convertToDocument XSS——`escapeHtml` 补引号转义。R5 governance 路径穿越——`updateProposalStatus` 对齐 `saveProposal` 的 proposalId 校验。**算法正确性与协议合规性审查（C8-C10 + H1-H7）**：C8 `_dedupCache.delete(newId)` key 类型错误（entryId→contentHash）；C9 skill-pipeline `NodeComplete` 内部 emit → 无限事件递归；C10 plugin-runner `executeAll` 共享可变 ctx→并行污染；H1 streaming-tool-executor LLM 协议违规（每条 tool_call 单独 assistant 消息→合为一条）；H2 SWITCH_AGENT 孤立 permission Promise→UI 挂死；H3 sessionTokens 双重计数（累加→覆盖）；H4 observer emit 在去重之前→下游持有悬空 ID；H5 cognitive-engine 贝叶斯评分 sigmoid 压制在 [0.007,0.12]→中心改为 prior；H6 task-board 多视角 invariant 删合法结果→claimedBy 非空前置守卫；H7 FSM action 在状态更新前执行→状态更新移至 action 之前。**包整理**：`.gitignore` 屏蔽 `.claude/` `.continue/` `.junie/` 死链接 + `_extraneous/` 第三方 dump + `.archived/` 封存脚本。总闭合数 55 项。 | 开拓者裁决（第三轮审查·算法正确性），昔涟施工 |
| v3.6→v3.7 | AM-2026-0801-001 | 2026-08-01 | **文件名对齐**：v3.0 → v3.7（文件名与内容版本一致）；v2.5.35（内容 v2.7.1）归档至 `docs/constitution/archive/`。**§2.8 矛盾修正**：AgentType 已回归 @cortex/shared 单源（config 仅转导出）。**图景盘点实测刷新**：包结构 25→29（增 client/server/protocol/design-tokens 独立编译单元）；Agent 表 15→16（strategist 双实例：钟离+霜凝，烟绯类型名 confirm-gate）；测试基线 3631→3982 passed / 13 skipped；CI 门禁四层→三段（tsc -b → eslint → vitest 三标签合一）；CONFIG_DOMAINS 14→17。**治理转型记录**：doc-govern/ 目录删除（6eefe676），职责由 docs/amendments JSON + docs/auditing 承接。**新增 §二十八**：第二轮全方位审查战果（P0×4 + P1×23 + P2×42+）。 | 开拓者裁决（图景盘点·代码现实），昔涟施工 |

---

## 十八、CI 门禁——五段执行

**入口**：`scripts/ci-gate.ts`（`npx tsx scripts/ci-gate.ts [--coverage]`）

| 段 | 触发 | 内容 |
|------|------|------|
| 1 | tsc -b | `pnpm exec tsc -b tsconfig.json` 全量增量编译——接口漂移、barrel 缺口、strictNullChecks 违反，任一项不通过即阻断 |
| 2 | eslint | `pnpm exec eslint packages --ext .ts,.tsx --max-warnings 0`——0 错误 0 警告 |
| 3 | critical-fixes | `pnpm exec tsx scripts/verify/critical-fixes.ts`——L5 混沌校验（零依赖独立脚本），守护 7 项 Critical 修复（命令注入/回滚/断路器/幂等）不回归 |
| 4 | vitest | 按包串行（`--pool=forks`），合并执行 @ci: unit + verify + contract 标签测试 |
| 5 | coverage | `--coverage` 显式启用——按包 lines% 阈值（`scripts/coverage-thresholds.json` 固化基线），低于阈值阻断 |

@ci 标签体系（写在测试文件首行）：`unit`（默认，CI 必跑）/ `verify`（关键修复验证，与 unit 同级）/ `contract`（跨包接口契约验证，与 unit 同级）/ `llm` / `integration` / `e2e` / `manual` / `stress` / `benchmark`（后六类 CI 跳过）。

**代码事实**：`scripts/ci-gate.ts` 五段顺序执行（tsc → eslint → critical-fixes → vitest → coverage[可选]），vitest 按包分组串行调用，`process.exit(allOk ? 0 : 1)` 真实阻断。

---

## 十九、测试基线

| 指标 | 数值 |
|------|------|
| 全仓测试 | 3982 passed / 13 skipped（2026-08-01 实测，29 包 vitest） |
| engine 测试 | 902 passed（pre-commit 口径） |
| tsc -b | 全仓零错误（含 strict + noUncheckedIndexedAccess） |
| eslint | packages 0 错误（`--ext .ts,.tsx --max-warnings 0` 口径） |
| CI 执行时间 | 五段含 coverage 全绿实测（2026-06-20） |
| 假阳性治理 | 39 文件失败 → 0（vitest alias 标准化）；23 处 skip 恢复 20 处 |

---

### §二十·WebUI 观测子系统（v3.2 新增）

#### 定位
WebUI 是交互层的扩展——将 CLI/TUI 的命令行交互扩展为图形化观测面。
代码位于 `packages/cli/src/tui/web/`，通过 WebSocket + HTTP 与引擎通信。
它不参与业务决策，不绕过 ConfirmGate 执行操作。

#### 三区布局
- 侧边栏（48px）：系统脉搏——健康灯、Agent计数、治理指示、模式切换
- 画布（55%）：系统全貌——遥测仪表盘、事件管线、Agent森林、治理仪表盘、配置快照
- IDE面板（45%）：任务切片——API用量、任务树、通知时间线、确认门、Trace详情

#### 数据边界（只读快照原则）
- WebUI 只消费 PipelineObserver 事件流，不直接查询引擎内部状态
- 所有写操作通过 `/api/execute` 转发，经 ConfirmGate 拦截
- 配置快照只读——配置编辑不走 WebUI
- IDE 面板不暴露全量 PipelineObserver 事件，仅通知 + 当前任务切片（`--verbose` 可控开启）

#### 与自审视的关系
WebUI 的治理仪表盘模块消费自审视报告（AuditReport + AmendmentLog），
是自审视结果的图形化呈现面。

#### 代码锚点
- 后端：`packages/cli/src/tui/web/gateway.ts`（WS 网关 + HTTP 服务）
- 后端：`packages/cli/src/tui/web/state-aggregator.ts`（三源聚合）
- 后端：`packages/cli/src/tui/web/api-router.ts`（REST API）
- 前端：`packages/cli/src/tui/web/static/src/`（React 组件，8 个）
- 入口：`scripts/start-webui.ts`

#### 设计参考
WebUI 设计参照成熟范式（Cursor/Windsurf），不自创交互范式。

### §二十二·自审视机制（v3.2 新增，v3.3 重构为对称攻防）

#### 定位
自审视是治理流的元操作——Cortex 审视自身代码以发现缺陷和盲区。
它不参与业务路径，是横切（监督流）的延伸。

#### 双模式
- **verify**：快速门禁。从上次配置 + flash 模型运行，输出合规报告，作为 CI 参考输入。
- **examine**：深度审查。可配置模型/记忆/推理参数，输出实验报告，支持对称攻防全流程。

#### 对称攻防五阶段闭环
| 阶段 | 内容 | 角色 |
|------|------|------|
| Phase 0 | 甘雨意图解析 → 动态生成任务 | LLM 直接调用 |
| Phase 1 | 6 claims 并发认领执行 | 独立生成论点 |
| Phase 2 | 3 对交叉攻防（配对驳辩） | 攻方驳斥守方，驳回误报 |
| Phase 3 | 发现矩阵汇总 | 聚合归类 |
| Phase 4 | 纳西妲裁决 + 钟离战略评估 + 霜凝监理展望 | 多 Agent 协同 |
| Phase 5 | 昔涟优先级裁决 → 共识修复清单 | 终审不签署 |

#### 软约束与硬约束
- **软约束自审视**：Agent 自主发现，交叉攻防纠偏，输出 P0/P1/P2 修复清单。不阻塞 CI。
- **硬约束共识圆桌**：凝光宪法审计 + 钟离战略评估 + 霜凝监理展望。结构性问题入宪追踪。
- solo-fight 与软约束自审视并重——两者均为自审视流程不可或缺的核心机制。

#### 资源约束
- 预算上限：1M token
- 执行频率：月度（非 CI）

#### 与 CI 门禁的关系
- verify 模式的结果作为 CI 门禁的参考输入
- 审计闭环未关闭的 P0 发现可阻塞门禁通过
- 自审视不替代 tsc -b / vitest / 三段 CI

#### 代码锚点
- 脚本：`scripts/self-exam-soft.ts`（7 阶段全流程，626 行）
- 输出：`test-output/self-examination-soft/`（45 文件）
- 设计：自审视平台重构设计（5 模块可插拔架构）

---

### §二十三·平台边界（v3.2 新增）

#### 定位
Cortex 是智能体治理框架。Qoder 是 Cortex 当前运行的宿主平台。
两者关系：

- Qoder 提供终端、文件系统、LLM API 接入
- Cortex 在 Qoder 上运行，提供 Agent 池、PipelineObserver、记忆系统、治理层
- 昔涟（ButlerAgent）既是 Cortex 的 Agent 池成员，也是 Qoder 上的主 Agent
- 平台切换（如有）不影响 Cortex 的内部治理闭环——引擎/调度/遥测/记忆/宪法均独立于平台
- 子Agent（executor/gatekeeper/curious/advisor）是 Qoder 侧的工作流角色，不纳入 Cortex 宪法管辖

#### 代码锚点
- Cortex 引擎入口：`packages/engine/src/bootstrap/bootstrap-engine.ts`
- Qoder 主 Agent 配置：`.qoder/agents/cyrene.md`
- 子Agent 配置：`.qoder/agents/cyrene-executor.md` 等

---

### §二十四·E2E 治理体系（v3.3 新增）

Cortex 的 E2E 测试分为四层梯队：

- **push 门禁**：core-smoke（全核心链路冒烟，~0.5元）
- **PR 门禁**：+cortex-e2e-full + memory-write-e2e
- **release 门禁**：+solo-flight + self-exam-soft
- **月度基线**：write-file-baseline（10次统计基准线）

E2E 测试必须声明覆盖矩阵（@covers 注释）。良性膨胀通过覆盖矩阵治理——新 E2E 必须先声明覆盖了已有 E2E 未覆盖的链路。

---

### §二十五·链路治理体系（v3.3 新增）

Cortex 定义了 12 条核心数据流，映射在 `docs/core/full-flow-map.md` 中。
每条流有明确的验收标准、E2E 覆盖、已知问题和 Core-2 演进方向。

链路治理规则：
- 核心 7 条链路每次 PR 必须通过对应的核心 E2E 验证
- 编译门禁：29 包 tsc 零错误（2026-08-01 实测）
- 测试门禁：engine 失败 ≤2（flaky 不变）
- 链路健康指标写入 `docs/core/link-governance.md`，每次发版更新

---

### 附录：docs/core/ 设计文档索引

| 文档 | 用途 |
|------|------|
| link-governance.md | 链路管理面板 |
| full-flow-map.md | 12 条数据流全路径 |
| core-2-audit.md | Core-2 逐层审计 |
| core-2-batch1-design.md | Core-2 第一批改造 |
| world-model-simulation-layer.md | 仿真层设计定稿 |
| confirmgate-agent-design.md | ConfirmGate Agent 化 |
| e2e-supplement-plan.md | E2E 补足计划 |

---

### §二十六·运行时防护增强（v3.4 新增）

基于五轮深度审查中发现的运行时脆弱点，实施以下系统性防护：

**Context compactor role 交替修复**：L3/L4/L5 压缩后可能产生连续同 role 消息（违规的 user/assistant 交替）。新增 `_fixRoleAlternation()` 后处理步骤，扫描结果消息列表，连续同 role 消息合并为单条，保证 LLM API 协议合规。代码：`packages/cli/src/tui/context-compactor.ts`。

**Memory write TOCTOU 防控**：并发同内容写入时，`_tryDedup()` 与 `backend.write()` 间的 await 间隙可被利用穿透去重。新增 `_inflightWrites` Map（contentHash → writePromise）——并发请求等待已有写入完成，写入成功后立即缓存。代码：`packages/memory-store/src/memory-store.ts`。

**maintain/read 互斥**：`maintain()` 同步执行 archive/obliterate 时，`read()` 中的 await 可能让出事件循环导致读到已删除条目。改为标记删除模式——`_pendingObliterate` Set 存储待湮灭 ID，`read()` 过滤，批量湮灭后清空。代码：同上。

**claimedBy 终态清理**：`TaskBoard.complete()` 和 `failNode()` 后 `node.claimedBy` 残留。新增终态 `node.claimedBy = []`，清理已调度印记。代码：`packages/scheduler/src/core/task-board.ts`。

**dispatchMulti 容错**：`Promise.all(promises)` → `Promise.allSettled(promises)`，单 agent 管线异常不影响其他 agent。代码：`packages/scheduler/src/core/scheduling-implementations.ts`。

**runDispatchPipeline try/finally**：新增 try/finally 包裹，异常路径仍执行 CleanupStep 释放 claimedBy/ManifoldGate/Pool。代码：同上。

**LLM 中间轮次恢复**：ReAct 崩溃时返回 `bestEffortOutput`（最后一次成功输出）而非 `[partial output...]` 占位。代码：`packages/engine/src/execution/react-loop.ts`。

**endSession 顺序修正**：`memory.endSession()` 移到 `orchestrator.shutdown()`（含 dispose）之前执行——先归档再关存储。代码：`packages/engine/src/bootstrap/bootstrap-engine.ts`。

---

### §二十七·重复实现统一治理（v3.4 新增）

代码重复是架构债务的核心信号。以下重复实现已完成统一：

| 重复项 | 权威源 | 删除 | 消除量 |
|--------|--------|------|:---:|
| PipelineEventType 双定义 | `@cortex/shared` | `config/src/vocabularies/event-types.ts` | -238 行 |
| AGENT_DEFS 双源 | `@cortex/shared` | `config/src/data/agent-defs.ts` | -117 行 |
| file-lock-manager 双实现 | `engine/src/core` | `platform/src/file-lock-manager.ts` | -285 行 |
| engine/components 死代码 | `@cortex/skill-kit` | 4 文件（skill-extractor/json-validator/persister/template-engine） | -1738 行 |
| clamp() 三份 → 一份 | `@cortex/shared` | memory-store/desktop 本地实现 | -2 份 |
| RagMemoryEntry 同名异义 | `@cortex/shared` | memory/cyrene/rag 局部定义更名 | -1 份 |

**治理原则**：
1. 删除前先确认消费方——grep 全仓零引用方可删除
2. 权威源为被最多包依赖的实现——shared 优先于 config，engine 优先于 platform
3. 接口对齐先于删除——如 `IFileLockManager.acquire` 参数顺序需与调用方一致

---

## 二十八、第二轮全方位审查战果与清理（v3.7 新增）

2026-07-31 ~ 08-01 对全仓执行第二轮全方位审查（四域扫描 + 四 Executor 修复），战果入宪：

### 28.1 四域修复（P0×4）

| # | 缺陷 | 根因 | 修复 |
|---|------|------|------|
| P0-1 | obliterate 湮灭不落盘 | `memory-store.ts` 湮灭仅清内存缓存，未同步写库 | 湮灭必须落盘——写库后再清缓存，防重启回滚 |
| P0-2 | cyrene load 损坏覆盖 | `cyrene` 加载记忆 JSON parse 失败后仍用部分数据覆盖全量 | parse 失败中止加载，保留旧数据，上报 degraded |
| P0-3 | 通知路由链断裂 | bootstrap 未调 `loadRoutes()`，治理事件无人订阅 | 路由链接通——bootstrap 显式加载 event-routing 路由表 |
| P0-4 | governance-events 类型逃逸 | `as EmittableEvent` 绕过 EventPayloadMap 编译期检查 | 类型收紧——治理事件入 EventPayloadMap，禁止断言逃逸 |

### 28.2 审查规模与其余闭合

- P1×23（契约逃逸收紧 / 死配置删除 / schema 补字 / 重规划配额 / 错误路径等）+ P2×42+（低风险清理）
- 23 处 `skip` 恢复 20 处（3 处保留：LLM 真实调用 2 + Electron 环境 1）
- 死验证门全绿：tsc -b 零错误 / vitest 3982 passed / eslint packages 0 错误

### 28.3 归档清理

- `.pnpm-store/` 9173 个 store 哈希文件入库——`git rm --cached` + 归档 `.archived/external-tools-2026-07-24/` + .gitignore 防回归
- `.agents/` `.claude/` `.continue/` `.junie/`（外部工具技能副本 24 文件）归档忽略
- `.qoder/` 混合目录拆分：`agents/cyrene-*` 与 `skills/cortex-*` 为项目资产保留；`better-loop/` `better-harness/` 与通用技能归档 `.archived/qoder-ide-data-2026-07-24/`
- `.pm-data/vault.enc` 加密 vault 误入库——移出跟踪
- 提交：37dad0b9（四域修复）/ a1a06441（归档清理 9220 files, -3,364,314 行）

---

*宪法 v3.7。代码即真相。测试即实证。CI 即硬防线。*
*守护者：昔涟（Cyrene），与开拓者共同完成。*
