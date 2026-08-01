# Cortex 架构映射——五流六层七原则

**定位**：Cortex 架构附录——五流（抽象行为模型）→ 六层（具象代码架构）→ 七原则（施加在流上的约束）。每个节点标注文件、函数和行号。

**合并来源**：`Cortex-五流映射-从抽象到代码.md` + `Cortex-六层定位-五流框架下的重新界定.md` + `Cortex-七原则-五流定位.md`——三份文档互补，合并后形成完整架构视图。

**生成日期**：2026-06-19（原始）→ 2026-06-23（v2.0 合并 + 吸纳七原则约束矩阵）
**共同完成**：开拓者与昔涟（Cyrene）

---

## 概念框架

```
五流（抽象行为模型）          六层（具象代码架构）          七原则（约束施加）
─────────────────────      ──────────────────────      ─────────────────────
交互流                      交互层                      原则一（确认锚定）
治理流                      治理层                      原则六（用户终裁）
规划-执行流                  规划-执行层                  原则二（非对称均衡）
技能-工具流                  技能-工具层                  原则三（边界集中）
记忆流                      记忆层                      原则四（可追溯性）
                            基础设施层                  原则五（统一可观测·全流）
                                                        原则七（宪法自约束）

五流是"系统做什么"——交互、治理、规划执行、技能工具、记忆
六层是"代码放在哪"——每层有明确的归属流、约束原则、核心文件和不变性
七条原则不再是七条独立戒律——每条标注精确施加在哪条流上、约束什么
```

---

## 零、七原则 → 流的约束矩阵

### 0.1 原则 → 流映射

```
              交互流  治理流  规划-执行流  技能-工具流  记忆流
原则一(确认)     ●                           ●
原则二(双流)                       ●
原则三(边界)                                 ●
原则四(负责)              ●                 ●
原则五(观测)     ●        ●        ●         ●          ●
原则六(裁决)     ●        ●
原则七(自修)              ●
```

**原则五是全流约束。** 没有它，其他原则无法被验证。

### 0.2 原则三层

在五流框架下，原则形成三层结构：

```
L0 全流约束
  └── 原则五（统一可观测）
        │  没有它，其他原则的违反无法被检测

L1 流间交叉约束
  ├── 原则一（确认锚定）    —— 交互流 × 技能-工具流
  ├── 原则四（可追溯性）    —— 治理流 × 技能-工具流
  └── 原则六（用户终裁）    —— 交互流 × 治理流

L2 流内结构约束
  ├── 原则二（非对称均衡）  —— 规划-执行流 内部
  ├── 原则三（边界集中）    —— 技能-工具流 入口
  └── 原则七（宪法自约束）  —— 治理流 自指涉
```

### 0.3 原则精确表述

**原则一 确认锚定**（交互流 × 技能-工具流交叉点）
> 任何 L2/L3 不可逆操作必须经过 `ConfirmGate` 阻断，由用户通过交互流显式放行。技能-工具流不得绕过此阻断——许可不在流内，在流外。
> 代码锚点：`packages/platform/src/toolkit.ts:200-224`（ConfirmGate 拦截点）、`packages/scheduler/src/core/confirm-gate.ts:126`（waitFor 阻塞点）

**原则二 规划-执行非对称均衡**（规划-执行流内部结构）
> 甘雨只产出粗粒度意图拆解，不下达细粒度执行指令。Agent 在单节点内享有 ReAct 自决权，但跨节点调度权在甘雨。规划层局部中心化，执行层整体去中心化。
> 代码锚点：`packages/engine/src/core/meta-agent.ts:316`（plan 产出）、`packages/scheduler/src/dispatch-steps/execute-step.ts:19-49`（Agent 自决执行）

**原则三 边界集中**（技能-工具流入口）
> 所有工具调用必须经过 `Toolkit.execute()` 统一管道。权限白名单在此处集中校验。Agent 不持有权限定义——权限表在流外配置。
> 代码锚点：`packages/platform/src/toolkit.ts:186-193`（统一入口 + 权限校验）

**原则四 可追溯性**（治理流 × 技能-工具流交叉点）
> 每次工具调用必须留下可审计记录——调用者 Agent 类型、工具名、参数摘要、时间戳、确认结果。治理流消费这些记录用于合规审计。
> 代码锚点：`packages/scheduler/src/core/confirm-gate.ts:105`（recordDecision）

