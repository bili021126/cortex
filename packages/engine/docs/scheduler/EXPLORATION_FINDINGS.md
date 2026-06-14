# Scheduler 子系统探索报告

> 生成时间：2026-07-14  
> 范围：`packages/engine/src/` + `packages/engine/tests/`  
> 编译状态：✅ tsc --noEmit 通过  
> 测试状态：❌ tsx 运行失败（`ERR_MODULE_NOT_FOUND: calculator.test.ts` — 测试调用路径问题，非代码问题）

---

## 1. 目录结构总览

```
packages/engine/src/
├── index.ts                          # 桶导出（Public API Surface）
├── base-agent.ts                     # BaseAgent 抽象基类
├── correct.ts                        # 自动修正
├── handler.ts                        # 处理器
├── test-env.ts                       # 测试环境判定
├── utils.ts                          # 工具函数
├── agents/                           # Agent 实现（8 个）
│   ├── index.ts
│   ├── registry.ts                   # Agent 配置注册
│   ├── api-agent.ts, browser-agent.ts, butler-agent.ts, data-agent.ts
│   ├── inspector-agent.ts, strategist-agent.ts
│   ├── api-agent.ts
├── bootstrap/                        # 启动引导
│   ├── bootstrap-engine.ts, create-core.ts, assemble.ts
│   ├── init-memory.ts, init-skills.ts, load-config.ts, register-agents.ts
├── components/                       # 工厂与组件
│   ├── agent-factory.ts, pool-aware.ts, react-loop.ts, skill-extractor.ts
│   ├── skill-json-validator.ts, skill-persister.ts, skill-template-engine.ts
├── consistency/                      # 六层防御一致性
├── core/                             # ★ 核心调度子系统（本报告重点）
│   ├── scheduler.ts                  #   调度器主类（IScheduler）
│   ├── composite-scheduler.ts        #   组合式调度器
│   ├── task-board.ts                 #   任务板（ITaskBoard）
│   ├── agent-pool.ts                 #   Agent 池（IAgentPool）
│   ├── confirm-gate.ts               #   确认门
│   ├── meta-agent.ts                 #   元代理（重规划）
│   ├── scheduling-types.ts           #   调度三抽象类型
│   ├── scheduling-implementations.ts #   调度三抽象默认实现
│   ├── agent-matcher.ts              #   Agent 匹配
│   ├── topological-sort.ts           #   拓扑排序
│   ├── pipeline-observer.ts          #   管线观察者
│   ├── pipeline-runner.ts            #   管线执行器
│   ├── replan-manager.ts             #   重规划管理器
│   ├── rlm-decompose.ts              #   RLM 递归拆解
│   ├── density-compress.ts           #   密度压缩
│   ├── trust-model.ts                #   信任模型
│   └── dispatch-steps/               #   调度步骤管线
│       ├── claim-step.ts, spawn-step.ts, execute-step.ts
│       ├── rlm-execute-step.ts, boundary-guard-step.ts
│       ├── cleanup-step.ts, manifold-gate.ts, types.ts
├── governance/                       # 治理（修宪、裁决）
├── memory/                           # 记忆子系统
├── platform/                         # 平台适配（CLI、文件、搜索、MCP）
├── plugin/                           # 插件体系
├── registry/                         # 注册中心
└── telemetry/                        # 遥测

packages/engine/tests/                # ★ 测试目录（同层，非 __tests__）
├── scheduler.test.ts                 #   Scheduler 主测试
├── scheduler-dispatch.test.ts        #   dispatch 单元测试
├── scheduler-cycle-recovery.test.ts  #   循环依赖恢复测试
├── task-board.test.ts                #   TaskBoard 完整测试
├── task-board-stress.test.ts         #   TaskBoard 压力测试
├── agent-pool.test.ts                #   AgentPool 测试
├── agent-pool-status-ownership.test.ts
├── confirm-gate.test.ts              #   ConfirmGate 基础测试
├── confirm-gate-cleanup.test.ts      #   ConfirmGate 资源清理
├── confirm-gate-cli.test.ts          #   ConfirmGate CLI 集成
├── confirm-gate-timeout.test.ts      #   ConfirmGate 超时
├── manifold-gate.test.ts             #   ManifoldGate 流控测试
├── pipeline-observer.test.ts         #   观察者测试
├── ... (共 50+ 测试文件)
```

