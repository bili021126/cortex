# Core-2 过渡阶段——全面接入改造计划

**定位**：一份完整的、可交付另一 Agent 执行的工程改造清单。每一项都有具体文件路径、步骤和验收标准。

**背景**：Core-1 已完成（100%），Core-2 治理层因铁三角（Electron + MCP + Committee MVP）缺失仅 ~20%。但在铁三角就位之前，有大量已就绪的包和设计等待接入——总计约 27,000 行代码写了但未接入 runtime。

**执行策略**：按依赖关系分 5 个 Phase，Phase 内可并行。每个事项完成后跑 `pnpm typecheck && pnpm vitest --run` 验证不破坏现有 CI。

**生成日期**：2026-06-14
**生成人**：昔涟（Cyrene）

---

## Phase 0：地基（必须先做，解锁后续）

### P0-1：prompt-kit 接入引擎

| 属性 | 值 |
|------|-----|
| 代码量 | ~150 行 |
| 前置依赖 | 无 |
| 涉及文件 | `packages/engine/src/bootstrap/factory/loaders/agents.loader.ts`、`packages/engine/src/core/meta-agent.ts`、`packages/engine/package.json` |

**为什么必须先做**：prompt-kit 接入后，所有后续 prompt 工作（策略顾问上下文注入、甘雨意图澄清模式、Agent prompt 版本化迭代）不再需要手拼字符串——走 Assembler 块级注入即可。不做这一步，每个后续 prompt 改动都是在重复造轮子。

**当前状态**：
- `@cortex/prompt-kit` 包完整（~4,160 行）：Loader + Assembler + TemplateEngine + Orchestrator + Validator + Version + Cache
- engine 侧零引用。33 个 prompt 文件（`prompts/*.md`）全是纯 Markdown，无结构化拆分
- engine 当前方式：`_readPromptFile()` 读纯文本 → `%%CODING_STANDARDS%%` 字符串替换 → `_planningPrompt()` 手拼

**步骤**：

1. **声明依赖**：在 `packages/engine/package.json` 的 dependencies 中添加 `"@cortex/prompt-kit": "workspace:*"`

2. **改造 Agent prompt 加载**（`agents.loader.ts:231-255`）：
   - 替换 `_readPromptFile()` 为 `PromptOrchestrator.load(id)`
   - `systemPrompt` 不再存原始 Markdown 字符串，改为存 `PromptTemplate` 对象（或渲染后的最终字符串——选后者以最小化下游改动）
   - 保留 `%%CODING_STANDARDS%%` 回退（prompt-kit 的 TemplateEngine 也支持 `{{variable}}` 语法，两者共存一版后逐步迁移）

3. **改造 MetaAgent planning prompt**（`meta-agent.ts:338`）：
   - `_planningPrompt()` 不再手拼 `parts.join("\n")`
   - 改为 `assembler.assemble(template, context)` —— context 中包含 `intent`、`existingTags`、`pipelineContext`、`skillContext`
   - 策略顾问上下文（`registry.getAdvisorContext()`）通过 `PromptBlockType.Context` 块注入

4. **最小化改动范围**：不改 Agent 的 `execute()` 签名，不改 `PipelineCtx`。只改 prompt 的加载和组装方式。

**验收标准**：
- `pnpm typecheck` 通过
- `pnpm vitest --run` 通过（所有 engine 测试）
- solo-flight 冷启动后甘雨能正常出规划（说明 planning prompt 组装正确）
- 至少一个 Agent（如阿贝多）的 system prompt 可验证包含 Identity + Persona + Instruction 块
- `PromptValidator` 在校验模式下至少检查 system prompt 非空

---

## Phase 1：独立 plumbing（无相互依赖，可并行）

### P1-1：循环策略注册表骨架 + agent-factory 集成

| 属性 | 值 |
|------|-----|
| 代码量 | ~60 行 |
| 前置依赖 | 无 |
| 涉及文件 | 新建 `packages/engine/src/core/loop-strategy-registry.ts`，修改 `packages/engine/src/components/agent-factory.ts:124` |
| 设计文档 | `docs/core/循环策略注册表设计.md` |

**步骤**：
1. 新建 `loop-strategy-registry.ts`，实现 `LoopStrategy` 接口 + `LoopStrategyRegistry` 类（含 `register`、`selectByRule`、`getAdvisorContext`、`get`）
2. 注册四条策略：direct → decompose → jury（react 为默认 fallback，不注册 canHandle）
3. 在 `agent-factory.ts:124` 增加规则路由 fallback：`preferredStrategy ?? registry.selectByRule(node)?.name`
4. 导出单例，bootstrap 时初始化