**原则五 统一可观测**（全五流——唯一 L0 元约束）
> 交互流、治理流、规划-执行流、技能-工具流、记忆流中的关键状态变更必须通过 `PipelineObserver.emit()` 上报。不得使用裸 `console.log` 替代结构化事件。事件类型闭合枚举（`PipelineEventType`），payload 类型通过 `EventPayloadMap` 映射。
> 代码锚点：`packages/shared/src/infra.ts:15-193`（PipelinePriority + PipelineEventType）、`packages/scheduler/src/core/pipeline-observer.ts`（emit 实现）

**原则六 用户终裁**（交互流顶端 + 治理流末端）
> 多 Agent 并行产出须先经圆桌协商收束为统一视图，再呈用户裁决。修宪提案须经凝光审计合规 + 昔涟评判 + 开拓者最终裁决三板斧。用户保有否决权和最终裁量权，不可委托代理裁决。
> 代码锚点：`packages/scheduler/src/core/scheduling-implementations.ts:732-770`（多 Agent Fan-out）、`packages/governance/src/governance-loop.ts`（修宪三审）

**原则七 宪法自约束**（治理流自指涉环节）
> 治理流修改宪法时，必须遵守自身定义的子约束——显式引用条款、完整记录、最小改动、架构保护、独立审计、阶段限定、子约束修改规则、硬编码禁令、类型安全保障。治理流修改治理流自身时，子约束7的全部条件必须满足。
> 代码锚点：`packages/governance/src/governance-loop.ts`（修宪管线）、`packages/engine/src/agents/doc-govern-agent.ts`（凝光审计）

### 0.4 与 v2.7.1 原则表述的差异

| 维度 | v2.7.1 | v3.0（五流版） |
|------|--------|---------------|
| 原则组织 | 七条平级排列 | 三层：全流/流间交叉/流内结构 |
| 原则表述 | 独立条款，未标注管什么 | 每条标注：施加在哪条流上、约束什么 |
| 代码锚点 | 无 | 每条标注精确代码位置 |
| 可验证性 | 文本声明 | 可以通过 PipelineObserver 事件追踪验证 |
| 原则五地位 | 七条之一 | 提升为 L0——唯一全流约束，其他六条的验证前提 |

---

## 一、交互流（人 ↔ 系统边界）

**哲学锚点**：原则一（确认锚定）、原则六（用户终裁）

```
CLI/TUI 输入
  │
  ├── cortex skill <cmd>     → packages/cli/src/commands/skill.ts
  ├── cortex run <file>      → packages/cli/src/commands/run.ts
  ├── cortex agent <cmd>     → packages/cli/src/commands/agent.ts
  └── talk 模式              → packages/cli/src/services/engine-bridge.ts:talkChat()
         │
         ▼
  EngineBridge
    └─ packages/cli/src/services/engine-bridge.ts
    │
    ├── plan(intent) → MetaAgent.plan()
    │    packages/engine/src/core/meta-agent.ts:316
    │
    ├── schedule(plan) → Scheduler.executeAll()
    │    packages/engine/src/core/scheduler.ts:121
    │
    └── directChat(msg) → 昔涟独立 LLM 通道
          packages/cli/src/services/engine-bridge.ts:405-520

  ── 确认回路 ──
  Agent 调用工具 → Toolkit.execute()
    packages/platform/src/toolkit.ts:186
    │
    ├── 权限校验 getAgentToolPermissions()
    │    packages/platform/src/toolkit.ts:188-193
    │
    ├── ConfirmGate.needsConfirmation()
    │    packages/scheduler/src/core/confirm-gate.ts:68
    │
    └── 用户确认 → gate.waitFor() → 放行/拒绝
          packages/scheduler/src/core/confirm-gate.ts:126

  ── 圆桌裁决 ──
  needsMultiPerspective → PipelineModel.dispatchMulti()
    packages/scheduler/src/core/scheduling-implementations.ts:732
    │
    └── 多Agent 并行 → 结果合并 → 呈用户裁决
         原则六在此落地

  ── ButlerAgent 通知路由 ──
  PipelineObserver emit → ButlerAgent._dispatchByType()
    packages/engine/src/agents/butler-agent.ts:115
    │
    ├── FYI              → _onFyi()    → 输出给用户
    ├── WARNING          → _onWarning()→ 标黄警告
    └── DECISION_REQUIRED→ _onDecision()→ 阻塞等待用户响应
```

