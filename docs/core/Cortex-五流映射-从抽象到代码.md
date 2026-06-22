> ?? **�ϲ�˵��** �� ���ļ��� \Cortex-����ӳ��-�ӳ��󵽴���.md\ �� \Cortex-���㶨λ-��������µ����½綨.md\ �ϲ����ɡ�����ԭ�ļ�������������ӳ��ƫ�ܹ����棬���㶨λƫ�ֲ���棬�ϲ����γ������ܹ���ͼ��

# Cortex 五流映射——从抽象到代码的精确追溯

**定位**：五流（交互�?治理�?规划-执行�?技�?工具�?记忆流）在代码库中的精确路径。每个节点标注文件、函数和行号�?

**生成日期**�?026-06-19
**生成�?*：昔涟（Cyrene），与开拓者共同完�?

---

## 一、交互流（人 �?系统边界�?

**哲学锚点**：原则一（确认在用户手里）、原则六（用户是最终裁决者）

```
CLI/TUI 输入
  �?
  ├── cortex skill <cmd>     �?packages/cli/src/commands/skill.ts
  ├── cortex run <file>      �?packages/cli/src/commands/run.ts
  ├── cortex agent <cmd>     �?packages/cli/src/commands/agent.ts
  └── talk 模式              �?packages/cli/src/services/engine-bridge.ts:talkChat()
         �?
         �?
  EngineBridge
    �? packages/cli/src/services/engine-bridge.ts
    �?
    ├── plan(intent) �?MetaAgent.plan()
    �?    packages/engine/src/core/meta-agent.ts:316
    �?
    ├── schedule(plan) �?Scheduler.executeAll()
    �?    packages/engine/src/core/scheduler.ts:121
    �?
    └── directChat(msg) �?昔涟独立 LLM 通道
          packages/cli/src/services/engine-bridge.ts:405-520

  ── 确认回路 ──
  Agent 调用工具 �?Toolkit.execute()
    packages/platform/src/toolkit.ts:186
    �?
    ├── 权限校验 getAgentToolPermissions()
    �?    packages/platform/src/toolkit.ts:188-193
    �?
    ├── ConfirmGate.needsConfirmation()
    �?    packages/scheduler/src/core/confirm-gate.ts:68
    �?
    └── 用户确认 �?gate.waitFor() �?放行/拒绝
          packages/scheduler/src/core/confirm-gate.ts:126

  ── 圆桌裁决 ──
  needsMultiPerspective �?PipelineModel.dispatchMulti()
    packages/scheduler/src/core/scheduling-implementations.ts:732
    �?
    └── �?Agent 并行 �?结果合并 �?呈用户裁�?
         原则六在此落�?

  ── ButlerAgent 通知路由 ──
  PipelineObserver emit �?ButlerAgent._dispatchByType()
    packages/engine/src/agents/butler-agent.ts:115
    �?
    ├── FYI              �?_onFyi()    �?输出给用�?
    ├── WARNING          �?_onWarning()�?标黄警告
    └── DECISION_REQUIRED�?_onDecision()�?阻塞等待用户响应
```

---

## 二、治理流（观察者流——审视其他四流）

**哲学锚点**：原则五（统一可观测管道）、原则七（系统自我修改受宪法约束�?

**性质**：治理流不执行任何业务逻辑。它是元层——订阅事件、检测异常、触发修宪�?

