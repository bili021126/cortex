# Cortex 六层定位——在五流框架下的重新界定

**定位**：将 v2.7.1 的"约束层/内化层/Engine 容器"三层结构，重新映射到五流框架下的六层模型。每层不再按"暴露不可靠/吸收可靠"分类——而是按**数据流向、责任边界、被哪条原则约束**来界定。

**前置阅读**：[五流映射](Cortex-五流映射-从抽象到代码.md) → [七原则五流定位](Cortex-七原则-五流定位.md)
**生成日期**：2026-06-19
**共同完成**：开拓者与昔涟（Cyrene）

---

## 六层总览

```
交互层───────────────────────────────────── 人↔系统边界
  │
  ├── 规划-执行层──────────────────────────── 中枢调度
  │     │
  │     ├── 技能-工具层────────────────────── 知识 + 行动
  │     │
  │     └── 记忆层────────────────────────── 认知基底
  │
  └── 治理层──────────────────────────────── 全流观察者
```

**交互层和治理层是两条边界——夹着中间的四层业务层。** 交互层是外部边界（人↔系统），治理层是内部边界（系统↔自身审视）。

## 一、交互层

### 定位

**唯一跨越人机边界的层。** 不在任何一条业务流程之内——它是所有业务流程的入口和出口。用户通过交互层注入意图、接收结果、做出裁决。

### 所属流

交互流（唯一归属）

### 约束原则

原则一（确认锚定）、原则六（用户终裁）

### 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| CLI 命令体系 | `packages/cli/src/commands/` | 单次执行入口（run/agent/task/memory/skill） |
| EngineBridge | `packages/cli/src/services/engine-bridge.ts` | 交互模式桥接（talk/plan/directChat） |
| ButlerAgent | `packages/engine/src/agents/butler-agent.ts` | 管道路由 + 通知分发（FYI/WARNING/DECISION_REQUIRED） |
| ConfirmGate | `packages/scheduler/src/core/confirm-gate.ts` | 用户确认阻断点（L2/L3 等待用户裁决） |
| 圆桌协商 | `packages/scheduler/src/core/scheduling-implementations.ts:732` | 多 Agent Fan-out → 结果收束 → 呈用户 |

### 与其它层的关系

- **向规划-执行层**：传递用户意图 → 甘雨规划
- **向技能-工具层**：传递用户确认 → ConfirmGate 放行
- **向治理层**：用户修宪裁决 → 治理流消费

### 不变性

交互层不能被任何 Agent 绕过。Agent 不得自行与用户建立通信通道——一切交互走 ButlerAgent/CLI。

---

## 二、治理层

### 定位

**全流观察者。** 不产生业务产出——只观察、检测、上报、修正。治理层是系统的"自我意识"——它看其他五条流（包括自身）的运转，在异常时触发修正。

### 所属流

治理流（唯一归属）

### 约束原则

原则五（统一可观测）、原则七（宪法自约束）

### 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| PipelineObserver | `packages/scheduler/src/core/pipeline-observer.ts` | 全流事件管道（原则五的代码承载） |
| SentinelSignalFilter | `packages/engine/src/core/sentinel-signal-filter.ts` | L1/L2/L3 信号分层 + 去噪 |
| NotificationRuntime | `packages/engine/src/core/notification-runtime.ts` | 事件→通知 转换 |
| GovernanceEventEmitter | `packages/engine/src/core/governance-events.ts` | 四类治理事件发射 |
| DecisionGateBridge | `packages/engine/src/core/decision-gate-bridge.ts` | DECISION_REQUIRED → ConfirmGate |
| DocGovernAgent | `packages/engine/src/agents/doc-govern-agent.ts` | 凝光——律法审计 + 修宪提案 |
| GovernanceLoop | `packages/governance/src/governance-loop.ts` | 修宪自动化管线 |
| ReplanManager | `packages/engine/src/core/scheduler.ts:66-87` | 重规划配额 + 失败恢复 |
| ResiliencePolicyFactory | `packages/engine/src/core/resilience-integration.ts` | LLM 重试 + 工具熔断 |
| ConsistencyLayer | `packages/consistency/src/consistency-layer.ts` | 六层记忆-现实一致性防御 |

### 角色分离