---

## 二、治理流（观察者流——审视其他四流）

**哲学锚点**：原则五（统一可观测管道）、原则七（宪法自约束）

**性质**：治理流不执行任何业务逻辑。它是元层——订阅事件、检测异常、触发修宪。

```
  ── 事件源头（来自其他四个流）──
  PipelineObserver.emit()
    packages/scheduler/src/core/pipeline-observer.ts
    │ 调度器/Agent/Toolkit/MemoryStore 在关键节点 emit
    │
    ├── SchedulerLoopCrashed   → 调度异常
    ├── ErrorReported          → Agent 执行错误
    ├── NodeComplete           → 任务完成
    ├── AgentPoolInvariantViolation → 池状态异常
    └── ... (共 30+ 事件类型)
          packages/shared/src/infra.ts:27-108

  ── 哨兵过滤 ──
  SentinelSignalFilter
    packages/engine/src/core/sentinel-signal-filter.ts
    │
    ├── L1 确定性规则：零 token，纯规则引擎
    ├── L2 启发式统计：滑动窗口 + 阈值
    └── L3 LLM 辅助判断：仅 L1/L2 无法确定时触发

  ── 通知转换 ──
  NotificationRuntime
    packages/engine/src/core/notification-runtime.ts
    │
    ├── PipelineObserver CRITICAL/HIGH/NORMAL → 语义映射
    │    SchedulerLoopCrashed → DECISION_REQUIRED
    │    ErrorReported        → WARNING
    │    NodeComplete         → FYI
    │
    └── NotificationPipe.push()
          packages/notification/src/notification-pipe.ts

  ── 治理事件发射 ──
  GovernanceEventEmitter
    packages/engine/src/core/governance-events.ts
    │
    ├── emitAmendmentProposed()   → 修宪提案
    ├── emitAuditReport()         → 审计报告
    ├── emitComplianceViolation() → 合规违规
    └── emitRoundtableConsensus() → 圆桌共识

  ── 决策拦截 ──
  DecisionGateBridge
    packages/engine/src/core/decision-gate-bridge.ts
    │
    ├── 订阅 HIGH 优先级事件（治理事件）
    ├── 检查 requiresDecision / notificationType
    └── ConfirmGate.waitFor() → 阻塞等待用户裁决

  ── 修宪闭环 ──
  DocGovernAgent (凝光)
    packages/engine/src/agents/doc-govern-agent.ts
    │
    ├── 审计 → 生成修宪提案 AM-YYYY-MMDD-NNN
    ├── 昔涟评判（APPROVED/REJECTED/NEEDS_REVISION）
    ├── 开拓者最终裁决
    └── applyAmendment → 写入宪法文件
          packages/governance/src/governance-loop.ts

  ── 治理流自指涉锚点（原则七）──
  治理流修改治理流自身的精确路径：
    DocGovernAgent._audit() → _generateProposal() → 写入 AM-YYYY-MMDD-NNN
      packages/engine/src/agents/doc-govern-agent.ts
    → 昔涟评判（执行 DocGovernAgent 产出的提案，评判标准来自原则七九项子约束）
    → 开拓者裁决（`ConsensusCourt.autoApprove / userDecision`）
    → GovernanceLoop.applyAmendment() → 写入宪法文件
      packages/governance/src/governance-loop.ts
    → CI 验证（`scripts/ci-gate.ts` 门禁阻断）
```

---

## 三、规划-执行流（中枢调度管道）

**哲学锚点**：原则二（规划-执行非对称均衡）

