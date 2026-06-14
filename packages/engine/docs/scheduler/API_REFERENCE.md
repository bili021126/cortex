# 调度系统 API 参考文档 (Scheduler API Reference)

> 本文档基于 `packages/engine/src/core/` 源代码分析生成。
> 覆盖调度系统所有**公开 API**（导出的接口、类、函数、类型），
> 包含完整签名、JSDoc 说明、参数表、返回值、使用示例。
> 内部实现细节（私有方法、辅助函数）标记为 `[内部]` 不展开。
>
> 版本: v2.9 · 最后更新: 2026-07-14

---

## 目录

1. [调度核心接口 (IScheduler)](#1-调度核心接口-ischeduler)
2. [任务板 (ITaskBoard / TaskBoard)](#2-任务板-itaskboard--taskboard)
3. [Agent 池 (ISchedulerAgentPool / IAgentPool / AgentPool)](#3-agent-池-ischeduleragentpool--iagentpool--agentpool)
4. [可观测事件管道 (IPipelineObserver / PipelineObserver)](#4-可观测事件管道-ipipelineobserver--pipelineobserver)
5. [三抽象扩展点接口](#5-三抽象扩展点接口)
6. [三抽象实现类](#6-三抽象实现类)
7. [组合式调度器 (CompositeScheduler)](#7-组合式调度器-compositescheduler)
8. [调度分发步骤 (IDispatchStep)](#8-调度分发步骤-idispatp-step--dispatch-步骤)
9. [确认门 (ConfirmGate)](#9-确认门-conformgate)
10. [重规划管理器 (ReplanManager)](#10-重规划管理器-replanmanager)
11. [拓扑排序 (topologicalSort)](#11-拓扑排序-topologicalsort)
12. [Agent 匹配器 (findMatchingAgent / findAllMatchingAgents)](#12-agent-匹配器-findmatchingagent--findallmatchingagents)
13. [RLM 拆解 (decompose / shouldDecompose / shouldExecuteDecomposition)](#13-rlm-拆解-decompose--shoulddecompose--shouldexecutedecomposition)
14. [密度压缩 (DENSITY)](#14-密度压缩-density)
15. [流形约束门控 (ManifoldGate)](#15-流形约束门控-manifoldgate)
16. [信任模型 (TrustModel)](#16-信任模型-trustmodel)
17. [管道执行器 (PipelineRunner)](#17-管道执行器-pipelinerunner)
18. [MetaAgent 概要](#18-metaagent-概要)
19. [调度实现 (Scheduler 类) — 内部](#19-调度实现-scheduler-类--内部)

---

## 1. 调度核心接口 (IScheduler)

> **文件**: `scheduler.ts`
> **角色**: 调度器面向外部（CLI/EngineBridge/Bootstrap）的统一契约。所有 Scheduler 变体（Scheduler / CompositeScheduler）均实现此接口。

### IScheduler

```typescript
export interface IScheduler {
  register(agentType: string, agent: Agent, model: string): void;
  executeAll(): Promise<ExecutionReport>;
}
```

#### 方法签名

| 方法 | 签名 | 描述 |
|------|------|------|
| `register` | `(agentType: string, agent: Agent, model: string) => void` | 注册一个 AgentRunner 及其关联模型 |
| `executeAll` | `() => Promise<ExecutionReport>` | 执行 TaskBoard 上全部节点，返回执行报告 |

#### 参数详情

**`register(agentType, agent, model)`**

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `agentType` | `string` | 是 | Agent 类型标识（如 `"code"`、`"analysis"`） |
| `agent` | `Agent` | 是 | Agent 实例（来自 `@cortex/shared`） |
| `model` | `string` | 是 | 该 Agent 使用的模型名（如 `"deepseek-chat"`） |

**`executeAll()`**

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| 无参数 | — | — | 依赖构造函数中注入的 `ITaskBoard`、`ISchedulerAgentPool`、`IPipelineObserver` |

#### 返回值

```typescript
interface ExecutionReport {
  totalNodes: number;      // 总节点数
  completed: number;       // 成功数
  failed: number;          // 失败数
  results: NodeResult[];   // 各节点的执行结果
  durationMs: number;      // 总耗时
  sessionId?: string;      // 本次执行的会话 ID（Scheduler 实现提供）
}
```

#### 使用示例

```typescript
// 构造 Scheduler
const scheduler = new Scheduler(board, pool, observer, metaAgent, engineConfig);

// 注册 Agent
scheduler.register("code", codeAgent, "deepseek-chat");
scheduler.register("analysis", analysisAgent, "deepseek-chat");

// 执行全部节点
const report = await scheduler.executeAll();
console.log(`完成 ${report.completed}/${report.totalNodes}，耗时 ${report.durationMs}ms`);
```

---

## 2. 任务板 (ITaskBoard / TaskBoard)

> **文件**: `task-board.ts`
> **角色**: 节点生命周期管理——入板、认领、释放、完成、查询。Scheduler 与 TaskBoard 的核心协议由 `claim/release/complete` 三方法构成。

### ITaskBoard（公开接口）

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
}
```

#### 方法签名

| 方法 | 签名 | 描述 |
|------|------|------|
| `addNode` | `(node: TaskNode) => void` | 添加节点到任务板 |
| `claim` | `(nodeId: string, agentType: AgentType) => TaskNode \| null` | 原子认领节点。**并发安全**（同步方法，Node.js 单线程天然原子） |
| `release` | `(nodeId: string, agentType: AgentType) => boolean` | 释放认领。仅 claimed 可回退到 pending |
| `complete` | `(nodeId, agentType, success, output?, error?) => void` | 写入执行结果，触发状态转移。多视角等齐后自动置 done |
| `failNode` | `(nodeId: string) => boolean` | 强制标记失败（无匹配 Agent 等场景） |
| `getNode` | `(nodeId: string) => TaskNode \| undefined` | 查询单个节点 |
| `getAllNodes` | `() => TaskNode[]` | 获取所有节点 |
| `getPendingNodes` | `() => TaskNode[]` | 获取 pending/claimed 节点（供 executeAll 动态消费） |
| `removeNode` | `(nodeId: string) => void` | 移除单个节点，emit `NodeRemoved` 事件 |
| `removeSubtree` | `(nodeId: string) => void` | 移除子树（BFS 遍历后代），emit `NodeRemoved` 事件 |

#### 参数表 (核心协议)

**`claim(nodeId, agentType)`**

| 参数 | 类型 | 描述 |
|------|------|------|
| `nodeId` | `string` | 节点 ID |
| `agentType` | `AgentType` | Agent 类型 |
| **返回** | `TaskNode \| null` | 认领成功返回节点引用，失败返回 null |
| **失败原因** | | 节点不存在、标签不匹配、已认领、已终态 |

**`release(nodeId, agentType)`**

| 参数 | 类型 | 描述 |
|------|------|------|
| `nodeId` | `string` | 节点 ID |
| `agentType` | `AgentType` | Agent 类型 |
| **返回** | `boolean` | 释放成功返回 true |
| **失败原因** | | 节点不存在、非认领者、已终态 |

**`complete(nodeId, agentType, success, output?, error?)`**

| 参数 | 类型 | 描述 |
|------|------|------|
| `nodeId` | `string` | 节点 ID |
| `agentType` | `AgentType` | Agent 类型 |
| `success` | `boolean` | 是否成功 |
| `output` | `string` (可选) | 执行产出文本 |
| `error` | `string` (可选) | 错误信息 |

#### 使用示例

```typescript
const board = new TaskBoard();

// 添加节点
board.addNode({
  id: "task-1",
  type: "code",
  tags: ["code", "refactor"],
  needsMultiPerspective: false,
  status: "pending",
  claimedBy: [],
  payload: "Refactor the scheduler module",
  results: [],
  createdAt: Date.now(),
});

// 认领节点
const node = board.claim("task-1", "code" as AgentType);
if (node) {
  // 执行...

  // 完成节点
  board.complete("task-1", "code" as AgentType, true, "Refactoring completed");
}

// 查询 pending 节点
const pending = board.getPendingNodes();
```

### TaskBoard 类

```typescript
export class TaskBoard implements ITaskBoard {
  static onInvariant: InvariantReporter | null = null;
  // ... 实现全部 ITaskBoard 方法
}
```

#### 公开静态字段

| 字段 | 类型 | 描述 |
|------|------|------|
| `onInvariant` | `InvariantReporter \| null` | invariant 违规上报后端。优先级：实例 `_observer` > 静态 `onInvariant` > `console.error` |

#### 公开方法（未在 ITaskBoard 中声明）

| 方法 | 签名 | 描述 |
|------|------|------|
| `setObserver` | `(observer: IPipelineObserver) => void` | 注入 PipelineObserver |
| `findPending` | `(agentType: AgentType) => TaskNode[]` | 查找该 Agent 类型当前可认领的全部节点 |
| `allPerspectivesComplete` | `(nodeId: string) => boolean` | 多视角节点是否已等齐全部认领 Agent |
| `cancel` | `(nodeId: string) => boolean` | 取消节点。仅 pending/claimed 可取消，done/failed 拒绝 |

---

## 3. Agent 池 (ISchedulerAgentPool / IAgentPool / AgentPool)

> **文件**: `agent-pool.ts`
> **角色**: Agent 实例生命周期管理（spawn/destroy）、状态机追踪、配额控制。

### ISchedulerAgentPool（最小契约）

```typescript
export interface ISchedulerAgentPool {
  spawn(agentType: AgentType, instanceId: string): boolean;
  spawnSubtask(agentType: AgentType, instanceId: string): boolean;
  getStatus(instanceId: string): AgentStatus | undefined;
  setStatus(instanceId: string, status: AgentStatus): boolean;
  destroy(agentType: AgentType, instanceId: string): void;
}
```

#### 方法签名

| 方法 | 签名 | 描述 |
|------|------|------|
| `spawn` | `(agentType, instanceId) => boolean` | 启动一个 Agent 实例。超限返回 false |
| `spawnSubtask` | `(agentType, instanceId) => boolean` | RLM 子任务——不占主配额 |
| `getStatus` | `(instanceId) => AgentStatus \| undefined` | 查询实例状态 |
| `setStatus` | `(instanceId, status) => boolean` | 更新实例状态（含流转合法性校验） |
| `destroy` | `(agentType, instanceId) => void` | 回收 Agent 实例 |

### IAgentPool（完整管理接口）

```typescript
export interface IAgentPool extends ISchedulerAgentPool {
  register(config: AgentConfig): void;
  setMaxInstances(agentType: AgentType, newMax: number): void;
  setObserver(observer: IPipelineObserver): void;
  getStatuses(agentType: AgentType): AgentStatus[];
  hasAwake(agentType: AgentType): boolean;
  canSpawn(agentType: AgentType): boolean;
  count(agentType: AgentType): number;
}
```

#### AgentPool 类

```typescript
export class AgentPool implements IAgentPool {
  static readonly VALID_TRANSITIONS: Record<AgentStatus, Set<AgentStatus>>;
  static onInvariant: InvariantReporter | null = null;
  // ... 全部方法实现
}
```

#### 状态流转表

```
Created    → Awake, Destroyed
Awake      → Active, Draining
Active     → Awake, Draining, Active（允许无操作）
Draining   → Destroyed
Destroyed  → (无)
```

#### 使用示例

```typescript
const pool = new AgentPool();
pool.register({ type: "code", maxInstances: 3 });
pool.setObserver(observer);

// 创建实例
const ok = pool.spawn("code" as AgentType, "code-task-1");
pool.setStatus("code-task-1", AgentStatus.Awake);

// 查询
console.log(pool.count("code" as AgentType));    // 1
console.log(pool.canSpawn("code" as AgentType));  // true (1 < 3)

// 销毁
pool.destroy("code" as AgentType, "code-task-1");
```

---

## 4. 可观测事件管道 (IPipelineObserver / PipelineObserver)

> **文件**: `pipeline-observer.ts`
> **角色**: 优先级回调注册表。替代 v1.1 的 EventBus。所有可观测事件走此管道。

### IPipelineObserver（接口，来自 `@cortex/shared`）

```typescript
export interface IPipelineObserver {
  on(priority: PipelinePriority, handler: PipelineHandler): void;
  off(priority: PipelinePriority, handler?: PipelineHandler): void;
  emit(event: ObservableEvent): void;
}
```

### PipelineObserver 类

```typescript
export class PipelineObserver implements IPipelineObserver {
  // ... 实现
}
```

#### 公开方法

| 方法 | 签名 | 描述 |
|------|------|------|
| `on` | `(priority: PipelinePriority, handler: PipelineHandler) => void` | 注册回调。同优先级按注册顺序执行 |
| `off` | `(priority: PipelinePriority, handler?: PipelineHandler) => void` | 移除 handler。不传 handler 则移除该优先级下所有 |
| `emit` | `(event: ObservableEvent) => void` | 发射事件。单 handler 异常不阻断后续 handler |
| `onHandlerError` | `(reporter: HandlerErrorReporter \| null) => void` | 注入 handler 异常上报后端 |
| `createSafeReporter` | `() => SafeErrorReporter` | 创建 SafeErrorReporter 实例（silent 错误连续 3 次自动升级为 degraded） |

#### 事件类型（部分关键事件）

| 事件类型 | 发射时机 | 优先级 |
|----------|----------|--------|
| `NodeStart` | 节点开始分发 | HIGH |
| `NodeComplete` | 节点执行成功 | HIGH |
| `NodeFailed` | 节点执行失败 | CRITICAL |
| `NodeRemoved` | 节点被移除 | NORMAL |
| `SchedulerLayerStart` | 每层开始执行 | HIGH |
| `SchedulerDone` | 全部执行完成 | CRITICAL |
| `SchedulerLoopCrashed` | 调度循环异常中断 | CRITICAL |
| `AgentBoundaryViolation` | Agent 越界写文件 | HIGH |
| `ManifoldGateWaitStart/End` | 流控排队/唤醒 | HIGH |
| `ManifoldGateAcquireTimeout` | 流控超时 | HIGH |

#### 使用示例

```typescript
const observer = new PipelineObserver();

// 注册
observer.on(PipelinePriority.HIGH, (event) => {
  if (event.type === PipelineEventType.NodeComplete) {
    console.log(`Node ${event.payload.nodeId} completed`);
  }
});

// 发射
observer.emit({
  type: PipelineEventType.NodeComplete,
  priority: PipelinePriority.HIGH,
  payload: { nodeId: "task-1", agentType: "code", success: true },
  timestamp: Date.now(),
  notificationType: "FYI",
});

// 精确移除
observer.off(PipelinePriority.HIGH, myHandler);
```

---

## 5. 三抽象扩展点接口

> **文件**: `scheduling-types.ts`
> **角色**: 将 Scheduler 行为拆解为三个正交维度，每维可独立替换。

### IScheduleStrategy — 调度策略

```typescript
export interface IScheduleStrategy {
  readonly name: string;
  findMatchingAgent(node: TaskNode, agents: Map<string, Agent>): string | null;
  findAllMatchingAgents(node: TaskNode, agents: Map<string, Agent>): string[];
}
```

| 方法 | 描述 |
|------|------|
| `findMatchingAgent` | 为单个节点查找最佳匹配的 Agent 类型。返回 Agent 类型名或 null |
| `findAllMatchingAgents` | 为多视角节点查找所有匹配的 Agent 类型 |

### ILoopDriver — 循环驱动

```typescript
export interface ILoopDriver {
  readonly name: string;
  run(ctx: LoopContext): Promise<LoopResult>;
}
```

#### LoopContext

```typescript
export interface LoopContext {
  board: ITaskBoard;
  pool: ISchedulerAgentPool;
  observer: IPipelineObserver;
  agents: Map<string, Agent>;
  models: Map<string, string>;
  metaAgent?: MetaAgent;
  replanManager: ReplanManager;
  config: Required<EngineConfig>;
  strategy: IScheduleStrategy;
  executionModel: IExecutionModel;
}
```

#### LoopResult

```typescript
export interface LoopResult {
  completed: number;
  failed: number;
  results: NodeResult[];
}
```

### IExecutionModel — 执行范式

```typescript
export interface IExecutionModel {
  readonly name: string;
  dispatchSingle(ctx: ExecutionContext): Promise<NodeResult>;
  dispatchMulti(ctx: ExecutionContext): Promise<NodeResult>;
}
```

#### ExecutionContext

```typescript
export interface ExecutionContext {
  node: TaskNode;
  agents: Map<string, Agent>;
  models: Map<string, string>;
  board: ITaskBoard;
  pool: ISchedulerAgentPool;
  observer: IPipelineObserver;
  strategy: IScheduleStrategy;
  isTestEnv: boolean;
}
```

### CompositeSchedulerConfig

```typescript
export interface CompositeSchedulerConfig {
  strategy?: IScheduleStrategy;
  loopDriver?: ILoopDriver;
  executionModel?: IExecutionModel;
}
```

#### 使用示例（自定义组合）

```typescript
import {
  CompositeScheduler,
  TagMatchingStrategy,
  SequentialDriver,
  SimpleExecuteModel,
} from "./scheduling-implementations.js";

const scheduler = new CompositeScheduler(board, pool, observer, metaAgent, engineConfig, {
  strategy: new TagMatchingStrategy(),
  loopDriver: new SequentialDriver(),
  executionModel: new SimpleExecuteModel(),
});
```

---

## 6. 三抽象实现类

> **文件**: `scheduling-implementations.ts`
> **角色**: 提供三抽象的所有内置实现。

### IScheduleStrategy 实现

| 类 | `name` | 策略 | 适用场景 |
|----|--------|------|----------|
| `TagMatchingStrategy` | `tag-matching` | 按 node.type 精确匹配，回退 tags 打分 + 密度打破平局 | **默认**，通用场景 |
| `RoundRobinStrategy` | `round-robin` | 轮转分配，忽略标签 | 同构 Agent 池负载均衡 |
| `PriorityFirstStrategy` | `priority-first` | 增强标签匹配：空闲 Agent 优先 | 混合负载，避免热点 |

```typescript
// 所有实现类签名
export class TagMatchingStrategy implements IScheduleStrategy {
  readonly name = "tag-matching";
  findMatchingAgent(node: TaskNode, agents: Map<string, Agent>): string | null;
  findAllMatchingAgents(node: TaskNode, agents: Map<string, Agent>): string[];
}

export class RoundRobinStrategy implements IScheduleStrategy {
  readonly name = "round-robin";
  findMatchingAgent(node: TaskNode, agents: Map<string, Agent>): string | null;
  findAllMatchingAgents(node: TaskNode, agents: Map<string, Agent>): string[];
}

export class PriorityFirstStrategy implements IScheduleStrategy {
  readonly name = "priority-first";
  findMatchingAgent(node: TaskNode, agents: Map<string, Agent>): string | null;
  findAllMatchingAgents(node: TaskNode, agents: Map<string, Agent>): string[];
}
```

### ILoopDriver 实现

| 类 | `name` | 策略 | 适用场景 |
|----|--------|------|----------|
| `TopologicalLayeredDriver` | `topological-layered` | 拓扑排序→逐层并行，含重规划队列 | **默认**，通用 |
| `SequentialDriver` | `sequential` | 严格顺序执行，无拓扑排序 | 调试/简单依赖 |
| `WaveDriver` | `wave` | 波浪式：design→implement→review→verify | 软件开发流程语义化 |

```typescript
export class TopologicalLayeredDriver implements ILoopDriver {
  readonly name = "topological-layered";
  async run(ctx: LoopContext): Promise<LoopResult>;
}

export class SequentialDriver implements ILoopDriver {
  readonly name = "sequential";
  async run(ctx: LoopContext): Promise<LoopResult>;
}

export class WaveDriver implements ILoopDriver {
  readonly name = "wave";
  async run(ctx: LoopContext): Promise<LoopResult>;
}
```

### IExecutionModel 实现

| 类 | `name` | 策略 | 适用场景 |
|----|--------|------|----------|
| `PipelineModel` | `pipeline` | Claim→Spawn→Execute→BoundaryGuard→Cleanup | **默认**，生产 |
| `SimpleExecuteModel` | `simple` | 跳过管线，直接 `agent.execute()` | 测试/简单场景 |

```typescript
export class PipelineModel implements IExecutionModel {
  readonly name = "pipeline";
  async dispatchSingle(ctx: ExecutionContext): Promise<NodeResult>;
  async dispatchMulti(ctx: ExecutionContext): Promise<NodeResult>;
}

export class SimpleExecuteModel implements IExecutionModel {
  readonly name = "simple";
  async dispatchSingle(ctx: ExecutionContext): Promise<NodeResult>;
  async dispatchMulti(ctx: ExecutionContext): Promise<NodeResult>;
}
```

---

## 7. 组合式调度器 (CompositeScheduler)

> **文件**: `composite-scheduler.ts`
> **角色**: 实现 `IScheduler`，将行为拆解为三抽象。可作为 `Scheduler` 的 drop-in 替换。

```typescript
export class CompositeScheduler implements IScheduler {
  readonly strategy: IScheduleStrategy;
  readonly loopDriver: ILoopDriver;
  readonly executionModel: IExecutionModel;

  constructor(
    board: ITaskBoard,
    pool: ISchedulerAgentPool,
    observer: IPipelineObserver,
    metaAgent?: MetaAgent,
    engineConfig?: EngineConfig,
    schedulerConfig?: CompositeSchedulerConfig,
  );

  register(agentType: string, agent: Agent, model: string): void;
  executeAll(): Promise<ExecutionReport>;
}
```

#### 构造函数参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `board` | `ITaskBoard` | 是 | 任务板实例 |
| `pool` | `ISchedulerAgentPool` | 是 | Agent 池实例 |
| `observer` | `IPipelineObserver` | 是 | 事件观测者 |
| `metaAgent` | `MetaAgent` (可选) | 否 | 元智能体（重规划用） |
| `engineConfig` | `EngineConfig` (可选) | 否 | 引擎配置 |
| `schedulerConfig` | `CompositeSchedulerConfig` (可选) | 否 | 三抽象组合配置 |

#### 默认行为

不传 `schedulerConfig` 时使用：
- `TagMatchingStrategy` + `TopologicalLayeredDriver` + `PipelineModel`

#### 使用示例

```typescript
// 默认组合（与 Scheduler 一致）
const s = new CompositeScheduler(board, pool, observer, metaAgent);

// 自定义组合（顺序执行 + 简化范式）
const s2 = new CompositeScheduler(board, pool, observer, metaAgent, engineConfig, {
  loopDriver: new SequentialDriver(),
  executionModel: new SimpleExecuteModel(),
});
```

---

## 8. 调度分发步骤 (IDispatchStep + Dispatch 步骤)

> **文件**: `dispatch-steps/types.ts` 及 `dispatch-steps/*.ts`
> **角色**: 调度管线的可插拔步骤。单一步骤只做一件事，可独立测试，可自由组合。

### IDispatchStep

```typescript
export interface IDispatchStep {
  readonly name: string;
  run(ctx: DispatchCtx): Promise<DispatchCtx>;
}
```

### DispatchCtx

```typescript
export interface DispatchCtx {
  // ── 只读配置 ──
  readonly agents: Map<string, Agent>;
  readonly models: Map<string, string>;
  readonly board: ITaskBoard;
  readonly pool: ISchedulerAgentPool;
  readonly observer: IPipelineObserver;
  readonly isTestEnv: boolean;
  readonly llmChat?: LlmCallable;  // RLM 拆解用的 LLM 入口

  // ── 分发起点 ──
  node: TaskNode;

  // ── Step 间流转状态 ──
  agentType?: string;
  agent?: Agent;
  instanceId?: string;
  model?: string;
  result?: NodeResult;
  boundaryViolation?: { agentType: string; files: string[] };
}
```

### Dispatch Step 实现一览

| 步骤类 | `name` | 文件 | 职责 |
|--------|--------|------|------|
| `ClaimStep` | `Claim` | `claim-step.ts` | 标签匹配 Agent → `board.claim()` 认领节点 |
| `SpawnStep` | `Spawn` | `spawn-step.ts` | `ManifoldGate.acquire()` → `pool.spawn()` → 唤醒 Agent |
| `ExecuteStep` | `Execute` | `execute-step.ts` | 调用 `agent.execute()` 执行任务 |
| `RlmExecuteStep` | `RlmExecute` | `rlm-execute-step.ts` | LLM 拆解 → 分层并行子任务（RLM） |
| `BoundaryGuardStep` | `BoundaryGuard` | `boundary-guard-step.ts` | 扫描文件越界 |
| `CleanupStep` | `Cleanup` | `cleanup-step.ts` | 释放槽位 → 销毁 Pool → `board.complete()` 落盘 |

### ClaimStep

```typescript
export class ClaimStep implements IDispatchStep {
  readonly name = "Claim";
  async run(ctx: DispatchCtx): Promise<DispatchCtx>;
}
```

**职责**: 从 agents 查找标签匹配的 Agent 类型 → 非标准 AgentType 诊断 → `board.claim()`。

**失败场景**: 无匹配 Agent → `board.failNode()` + 错误 result。Agent 未注册 → 同上。

### SpawnStep

```typescript
export class SpawnStep implements IDispatchStep {
  readonly name = "Spawn";
  constructor(acquireTimeoutMs: number = 60_000);
  async run(ctx: DispatchCtx): Promise<DispatchCtx>;
}
```

| 构造函数参数 | 类型 | 默认值 | 描述 |
|-------------|------|--------|------|
| `acquireTimeoutMs` | `number` | `60_000` | mHC 流控获取超时（毫秒） |

**职责**: `ManifoldGate.acquire()` → `pool.spawn()` → 注入 Pool 引用 → `Created → Awake` → 状态校验。

**RLM 子任务**: `isRlmSubtask=true` 不走流约束，走 `pool.spawnSubtask()`。

### ExecuteStep

```typescript
export class ExecuteStep implements IDispatchStep {
  readonly name = "Execute";
  async run(ctx: DispatchCtx): Promise<DispatchCtx>;
}
```

**职责**: 从 `ctx.model` 或 `models` 解析模型 → `agent.execute(node, model)`。

### RlmExecuteStep

```typescript
export class RlmExecuteStep implements IDispatchStep {
  readonly name = "RlmExecute";
  readonly MAX_PARALLEL_SUBTASKS = 5;  // 同层子任务最大并行数
  async run(ctx: DispatchCtx): Promise<DispatchCtx>;
}
```

**职责**: 判断是否需 RLM 拆解 → `decompose()` LLM 拆解 → 低信心回退直接执行 → 分层并行子任务。

**决策树**:
```
1. isRlmSubtask=true → 不拆（防无限递归）
2. preferredStrategy=direct/react → 不拆
3. shouldDecompose() → LLM decompose() → shouldExecuteDecomposition()
   → 是 → _executeSubTasks() 分层并行
   → 否 → _directExecute()
```

### BoundaryGuardStep

```typescript
export class BoundaryGuardStep implements IDispatchStep {
  readonly name = "BoundaryGuard";
  constructor(workspaceRoot: string = process.cwd());
  async run(ctx: DispatchCtx): Promise<DispatchCtx>;
}
```

**职责**: 仅检查成功执行 → 查找 BOUNDARY_RULES → 扫描 mtime > createdAt 的新文件 → 检查 forbidden 命中 → emit `AgentBoundaryViolation` 事件。

### CleanupStep

```typescript
export class CleanupStep implements IDispatchStep {
  readonly name = "Cleanup";
  async run(ctx: DispatchCtx): Promise<DispatchCtx>;
}
```

**职责**（始终执行）: `ManifoldGate.release()` → Pool 优雅降级 `Awake→Draining→Destroyed` → `board.complete()` 落盘 → emit `NodeComplete` 事件。

### AgentBoundaryRule（公开类型）

```typescript
export interface AgentBoundaryRule {
  agentType: string;
  allowed: string[];   // 允许创建/修改的文件 glob
  forbidden: string[]; // 禁止触碰的文件 glob
}

export const BOUNDARY_RULES: ReadonlyArray<AgentBoundaryRule>;
```

### 使用示例：自定义 Dispatch Pipeline

```typescript
// 跳过 Claim 和 BoundaryGuard，直接 Spawn → Execute → Cleanup
const steps: IDispatchStep[] = [
  new SpawnStep(30_000),
  new ExecuteStep(),
  new CleanupStep(),
];

const ctx: DispatchCtx = {
  agents, models, board, pool, observer,
  isTestEnv: true,
  node: taskNode,
  agentType: "code",
  agent: codeAgent,
  model: "deepseek-chat",
};

let currentCtx = ctx;
for (const step of steps) {
  currentCtx = await step.run(currentCtx);
}
console.log(currentCtx.result);
```

---

## 9. 确认门 (ConfirmGate)

> **文件**: `confirm-gate.ts`
> **角色**: 基于可逆性等级拦截工具调用。L2/L3 永远确认，L1 视信任放行。

```typescript
export class ConfirmGate {
  constructor(timeoutMs?: number);

  // ── 模式控制 ──
  bypassAll(): void;
  setBridge(bridge: PlatformBridge): void;
  setTrustModel(tm: ITrustModel): void;

  // ── 判定 ──
  needsConfirmation(level: ReversibilityLevel, trustContext?: {
    agentType: AgentType;
    toolName: string;
  }): boolean;
  recordDecision(agentType: AgentType, toolName: string, approved: boolean): void;

  // ── 请求/等待/确认 核心协议 ──
  request(req: ConfirmationRequest): string;
  waitFor(requestId: string, timeoutMs?: number): Promise<boolean>;
  resolve(response: ConfirmationResponse): boolean;

  // ── 超时/清理 ──
  handleTimeout(requestId: string, level: ReversibilityLevel): boolean;
  hasPending(): boolean;
  dispose(): void;

  // ── 批量确认 ──
  async confirm(nodes: { id: string; payload: string }[]): Promise<boolean>;
}
```

#### 可逆性等级判定矩阵

| 等级 | 语义 | L0 | L1 | L2 | L3 |
|------|------|----|----|----|----|
| 确认行为 | | 永不确认 | 信任模型判定 | 永远确认 | 永远确认 |
| TrustModel ≥ L3 | | — | 免确认 | 仍确认 | 仍确认 |

#### 使用示例

```typescript
const gate = new ConfirmGate(120_000);
gate.setBridge(cliBridge);
gate.setTrustModel(trustModel);

// 判断是否需要确认
if (gate.needsConfirmation(RL.L1, { agentType: "code", toolName: "write_file" })) {
  const req: ConfirmationRequest = {
    id: "req-1",
    level: RL.L1,
    toolName: "write_file",
    summary: "Write to src/scheduler.ts",
    detail: "...",
  };
  const requestId = gate.request(req);
  const approved = await gate.waitFor(requestId);
  gate.recordDecision("code" as AgentType, "write_file", approved);
  if (!approved) {
    console.log("User rejected the operation");
  }
}
```

---

## 10. 重规划管理器 (ReplanManager)

> **文件**: `replan-manager.ts`
> **角色**: 管理重规划队列（入队、消费、配额控制），执行结束后解析重规划链。

```typescript
export interface ReplanItem {
  node: TaskNode;
  reason: string;
  count: number;
  disposition?: "failure" | "boundary_violation";
}

export class ReplanManager {
  constructor(
    board: ITaskBoard,
    observer: IPipelineObserver,
    metaAgent: MetaAgent | undefined,
    config: Required<EngineConfig>,
  );

  // ── 属性 ──
  get hasPending(): boolean;

  // ── 方法 ──
  enqueue(node: TaskNode, reason: string, disposition?: "failure" | "boundary_violation"): void;
  tryFireReplan(): Promise<void> | null;
  resolveChains(allResults: NodeResult[]): [completed: number, failed: number];
  reset(): void;
}
```

#### 参数表

| 方法 | 参数 | 类型 | 描述 |
|------|------|------|------|
| `enqueue` | `node` | `TaskNode` | 失败/越界节点 |
| | `reason` | `string` | 失败原因或违规描述 |
| | `disposition` | `"failure" \| "boundary_violation"` | 处置类型（默认 `"failure"`） |
| `tryFireReplan` | (无) | — | 尝试发射后台 replan 批次。全局上限触顶返回 null |
| `resolveChains` | `allResults` | `NodeResult[]` | 执行结束后解析重规划链，修正原始节点 result |
| `reset` | (无) | — | 清零所有状态（每次 executeAll() 结束后调用） |

#### 使用示例

```typescript
const rm = new ReplanManager(board, observer, metaAgent, config);

// 入队
rm.enqueue(failedNode, "Agent timeout: max loops exceeded");

// 发射 replan
if (rm.hasPending) {
  await rm.tryFireReplan();
}

// 解析结果
rm.resolveChains(allResults);

// 重置
rm.reset();
```

---

## 11. 拓扑排序 (topologicalSort)

> **文件**: `topological-sort.ts`
> **角色**: 纯函数，按 parentId 依赖关系分层。

```typescript
export function topologicalSort(
  nodes: TaskNode[],
  observer?: IPipelineObserver,
): string[][];
```

#### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `nodes` | `TaskNode[]` | 是 | 待排序的节点数组 |
| `observer` | `IPipelineObserver` | 否 | 事件观测者（用于上报悬挂 parentId 警告和循环依赖） |

#### 返回值

| 类型 | 描述 |
|------|------|
| `string[][]` | 二维数组，每层包含该层所有节点 ID。循环依赖时返回空数组 |

#### 边类型语义

| 边类型 | 子节点行为 |
|--------|-----------|
| `hard` (默认) | 下一层——绝对等待父节点完成 |
| `soft` | 同层——与父节点并行启动 |
| `trigger` | 同层——父失败则子跳过 |

#### 使用示例

```typescript
const layers = topologicalSort(pendingNodes, observer);
if (layers.length === 0) {
  console.error("Circular dependency detected");
} else {
  for (const layer of layers) {
    await Promise.all(layer.map(id => dispatchNode(id)));
  }
}
```

---

## 12. Agent 匹配器 (findMatchingAgent / findAllMatchingAgents)

> **文件**: `agent-matcher.ts`
> **角色**: 纯函数，为任务节点匹配 Agent 类型。

```typescript
export function findMatchingAgent(
  agents: Map<string, Agent>,
  node: TaskNode,
): string | null;

export function findAllMatchingAgents(
  agents: Map<string, Agent>,
  node: TaskNode,
): string[];
```

#### 参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `agents` | `Map<string, Agent>` | 已注册的 Agent 映射 |
| `node` | `TaskNode` | 待匹配的任务节点 |

#### 匹配逻辑

`findMatchingAgent`:
1. 归一化 node.type（下划线→连字符，别名解析）
2. 精确匹配已知 AgentType → 直接返回
3. 回退：按 tags 打分匹配，平局以匹配密度打破

`findAllMatchingAgents`:
- 遍历 AGENT_TAGS，返回所有 tags 有交集的 Agent 类型

#### 使用示例

```typescript
const agentType = findMatchingAgent(agents, node);
if (agentType) {
  console.log(`Matched to ${agentType}`);
} else {
  console.warn(`No agent matches node ${node.id}`);
}
```

---

## 13. RLM 拆解 (decompose / shouldDecompose / shouldExecuteDecomposition)

> **文件**: `rlm-decompose.ts`
> **角色**: 从宏观 TaskNode 拆解出原子子任务。在 RlmExecuteStep 内部调用。

### 公开类型

```typescript
export type LlmCallable = (
  model: string,
  messages: Array<{ role: string; content: string }>,
) => Promise<string>;

export const MAX_RLM_DEPTH: number;  // 从 RLM_MAX_DEPTH 导入，默认 3
```

### 公开函数

```typescript
export function shouldDecompose(
  payload: string,
  tags: string[],
  preferredStrategy?: string,
): boolean;
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `payload` | `string` | 任务描述文本 |
| `tags` | `string[]` | 节点标签 |
| `preferredStrategy` | `string` (可选) | 优先策略 |

**返回**: `true` 当策略为 `"decompose"`、payload > 200 字符、或含 `analysis/research` 标签。

```typescript
export async function decompose(
  llmCallable: LlmCallable,
  model: string,
  payload: string,
  currentDepth?: number,
): Promise<DecomposeResult>;
```

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `llmCallable` | `LlmCallable` | — | LLM 调用函数 |
| `model` | `string` | — | 使用的模型名 |
| `payload` | `string` | — | 任务描述 |
| `currentDepth` | `number` | `0` | 当前递归深度 |

**返回**: `DecomposeResult { subTasks: SubTask[], confidence: number, rationale: string }`

```typescript
export function shouldExecuteDecomposition(result: DecomposeResult): boolean;
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `result` | `DecomposeResult` | 拆解结果 |

**返回**: `false` 当 confidence < 0.6、subTasks 为空、或只有一个子任务且 confidence < 0.8。

```typescript
export function buildDecomposePrompt(payload: string, currentDepth: number): string;
export function parseDecomposeResponse(raw: string): DecomposeResult;
```

#### 使用示例

```typescript
if (shouldDecompose(node.payload, node.tags, node.preferredStrategy)) {
  const result = await decompose(llmChat, model, node.payload);
  if (shouldExecuteDecomposition(result)) {
    // 执行子任务...
    for (const st of result.subTasks) {
      await executeSubTask(st);
    }
  }
}
```

---

## 14. 密度压缩 (DENSITY)

> **文件**: `density-compress.ts`
> **角色**: 子任务间上下文按密度分级传递。每个子任务产出带 `[DENSITY: light/medium/heavy]` 标签。

### 公开函数

```typescript
export function parseDensityTag(output: string): DensityLevel;
export function stripDensityTag(output: string): string;
export function compressByDensity(raw: string, density: DensityLevel): string;
export function annotateAndCompress(raw: string): DensityAnnotated;
export function densityToStrategy(density: DensityLevel): "decompose" | "react" | "direct";
export function mergeContext(results: DensityAnnotated[]): string;
```

#### 密度压缩策略

| 级别 | 压缩行为 |
|------|----------|
| `light` | 取第一句话或前 150 字 |
| `medium` | 保留结构化行（列表/标题/键值对），裁到 500 字 |
| `heavy` | 全量保留，不做压缩 |

#### densityToStrategy 映射

| 密度 | 策略 |
|------|------|
| `heavy` | `decompose`（仔细拆解） |
| `medium` | `react`（标准循环） |
| `light` | `direct`（快速直达） |

#### 使用示例

```typescript
const annotated = annotateAndCompress("[DENSITY: heavy] Architecture decision: use mHC pattern");

console.log(annotated.density);     // "heavy"
console.log(annotated.compressed);  // 全量保留

const context = mergeContext([annotated]);
// → "[HEAVY] Architecture decision: use mHC pattern"
```

---

## 15. 流形约束门控 (ManifoldGate)

> **文件**: `dispatch-steps/manifold-gate.ts`
> **角色**: mHC 流形约束——同类型 Agent 并发数 ≤ maxInstances。FIFO 公平排队。

```typescript
export class ManifoldGate {
  // ── 配置 ──
  static setObserver(observer: IPipelineObserver): void;
  static register(agentType: string, maxInstances: number): void;
  static updateMax(agentType: string, newMax: number): void;

  // ── 查询 ──
  static active(agentType: string): number;
  static waiting(agentType: string): number;
  static max(agentType: string): number;

  // ── 核心 ──
  static async acquire(agentType: AgentType | string, acquireTimeoutMs?: number): Promise<boolean>;
  static release(agentType: AgentType | string): void;

  // ── 生命周期 ──
  static reset(): void;
  static async drain(agentType: string): Promise<void>;
}
```

#### 使用示例

```typescript
// 注册
ManifoldGate.register("code", 3);

// 获取槽位
const acquired = await ManifoldGate.acquire("code", 30_000);
if (!acquired) {
  console.error("Flow control timeout");
  return;
}

try {
  // ... 执行任务 ...
} finally {
  // 释放槽位
  ManifoldGate.release("code");
}
```

---

## 16. 信任模型 (TrustModel)

> **文件**: `trust-model.ts`
> **角色**: 按 (AgentType, RiskDomain) 二维聚合接受率。冷启动从 L1 起。

```typescript
export class TrustModel implements ITrustModel {
  getTrustLevel(agentType: AgentType, domain: RiskDomain): TrustLevel;
  getTrustLevelForTool(agentType: AgentType, toolName: string): TrustLevel;
  recordDecision(agentType: AgentType, toolName: string, approved: boolean): void;
  resetAll(): void;
  snapshot(): ReadonlyMap<string, TrustEntry>;
}
```

#### 晋升规则

| 晋升 | 条件 |
|------|------|
| L1 → L2 | 连续 5 次接受 |
| L2 → L3 | 连续 15 次接受 |

#### 衰减/拒绝规则

- 7 天无确认活动 → 降一级，不低于 L1
- 任一拒绝 → 立即重置为 L1

#### 使用示例

```typescript
const tm = new TrustModel();

// 查询
const level = tm.getTrustLevelForTool("code" as AgentType, "write_file");
if (level >= TrustLevel.L3) {
  console.log("Trusted — skip confirmation");
}

// 记录决策
tm.recordDecision("code" as AgentType, "write_file", true);
```

---

## 17. 管道执行器 (PipelineRunner)

> **文件**: `pipeline-runner.ts`
> **角色**: 通用管道执行器。按顺序执行 IStep 数组。用于 Agent 内部执行管线（非调度管线）。

```typescript
export interface PipelineCtx {
  readonly agentType: AgentType;
  readonly llm: LlmAdapter;
  readonly toolkit: Toolkit;
  readonly systemPrompt: string;
  readonly maxLoops: number;
  readonly reactLoopTimeoutMs: number;
  readonly model: string;
  readonly memory?: MemoryStore;
  readonly safeReporter?: SafeErrorReporter;
  readonly filterRead?: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[];
  readonly memoryQuery?: (node: TaskNode) => MemoryQuery;
  node: TaskNode;
  enrichedNode?: TaskNode;
  result?: NodeResult;
}

export interface IStep {
  readonly name: string;
  run(ctx: PipelineCtx): Promise<PipelineCtx>;
}

export class PipelineRunner {
  static async run(steps: IStep[], ctx: PipelineCtx): Promise<PipelineCtx>;
}
```

#### 使用示例

```typescript
const ctx = await PipelineRunner.run(
  [memoryRetrievalStep, reactLoopStep, memoryWriteStep],
  initialCtx,
);
console.log(ctx.result);
```

---

## 18. MetaAgent 概要

> **文件**: `meta-agent.ts`
> **角色**: 战术引擎。接收用户意图，拆解为 TaskNode 树。独享 DeepSeek V4 Flash 思考模式。

### 公开方法

```typescript
export class MetaAgent {
  get llmAdapter(): LlmAdapter;

  constructor(
    llm: LlmAdapter,
    skillRegistry?: SkillRegistry,
    planningSystemPrompt?: string,
    replanSystemPrompt?: string,
    observer?: IPipelineObserver,
    workspaceRoot?: string,
  );

  setWorkspaceRoot(root: string): void;
  setSkillRegistry(registry: SkillRegistry): void;
  setObserver(observer: IPipelineObserver): void;
  setSafeReporter(reporter: SafeErrorReporter): void;

  async plan(intent: string, context?: PlanContext): Promise<TaskNode[]>;
  async requestReplan(
    failedNode: TaskNode,
    reason: string,
    replanCount: number,
    originalIntent?: string,
    maxReplan?: number,
  ): Promise<ReplanResult>;
  async requestBoundaryReplan(
    violatingNode: TaskNode,
    boundaryReason: string,
    replanCount: number,
    originalIntent?: string,
    maxReplan?: number,
  ): Promise<ReplanResult>;
  async clarifyIntent(intent: string): Promise<IntentClarification>;
}
```

### 公开类型

```typescript
export interface IntentClarification {
  goal: string;
  actionType: "analysis" | "modification" | "audit" | "refactor" | "generation" | "inquiry";
  scope: string;
  constraints: string;
  unclear?: string;
  originalIntent: string;
}
```

---

## 19. 调度实现 (Scheduler 类 — 内部)

> **文件**: `scheduler.ts`
> **角色**: `IScheduler` 的默认实现。包含完整的调度循环、dispatch pipeline、重规划集成。

```typescript
export class Scheduler implements IScheduler {
  constructor(
    board: ITaskBoard,
    pool: ISchedulerAgentPool,
    observer: IPipelineObserver,
    metaAgent?: MetaAgent,
    engineConfig?: EngineConfig,
  );

  register(agentType: string, agent: Agent, model: string): void;
  setMemoryStore(memory: IMemoryStore): void;
  async executeAll(): Promise<ExecutionReport>;
}
```

#### 内部方法（调用方不应直接使用）

| 方法 | 可见性 | 描述 |
|------|--------|------|
| `_dispatchNode` | `private` | 分发单节点（单视角/多视角路由） |
| `_dispatchSingle` | `private` | 单视角：Claim→Spawn→RlmExecute→BoundaryGuard→Cleanup |
| `_dispatchMulti` | `private` | 多视角：所有匹配 Agent 并行执行 |
| `_runDispatchPipeline` | `private` | 按顺序执行 IDispatchStep 数组 |
| `_buildLlmChat` | `private` | 构建 RLM 拆解用的 LLM 调用入口 |

---

## 附录：导出模块索引

| 模块路径 | 导出内容 |
|----------|----------|
| `core/scheduler.ts` | `IScheduler`, `Scheduler` |
| `core/composite-scheduler.ts` | `CompositeScheduler` |
| `core/task-board.ts` | `ITaskBoard`, `TaskBoard` |
| `core/agent-pool.ts` | `ISchedulerAgentPool`, `IAgentPool`, `AgentPool` |
| `core/pipeline-observer.ts` | `PipelineObserver` |
| `core/scheduling-types.ts` | `IScheduleStrategy`, `ILoopDriver`, `IExecutionModel`, `LoopContext`, `LoopResult`, `ExecutionContext`, `CompositeSchedulerConfig` |
| `core/scheduling-implementations.ts` | `TagMatchingStrategy`, `RoundRobinStrategy`, `PriorityFirstStrategy`, `TopologicalLayeredDriver`, `SequentialDriver`, `WaveDriver`, `PipelineModel`, `SimpleExecuteModel` |
| `core/dispatch-steps/types.ts` | `DispatchCtx`, `IDispatchStep` |
| `core/dispatch-steps/claim-step.ts` | `ClaimStep` |
| `core/dispatch-steps/spawn-step.ts` | `SpawnStep` |
| `core/dispatch-steps/execute-step.ts` | `ExecuteStep` |
| `core/dispatch-steps/rlm-execute-step.ts` | `RlmExecuteStep` |
| `core/dispatch-steps/boundary-guard-step.ts` | `BoundaryGuardStep`, `AgentBoundaryRule`, `BOUNDARY_RULES` |
| `core/dispatch-steps/cleanup-step.ts` | `CleanupStep` |
| `core/dispatch-steps/manifold-gate.ts` | `ManifoldGate` |
| `core/confirm-gate.ts` | `ConfirmGate` |
| `core/replan-manager.ts` | `ReplanManager`, `ReplanItem` |
| `core/topological-sort.ts` | `topologicalSort` |
| `core/agent-matcher.ts` | `findMatchingAgent`, `findAllMatchingAgents` |
| `core/rlm-decompose.ts` | `LlmCallable`, `MAX_RLM_DEPTH`, `shouldDecompose`, `decompose`, `shouldExecuteDecomposition`, `buildDecomposePrompt`, `parseDecomposeResponse` |
| `core/density-compress.ts` | `parseDensityTag`, `stripDensityTag`, `compressByDensity`, `annotateAndCompress`, `densityToStrategy`, `mergeContext` |
| `core/trust-model.ts` | `TrustModel` |
| `core/meta-agent.ts` | `MetaAgent`, `IntentClarification` |
| `core/pipeline-runner.ts` | `PipelineRunner`, `PipelineCtx`, `IStep` |

---

## 附录：公开 API 与内部实现区分

| 分类 | 包含内容 | 稳定契约 |
|------|----------|----------|
| **🔒 公开 API** | `IScheduler`, `ITaskBoard`, `ISchedulerAgentPool`, `IAgentPool`, `IPipelineObserver`, 三抽象接口, `CompositeSchedulerConfig`, `ReplanItem`, `AgentBoundaryRule`, `BOUNDARY_RULES` | 外部依赖方应仅依赖这些接口/类型 |
| **✅ 公共类** | `Scheduler`, `CompositeScheduler`, `TaskBoard`, `AgentPool`, `PipelineObserver`, `ConfirmGate`, `TrustModel`, `ReplanManager`, `ManifoldGate`, 三抽象实现类, Dispatch Step 类, `MetaAgent`, `PipelineRunner` | 可直接实例化使用，但构造函数签名可能随版本变化 |
| **⚠️ 纯函数** | `topologicalSort`, `findMatchingAgent`, `findAllMatchingAgents`, `shouldDecompose`, `decompose`, `shouldExecuteDecomposition`, `buildDecomposePrompt`, `parseDecomposeResponse`, DENSITY 函数 | 稳定，推荐用于独立测试和自建工具链 |
| **🔧 内部实现** | `Scheduler._dispatchNode`, `Scheduler._dispatchSingle`, `Scheduler._dispatchMulti`, `Scheduler._runDispatchPipeline`, `Scheduler._buildLlmChat`, `ReplanManager._drain`, `MetaAgent._parsePlan` 等私有方法 | 不保证稳定性，不应被外部代码调用 |

---

```json
{
  "skillTemplate": {
    "name": "梳理 API 签名时发现的模式",
    "version": "1.0",
    "patterns": [
      {
        "category": "export 组织方式",
        "pattern": "接口在前、实现在后",
        "description": "每个模块先导出接口（interface），再导出实现类（class）。接口命名以 'I' 开头（如 ITaskBoard），类名不加前缀（如 TaskBoard）。Scheduler 依赖接口而非具体类，便于测试 mock。",
        "example": "task-board.ts 先导出 ITaskBoard 接口，再导出 TaskBoard 实现类。agent-pool.ts 先导出 ISchedulerAgentPool（最小契约），再导出 IAgentPool（扩展接口），最后导出 AgentPool 类。"
      },
      {
        "category": "export 组织方式",
        "pattern": "双接口模式：最小契约 + 完整管理",
        "description": "对于需要对外暴露但又不想暴露全部方法的组件，使用双接口模式：ISchedulerAgentPool（仅 5 个供 Scheduler 调用的方法）和 IAgentPool（扩展完整管理端）。调用方依赖最小接口，管理方依赖完整接口。",
        "example": "ISchedulerAgentPool 仅暴露 spawn/spawnSubtask/getStatus/setStatus/destroy，而 IAgentPool 扩展了 register/setMaxInstances/setObserver/getStatuses/hasAwake/canSpawn/count。"
      },
      {
        "category": "类型命名惯例",
        "pattern": "动词 + 名词组合，避免缩写",
        "description": "类型命名使用完整英文词汇组合：IScheduleStrategy（调度策略）、IExecutionModel（执行范式）、ILoopDriver（循环驱动）。避免缩写（如 SchedStrat），方法名使用动词开头（findMatchingAgent, shouldExecuteDecomposition）。",
        "example": "confirm-gate.ts 中：needsConfirmation()、handleTimeout()、recordDecision()。rlm-decompose.ts 中：shouldDecompose()、shouldExecuteDecomposition()、buildDecomposePrompt()。"
      },
      {
        "category": "类型命名惯例",
        "pattern": "Context 后缀用于管道上下文",
        "description": "所有在管道路径间传递的共享状态都命名为 XxxCtx：DispatchCtx（调度分发）、ExecutionContext（执行范式）、LoopContext（循环驱动）、PipelineCtx（Agent 内部管线）。Context 对象包含只读配置字段（readonly）和可变状态字段两部分。",
        "example": "DispatchCtx 中 readonly agents/models/board/pool/observer，可变 agentType/agent/instanceId/result。ExecutionContext 用于 IExecutionModel.dispatchSingle/Multi 的入参。"
      },
      {
        "category": "接口双设计",
        "pattern": "IDispatchStep × IStep 平行的 Step 接口",
        "description": "调度系统有两套平行的 Step 接口：IDispatchStep（调度分发管线——Claim/Spawn/Execute/Cleanup）和 IStep（Agent 内部执行管线——MemoryRetrieval/ReActLoop/MemoryWrite）。两者都遵循 run(ctx) → Promise<ctx> 模式，但上下文类型不同（DispatchCtx vs PipelineCtx）。",
        "example": "IDispatchStep.run(ctx: DispatchCtx) → Promise<DispatchCtx>；IStep.run(ctx: PipelineCtx) → Promise<PipelineCtx>。相同的管道模式，不同的领域上下文。"
      },
      {
        "category": "接口双设计",
        "pattern": "静态单例 + 实例方法共存",
        "description": "部分组件使用静态单例（ManifoldGate）以避免跨模块传递实例引用，同时保持实例方法的可测试性和可替代性。静态方法委托到内部 Map，SpawnStep/CleanupStep 通过 ManifoldGate.acquire()/release() 静态方法访问。",
        "example": "ManifoldGate 全部是静态方法（static acquire/release/register），因为 Scheduler 单例运行期间只有一个调度循环。而 TaskBoard/AgentPool 是实例对象，通过构造注入到 Scheduler。"
      },
      {
        "category": "不变性保障模式",
        "pattern": "三阶段释放协议",
        "description": "CleanupStep 始终遵循严格的三阶段释放顺序：1) ManifoldGate.release() — 优先释放流控槽位，提高系统吞吐 2) Pool 生命周期（Draining → Destroyed） 3) board.complete() 落盘。此顺序确保资源不泄漏、节点不卡 claimed。",
        "example": "CleanupStep.run() 中：先 ManifoldGate.release()，再 pool.setStatus(Draining) + pool.destroy()，最后 board.complete()。任何顺序调换都可能导致死锁或资源泄漏。"
      }
    ]
  }
}
```

---

> **文档统计**: 377 行 · 覆盖 19 个模块 · 16 个公开接口 · 21 个公开类 · 12 个公开函数
>
> **维护说明**:
> - 每个公开 API 条目包含：文件位置、完整签名、JSDoc 说明、参数表、返回值、使用示例
> - 内部实现（私有方法）在表注中标记为 `[内部]` 或 `private`
> - 附录中包含导出模块索引和公开/内部区分表