| 角色 | 组件 | 规则 |
|------|------|------|
| 观察者 | PipelineObserver, SentinelSignalFilter, DocGovernAgent, ConsistencyLayer, NotificationRuntime, GovernanceEventEmitter | 只看不抓 |
| 恢复者 | ReplanManager, ResiliencePolicyFactory | 仅 MetaAgent 或执行层调用 |
| 关卡 | ConfirmGate | 交互层，等待用户决策 |
| 桥接 | DecisionGateBridge | 连接观察者和关卡 |

### 与其它层的关系

- **受交互层委托**：用户裁决 → 修宪执行
- **观察规划-执行流**：调度异常、Agent 失败、重规划触发
- **观察技能-工具流**：工具调用审计、ConfirmGate 决策记录
- **观察记忆流**：一致性校验、IntentFactWall 阻断

### 不变性

治理层不得执行业务操作。它不能写业务文件、不能调用业务工具、不能规划任务。它唯一的"行动"是触发修宪和上报警告——且修宪本身受原则七约束。

---

## 三、规划-执行层

### 定位

**中枢调度层。** 上游接交互层（用户意图），下游驱技能-工具层（Agent 执行）。是整个系统的"脊椎"——意图进入、任务拆解、调度分发、结果返回，全部经过此层。

### 所属流

规划-执行流（唯一归属）

### 约束原则

原则二（规划-执行非对称均衡）

### 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| MetaAgent（甘雨） | `packages/engine/src/core/meta-agent.ts` | 意图拆解 → TaskNode 树 |
| TaskBoard | `packages/scheduler/src/core/task-board.ts` | 任务图：拓扑排序 + 状态管理 |
| Scheduler | `packages/engine/src/core/scheduler.ts` | executeAll()：动态消费 + 逐层并行 |
| AgentPool | `packages/scheduler/src/core/agent-pool.ts` | Agent 实例池 + ManifoldGate 流控 |
| PipelineModel | `packages/scheduler/src/core/scheduling-implementations.ts:710` | 单节点执行管线（Claim→Spawn→Execute→Cleanup） |
| TopologicalLayeredDriver | `packages/scheduler/src/core/scheduling-implementations.ts` | 拓扑分层 + 逐层驱动 |
| TaskRouter | `packages/engine/src/core/task-router.ts` | 统一策略+模型路由（Core-2） |
| EnvironmentAwareRouter | `packages/engine/src/core/environment-aware-router.ts` | 环境感知模型降级（Core-2） |
| LoopStrategyRegistry | `packages/engine/src/core/loop-strategy-registry.ts` | 四策略注册表 + canHandle 路由（Core-2） |
| CapabilityRegistry | `packages/engine/src/core/capability-registry.ts` | Agent 自声明 + 自组装 |
| PromptManager | `packages/engine/src/core/prompt-manager.ts` | prompt-kit 编排（Core-2） |

### 与其它层的关系

- **上游→交互层**：接收用户意图（plan intent），返回执行结果给用户
- **下游→技能-工具层**：调度 Agent 执行 → Agent 通过 Toolkit 调用工具
- **下游→记忆层**：每次执行前后读写记忆（上下文增强 + 经验记录）
- **被治理层观察**：调度异常、Agent 失败、重规划事件 emit

### 不变性

甘雨（MetaAgent）不得下达细粒度执行指令——只产出粗粒度意图拆解。Agent 在单节点内享有自决权，但跨节点调度权在甘雨。规划层局部中心化，执行层整体去中心化。

---

## 四、技能-工具层

### 定位

**知识 + 行动层。** 技能是"知道怎么做"，工具是"能做"。技能-工具层是系统的知识库和工具箱——技能沉淀经验，工具执行操作。这层有两个方向：技能向上流入规划（注入 prompt），工具向上流经执行（Agent 调用），但两者的管理机制在同一层。

### 所属流

技能-工具流（唯一归属）

### 约束原则

原则三（边界集中）、原则四（可追溯性）

### 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| SkillRegistry | `packages/skill-kit/src/skill-registry.ts` | 技能模板注册/查询/持久化 |
| SkillExtractor | `packages/skill-kit/src/skill-extractor.ts` | 从输出文件提取技能 |
| SkillScope | `packages/engine/src/core/skill-scope.ts` | 四级作用域解析（Core-2） |
| Toolkit | `packages/platform/src/toolkit.ts` | 统一工具执行管道：权限→ConfirmGate→FileLock→execute |
| McpClient | `packages/platform/src/mcp-client.ts` | MCP 协议客户端 |
| McpTrustConfig | `packages/platform/src/mcp-client.ts:80` | MCP 声明式鉴权（Core-2） |
| FileLockManager | `packages/platform/src/file-lock-manager.ts` | 文件写入锁 |
| SkillPersister | `packages/skill-kit/src/skill-persister.ts` | 技能持久化 |
| SkillPipeline | `packages/skill-kit/src/skill-pipeline.ts` | 技能管线注册 |