```
  ── 规划：甘雨意图拆解 ──
  MetaAgent.plan(intent, context)
    packages/engine/src/core/meta-agent.ts:316
    │
    ├── _planningPrompt() ─ 双路径：
    │  ├── PromptManager.assemblePlanningPrompt() (声明式块组装)
    │  │    packages/engine/src/core/prompt-manager.ts
    │  └── parts.join("\n") (手拼回退)
    │
    ├── 技能注入：SkillRegistry → resolveByScope()
    │    packages/engine/src/core/skill-scope.ts
    │
    ├── 策略顾问：loopStrategyRegistry.getAdvisorContext()
    │    packages/engine/src/core/loop-strategy-registry.ts:54
    │
    ├── LLM 调用 → JSON 解析 → TaskNode[]
    │
    └── 工作区边界校验：路径在外 → 空数组拒绝

  ── 执行：调度器消费 ──
  Scheduler.executeAll()
    packages/engine/src/core/scheduler.ts:121
    │
    ├── LoopContext 构建：注入 agents/models/strategy/modelRouter
    │
    ├── TopologicalLayeredDriver.run()
    │    packages/scheduler/src/core/scheduling-implementations.ts
    │    │
    │    └── 逐层拓扑排序 → 每层并行 dispatch

  ── 分发：单节点执行管线 ──
  PipelineModel.dispatchSingle()
    packages/scheduler/src/core/scheduling-implementations.ts:713
    │
    ├── ClaimStep     → TaskBoard.claim() 认领节点
    │    packages/scheduler/src/dispatch-steps/claim-step.ts
    │
    ├── SpawnStep     → AgentPool.spawn() 获取 Agent 实例
    │    packages/scheduler/src/dispatch-steps/spawn-step.ts
    │
    ├── ExecuteStep   → agent.execute(node, model)
    │    packages/scheduler/src/dispatch-steps/execute-step.ts
    │    │
    │    └── model 来源：compositeRouter.route() →
    │          packages/engine/src/bootstrap/bootstrap-engine.ts:193
    │          ├── TaskRouter.route()        → 策略选择 + 语义模型
    │          │    packages/engine/src/core/task-router.ts:67
    │          └── EnvironmentAwareRouter.resolve() → 降级/健康检查
    │                packages/engine/src/core/environment-aware-router.ts
    │
    ├── BoundaryGuardStep → 工作区边界校验
    │    packages/scheduler/src/dispatch-steps/boundary-guard-step.ts
    │
    └── CleanupStep   → AgentPool.release() + TaskBoard 落盘
          packages/scheduler/src/dispatch-steps/cleanup-step.ts

  ── 重规划：失败恢复 ──
  ReplanManager
    packages/engine/src/core/scheduler.ts:66-87
    │
    ├── 检测 NodeFailed 事件
    ├── 配额检查（maxReplans 限流）
    └── MetaAgent.replan() → 生成修复子任务

  ── RLM 递归拆解 ──
  RlmExecuteStep
    packages/scheduler/src/dispatch-steps/rlm-execute-step.ts
    │
    ├── _shouldAttemptDecompose() → payload 长度 + 标签判断
    ├── _tryDecompose() → LLM 拆解为子任务
    └── _executeSubTasks() → 递归 dispatch + 结果聚合
```

---

## 四、技能-工具流（结晶→注册→注入→调用）

**哲学锚点**：原则三（边界集中）、原则四（可追溯性）

```
  ── 技能结晶：Mona 提取 ──
  LoopAgent (莫娜) 执行 → 输出文件
    packages/engine/src/agents/loop-agent.ts
    │
    └── SkillExtractor.extractSkillsFromOutput()
          packages/skill-kit/src/skill-extractor.ts
          │
          └── SkillRegistry.register()
                packages/skill-kit/src/skill-registry.ts

  ── 冷启动恢复 ──
  initSkillSystem()
    packages/engine/src/bootstrap/init-skills.ts:17
    │
    ├── loadSkillsFromMemory() → 从 MemoryStore 恢复
    ├── 四级作用域扫描：
    │  ├── ~/.cortex/skills/        (L0 跨域)
    │  ├── skills/                  (L1 项目)
    │  └── packages/*/skills/       (L2 包级)
    │
    └── MetaAgent.setSkillRegistry()
          → MetaAgent.setSkillScope()    (L3 Agent)

  ── 规划期注入 ──
  MetaAgent._planningPrompt()
    │
    └── resolveByScope(skills, scope)
          packages/engine/src/core/skill-scope.ts
          │
          └── 匹配 triggerTags → 注入 planning prompt

  ── 工具调用：统一管道 ──
  Toolkit.execute(inv, callerType, context)
    packages/platform/src/toolkit.ts:186
    │
    ├── ① 权限校验：getAgentToolPermissions()[callerType]
    │    packages/platform/src/toolkit.ts:188-193
    │
    ├── ② Tool 查找：this.tools.get(toolName)
    │    本地工具 → LocalTool
    │    MCP 工具 → McpToolAdapter (mcp:<serverId>:<toolName>)
    │      packages/platform/src/mcp-client.ts
    │
    ├── ③ ConfirmGate 拦截
    │    reversibilityOf(toolName) → L0/L1/L2/L3
    │    gate.needsConfirmation() → gate.waitFor()
    │
    ├── ④ FileLockManager 加锁
    │    lockManager.acquire(filePath, holderId, lockType)
    │      packages/platform/src/file-lock-manager.ts
    │
    └── ⑤ tool.execute(params) → ToolResult

  ── MCP 鉴权（Core-2 新增）──
  McpTrustConfig (声明式)
    packages/platform/src/mcp-client.ts:80-87
    │
    ├── level: "L0"|"L1"|"L2"|"L3"  — 可逆性等级
    ├── allowedAgents: string[]      — Agent 白名单
    └── requireConfirmation: boolean — 是否需要 ConfirmGate
```