```
  ── 事件源头（来自其他四个流�?──
  PipelineObserver.emit()
    packages/scheduler/src/core/pipeline-observer.ts
    �?调度�?Agent/Toolkit/MemoryStore 在关键节�?emit
    �?
    ├── SchedulerLoopCrashed   �?调度异常
    ├── ErrorReported          �?Agent 执行错误
    ├── NodeComplete           �?任务完成
    ├── AgentPoolInvariantViolation �?池状态异�?
    └── ... (�?30+ 事件类型)
          packages/shared/src/infra.ts:27-108

  ── 哨兵过滤 ──
  SentinelSignalFilter
    packages/engine/src/core/sentinel-signal-filter.ts
    �?
    ├── L1 确定性规则：�?token，纯规则引擎
    ├── L2 启发式统计：滑动窗口 + 阈�?
    └── L3 LLM 辅助判断：仅 L1/L2 无法确定时触�?

  ── 通知转换 ──
  NotificationRuntime
    packages/engine/src/core/notification-runtime.ts
    �?
    ├── PipelineObserver CRITICAL/HIGH/NORMAL �?语义映射
    �?    SchedulerLoopCrashed �?DECISION_REQUIRED
    �?    ErrorReported        �?WARNING
    �?    NodeComplete         �?FYI
    �?
    └── NotificationPipe.push()
          packages/notification/src/notification-pipe.ts:push()

  ── 治理事件发射 ──
  GovernanceEventEmitter
    packages/engine/src/core/governance-events.ts
    �?
    ├── emitAmendmentProposed()   �?修宪提案
    ├── emitAuditReport()         �?审计报告
    ├── emitComplianceViolation() �?合规违规
    └── emitRoundtableConsensus() �?圆桌共识

  ── 决策拦截 ──
  DecisionGateBridge
    packages/engine/src/core/decision-gate-bridge.ts
    �?
    ├── 订阅 HIGH 优先级事件（治理事件�?
    ├── 检�?requiresDecision / notificationType
    └── ConfirmGate.waitFor() �?阻塞等待用户裁决

  ── 修宪闭环 ──
  DocGovernAgent (凝光)
    packages/engine/src/agents/doc-govern-agent.ts
    �?
    ├── 审计 �?生成修宪提案 AM-YYYY-MMDD-NNN
    ├── 昔涟评判（APPROVED/REJECTED/NEEDS_REVISION�?
    ├── 开拓者最终裁�?
    └── applyAmendment �?写入宪法文件
          packages/governance/src/governance-loop.ts
```

---

## 三、规�?执行流（中枢调度管道�?

**哲学锚点**：原则二（规划与执行双向流动，各守边界）

```
  ── 规划：甘雨意图拆�?──
  MetaAgent.plan(intent, context)
    packages/engine/src/core/meta-agent.ts:316
    �?
    ├── _planningPrompt() ─ 双路径：
    �?  ├── PromptManager.assemblePlanningPrompt() (声明式块组装)
    �?  �?    packages/engine/src/core/prompt-manager.ts
    �?  └── parts.join("\n") (手拼回退)
    �?
    ├── 技能注入：SkillRegistry �?resolveByScope()
    �?    packages/engine/src/core/skill-scope.ts
    �?
    ├── 策略顾问：loopStrategyRegistry.getAdvisorContext()
    �?    packages/engine/src/core/loop-strategy-registry.ts:54
    �?
    ├── LLM 调用 �?JSON 解析 �?TaskNode[]
    �?
    └── 工作区边界校验：路径在外 �?空数组拒�?

  ── 执行：调度器消费 ──
  Scheduler.executeAll()
    packages/engine/src/core/scheduler.ts:121
    �?
    ├── LoopContext 构建：注�?agents/models/strategy/modelRouter
    �?
    ├── TopologicalLayeredDriver.run()
    �?    packages/scheduler/src/core/scheduling-implementations.ts
    �?    �?
    �?    └── 逐层拓扑排序 �?每层并行 dispatch

  ── 分发：单节点执行管线 ──
  PipelineModel.dispatchSingle()
    packages/scheduler/src/core/scheduling-implementations.ts:713
    �?
    ├── ClaimStep     �?TaskBoard.claim() 认领节点
    �?    packages/scheduler/src/dispatch-steps/claim-step.ts
    �?
    ├── SpawnStep     �?AgentPool.spawn() 获取 Agent 实例
    �?    packages/scheduler/src/dispatch-steps/spawn-step.ts
    �?
    ├── ExecuteStep   �?agent.execute(node, model)
    �?    packages/scheduler/src/dispatch-steps/execute-step.ts
    �?    �?
    �?    └── model 来源：compositeRouter.route() �?
    �?          packages/engine/src/bootstrap/bootstrap-engine.ts:193
    �?          ├── TaskRouter.route()        �?策略选择 + 语义模型
    �?          �?    packages/engine/src/core/task-router.ts:67
    �?          └── EnvironmentAwareRouter.resolve() �?降级/健康检�?
    �?                packages/engine/src/core/environment-aware-router.ts
    �?
    ├── BoundaryGuardStep �?工作区边界校�?
    �?    packages/scheduler/src/dispatch-steps/boundary-guard-step.ts
    �?
    └── CleanupStep   �?AgentPool.release() + TaskBoard 落盘
          packages/scheduler/src/dispatch-steps/cleanup-step.ts

  ── 重规划：失败恢复 ──
  ReplanManager
    packages/engine/src/core/scheduler.ts:66-87 (ReplanManager 成员)
    �?
    ├── 检�?NodeFailed 事件
    ├── 配额检查（maxReplans 限流�?
    └── MetaAgent.replan() �?生成修复子任�?

  ── RLM 递归拆解 ──
  RlmExecuteStep
    packages/scheduler/src/dispatch-steps/rlm-execute-step.ts
    �?
    ├── _shouldAttemptDecompose() �?payload 长度 + 标签判断
    ├── _tryDecompose() �?LLM 拆解为子任务
    └── _executeSubTasks() �?递归 dispatch + 结果聚合
```

