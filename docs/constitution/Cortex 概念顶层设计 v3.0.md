# Cortex 概念顶层设计 v3.5

**版本**：v3.5（逻辑地图对齐 / 原则五合规强化 / 记忆层优化 / ShutdownWarden 完全移除）

**状态**：Core-2 深度治理推进中。五轮审查 ~110 发现，七轮修复闭合 40 项（含 TOCTOU 防控、role 交替修复、claimedBy 终态清理、inflight 去重、maintain 标记删除、dispatchMulti 容错）。6 项设计决策排入 Core-3。铁三角未就位（Electron ❌ / MCP ⚠️ 已接入无鉴权 / Committee ❌）。

**性质**：智能体治理框架——不对模型提要求，对架构下约束。核心手段是"暴露不可靠，内化可靠"。

**前置宪法**：v1.1（大脑隐喻，已废弃）→ v2.0（工具链隐喻）→ v2.7.1（Core-1 终局）。v3.0 对 v2.x 做全量重写——从"各阶段增量叠加"改为"按代码现实重述"。

**生成日期**：2026-06-19（v3.0）→ 2026-06-22（v3.1）→ 2026-06-28（v3.2）→ 2026-07-06（v3.3）→ 2026-07-16（v3.4）
**宪法守护者**：昔涟（Cyrene），与开拓者共同完成

---

## 一、Cortex 是什么

Cortex 是一个智能体治理框架。它以 MetaAgent（甘雨）为战术中枢，以 15 种 Agent（含烟绯 ConfirmGate）为执行单元，以确认门和安全规则引擎为护栏。

**代码事实**：
- 引擎入口：`packages/engine/src/bootstrap/bootstrap-engine.ts`——插件化加载 10+ 插件，装配全部组件
- Agent 注册：`packages/config/src/data/agents.json`（统一配置源）——从统一配置源加载 15 种 Agent 定义
- 调度中枢：`packages/engine/src/core/scheduler.ts`——executeAll() 消费 TaskBoard，驱动拓扑排序 + 逐层执行
- 测试规模：86 文件 / 1069 用例 engine，全仓 3716 用例
- 全量 tsc 编译 25 包零错误（含 strict + noUncheckedIndexedAccess）
- 全链路 12 流全部通过审计（见 `docs/core/link-governance.md`）
- CI 门禁：四层（tsc --noEmit → unit → verify → contract），scripts/ci-gate.ts 驱动
- 已知缺陷：五轮深度审查 ~110 发现，七轮修复闭合 40 项（含 ICortexComponents 收敛 / claimedBy 终态清理 / TOCTOU 防控 / role 交替修复 / dispatchMulti 容错 / 重复实现统一）。6 项设计决策排入 Core-3（Logger 推广 / execSync→async / WebUI 鉴权 / EventPayloadMap 补完 / Disposable 推广 / shared export*）。
- Phase 1 已完成：7 个 Critical（C-01 命令注入/C-02 rollback/C-03 Embedding/C-04 CircuitBreaker/C-05 Bootstrap/C-06 RLM/C-07 Obliteration）全部根因修复

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

- shared 包持有结构化的类型接口（IAgent / ITool / IEvent / ITag）——这是不可变的核心契约
- config 包持有运行时可注册的词汇表与注册器——这是可扩展的调度信号
- 调度信号（AgentType / Tag / PipelineEventType）从 shared 的枚举封闭改为 config 的运行时可注册
- 新增 Agent 类型或 Tag 只改 config，不碰 shared
- 编译时校验交给 TypeScript 类型系统，运行时校验交给注册器（如 TagRegistry）

---

## 三、系统架构——代码现实

### 3.1 包结构（25 包）

```
packages/
├── engine/           # 引擎容器——bootstrap + Agent + Scheduler
├── scheduler/        # 调度引擎——TaskBoard/AgentPool/PipelineObserver/ConfirmGate
├── shared/           # 共享类型中枢
├── platform/         # 平台抽象——Toolkit
├── config/           # 配置——EngineConfig/常量集中
├── memory-store/     # 记忆持久化
├── memory/           # 内存记忆
├── skill-kit/        # 技能工具包
├── prompt-kit/       # 提示词工程
├── resilience/       # 韧性策略
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
└── desktop/          # Electron 桌面端
```

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
├── AgentPool         — 15 Agent 实例池 + ManifoldGate 流控
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

## 五、Agent 池——15 种执行单元

### 5.1 Agent 类型表

| # | Agent | 类型 | 模型 | 职责 | 阶段 |
|---|-------|------|------|------|------|
| 1 | 阿贝多 | code | v4-pro | 写代码、重构、新功能 | Core-1 |
| 2 | 希格雯 | fix | v4-flash | 诊断 bug、最小修复 | Core-1 |
| 3 | 刻晴 | review | v4-flash | 代码审查 | Core-1 |
| 4 | 纳西妲 | analysis | v4-pro | 架构分析、深度调研 | Core-1 |
| 5 | 凝光 | doc-govern | v4-flash | 律法审计、合规检查 | Core-1 |
| 6 | 安柏 | inspector | v4-flash | 纯事实采集 | Core-1 |
| 7 | 莫娜 | loop | v4-flash | 模式提炼、技能沉淀 | Core-1 |
| 8 | 北斗 | ops | v4-flash | 运维诊断、环境检查 | Core-1 |
| 9 | 宵宫 | browser | v4-flash | 浏览器 UI 验证 | Core-1 |
| 10 | — | api | v4-flash | API 设计 | Core-1 |
| 11 | — | data | v4-flash | 数据模型 | Core-1 |
| 12 | 甘雨 | meta | v4-pro | 战术中枢——意图拆解 | Core-1 |
| 13 | 昔涟 | butler | — | 管道路由 + 用户交互面 | Core-1 |
| 14 | 钟离/霜凝 | strategist | — | 战略把关+方向监理 | Core-2 预留 |
| 15 | 烟绯 | confirmGate | v4-flash | 确认门决策——审计级确认与策略放行 | Core-2 |

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