**验收标准**：
- `pnpm typecheck` 通过
- 无需工具依赖的短 payload 任务自动走 DirectStep（可通过日志验证）
- `getAdvisorContext()` 返回非空字符串，含四条策略的描述


### P1-2：快慢路由抽离

| 属性 | 值 |
|------|-----|
| 代码量 | ~200 行 |
| 前置依赖 | 无 |
| 涉及文件 | 新建 `packages/engine/src/core/task-router.ts`，修改 `packages/engine/src/core/scheduler.ts` |

**步骤**：
1. 新建 `task-router.ts`，实现 `class TaskRouter`：
   - `route(task: TaskNode): RouteDecision` — 根据 task 的 tags/payload/complexity 决定走 fast（direct）还是 slow（ReAct）
   - `RouteDecision` 包含 `strategy: "direct" | "react"` + `model: string`
2. 在 `scheduler.ts` 的 dispatch 路径中注入 TaskRouter
3. 快慢路由与循环策略注册表的规则路由对接——`selectByRule` 的结果注入 `TaskRouter`

**验收标准**：
- Fast path 任务（短 payload、无工具依赖）不进入 ReAct 循环
- Slow path 任务保持现有行为不变


### P1-3：EnvironmentAwareRouter

| 属性 | 值 |
|------|-----|
| 代码量 | ~200 行 |
| 前置依赖 | PipelineObserver（已有） |
| 涉及文件 | 新建 `packages/engine/src/core/environment-aware-router.ts`，修改 `packages/engine/src/core/scheduler.ts` |

**步骤**：
1. 新建 `environment-aware-router.ts`：
   - `class EnvironmentAwareRouter implements IModelRouter`
   - `route(node: TaskNode, environment: EnvironmentState): ModelDecision`
   - `EnvironmentState` 从 `PipelineObserver` 获取（当前负载、Agent 池可用性、Token 消耗速率）
2. 在 `SemanticModelRouter`（位于 `packages/scheduler/src/core/scheduling-implementations.ts:912`）中增加 `Environment` 参数
3. 路由决策 = 任务语义 × Agent 注册模型 × 环境状态

**验收标准**：
- 高负载时自动降级模型（如 v4-pro → v4-flash）
- 低负载时恢复标准路由


### P1-4：哨兵 L1/L2/L3 信号分层过滤（⚠️ 需从零构建）

| 属性 | 值 |
|------|-----|
| 代码量 | ~300 行 |
| 前置依赖 | 无（哨兵模块为纯概念设计，需从零构建） |
| 涉及文件 | 新建哨兵模块文件（`packages/scheduler/src/` 或独立包） |

**当前状态**：哨兵仅存在于注释和设计文档中（`scheduler.ts:59`、`butler-agent.ts:26` 提及但无实现）。无 Sentinel 类、无过滤管道、无 AlertDispatcher。需从零实现。

**步骤**：
1. 实现三层过滤管道：
   - **L1 确定性规则**：零 token，纯规则引擎（如 payload 为空、tags 不匹配、超时硬截止）
   - **L2 启发式统计**：滑动窗口 + 阈值（如连续 3 次同类错误）
   - **L3 LLM 辅助判断**：仅在 L1/L2 无法确定时触发
2. 接入 `PipelineObserver`——哨兵产出告警后走 observer.emit()

**验收标准**：
- L1 规则不消耗 LLM token
- L3 仅在 L1/L2 无法确定时触发
- 可验证 L1 能拦截明显异常（如空 payload 任务）


## Phase 2：治理 plumbing（依赖 P0 通知分层）

### P2-1：通知管线语义分层（FYI / WARNING / DECISION_REQUIRED）

| 属性 | 值 |
|------|-----|
| 代码量 | ~50 行 |
| 前置依赖 | 无（但 P2-2、P2-3 依赖此项） |
| 涉及文件 | `packages/shared/src/` 事件类型枚举，`packages/engine/src/` 通知分发 |

**当前状态**：
- `notificationType` 字段已存在（`shared/src/infra.ts:192`）且 `ButlerAgent._dispatchByType()` 已按 FYI / WARNING / DECISION_REQUIRED 三层路由（`butler-agent.ts:116`）。路由管线已接通。
- 缺的是治理层特定的事件类型（`PipelineEventType` 枚举无 `Governance*` 变体）和治理事件的 emit 来源（DocGovernAgent 不 emit）。