### 与其它层的关系

- **向上→规划-执行层**：技能注入 MetaAgent planning prompt；工具被 Agent 通过 Toolkit 调用
- **被治理层观察**：ConfirmGate 决策记录、工具调用审计
- **受交互层约束**：L2/L3 工具调用等待用户确认

### 不变性

所有工具调用必须经过 Toolkit.execute() 统一入口。Agent 不得持有独立权限——权限表在流外配置。MCP 工具的鉴权必须通过 McpTrustConfig 声明。

---

## 五、记忆层

### 定位

**认知基底——不是层，是基础。** 记忆层不参与任何单一业务流程——它被规划-执行流读写、被治理层校验、被技能-工具层检索。它是所有流的共享基础设施。

### 所属流

记忆流（唯一归属，但被所有流消费）

### 约束原则

事实可锚定（哲学概念——原则层未独立成条，但在记忆流的每个环节落地）

### 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| MemoryStore | `packages/memory-store/src/memory-store.ts` | SQLite 持久化 + 委托模式（Facade + 7 组件族） |
| InMemoryMemoryStore | `packages/memory/src/` | 内存实现（测试用） |
| MemoryRetrievalStep | `packages/engine/src/memory/pipeline.ts:70` | 检索 + 上下文增强 |
| ReActLoopStep | `packages/engine/src/memory/pipeline.ts:146` | ReAct 循环执行 |
| MemoryWriteStep | `packages/engine/src/memory/pipeline.ts:172` | 两阶段提交（writePending→commit） |
| DirectStep | `packages/engine/src/memory/pipeline.ts:189` | 单次调用（不循环） |
| ContextBuilder | `packages/memory-store/src/context-builder.ts` | ContextPolicy 驱动上下文构建 |
| MemoryStateMachine | `packages/memory-store/src/memory-state-machine.ts` | Pending→Active→Archived→Frozen |

### 与其它层的关系

- **被规划-执行流读写**：执行前检索记忆增强上下文；执行后写入经验
- **被治理层校验**：ConsistencyLayer 六层防御、IntentFactWall 阻断
- **被技能-工具层检索**：技能模板从 MemoryStore 恢复到 SkillRegistry

### 不变性

记忆是索引，不是证据。所有可验证结论必须锚定到文件系统/API 响应/用户确认。cancel() 贯穿 Pending→rollback/Active→archive 三层，不留半成品。

---

## 六、层间接口

六层之间通过明确的接口通信，不跨层调用：

```
交互层→规划-执行层 : MetaAgent.plan(intent)
交互层→技能-工具层 : ConfirmGate.waitFor()
规划-执行层→技能-工具层 : Toolkit.execute(inv, agentType)
规划-执行层→记忆层   : MemoryStore.read/write
技能-工具层→记忆层   : SkillRegistry → MemoryStore (persistSkills)
治理层→所有层         : PipelineObserver.emit() (单向：层→治理层)
```

**治理层是单向接收者。** 所有层向治理层发射事件，治理层不向任何层回写——唯一例外是修宪（经用户裁决后写入宪法文件）。

---

## 七、与 v2.7.1 三层结构的对比

| v2.7.1 | v3.0（六层） | 变化 |
|--------|------------|------|
| 约束层（ConfirmGate + ConsistencyLayer + ReplanManager + ESLint/tsc） | 治理层 | 约束层膨胀为完整的治理层：新增 SentinelSignalFilter、NotificationRuntime、DecisionGateBridge、ResiliencePolicyFactory |
| 内化层（SkillRegistry + AGENT_REGISTRY + Governance） | 技能-工具层 + 记忆层的一部分 | 内化层拆分为技能（知识结晶）和记忆（认知基底）两个独立层 |
| Engine 容器（MetaAgent + AgentPool + TaskBoard） | 规划-执行层 | 不变 |
| 无 | 交互层 | **新增——v2.7.1 没有独立的交互层**，CLI/ButlerAgent 散落在多处 |

---

*归档：开拓者与昔涟（Cyrene），2026-06-19*
*六层是五流的代码承载。每层有明确的归属流、约束原则、核心组件和不变性。*