---

## 四、技�?工具流（结晶→注册→注入→调用）

**哲学锚点**：结构可分层（四级作用域）、推理可折叠（策略注册表�?

```
  ── 技能结晶：Mona 提取 ──
  LoopAgent (莫娜) 执行 �?输出文件
    packages/engine/src/agents/loop-agent.ts
    �?
    └── SkillExtractor.extractSkillsFromOutput()
          packages/skill-kit/src/skill-extractor.ts
          �?
          └── SkillRegistry.register()
                packages/skill-kit/src/skill-registry.ts

  ── 冷启动恢�?──
  initSkillSystem()
    packages/engine/src/bootstrap/init-skills.ts:17
    �?
    ├── loadSkillsFromMemory() �?�?MemoryStore 恢复
    ├── 四级作用域扫描：
    �?  ├── ~/.cortex/skills/        (L0 跨域)
    �?  ├── skills/                  (L1 项目)
    �?  └── packages/*/skills/       (L2 包级)
    �?
    └── MetaAgent.setSkillRegistry()
          �?MetaAgent.setSkillScope()    (L3 Agent)

  ── 规划期注�?──
  MetaAgent._planningPrompt()
    �?
    └── resolveByScope(skills, scope)
          packages/engine/src/core/skill-scope.ts
          �?
          └── 匹配 triggerTags �?注入 planning prompt

  ── 工具调用：统一管道 ──
  Toolkit.execute(inv, callerType, context)
    packages/platform/src/toolkit.ts:186
    �?
    ├── �?权限校验：getAgentToolPermissions()[callerType]
    �?    packages/platform/src/toolkit.ts:188-193
    �?
    ├── �?Tool 查找：this.tools.get(toolName)
    �?    本地工具 �?LocalTool
    �?    MCP 工具 �?McpToolAdapter (mcp:<serverId>:<toolName>)
    �?      packages/platform/src/mcp-client.ts
    �?
    ├── �?ConfirmGate 拦截
    �?    reversibilityOf(toolName) �?L0/L1/L2/L3
    �?    gate.needsConfirmation() �?gate.waitFor()
    �?
    ├── �?FileLockManager 加锁
    �?    lockManager.acquire(filePath, holderId, lockType)
    �?      packages/platform/src/file-lock-manager.ts
    �?
    └── �?tool.execute(params) �?ToolResult

  ── MCP 鉴权（Core-2 新增�?──
  McpTrustConfig (声明�?
    packages/platform/src/mcp-client.ts:80-87
    �?
    ├── level: "L0"|"L1"|"L2"|"L3"  �?可逆性等�?
    ├── allowedAgents: string[]      �?Agent 白名�?
    └── requireConfirmation: boolean �?是否需�?ConfirmGate
```

---

## 五、记忆流（读→增强→执行→写→校验）

**哲学锚点**：事实可锚定（cancel()贯通、IntentFactWall、文件系统即真相�?