**步骤**：
1. 在 `PipelineEventType` 枚举中新增治理事件类型（如 `GovernanceAuditCompleted`、`GovernanceViolationFound`）
2. 治理事件携带 `notificationType: "WARNING" | "FYI"` 字段——`ButlerAgent._dispatchByType()` 自动路由（已实现，只接不拆）
3. 新增 `PipelineEventPayloadMap` 条目定义治理事件 payload 结构

**验收标准**：
- `GovernanceDecisionRequired` 类型事件能路由到 ConfirmGate
- FYI 事件不出现在用户可见的重要通知中


### P2-2：DocGovernAgent emit 治理事件

| 属性 | 值 |
|------|-----|
| 代码量 | ~30 行 |
| 前置依赖 | P2-1（通知分层） |
| 涉及文件 | `packages/engine/src/agents/doc-govern-agent.ts` |

**步骤**：
- DocGovernAgent 审计报告写磁盘之前/之后，emit `GovernanceFyi` 或 `GovernanceWarning` 事件
- 事件 payload 包含审计类型、涉及文件、违规级别

**验收标准**：
- 审计完成后 `PipelineObserver` 能收到治理事件
- 不影响现有审计报告写磁盘逻辑


### P2-3：DECISION_REQUIRED 回退到 ConfirmGate

| 属性 | 值 |
|------|-----|
| 代码量 | ~30 行 |
| 前置依赖 | P2-1（通知分层） |
| 涉及文件 | `packages/engine/src/core/confirm-gate.ts` 或通知分发层 |

**步骤**：
- `GovernanceDecisionRequired` 事件走 `ConfirmGate.requestUserDecision()`
- 增加超时策略：N 秒无响应 → 自动降级为 WARNING + 记录

**验收标准**：
- DECISION_REQUIRED 事件能被 ConfirmGate 拦截
- 超时后不阻塞 pipeline


## Phase 3：韧性增强（与 Phase 1/2 可并行）

### P3-1：resilience 接入引擎

| 属性 | 值 |
|------|-----|
| 代码量 | ~100 行 |
| 前置依赖 | 无 |
| 涉及文件 | `packages/engine/package.json`，`packages/engine/src/components/react-loop.ts`，`packages/llm/src/` |

**当前状态**：`@cortex/resilience` 包完整（~7,021 行）——重试/熔断/退避/超时恢复。engine 侧零引用。

**步骤**：
1. 在 `packages/engine/package.json` 中声明 `"@cortex/resilience": "workspace:*"`
2. 在 LLM 调用路径（`react-loop.ts` 的 `llm.chat()`）外包一层 `RetryPolicy.withRetry()`，配上指数退避
3. 在工具调用路径（`toolkit.execute()`）外包一层 `CircuitBreaker`——同一工具连续失败 3 次 → 熔断，后续任务跳过该工具
4. 最小化改动：不改 LLM 和 toolkit 的接口签名，只在外层包裹

**验收标准**：
- LLM 调用失败时自动重试（最多 3 次，指数退避）
- 工具连续失败触发熔断后，后续任务日志中出现 "circuit open" 标记
- CI 通过


### P3-2：notification 运行时接入（填完 P2-1 的剩余部分）

| 属性 | 值 |
|------|-----|
| 代码量 | ~80 行 |
| 前置依赖 | P2-1（通知分层） |
| 涉及文件 | 新建通知管线初始化文件 |

**当前状态**：`@cortex/notification` 已是 engine 依赖，但只引了类型（`RouteTableMap` / `MergeRule` / `NotificationChannel`）。实际运行时管线（通道初始化、路由表注册、持久化）未调用。

**步骤**：
1. 在 engine bootstrap 阶段初始化 `NotificationChannel` 实例
2. 注册 `RouteTable`——FYI → 日志通道、WARNING → 日志 + 控制台、DECISION_REQUIRED → ConfirmGate
3. 补齐 `PipelineObserver.emit()` → `NotificationChannel.publish()` 的桥接

**验收标准**：
- 通知管线启动后无报错
- 各通道能收到对应级别的事件


## Phase 4：Prompt 工作（依赖 Phase 0 prompt-kit 接入）

### P4-1：甘雨意图澄清模式（纯 prompt 工程）