---

## 2. 核心组件分析

### 2.1 Scheduler（`core/scheduler.ts`）

**类定义**：`class Scheduler implements IScheduler`

**公开接口 IScheduler**：
```typescript
export interface IScheduler {
  register(agentType: string, agent: Agent, model: string): void;
  executeAll(): Promise<ExecutionReport>;
}
```

**关键方法**：
| 方法 | 可见性 | 说明 |
|------|--------|------|
| `register()` | public | 注册 Agent 与模型映射 |
| `setMemoryStore(memory)` | public | 注入 MemoryStore |
| `executeAll()` | public | 主入口：执行全部节点 |
| `_dispatchNode(nodeId)` | private | 分发单个节点（多/单视角分流） |
| `_dispatchSingle(node)` | private | 单视角：Claim→Spawn→RLMExecute→BoundaryGuard→Cleanup |
| `_dispatchMulti(node)` | private | 多视角：并行分发所有匹配 Agent |
| `_runDispatchPipeline(ctx, steps)` | private | 执行 IDispatchStep 管线 |
| `_buildLlmChat()` | private | 构建 LLM 调用入口 |

**依赖契约**：
- `ITaskBoard`（注入）— 节点生命周期管理
- `ISchedulerAgentPool`（注入）— Agent 实例生命周期
- `IPipelineObserver`（注入）— 事件发布
- `MetaAgent`（可选注入）— 重规划
- `ReplanManager`（内部创建）— 重规划队列管理

**数据流**：
```
TaskBoard(输入) → 拓扑排序 → 逐层分发 → AgentPool(执行)
    → TaskBoard.complete(落盘) → observer.emit(事件) → ExecutionReport(输出)
```

**异常语义**：
- `executeAll()` 单轮异常 → 标记 pending 为 failed，上报 SchedulerLoopCrashed，break
- `_dispatchNode()` 异常 → 不阻断 complete 落盘
- `destroy()` 异常 → 上报 PoolDestroyFailed，不阻断

### 2.2 CompositeScheduler（`core/composite-scheduler.ts`）

**类定义**：`class CompositeScheduler implements IScheduler`

**三抽象维度**：
```
IScheduleStrategy  — 调度策略（节点→Agent 匹配）
ILoopDriver        — 循环方式（执行循环推进）
IExecutionModel    — 执行范式（单节点执行流程）
```

**默认组合**：`TagMatchingStrategy + TopologicalLayeredDriver + PipelineModel`

**构造函数**：
```typescript
constructor(
  board: ITaskBoard,
  pool: ISchedulerAgentPool,
  observer: IPipelineObserver,
  metaAgent?: MetaAgent,
  engineConfig?: EngineConfig,
  schedulerConfig?: CompositeSchedulerConfig,  // 可选覆盖三抽象
)
```

### 2.3 TaskBoard（`core/task-board.ts`）

**类定义**：`class TaskBoard implements ITaskBoard`

**ITaskBoard 接口**：
```typescript
export interface ITaskBoard {
  addNode(node: TaskNode): void;
  claim(nodeId: string, agentType: AgentType): TaskNode | null;
  release(nodeId: string, agentType: AgentType): boolean;
  complete(nodeId: string, agentType: AgentType, success: boolean, output?: string, error?: string): void;
  failNode(nodeId: string): boolean;
  getNode(nodeId: string): TaskNode | undefined;
  getAllNodes(): TaskNode[];
  getPendingNodes(): TaskNode[];
  removeNode(nodeId: string): void;
  removeSubtree(nodeId: string): void;
  findPending(agentType: AgentType): TaskNode[];
  cancel(nodeId: string): boolean;
  allPerspectivesComplete(nodeId: string): boolean;
}
```