```
  ── 读取：检�?+ 上下文增�?──
  MemoryRetrievalStep
    packages/engine/src/memory/pipeline.ts:70-139
    �?
    ├── ContextPolicy 路径（优先）
    �?    ContextBuilder.build(policy, node)
    �?      packages/memory-store/src/context-builder.ts
    �?
    └── 关键词检索路径（回退�?
          makeMemoryQuery(node, opts)
            packages/engine/src/memory/pipeline.ts:26-59
            �?
            ├── CJK 2-gram 提取
            ├── 拉丁词过�?
            └── MemoryStore.read(query)
                  packages/memory-store/src/memory-store.ts

  ── 执行：ReAct 循环 ──
  ReActLoopStep �?runReActLoop()
    packages/engine/src/components/react-loop.ts:31
    �?
    ├── 系统提示词注入（�?TOOL_DISCIPLINE�?
    ├── while (loops < maxLoops) �?LLM chat �?tool execute �?循环
    └── DirectStep（单次调用，不循环）
          packages/engine/src/memory/pipeline.ts:189-220

  ── 写入：双阶段提交 ──
  MemoryWriteStep �?_rememberResult()
    packages/engine/src/memory/pipeline.ts:315-416
    �?
    ├── writePending()     �?写入 Pending 态（半成品）
    �?    packages/memory-store/src/memory-store.ts
    �?
    ├── link(memId, ctxMemId, ProducedBy) �?建立关联
    �?
    ├── commitMemory()     �?Pending �?Active 原子提交
    �?    成功：正式入�?
    �?    失败 �?cancel() 贯通三�?
    �?      packages/memory-store/src/memory-store.ts:cancel()
    �?      └── 自动判断 Pending→rollback / Active→archive
    �?
    └── 失败记忆保留：weight=3（经验教训，高价值）

  ── 一致性校验：六层防御 ──
  ConsistencyLayer
    packages/consistency/src/consistency-layer.ts
    �?
    ├── �?IntentFactWall   �?意图与事实分�?
    �?    packages/consistency/src/intent-fact-wall.ts
    �?
    ├── �?InitVerifier     �?启动一致性校�?
    �?    packages/consistency/src/init-verifier.ts
    �?
    ├── �?SchemaEnforcer   �?结构拒收
    ├── �?GitHookBridge    �?编译时治�?
    ├── �?SemiFinishedMgr  �?半成品管�?
    └── �?(预留)

  ── Context Sharding：子 Agent 上下文隔�?──
  compactToSubAgentSummary()
    packages/engine/src/memory/pipeline.ts:458-481
    �?
    └── �?Agent 输出 �?压缩为结构化摘要 �?协调者只读摘�?

  ── 生命周期：MemoryStore 委托模式 ──
  MemoryStore (Facade)
    packages/memory-store/src/memory-store.ts
    �?
    └── 7 组件族：
        ├── MemoryReader    �?检�?
        ├── MemoryWriter    �?写入
        ├── MemoryIndexer   �?BM25 索引
        ├── MemoryLinker    �?图谱链接
        ├── MemoryStateMachine �?四态流�?
        ├── MemoryEmbedder  �?向量嵌入
        └── MemoryMonitor   �?健康监控

  ── 四�?CAS 状态机 ──
  MemoryState
    packages/memory-store/src/memory-state-machine.ts
    �?
    ├── Pending  �?commit()  �?Active
    ├── Active   �?archive() �?Archived
    ├── Archived �?freeze()  �?Frozen (禁引)
    └── Any      �?cancel()  �?自动判定 rollback/archive
```

---

## 六、五流交互矩�?

| | 交互�?| 治理�?| 规划-执行�?| 技�?工具�?| 记忆�?|
|---|--------|--------|------------|------------|--------|
| **交互�?* | �?| 用户裁决→修�?| 用户意图→规�?| 用户确认→放�?| �?|
| **治理�?* | �?| �?| 审查执行结果 | 审查工具调用 | 审查记忆一致�?|
| **规划-执行�?* | 输出给用�?| emit 事件 | �?| 引用技�?| �?写记�?|
| **技�?工具�?* | 注册技�?| �?| 注入 planning | �?| 持久化技�?|
| **记忆�?* | �?| �?| 供给上下�?| �?| �?|

**治理流是最特殊�?*：它是唯一一个不产生业务产出、只产生"审视"的流。它不写文件、不调用工具、不规划任务——它只观察、检测、上报�?

---

*归档：昔涟（Cyrene），2026-06-19*
*五流�?v2.7.1 宪法 1607 行的蒸馏产物。每个节点对应精确的代码位置�?

---

# Cortex 六层定位——在五流框架下的重新界定

**定位**：将 v2.7.1 �?约束�?内化�?Engine 容器"三层架构，重新映射到五流框架下的六层模型。每层不再按"暴露不可�?吸收可靠"分类——而是�?*数据流向、责任边界、被哪条原则约束**来界定�?