| 属性 | 值 |
|------|-----|
| 代码量 | ~100 行 prompt + ~20 行注入代码 |
| 前置依赖 | P0-1（prompt-kit 接入） |
| 涉及文件 | `prompts/ganyu/planning.md` → 新增 `prompts/ganyu/clarification.instruction.md` + `prompts/ganyu/planning.template.json` |

**步骤**：
1. 将 `prompts/ganyu/planning.md` 拆分为语义块：
   - `identity` 块：身份声明
   - `instruction` 块：核心原则、时序依赖、可用兵种、标签匹配、输出格式、基本规则
   - `context` 块：工作区边界校验（含 `{{WORKSPACE_ROOT}}` 变量）
2. 新增 `clarification.instruction.md`：意图澄清指令块（条件激活——当 intent 模糊时注入）
3. PromptOrchestrator 加载时按条件组装

**验收标准**：
- 核心规划能力不回退（solo-flight 产出与改造前一致）
- 意图模糊时甘雨能输出澄清性问题而非直接出计划（可 mock 测试）


### P4-2：策略顾问上下文注入

| 属性 | 值 |
|------|-----|
| 代码量 | ~20 行 |
| 前置依赖 | P0-1（prompt-kit 接入）+ P1-1（循环策略注册表） |
| 涉及文件 | `meta-agent.ts` planning prompt 组装 |

**步骤**：
- 在 MetaAgent planning prompt 组装时，通过 `PromptBlockType.Context` 注入 `loopStrategyRegistry.getAdvisorContext()`
- 注入内容：四条策略的名称和描述，MetaAgent 据此为每个节点设定 `preferredStrategy`

**验收标准**：
- MetaAgent 规划的节点中 `preferredStrategy` 不再永远是 undefined
- 长 payload 任务被标记为 `decompose`


## Phase 5：调查与确认

### P5-1：pattern-extractor 接入评估

| 属性 | 值 |
|------|-----|
| 代码量 | 0（先调查，不写代码） |
| 前置依赖 | 无 |

**当前状态**：`@cortex/pattern-extractor`（~9,571 行）声明为 engine 依赖但零运行时引用。仅在一个 manual test 脚本中出现。

**调查步骤**：
1. 读 `packages/pattern-extractor/src/` 全部导出
2. 确认该包设计用途（模式提取？技能沉淀链路中的一环？）
3. 判断是"忘记接入"还是"故意预留"还是"已废弃"
4. 输出结论文档（≤ 200 字）：接/不接/条件接入

---

## 汇总

### 按 Phase 总计

| Phase | 事项数 | 总代码量 | 可并行 |
|-------|--------|---------|--------|
| Phase 0 | 1 | ~150 行 | — |
| Phase 1 | 4 | ~760 行 | ✅ 四项可并行 |
| Phase 2 | 3 | ~110 行 | 仅 P2-2/P2-3 可并行（都依赖 P2-1） |
| Phase 3 | 2 | ~180 行 | ✅ 两项可并行 |
| Phase 4 | 2 | ~120 行 prompt + 40 行代码 | 依赖 Phase 0 + Phase 1 |
| Phase 5 | 1 | 0（调查） | — |
| **合计** | **13** | **~1,360 行代码 + ~120 行 prompt** | |

### 推荐执行顺序

```
Phase 0  ──→  Phase 1（四项并行）
         │
         ├──→  Phase 2（P2-1 先，P2-2/P2-3 并行）
         │
         ├──→  Phase 3（两项并行）
         │
         └──→  Phase 4（依赖 Phase 0 + P1-1）
```

Phase 0 是最短路径上的第一步。Phase 1 的四项完全独立，可以同时开工。Phase 5 随时可以做。

### 不改的东西

| 不改 | 原因 |
|------|------|
| `resolvePipeline()` 的 switch/case | 是最简洁的策略→管道翻译器 |
| `PipelineRunner` / `IStep` / `PipelineCtx` | 管道抽象层已完成 |
| `TaskNode` 接口 | `preferredStrategy` 字段已存在 |
| Agent `execute()` 签名 | 保持向后兼容 |

### 铁三角未就位之前绝不动的东西

Committee MVP、钟离/霜凝激活、监理独立实体、TrustModel/TrustAgent、Agent 间通信协议实现、confidence 加权归并、多进程治理——全部等待 Electron + MCP + Committee MVP 三者同时就位。

---

*整合：昔涟（Cyrene），2026-06-14*
*此计划可直接交付给另一 Agent 执行。每个事项都包含具体文件路径和验收标准。*