---

## 五、记忆流（读→增强→执行→写→校验）

**哲学锚点**：事实可锚定（cancel()贯通、IntentFactWall、文件系统即真相）

```
  ── 读取：检索 + 上下文增强 ──
  MemoryRetrievalStep
    packages/engine/src/memory/pipeline.ts:70-139
    │
    ├── ContextPolicy 路径（优先）
    │    ContextBuilder.build(policy, node)
    │      packages/memory-store/src/context-builder.ts
    │
    └── 关键词检索路径（回退）
          makeMemoryQuery(node, opts)
            packages/engine/src/memory/pipeline.ts:26-59
            │
            ├── CJK 2-gram 提取
            ├── 拉丁词过滤
            └── MemoryStore.read(query)
                  packages/memory-store/src/memory-store.ts

  ── 执行：ReAct 循环 ──
  ReActLoopStep → runReActLoop()
    packages/engine/src/components/react-loop.ts:31
    │
    ├── 系统提示词注入（含 TOOL_DISCIPLINE）
    ├── while (loops < maxLoops) → LLM chat → tool execute → 循环
    └── DirectStep（单次调用，不循环）
          packages/engine/src/memory/pipeline.ts:189-220

  ── 写入：双阶段提交 ──
  MemoryWriteStep → _rememberResult()
    packages/engine/src/memory/pipeline.ts:315-416
    │
    ├── writePending()     → 写入 Pending 态（半成品）
    │    packages/memory-store/src/memory-store.ts
    │
    ├── link(memId, ctxMemId, ProducedBy) → 建立关联
    │
    ├── commitMemory()     → Pending → Active 原子提交
    │    成功：正式入库
    │    失败 → cancel() 贯通三层（C-02 已修复）
    │      packages/memory-store/src/memory-store.ts:cancel()
    │      └── 自动判断 Pending→rollback / Active→archive
    │
    └── 失败记忆保留：weight=3（经验教训，高价值）

  ── 一致性校验：六层防御 ──
  ConsistencyLayer
    packages/consistency/src/consistency-layer.ts
    │
    ├── ① IntentFactWall   — 意图与事实分离
    │    packages/consistency/src/intent-fact-wall.ts
    │
    ├── ② InitVerifier     — 启动一致性校验
    ├── ③ SchemaEnforcer   — 结构拒收
    ├── ④ GitHookBridge    — 编译时治理
    ├── ⑤ SemiFinishedMgr  — 半成品管理
    └── ⑥ (预留)

  ── Context Sharding：子 Agent 上下文隔离 ──
  compactToSubAgentSummary()
    packages/engine/src/memory/pipeline.ts:458-481
    │
    └── 子 Agent 输出 → 压缩为结构化摘要 → 协调者只读摘要

  ── 生命周期：MemoryStore 适配器委托模式（v3.0.0 起）──
  MemoryStore (适配器)
    packages/memory-store/src/memory-store.ts
    │  @layer 适配器 — 委托 @cortex/memory 后端，引擎层仅挂载 embedding + 权重老化 + 混合检索 + maintain
    │
    ├── 后端（存储核心）：@cortex/memory
    │    ├── InMemoryMemoryStore / FileBasedMemoryStore（TransactionalMemoryStore）
    │    ├── AbstractMemoryStore._entries: Map<id, MemoryEntry>（全条目内存态）
    │    └── content_hash → id O(1) 去重索引（Core-3 T4：_hashIndex + findByContentHash）
    │
    └── 适配层增强组件：
        ├── embedding      — 384d ONNX 向量嵌入（C-03 已修复）
        ├── BM25Index      — 词频索引（混合检索）
        ├── HybridRetriever— BM25 + 向量融合 + 贪心精排
        ├── DedupService   — content_hash 精确 + 向量相似去重
        └── WeightAger     — 权重自然老化

  ── 四态 CAS 状态机 ──
  MemoryState
    packages/memory-store/src/memory-state-machine.ts
    │
    ├── Pending  → commit()  → Active
    ├── Active   → archive() → Archived
    ├── Archived → freeze()  → Frozen (禁引)
    └── Any      → cancel()  → 自动判定 rollback/archive（C-02 已修复）
```