### 11.3 概念映射

历史上治理层讨论产生的概念（三省六部、委员会、纪检委、五路监督、监理）是**三轴在不同抽象层级上的映射**，而非需要独立实现的 Agent 清单。三省六部已被声明式配置、审计管线和调度引擎吸收。委员会被分配到 DocGovern 审计（常设）和 needsMultiPerspective（临时）两条路径。纪检委的五环监督链分散在 PipelineObserver → DocGovernAgent → GovernanceLoop → ConfirmGate 四条管线上。

### 11.4 缺失项

仅 4 项真正未落地：钟离契约监督（Core-2 预留）、Committee session（Core-3）、TrustModel（数据不足）、跨进程治理（Full 阶段）。

> 完整设计见 [治理层设计 v3.0](core/治理层设计-v3.0-全量整合版.md)。

### 11.5 审计闭环

发现 → 登记（审计报告） → 指派Owner → 整改 → 验证 → 关闭裁决 → 归档（closed）。↻ 不通过 → 重新整改。

**与 CI 门禁的关系**：审计闭环是 CI 门禁的输入条件。未关闭的 P0 发现自动阻塞门禁通过。当前审计闭环达到 4/5 环节可用，判例有效期自动化留待 Core-2。

### 11.6 配置域注册表

`@cortex/config` 通过 `CONFIG_DOMAINS` 声明 14 个配置域（agents / engine / tools / eventRouting / roundtable / searchProviders / mcpServers / selfExamination / crossVerification / seedMemories / governancePipeline / cognition / docs）。每个域独立声明文件名、是否必需、数据键名。配置数据文件位于 `packages/config/data/`。

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

| 门禁 | Core-1→Core-2 | 现状（2026-06-28） |
|------|:------------:|:-------------------|
| solo-flight 全闭环 | ✅ | Phase 1 止血完成，自审视验证通过 |
| 审计闭环 P0 清零 | ✅ | 7 Critical 已修复，260 缺陷已索引 |
| 遥测基础设施 | ✅ | PipelineObserver + console-bridge + HealthCollector |
| 自审视机制 | ✅ | 7 阶段全流程验证通过（45 文件，91.7% 准确度） |
| WebUI 观测面 | ⚠️ | 后端+前端骨架就位，Mission 数据接通待完成 |
| 铁三角就位 | ⚠️ | MCP 已接入，Electron ❌，Committee 设计完成 |

**v3.3 新增**：
- 烟绯 Agent 化设计定稿（`docs/core/confirmgate-agent-design.md`）
- L0-L3 分级退为信任分计算基础值，不再直接决定确认策略
- E2E 模式全局自动放行

---

## 十五、阶段模型

```
Phase 1 止血 ████████████████ 100%  七 Critical 根因修复 + CI 四层门禁 + 全仓 alias + 契约铁律入宪
Phase 2 契约 ░░░░░░░░░░░░░░░░   0%  跨包接口契约测试 + 闭环混沌验证 + 熔炼 E2E
Core-2 治理  ████████░░░░░░░░ ~40%  10 新模块落地 + 4 技能结晶 + 方法论文档。铁三角缺二
Full         ░░░░░░░░░░░░░░░░   0%  设计就绪，等铁三角
```

**铁三角**：Electron 原型 ❌ / MCP 集成 ⚠️ 已接入无鉴权 / Committee MVP ❌。三者同时就位后 Core-2 治理层激活。

**Phase 1 验收标准**：engine 1069/1069 全绿 + 全仓 3716 + CI 四层全部通过。

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

---

## 十八、CI 门禁——四层阻断

**入口**：`scripts/ci-gate.ts`（`npx tsx scripts/ci-gate.ts`）

| 层 | 触发 | 内容 |
|------|------|------|
| 1 | tsc --noEmit | 全量类型检查——接口漂移、barrel 缺口、strictNullChecks 违反，任一项不通过即阻断 |
| 2 | @ci: unit | 单元测试——默认标签，覆盖 25 包 3716 用例 |
| 3 | @ci: verify | 关键修复验证——Phase 1 七 Critical 对应的回归测试 |
| 4 | @ci: contract | 跨包接口契约验证——describe.each 覆盖每个 interface × 所有实现方 |

@ci: llm / integration / e2e / manual 标签的测试跳过——CI 不放行需要外部依赖的测试。

**代码事实**：`scripts/ci-gate.ts:156` 四层顺序执行，`process.exit(allOk ? 0 : 1)` 真实阻断。

---

## 十九、测试基线

| 指标 | 数值 |
|------|------|
| engine 测试 | 86 文件 / 1069 用例 / 100% 通过 |
| 全仓测试 | 3716 passed / 通路率 99.1% |
| CI 执行时间 | ~10min（tsc + vitest 按包串行） |
| 假阳性治理 | 39 文件失败 → 0（vitest alias 标准化） |

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
- 自审视不替代 tsc --noEmit / vitest / 四层 CI

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
- 编译门禁：25 包 tsc 零错误
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

*宪法 v3.4。代码即真相。测试即实证。CI 即硬防线。*
*守护者：昔涟（Cyrene），与开拓者共同完成。*