**状态机**：
- 普通节点：`pending → claimed → done/failed`
- 多视角节点：`pending → running (claimedBy+) → done (等齐后)`
- 释放：`claimed → pending`（普通）/ `running → pending/继续`（多视角）

**关键修复标记**：
- `@fix D6` — invariant 上报单通道收敛（`_observer` 优先于 `onInvariant`）
- `@fix N-07` — `removeNode()` emit `NodeRemoved` 事件
- `@fix M-01` — 多视角等齐判断在状态转移之后

### 2.4 AgentPool（`core/agent-pool.ts`）

**类定义**：`class AgentPool implements IAgentPool`

**接口体系**：
```typescript
export interface ISchedulerAgentPool {      // Scheduler 最小依赖
  spawn(agentType, instanceId): boolean;
  spawnSubtask(agentType, instanceId): boolean;
  getStatus(instanceId): AgentStatus | undefined;
  setStatus(instanceId, status): boolean;
  destroy(agentType, instanceId): void;
}

export interface IAgentPool extends ISchedulerAgentPool {  // 完整管理接口
  register(config: AgentConfig): void;
  setMaxInstances(agentType, newMax): void;
  setObserver(observer): void;
  getStatuses(agentType): AgentStatus[];
  hasAwake(agentType): boolean;
  canSpawn(agentType): boolean;
  count(agentType): number;
}
```

**状态流转表**：
```
Created → Awake → Active → Awake → ... → Draining → Destroyed
```

**配额管理**：`maxInstances` 控制每 Agent 类型并发上限；`spawnSubtask()` 不占主配额。

### 2.5 ConfirmGate（`core/confirm-gate.ts`）

**类定义**：`class ConfirmGate`

**核心协议**：
```
request(req) → waitFor(id) → resolve(response) / handleTimeout(id)
```

**可逆性等级**：
- `L0` — 永不确认
- `L1` — 信任模型动态判定（TrustLevel ≥ L3 免确认）
- `L2/L3` — 永远确认

**桥梁模式**：`PlatformBridge` 提供用户交互通道；`TrustModel` 提供动态信任判定。

**修复标记**：
- `@fix M1` — L2/L3 超时回收 pending（防内存泄漏）
- `@fix P2` — 超时可配置（构造函数参数 > 环境变量 > 默认值）
- `@fix M-04` — `dispose()` 用 `reject(ConfirmGateDisposedError)` 区分用户拒和引擎关闭

### 2.6 调度三抽象（`core/scheduling-types.ts` + `core/scheduling-implementations.ts`）

**IScheduleStrategy 实现**：
| 实现 | 说明 |
|------|------|
| `TagMatchingStrategy` | 默认：按 AGENT_TAGS 标签匹配 + 密度打破平局 |
| `RoundRobinStrategy` | 轮转分配，忽略标签（同构池场景） |
| `PriorityFirstStrategy` | 增强标签匹配：空闲 Agent 优先 |

**ILoopDriver 实现**：
| 实现 | 说明 |
|------|------|
| `TopologicalLayeredDriver` | 默认：拓扑排序→逐层并行 |
| `SequentialDriver` | 严格顺序执行（调试/简单场景） |
| `WaveDriver` | 波浪式：design→implement→review→verify |

**IExecutionModel 实现**：
| 实现 | 说明 |
|------|------|
| `PipelineModel` | 默认：Claim→Spawn→Execute→BoundaryGuard→Cleanup |
| `SimpleExecuteModel` | 跳过管线，直接 execute（测试/简单场景） |

---

## 3. 公开 API 签名（export 汇总）