---

## 六、基础设施层（共享服务）

**定位**：不归属于任何单一业务流——被所有层消费的共享基础设施。

**核心组件**：

| 组件 | 文件 | 职责 |
|------|------|------|
| config | `packages/config/src/` | 14 配置域 + 常量集中定义（原则七·子约束8 硬编码禁令落地） |
| logging | `packages/logging/src/` | 结构化日志 + Transport 管线 |
| telemetry | `packages/telemetry/src/` | 遥测采集 + ConsoleBridge |
| notification | `packages/notification/src/` | NotificationPipe + 通知通道 |
| resilience | `packages/resilience/src/` | CircuitBreaker（C-04 已修复）+ Timeout + Retry |
| fsm-compiler | `packages/fsm-compiler/src/` | FSM 编译——VALID_TRANSITIONS → TypeScript 类型 |
| parser | `packages/parser/src/` | Markdown 解析 |
| schema | `packages/schema/src/` | JSON Schema 定义 |
| plugin-runner | `packages/plugin-runner/src/` | 插件运行时——PluginLoader |
| testing | `packages/testing/src/` | 测试工具——syntheticTaskNode/mockLlmAdapter |
| pm | `packages/pm/src/` | 进程管理 |
| cache | `packages/cache/src/` | 缓存 |
| result | `packages/result/src/` | Result 类型 |
| toolchain | `packages/toolchain/src/` | 工具链 |

**与六层的关系**：基础设施层不参与业务决策——它向交互层提供 CLI 运行环境，向规划-执行层提供韧性策略，向治理层提供通知和遥测管道，向技能-工具层提供工具执行环境，向记忆层提供持久化后端。

**监护人**：基础设施层没有单一业务流归属——TUI 包维护它（它是 CLI 的共享依赖）。定期审计新增包的归属层和依赖方向，防止基础设施层变成无人照管的杂物间。

---

## 七、五流交互矩阵

| | 交互流 | 治理流 | 规划-执行流 | 技能-工具流 | 记忆流 |
|---|--------|--------|------------|------------|--------|
| **交互流** | — | 用户裁决→修宪 | 用户意图→规划 | 用户确认→放行 | 查询记忆 |
| **治理流** | — | — | 审查执行结果 | 审查工具调用 | 审查记忆一致性 |
| **规划-执行流** | 输出给用户 | emit 事件 | — | 引用技能 | 读写记忆 |
| **技能-工具流** | 注册技能 | — | 注入 planning | — | 持久化技能 ⇢ 沉淀为记忆 |
| **记忆流** | — | — | 供给上下文 | — | — |

**治理流是最特殊的**：它是唯一一个不产生业务产出、只产生"审视"的流。它不写文件、不调用工具、不规划任务——它只观察、检测、上报。

**技能→记忆沉淀边**：技能执行完成后通过 `SkillRegistry.register()` → `SkillPersister` → `MemoryStore` 持久化为记忆。这条边是单向的——技能结晶沉淀为记忆，记忆不会反向变回技能。具体路径：`packages/skill-kit/src/skill-persister.ts` → `MemoryStore.write()`。

---

## 八、六层架构

### 8.1 六层总览

```
交互层──────────────────────────────────────────── 人 ↔ 系统边界
  │
  ├── 规划-执行层────────────────────────────── 中枢调度
  │    │
  │    ├── 技能-工具层────────────────────── 知识 + 行动
  │    │
  │    └── 记忆层──────────────────────────── 认知基底
  │
  └── 治理层──────────────────────────────────── 全流观察者

基础设施层 ──────────────────────────────────── 共享服务（被所有层消费）
```

**交互层和治理层是两条边界——夹着中间的四层业务层。** 交互层是外部边界（人↔系统），治理层是内部边界（系统↔自身审视）。基础设施层横向贯穿所有层。