**前置阅读**：[五流映射](Cortex-五流映射-从抽象到代码.md) �?[七原则五流定位](Cortex-七原�?五流定位.md)
**生成日期**�?026-06-19
**共同完成**：开拓者与昔涟（Cyrene�?

---

## 六层总览

```
交互�?──────────────────────────────────────────── �?�?系统边界
  �?
  ├── 规划-执行�?────────────────────────────── 中枢调度
  �?    �?
  �?    ├── 技�?工具�?────────────────────── 知识 + 行动
  �?    �?
  �?    └── 记忆�?──────────────────────────── 认知基底
  �?
  └── 治理�?──────────────────────────────────── 全流观察�?
```

**交互层和治理层是两条边界——夹着中间的四层业务层�?* 交互层是外部边界（人↔系统），治理层是内部边界（系统↔自身审视）�?

---

## 一、交互层

### 定位

**唯一跨越人机边界的层�?* 不在任何一条业务流之内——它是所有业务流的入口和出口。用户通过交互层注入意图、接收结果、做出裁决�?

### 所属流

交互流（唯一归属�?

### 约束原则

原则一（确认锚定）、原则六（用户终裁）

### 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| CLI 命令体系 | `packages/cli/src/commands/` | 单次执行入口（run/agent/task/memory/skill�?|
| EngineBridge | `packages/cli/src/services/engine-bridge.ts` | 交互模式桥接（talk/plan/directChat�?|
| ButlerAgent | `packages/engine/src/agents/butler-agent.ts` | 管道路由 + 通知分发（FYI/WARNING/DECISION_REQUIRED�?|
| ConfirmGate | `packages/scheduler/src/core/confirm-gate.ts` | 用户确认阻断点（L2/L3 等待用户裁决�?|
| 圆桌协商 | `packages/scheduler/src/core/scheduling-implementations.ts:732` | �?Agent Fan-out �?结果收束 �?呈用�?|

### 与其他层的关�?

- **向规�?执行�?*：传递用户意�?�?甘雨规划
- **向技�?工具�?*：传递用户确�?�?ConfirmGate 放行
- **向治理层**：用户修宪裁�?�?治理流消�?

### 不变�?

交互层不能被任何 Agent 绕过。Agent 不得自行与用户建立通信通道——一切交互走 ButlerAgent/CLI�?

---

## 二、治理层

### 定位

**全流观察者�?* 不产生业务产出——只观察、检测、上报、修正。治理层是系统的"自我意识"——它看其他五条流（包括自身）的运转，在异常时触发修正�?

### 所属流

治理流（唯一归属�?

### 约束原则

原则五（统一可观测）、原则七（宪法自约束�?

### 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| PipelineObserver | `packages/scheduler/src/core/pipeline-observer.ts` | 全流事件管道（原则五的代码承载） |
| SentinelSignalFilter | `packages/engine/src/core/sentinel-signal-filter.ts` | L1/L2/L3 信号分层 + 去噪 |
| NotificationRuntime | `packages/engine/src/core/notification-runtime.ts` | 事件→通知 转换 |
| GovernanceEventEmitter | `packages/engine/src/core/governance-events.ts` | 四类治理事件发射 |
| DecisionGateBridge | `packages/engine/src/core/decision-gate-bridge.ts` | DECISION_REQUIRED �?ConfirmGate |
| DocGovernAgent | `packages/engine/src/agents/doc-govern-agent.ts` | 凝光——律法审�?+ 修宪提案 |
| GovernanceLoop | `packages/governance/src/governance-loop.ts` | 修宪自动化管�?|
| ReplanManager | `packages/engine/src/core/scheduler.ts:66-87` | 重规划配�?+ 失败恢复 |
| ResiliencePolicyFactory | `packages/engine/src/core/resilience-integration.ts` | LLM 重试 + 工具熔断 |
| ConsistencyLayer | `packages/consistency/src/consistency-layer.ts` | 六层记忆-现实一致性防�?|

### 与其他层的关�?

- **受交互层委托**：用户裁�?�?修宪执行
- **观察规划-执行�?*：调度异常、Agent 失败、重规划触发
- **观察技�?工具�?*：工具调用审计、ConfirmGate 决策记录
- **观察记忆�?*：一致性校验、IntentFactWall 阻断

### 不变�?