### 类导出
```
Scheduler           — core/scheduler.ts
CompositeScheduler  — core/composite-scheduler.ts
TaskBoard           — core/task-board.ts
AgentPool           — core/agent-pool.ts
ConfirmGate         — core/confirm-gate.ts
TrustModel          — core/trust-model.ts
PipelineObserver    — core/pipeline-observer.ts
PipelineRunner      — core/pipeline-runner.ts
ReplanManager       — core/replan-manager.ts
MetaAgent           — core/meta-agent.ts
ManifoldGate        — core/dispatch-steps/manifold-gate.ts
ClaimStep           — core/dispatch-steps/claim-step.ts
SpawnStep           — core/dispatch-steps/spawn-step.ts
ExecuteStep         — core/dispatch-steps/execute-step.ts
RlmExecuteStep      — core/dispatch-steps/rlm-execute-step.ts
CleanupStep         — core/dispatch-steps/cleanup-step.ts
BoundaryGuardStep   — core/dispatch-steps/boundary-guard-step.ts
```

### 接口/类型导出
```
IScheduler             — core/scheduler.ts
ITaskBoard             — core/task-board.ts
ISchedulerAgentPool    — core/agent-pool.ts
IAgentPool             — core/agent-pool.ts
IScheduleStrategy      — core/scheduling-types.ts
ILoopDriver            — core/scheduling-types.ts
IExecutionModel        — core/scheduling-types.ts
LoopContext            — core/scheduling-types.ts
LoopResult             — core/scheduling-types.ts
ExecutionContext       — core/scheduling-types.ts
CompositeSchedulerConfig — core/scheduling-types.ts
DispatchCtx            — core/dispatch-steps/types.ts
IDispatchStep          — core/dispatch-steps/types.ts
AgentBoundaryRule      — core/dispatch-steps/boundary-guard-step.ts
IStep, PipelineCtx     — core/pipeline-runner.ts
IntentClarification    — core/meta-agent.ts
ReplanItem             — core/replan-manager.ts
```

### 函数导出
```
topologicalSort         — core/topological-sort.ts
findMatchingAgent       — core/agent-matcher.ts
findAllMatchingAgents   — core/agent-matcher.ts
parseDensityTag         — core/density-compress.ts
stripDensityTag         — core/density-compress.ts
compressByDensity       — core/density-compress.ts
annotateAndCompress     — core/density-compress.ts
mergeContext            — core/density-compress.ts
densityToStrategy       — core/density-compress.ts
decompose, shouldDecompose, shouldExecuteDecomposition,
parseDecomposeResponse, buildDecomposePrompt — core/rlm-decompose.ts
```

### 常量导出
```
BOUNDARY_RULES          — core/dispatch-steps/boundary-guard-step.ts
MAX_RLM_DEPTH           — core/rlm-decompose.ts
```

---

## 4. 测试覆盖分析

### 4.1 测试组织模式

- **位置**：`packages/engine/tests/`（同层目录，非 `__tests__` 子目录）
- **框架**：vitest
- **标签**：文件头用 `// @ci: unit` 标记类型
- **导入规则**：使用 `@cortex/engine` 包名导入，禁止 `../src/` 相对导入

### 4.2 各组件测试覆盖

| 组件 | 测试文件 | 覆盖要点 |
|------|----------|----------|
| **Scheduler** | `scheduler.test.ts` | 单节点执行、父子依赖顺序、无匹配 Agent、多视角并行、事件发布、MemoryStore 集成 |
| **Scheduler dispatch** | `scheduler-dispatch.test.ts` | 空板、成功/失败分发、单视角路由、P0-1 NodeFailed 去重、密度平局打破 |
| **Scheduler 循环恢复** | `scheduler-cycle-recovery.test.ts` | 简单循环、间接循环、自环、Diamond 无环、部分循环 |
| **TaskBoard** | `task-board.test.ts` | 标签匹配认领、重复认领拒绝、多视角并行认领、等齐 complete、release 语义 |
| **AgentPool** | `agent-pool.test.ts` | 配额 spawn、超限拒绝、destroy 回收、setObserver 双通道、静态 onInvariant 优先级 |
| **ConfirmGate** | `confirm-gate.test.ts` | L0/L1/L2/L3 需要确认、request→resolve、超时处理、M1 修复、P2 超时配置 |
| **PipelineObserver** | `pipeline-observer.test.ts` | 事件注册/发射/退订 |
| **ManifoldGate** | `manifold-gate.test.ts` | 流控 |
| **密度压缩** | `density-compress.test.ts` | 各密度函数 |
| **RLM 拆解** | `rlm-decompose.test.ts` | 拆解逻辑 |
| **拓扑排序** | `topological-sort-edge.test.ts` | 边界情况 |