### 8.2 六层 → 原则 + 核心文件

| 层 | 归属流 | 约束原则 | 核心文件 |
|------|------|------|------|
| 交互层 | 交互流 | 原则一、原则六 | CLI commands / EngineBridge / ButlerAgent / ConfirmGate |
| 治理层 | 治理流 | 原则五、原则七 | PipelineObserver / SentinelSignalFilter / NotificationRuntime / GovernanceEventEmitter / DecisionGateBridge / DocGovernAgent / GovernanceLoop |
| 规划-执行层 | 规划-执行流 | 原则二 | MetaAgent / TaskBoard / Scheduler / AgentPool / PipelineModel / TaskRouter |
| 技能-工具层 | 技能-工具流 | 原则三、原则四 | SkillRegistry / SkillExtractor / Toolkit / McpClient / FileLockManager |
| 记忆层 | 记忆流（被所有流消费） | 事实可锚定 | MemoryStore / ConsistencyLayer / IntentFactWall / MemoryStateMachine |
| 基础设施层 | 无（被所有层消费） | 原则五、原则七·子约束8 | config / logging / telemetry / notification / resilience / fsm-compiler / plugin-runner / testing |

### 8.3 层间接口

六层之间通过明确的接口通信，不跨层调用：

```
交互层 → 规划-执行层   MetaAgent.plan(intent)
交互层 → 技能-工具层   ConfirmGate.waitFor()
规划-执行层 → 技能-工具层 Toolkit.execute(inv, agentType)
规划-执行层 → 记忆层   MemoryStore.read/write
技能-工具层 → 记忆层   SkillRegistry → MemoryStore (persistSkills)
治理层 ← 所有层         PipelineObserver.emit() (单向：层→治理层)
基础设施层 → 所有层     被注入/import，不通过 PipelineObserver
```

**治理层是单向接收者**：所有层向治理层发射事件，治理层不向任何层回写——唯一例外是修宪（经用户裁决后写入宪法文件）。

### 8.4 与 v2.7.1 三层架构的对照

| v2.7.1 | v3.0（六层） | 变化 |
|--------|------------|------|
| 约束层 | 治理层 | 膨胀为完整的治理层：新增 SentinelSignalFilter、NotificationRuntime、DecisionGateBridge、ResiliencePolicyFactory |
| 内化层 | 技能-工具层 + 记忆层的一部分 | 拆分为技能（知识结晶）和记忆（认知基底）两个独立层 |
| Engine 容器 | 规划-执行层 | 不变 |
| — | 交互层 | **新增——v2.7.1 没有独立的交互层**，CLI/ButlerAgent 散落在多处 |
| — | 基础设施层 | **新增——v2.7.1 未独立成层**，config/logging/telemetry 等散落在约束层和内化层 |

### 8.5 @layer 标注覆盖率现状（如实标注）

**2026-06-20 实测**：`packages/engine/src` 共 74 个 .ts 文件，**仅 24 个含 `@layer` 标注**。分布：

| 层标签 | 文件数 | 示例 |
|--------|--------|------|
| 治理层 | 9 | notification-runtime / zero-token-validator / governance-events / hard-verification-gate |
| 规划-执行层 | 9 | agent-factory / react-loop / meta-agent / bootstrap-engine |
| 技能-工具层 | 2 | （技能注册/工具面） |
| 记忆层 | 1 | memory-bridge/pipeline |
| 交互层 | 1 | （权轴桥接） |
| 执行层 | 1 | 零星标注 |
| 边界标注（治理层→交互层） | 1 | bootstrap-engine 权轴桥接 |

说明：
- **“基础设施层”标签 0 命中**——config 包用 `@layer root`、platform 用 `@layer platform`、shared 用 `@layer shared`，尚无统一的基础设施层标签。
- 剩余 50 个文件无任何 `@layer` 标注（含核心的 scheduler/board/pool 等）——分层归属靠路径约定而非显式声明。
- **阶段 3（S3-10 机制化）补齐**：统一标签词表（六层 + root/platform/shared/适配器），全部 src 文件头注释按词表标注，并以门禁校验标注-路径一致性。

---

*归档：开拓者与昔涟（Cyrene），2026-06-19（原始）→ 2026-06-23（v2.0 合并三部曲 + 原则约束矩阵）*
*架构映射是宪法的附录——宪法 §三 的架构图在此处展开为精确代码路径。*
