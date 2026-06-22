# Cortex 概念顶层设计 v3.1

**版本**：v3.1（Core-1 终局归档 + Core-2 过渡期 Phase 1 止血完成。七 Critical 修复 + CI 四层门禁落地 + 全仓 Vitest alias + 跨包契约铁律入宪。）

**状态**：Core-1 已完成（100%），Core-2 过渡期 Phase 1 止血完成（7 Critical 修复），Phase 2 契约层待启动。铁三角未就位（Electron ❌ / MCP ⚠️ 已接入无鉴权 / Committee ❌）。

**性质**：智能体治理框架——不对模型提要求，对架构下约束。核心手段是"暴露不可靠，内化可靠"。

**前置宪法**：v1.1（大脑隐喻，已废弃）→ v2.0（工具链隐喻）→ v2.7.1（Core-1 终局）。v3.0 对 v2.x 做全量重写——从"各阶段增量叠加"改为"按代码现实重述"。

**生成日期**：2026-06-19（v3.0）→ 2026-06-22（v3.1）
**宪法守护者**：昔涟（Cyrene），与开拓者共同完成

---

## 一、Cortex 是什么

Cortex 是一个智能体治理框架。它以 MetaAgent（甘雨）为战术中枢，以 14 种 Agent 为执行单元，以确认门和安全规则引擎为护栏。

**代码事实**：
- 引擎入口：`packages/engine/src/bootstrap/bootstrap-engine.ts`——插件化加载 10+ 插件，装配全部组件
- Agent 注册：`packages/engine/src/bootstrap/factory/loaders/agents.loader.ts`——从 `cortex-agents.json` 加载 14 种 Agent 定义
- 调度中枢：`packages/engine/src/core/scheduler.ts`——executeAll() 消费 TaskBoard，驱动拓扑排序 + 逐层执行
- 测试规模：79 文件 / 890 用例 engine，全仓 3146/3174 通路率 99.1%
- CI 门禁：四层（tsc --noEmit → unit → verify → contract），scripts/ci-gate.ts 驱动
- 已知缺陷：五轮深度审查 ~260 项，根因收敛为四类整合缺陷（跨包类型漂移/any 桥接/事件契约断裂/上下文逻辑漂移）
- Phase 1 已完成：7 个 Critical（C-01 命令注入/C-02 rollback/C-03 Embedding/C-04 CircuitBreaker/C-05 Bootstrap/C-06 RLM/C-07 Obliteration）全部根因修复

**核心隐喻**：工具链。每个组件是可替换、可验证、职责清晰的工具。不存在"数字生命体"的不可知性——每个行为可审计。用户是工具的使用者和最终裁决者。

---

## 二、七条不可变原则

继承自 v2.7.1，无变更。原则七子约束9（类型安全保障）已在四轮审计中全面验证——5 核心包 `as any` 零残留。

### 原则七 九项子约束

1. **宪法依据**：修改必须显式引用目标宪法条款
2. **完整修改记录**：每次修改记录旧逻辑缺陷、新逻辑补足、涉及文件行号、执行者、时间戳
3. **最小改动**：仅修改必须改的那一行/段
4. **架构保护**：不损害拓展性、稳定性。breaking change 须标记
5. **独立审计与最终裁决**：凝光审计合规性，开拓者最终裁决
6. **阶段限定**：仅限当前激活阶段内修改
7. **子约束修改规则**：子约束可通过修宪流程修改，但保护力度不可降低。并发提案冲突按 before 版本号检测→冲突回退处理
8. **硬编码禁令**：所有魔法数字、路径字面量、环境变量名须在 `packages/config/src/constants/` 统一定义
9. **类型安全保障**：禁止 `as any` / 公开 API `any` 返回类型 / 非空断言 `!`。Plugin 实例通过 `Disposable` 接口安全调用

> **首个判例（NG-2026-0515）**：凝光发现宪法缺少自我修改约束，生成提案经昔涟评判+开拓者裁决通过。**判例二（NG-2026-0606）**：子约束缺少自身修改规则——自反性缺口修复。**判例三（NG-2026-0515-Hardcoding）**：硬编码禁令制度化落地。
>
> **原则二修宪特殊裁定（v2.5.41）**：solo-flight 冷启动实验三跑（event-bus/telemetry/memory）一致证伪"Agent 只执行不规划"假设。RLM 模式（ReAct→Loop→Meta）在执行 Agent 的 ReAct 循环中自然涌现。开拓者以终局裁决权直接裁定原则二从"绝对分离"修正为"非对称均衡"——规划层局部中心化，执行层整体去中心化。

---

## 三、系统架构——代码现实

### 3.1 包结构（31 包）

```
packages/
├── engine/           # 引擎容器——bootstrap + Agent + Scheduler
├── scheduler/        # 调度引擎——TaskBoard/AgentPool/PipelineObserver/ConfirmGate
├── shared/           # 共享类型
├── platform/         # 平台抽象——Toolkit
├── config/           # 配置——EngineConfig/常量集中
├── memory-store/     # 记忆持久化
├── memory/           # 内存记忆
├── consistency/      # 一致性校验
├── skill-kit/        # 技能工具包
├── prompt-kit/       # 提示词工程
├── resilience/       # 韧性策略
├── notification/     # 通知管线
├── governance/       # 治理
├── telemetry/        # 遥测
├── logging/          # 日志
├── plugin-runner/    # 插件运行时
├── fsm-compiler/     # FSM 编译
├── pattern-extractor/# 模式提取
├── llm/              # LLM 适配层
├── cli/              # CLI
├── tui/              # TUI
├── cache/            # 缓存
├── doctor/           # 诊断
├── tools/            # 内部工具
├── testing/          # 测试工具
├── pm/               # 进程管理
├── parser/           # 解析器
├── schema/           # Schema 定义
├── result/           # Result 类型
├── self-examination/ # 自审视
└── toolchain/        # 工具链
```