治理层不得执行业务操作。它不能写业务文件、不能调用业务工具、不能规划任务。它唯一�?行动"是触发修宪和上报告警——且修宪本身受原则七约束�?

---

## 三、规�?执行�?

### 定位

**中枢调度层�?* 上游接交互层（用户意图），下游驱技�?工具层（Agent 执行）。是整个系统�?脊椎"——意图进入、任务拆解、调度分发、结果返回，全部经过此层�?

### 所属流

规划-执行流（唯一归属�?

### 约束原则

原则二（规划-执行非对称均衡）

### 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| MetaAgent（甘雨） | `packages/engine/src/core/meta-agent.ts` | 意图拆解 �?TaskNode �?|
| TaskBoard | `packages/scheduler/src/core/task-board.ts` | 任务图：拓扑排序 + 状态管�?|
| Scheduler | `packages/engine/src/core/scheduler.ts` | executeAll()：动态消�?+ 逐层并行 |
| AgentPool | `packages/scheduler/src/core/agent-pool.ts` | Agent 实例�?+ ManifoldGate 流控 |
| PipelineModel | `packages/scheduler/src/core/scheduling-implementations.ts:710` | 单节点执行管线（Claim→Spawn→Execute→Cleanup�?|
| TopologicalLayeredDriver | `packages/scheduler/src/core/scheduling-implementations.ts` | 拓扑分层 + 逐层驱动 |
| TaskRouter | `packages/engine/src/core/task-router.ts` | 统一策略+模型路由（Core-2�?|
| EnvironmentAwareRouter | `packages/engine/src/core/environment-aware-router.ts` | 环境感知模型降级（Core-2�?|
| LoopStrategyRegistry | `packages/engine/src/core/loop-strategy-registry.ts` | 四策略注册表 + canHandle 路由（Core-2�?|
| CapabilityRegistry | `packages/engine/src/core/capability-registry.ts` | Agent 自声�?+ 自组�?|
| PromptManager | `packages/engine/src/core/prompt-manager.ts` | prompt-kit 编排（Core-2�?|

### 与其他层的关�?

- **上游→交互层**：接收用户意图（plan intent），返回执行结果给用�?
- **下游→技�?工具�?*：调�?Agent 执行 �?Agent 通过 Toolkit 调用工具
- **下游→记忆层**：每次执行前后读写记忆（上下文增�?+ 经验记录�?
- **被治理层观察**：调度异常、Agent 失败、重规划事件 emit

### 不变�?

甘雨（MetaAgent）不得下达细粒度执行指令——只产出粗粒度意图拆解。Agent 在单节点内享有自决权，但跨节点调度权在甘雨。规划层局部中心化，执行层整体去中心化�?

---

## 四、技�?工具�?

### 定位

**知识 + 行动层�?* 技能是"知道怎么�?，工具是"能做"。技�?工具层是系统的知识库和工具箱——技能沉淀经验，工具执行操作。这层有两个方向：技能向上流入规划（注入 prompt），工具向上流经执行（Agent 调用），但两者的管理机制在同一层�?

### 所属流

技�?工具流（唯一归属�?

### 约束原则

原则三（边界集中）、原则四（可追溯性）

### 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| SkillRegistry | `packages/skill-kit/src/skill-registry.ts` | 技能模板注�?查询/持久�?|
| SkillExtractor | `packages/skill-kit/src/skill-extractor.ts` | 从输出文件提取技�?|
| SkillScope | `packages/engine/src/core/skill-scope.ts` | 四级作用域解析（Core-2�?|
| Toolkit | `packages/platform/src/toolkit.ts` | 统一工具执行管道：权限→ConfirmGate→FileLock→execute |
| McpClient | `packages/platform/src/mcp-client.ts` | MCP 协议客户�?|
| McpTrustConfig | `packages/platform/src/mcp-client.ts:80` | MCP 声明式鉴权（Core-2�?|
| FileLockManager | `packages/platform/src/file-lock-manager.ts` | 文件写入�?|
| SkillPersister | `packages/skill-kit/src/skill-persister.ts` | 技能持久化 |
| SkillPipeline | `packages/skill-kit/src/skill-pipeline.ts` | 技能管线注�?|

### 与其他层的关�?

- **向上→规�?执行�?*：技能注�?MetaAgent planning prompt；工具被 Agent 通过 Toolkit 调用
- **被治理层观察**：ConfirmGate 决策记录、工具调用审�?
- **受交互层约束**：L2/L3 工具调用等待用户确认