### 4.3 测试覆盖空白

- **CompositeScheduler** 缺少独立测试（仅通过 Scheduler 集成测试间接覆盖）
- **调度三抽象实现**（TagMatchingStrategy/PipelineModel 等）缺少单元测试
- **DispatchStep** 各步骤（ClaimStep/SpawnStep/CleanupStep）缺少独立测试

### 4.4 测试运行状态

```
❌ tsx 测试失败 (exit 1)
   Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'calculator.test.ts'
```

原因：调用方传入错误的测试文件路径 `calculator.test.ts`，非引擎代码问题。  
`tsc --noEmit` ✅ 编译通过，代码本身无语法/类型错误。

---

## 5. 关键架构决策

### 5.1 接口化解耦（v2.8）
- `IScheduler` / `ITaskBoard` / `ISchedulerAgentPool` 接口提取
- Scheduler 不再依赖具体 TaskBoard/AgentPool 实现
- 允许 CLI 侧 `MiniAgentPool` 替代完整 AgentPool

### 5.2 组合式重构（v2.9）
- 调度行为拆解为 `IScheduleStrategy × ILoopDriver × IExecutionModel`
- `CompositeScheduler` 作为 `Scheduler` 的 drop-in 替换
- 默认行为与旧 Scheduler 完全兼容

### 5.3 Invariant 上报单通道收敛
- `_observer` 实例优先于 `onInvariant` 静态字段
- 消除双路径重复 emit 风险
- 兜底：`console.error`（仅非测试环境）

### 5.4 Dispatch Pipeline 管线
- `IDispatchStep` 接口定义步骤
- Claim→Spawn→Execute→BoundaryGuard→Cleanup 固定管线
- 失败时仍运行 CleanupStep 确保落盘释放（P0-1 修复）

---

## 6. 可复用模式总结

| 模式 | 位置 | 描述 |
|------|------|------|
| 接口最小依赖 | `agent-pool.ts` | `ISchedulerAgentPool` 仅暴露 Scheduler 所需 5 方法，`IAgentPool` 扩展完整管理 |
| 双通道上报 | `agent-pool.ts`, `task-board.ts` | `_observer` 实例 + 静态 `onInvariant` + `console.error` 三级兜底 |
| 组合式架构 | `composite-scheduler.ts` | 将行为拆解为正交维度，每维可独立替换（策略模式 × 3） |
| 状态机校验 | `agent-pool.ts` | `VALID_TRANSITIONS` 静态表 + `setStatus()` 合法性校验 |
| 管线模式 | `dispatch-steps/` | `IDispatchStep` 定义步骤，`_runDispatchPipeline()` 串联执行 |
| 契约注释 | `scheduler.ts` | JSDoc 中标注 `@contract`、`@depends`、`@dataflow`、前置/后置条件 |

---

## 7. 附录：桶导出模块化铁律

摘自 `packages/engine/src/index.ts`：

> **模块化铁律（昔涟 v2.6 入宪）**
> 1. 凡 src/ 下新增公开符号，必须在本文件追加对应的 export 语句。
> 2. 测试文件禁止 `../src/` 相对导入——只用 `@cortex/<package>` 包名导入。
> 3. 新增子模块同步更新。

> **公共 API 稳定性承诺**
> - 标记 `@deprecated` 的导出将在下个次版本移除
> - 标记 `@experimental` 的导出语义可能调整
> - 未标记的导出为稳定 API