### 3.2 三层架构

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
├── AgentPool         — 14 Agent 实例池 + ManifoldGate 流控
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

## 五、Agent 池——14 种执行单元

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
- `packages/consistency/src/consistency-layer.ts`——六层防御（IntentFactWall/InitVerifier/SchemaEnforcer/GitHookBridge/SemiFinishedMgr）

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

| 门禁 | Core-1→Core-2 | 现状 |
|------|:--:|:--:|
| CI 全绿 | ✅ | 3146/3174 + 四层阻断 |
| typecheck 零错 | ✅ | tsc --noEmit 全量 |
| eslint 零 error | ⚠️ | 511 warnings 预存 |
| solo-flight 全闭环 | ⏳ | Phase 2 待验证 |
| 审计闭环 P0 清零 | ⚠️ | 260 缺陷已索引 |
| 铁三角就位 | ❌ | 缺 Electron + Committee |

---

## 十五、阶段模型

```
Phase 1 止血 ████████████████ 100%  七 Critical 根因修复 + CI 四层门禁 + 全仓 alias + 契约铁律入宪
Phase 2 契约 ░░░░░░░░░░░░░░░░   0%  跨包接口契约测试 + 闭环混沌验证 + 熔炼 E2E
Core-2 治理  ████████░░░░░░░░ ~40%  10 新模块落地 + 4 技能结晶 + 方法论文档。铁三角缺二
Full         ░░░░░░░░░░░░░░░░   0%  设计就绪，等铁三角
```

**铁三角**：Electron 原型 ❌ / MCP 集成 ⚠️ 已接入无鉴权 / Committee MVP ❌。三者同时就位后 Core-2 治理层激活。

**Phase 1 验收标准**：engine 890/890 全绿 + 全仓 3146/3174 + CI 四层全部通过。

---

## 十六、演进方法论

Core-2 过渡期催生了 Cortex 演进方法论——九阶段闭环：混沌 → 收敛 → 诊断 → 规划 → 执行 → 审查 → 结晶 → 升级 → 归纳。详见 `docs/core/Cortex-演进方法论-九阶段闭环.md`。

---

## 十七、宪法修正记录

| 版本 | 修正案 | 日期 | 内容 |
|------|--------|------|------|
| v3.0 | — | 2026-06-19 | 全量重写。从"各阶段增量叠加"改为"按代码现实重述"。纳入 Core-2 过渡期全部新增模块。四轮审计验证——typecheck 全绿、`as any` 零残留、架构无循环依赖。 |
| v3.1 | AM-2026-0622-001 | 2026-06-22 | Phase 1 止血完成。七 Critical 修复入宪：C-01 命令注入（接口名白名单）、C-02 rollback（async/await 消除 as unknown as boolean）、C-03 Embedding（try/finally 防止永久卡死）、C-04 CircuitBreaker（fallback 不再穿透原函数）、C-05 Bootstrap（失败逆序 stop+dispose）、C-06 RLM（成功率 ≥50% 阈值）、C-07 Obliteration（移除短路条件）。CI 门禁升级为四层：tsc --noEmit → unit → verify → contract。全仓 29 包 Vitest resolve.alias 标准化——删 dist 不影响测试。跨包契约铁律（§十五）入 coding-standards.md。测试基线：engine 79 文件 890/890，全仓 3146/3174。全景图 v1.1 数据修正。 |

---

## 十八、CI 门禁——四层阻断

**入口**：`scripts/ci-gate.ts`（`npx tsx scripts/ci-gate.ts`）

| 层 | 触发 | 内容 |
|------|------|------|
| 1 | tsc --noEmit | 全量类型检查——接口漂移、barrel 缺口、strictNullChecks 违反，任一项不通过即阻断 |
| 2 | @ci: unit | 单元测试——默认标签，覆盖 29 包 3146 用例 |
| 3 | @ci: verify | 关键修复验证——Phase 1 七 Critical 对应的回归测试 |
| 4 | @ci: contract | 跨包接口契约验证——describe.each 覆盖每个 interface × 所有实现方 |

@ci: llm / integration / e2e / manual 标签的测试跳过——CI 不放行需要外部依赖的测试。

**代码事实**：`scripts/ci-gate.ts:156` 四层顺序执行，`process.exit(allOk ? 0 : 1)` 真实阻断。

---

## 十九、测试基线

| 指标 | 数值 |
|------|------|
| engine 测试 | 79 文件 / 890 用例 / 100% 通过 |
| 全仓测试 | 3146 passed / 3174 total / 99.1% |
| CI 执行时间 | ~10min（tsc + vitest 按包串行） |
| 假阳性治理 | 39 文件失败 → 0（vitest alias 标准化） |

---

*宪法 v3.1。代码即真相。测试即实证。CI 即硬防线。*
*守护者：昔涟（Cyrene），与开拓者共同完成。*