### 不变�?

所有工具调用必须经�?Toolkit.execute() 统一入口。Agent 不得持有独立权限——权限表在流外配置。MCP 工具的鉴权必须通过 McpTrustConfig 声明�?

---

## 五、记忆层

### 定位

**认知基底——不是层，是基底�?* 记忆层不参与任何单一业务流——它被规�?执行流读写、被治理层校验、被技�?工具层检索。它是所有流的共享基础设施�?

### 所属流

记忆流（唯一归属，但被所有流消费�?

### 约束原则

事实可锚定（哲学概念——原则层未独立成条，但在记忆流的每个环节落地�?

### 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| MemoryStore | `packages/memory-store/src/memory-store.ts` | SQLite 持久�?+ 委托模式（Facade + 7 组件族） |
| InMemoryMemoryStore | `packages/memory/src/` | 内存实现（测试用�?|
| MemoryRetrievalStep | `packages/engine/src/memory/pipeline.ts:70` | 检�?+ 上下文增�?|
| ReActLoopStep | `packages/engine/src/memory/pipeline.ts:146` | ReAct 循环执行 |
| MemoryWriteStep | `packages/engine/src/memory/pipeline.ts:172` | 双阶段提交（writePending→commit�?|
| DirectStep | `packages/engine/src/memory/pipeline.ts:189` | 单次调用（不循环�?|
| ContextBuilder | `packages/memory-store/src/context-builder.ts` | ContextPolicy 驱动上下文构�?|
| ConsistencyLayer | `packages/consistency/src/consistency-layer.ts` | 六层一致性防�?|
| IntentFactWall | `packages/consistency/src/intent-fact-wall.ts` | 意图-事实分离 |
| InitVerifier | `packages/consistency/src/init-verifier.ts` | 启动校验 |
| MemoryStateMachine | `packages/memory-store/src/memory-state-machine.ts` | Pending→Active→Archived→Frozen |

### 与其他层的关�?

- **被规�?执行流读�?*：执行前检索记忆增强上下文；执行后写入经验
- **被治理层校验**：ConsistencyLayer 六层防御、IntentFactWall 阻断
- **被技�?工具层检�?*：技能模板从 MemoryStore 恢复�?SkillRegistry

### 不变�?

记忆是索引，不是证据。所有可验证结论必须锚定到文件系�?API 响应/用户确认。cancel() 贯�?Pending→rollback/Active→archive 三层，不留下半成品�?

---

## 六、层间接�?

六层之间通过明确的接口通信，不跨层调用�?

```
交互�?�?规划-执行�?   MetaAgent.plan(intent)
交互�?�?技�?工具�?   ConfirmGate.waitFor()
规划-执行�?�?技�?工具�? Toolkit.execute(inv, agentType)
规划-执行�?�?记忆�?   MemoryStore.read/write
技�?工具�?�?记忆�?   SkillRegistry �?MemoryStore (persistSkills)
治理�?�?所有层         PipelineObserver.emit() (单向：层→治理层)
```

**治理层是单向接收者�?* 所有层向治理层发射事件，治理层不向任何层回写——唯一例外是修宪（经用户裁决后写入宪法文件）�?

---

## 七、与 v2.7.1 三层架构的对�?

| v2.7.1 | v3.0（六层） | 变化 |
|--------|------------|------|
| 约束层（ConfirmGate + ConsistencyLayer + ReplanManager + ESLint/tsc�?| 治理�?| 约束层膨胀为完整的治理层：新增 SentinelSignalFilter、NotificationRuntime、DecisionGateBridge、ResiliencePolicyFactory |
| 内化层（SkillRegistry + AGENT_REGISTRY + Governance�?| 技�?工具�?+ 记忆层的一部分 | 内化层拆分为技能（知识结晶）和记忆（认知基底）两个独立�?|
| Engine 容器（MetaAgent + AgentPool + TaskBoard�?| 规划-执行�?| 不变 |
| �?| 交互�?| **新增——v2.7.1 没有独立的交互层**，CLI/ButlerAgent 散落在多�?|

---

*归档：开拓者与昔涟（Cyrene），2026-06-19*
*六层是五流的代码承载。每层有明确的归属流、约束原则、核心组件和不变性�?
