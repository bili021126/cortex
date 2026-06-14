# @cortex/scheduler — 架构设计文档

> **版本**: v1.0 (草案)  
> **状态**: 设计中  
> **范围**: 从 `@cortex/engine` 提取调度子系统为独立包，定义核心接口与模块划分

---

## 目录

1. [包定位](#1-包定位)
2. [核心职责与边界](#2-核心职责与边界)
3. [模块划分总览](#3-模块划分总览)
4. [核心接口契约](#4-核心接口契约)
5. [模块详解](#5-模块详解)
6. [扩展点：三抽象](#6-扩展点三抽象)
7. [数据流全景](#7-数据流全景)
8. [依赖关系与外部契约](#8-依赖关系与外部契约)
9. [文件组织方案](#9-文件组织方案)
10. [从 engine 提取的迁移路径](#10-从-engine-提取的迁移路径)

---

## 1. 包定位

### 1.1 一句话定位

**@cortex/scheduler** 是 Cortex 生态中的**任务调度执行引擎**——接收 MetaAgent 规划的 DAG 任务树，通过可替换的调度策略、循环驱动、执行范式三抽象，将任务节点高效分发至 Agent 执行，产出 `ExecutionReport`。

### 1.2 包名

```json
{
  "name": "@cortex/scheduler",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

### 1.3 解决的问题

| 痛点 | 当前状态 (engine 内联) | 本包解决方式 |
|------|------------------------|-------------|
| **调度耦合在 engine 内** | Scheduler/TaskBoard/DispatchStep 散落在 `engine/src/core/` | 提取为独立包，engine 通过 `@cortex/scheduler` 依赖 |
| **无独立接口契约** | 接口演化受 engine 版本号制约 | 独立版本号 + 接口稳定性承诺 |
| **单元测试依赖 engine** | 测 Scheduler 需启动整个 engine | 独立测试，mock 依赖接口 |
| **复用困难** | FSM-Compiler 想复用 Dispatch Pipeline 需绕道 engine | 独立包，`@cortex/fsm-compiler` 可直接引入调度类型 |
| **扩展点隐式** | 三抽象虽存在但文档不充分 | 本文档显式定义所有扩展点及其契约 |

### 1.4 不做的事

- ❌ 不包含 MetaAgent（任务规划/重规划逻辑）— 由 `@cortex/engine` 保留
- ❌ 不包含 Agent 实现（CodeAgent/ReviewAgent 等）— 由 `@cortex/engine` 保留  
- ❌ 不包含 MemoryStore/记忆系统 — 由 `@cortex/engine` 保留
- ❌ 不包含 Toolkit/CLIAdapter/文件系统适配器 — 由 `@cortex/engine` 保留
- ❌ 不包含 Plugin 系统（PluginLoader/PluginContainer）— 由 `@cortex/engine` 保留
- ❌ 不包含 AgentFactory/AgentRegistry — 由 `@cortex/engine` 保留
- ❌ 不包含 Bootstrap/配置接线 — 由 `@cortex/engine` 保留

---

## 2. 核心职责与边界

### 2.1 哪些属于 @cortex/scheduler

**调度核心** — 纯调度基础设施，不依赖 Agent 实现：

```
✅ Scheduler / CompositeScheduler     — 调度器主类
✅ IScheduler                          — 调度器公开接口
✅ TaskBoard / ITaskBoard              — DAG 节点生命周期管理
✅ AgentPool / IAgentPool              — Agent 实例生命周期管理  
✅ ISchedulerAgentPool                 — 调度器依赖的最小池契约
✅ PipelineObserver / IPipelineObserver — 事件管道
✅ Dispatch Pipeline 步骤               — Claim/Spawn/Execute/RlmExecute/BoundaryGuard/Cleanup
✅ DispatchCtx / IDispatchStep          — 调度管线上下文与步骤接口
✅ ManifoldGate                        — mHC 流形约束门控
✅ ReplanManager / ReplanItem           — 重规划队列管理
✅ ConfirmGate                         — 确认门（基于可逆性等级）
✅ TrustModel / ITrustModel             — 信任模型
✅ TopologicalSort                      — DAG 拓扑排序
✅ AgentMatcher                         — 节点→Agent 匹配
✅ 三抽象接口与实现                      — IScheduleStrategy / ILoopDriver / IExecutionModel
✅ PipelineRunner / IStep / PipelineCtx  — Agent 内部执行管线（Memory→ReAct→MemoryWrite）
✅ RLM Decompose                        — 递归任务拆解
✅ Density Compress                     — 上下文密度压缩
```

### 2.2 哪些留在 @cortex/engine

**引擎编排层** — 依赖 Agent 实现和业务逻辑：

```
❌ MetaAgent                     — 任务规划/重规划 (依赖 LlmAdapter + SkillRegistry)
❌ Agent 实现                     — codeAgent/reviewAgent/analysisAgent 等
❌ MemoryStore / 记忆系统         — 持久化 + embedding
❌ Toolkit / CLIAdapter / FS      — 平台适配
❌ PluginLoader / Plugin 系统     — 插件生命周期
❌ AgentFactory / AgentRegistry    — Agent 构造工厂
❌ Bootstrap / 配置接线           — engine 启动流程
❌ Governance / 修宪管线          — 宪法治理
❌ ConsistencyLayer               — 六层防御一致性
```

### 2.3 边界原则

```
@cortex/engine
  └── 依赖 → @cortex/scheduler      (调度基础设施)
  └── 依赖 → @cortex/shared          (共享类型)
  └── 依赖 → @cortex/config          (配置类型)
  └── 依赖 → @cortex/llm             (LLM 适配器)

@cortex/scheduler
  └── 依赖 → @cortex/shared          (仅类型: TaskNode, Agent, ExecutionReport 等)
  └── 依赖 → @cortex/config          (仅配置类型: EngineConfig)
  └── (可选) 依赖 → @cortex/llm      (仅 LlmCallable 类型，不依赖实现)
```

**解耦关键**: `@cortex/scheduler` 不 import `@cortex/engine` 中的任何模块。所有 Agent 交互通过 `@cortex/shared` 中定义的 `Agent` 接口进行。

---

## 3. 模块划分总览

```
@cortex/scheduler
├── core/                       # 调度核心
│   ├── scheduler.ts            # IScheduler + Scheduler 实现
│   ├── composite-scheduler.ts  # CompositeScheduler（三抽象组合）
│   ├── scheduling-types.ts     # 三抽象接口定义
│   ├── scheduling-implementations.ts  # 三抽象内置实现
│   ├── task-board.ts           # ITaskBoard + TaskBoard
│   ├── agent-pool.ts           # ISchedulerAgentPool + IAgentPool + AgentPool
│   ├── pipeline-observer.ts    # IPipelineObserver + PipelineObserver
│   ├── pipeline-runner.ts      # IStep + PipelineCtx + PipelineRunner
│   ├── replan-manager.ts       # ReplanManager + ReplanItem
│   ├── confirm-gate.ts         # ConfirmGate
│   ├── trust-model.ts          # TrustModel
│   ├── topological-sort.ts     # topologicalSort (纯函数)
│   ├── agent-matcher.ts        # findMatchingAgent / findAllMatchingAgents
│   ├── rlm-decompose.ts        # decompose / shouldDecompose / shouldExecuteDecomposition
│   └── density-compress.ts     # DENSITY 标注/压缩/合并工具
│
├── dispatch-steps/             # 调度分发管线步骤
│   ├── types.ts                # DispatchCtx / IDispatchStep
│   ├── claim-step.ts           # ClaimStep
│   ├── spawn-step.ts           # SpawnStep (mHC 流约束版)
│   ├── execute-step.ts         # ExecuteStep
│   ├── rlm-execute-step.ts    # RlmExecuteStep (RLM 递归拆解)
│   ├── boundary-guard-step.ts  # BoundaryGuardStep + BOUNDARY_RULES
│   ├── cleanup-step.ts         # CleanupStep
│   └── manifold-gate.ts        # ManifoldGate (mHC 流形约束)
│
├── index.ts                    # 桶导出 (barrel)
└── types/                      # 本包私有类型（不对外暴露）
    └── internal.ts
```

---

## 4. 核心接口契约

### 4.1 IScheduler — 调度器统一入口

```typescript
/**
 * IScheduler —— 调度器面向外部（CLI/EngineBridge/Bootstrap）的统一契约。
 * 所有 Scheduler 变体（Scheduler / CompositeScheduler）均实现此接口。
 *
 * 职责：
 * - register(): 注册 Agent 与模型的映射关系
 * - executeAll(): 执行 TaskBoard 上全部节点，产出 ExecutionReport
 */
export interface IScheduler {
  /** 注册一个 AgentRunner 及其关联模型 */
  register(agentType: string, agent: Agent, model: string): void;

  /** 执行 TaskBoard 上全部节点，返回执行报告 */
  executeAll(): Promise<ExecutionReport>;
}
```

### 4.2 ITaskBoard — DAG 节点生命周期

```typescript
/**
 * ITaskBoard —— TaskBoard 抽象接口。
 *
 * claim/release/complete 三方法构成 Scheduler 与 TaskBoard 之间的核心协议。
 * 节点状态机: pending → claimed → done/failed
 * 多视角节点: pending → running (多次 claim) → done (等齐)
 */
export interface ITaskBoard {
  /** 添加节点到任务板 */
  addNode(node: TaskNode): void;

  /** 原子认领节点。普通节点仅 pending 可领；多视角节点允许多 Agent 并行认领 */
  claim(nodeId: string, agentType: AgentType): TaskNode | null;

  /** 释放认领。仅 claimed 可回退到 pending；多视角移除单 Agent 认领 */
  release(nodeId: string, agentType: AgentType): boolean;

  /** 写入执行结果，触发状态转移。多视角等齐后自动置 done */
  complete(nodeId: string, agentType: AgentType, success: boolean, output?: string, error?: string): void;

  /** 强制标记节点为失败（无匹配 Agent 等调度前错误场景） */
  failNode(nodeId: string): boolean;

  /** 查询单个节点 */
  getNode(nodeId: string): TaskNode | undefined;

  /** 获取所有节点 */
  getAllNodes(): TaskNode[];

  /** 获取 pending/claimed 节点（供 executeAll 动态消费） */
  getPendingNodes(): TaskNode[];

  /** 移除单个节点，emit NodeRemoved 事件 */
  removeNode(nodeId: string): void;

  /** 移除子树（BFS 遍历后代），emit NodeRemoved 事件 */
  removeSubtree(nodeId: string): void;
}
```

### 4.3 ISchedulerAgentPool — Agent 实例生命周期（最小契约）

```typescript
/**
 * ISchedulerAgentPool —— Scheduler 依赖的 AgentPool 最小契约。
 *
 * 仅暴露 Scheduler 需要的 5 个方法：
 * - spawn/spawnSubtask: 创建实例
 * - getStatus/setStatus: 状态查询与变更
 * - destroy: 销毁实例
 *
 * 完整管理接口 (IAgentPool) 包含 register/setMaxInstances 等管理端方法。
 */
export interface ISchedulerAgentPool {
  /** 启动一个 Agent 实例。超限返回 false */
  spawn(agentType: AgentType, instanceId: string): boolean;

  /** RLM 子任务——不占主配额 */
  spawnSubtask(agentType: AgentType, instanceId: string): boolean;

  /** 查询实例状态 */
  getStatus(instanceId: string): AgentStatus | undefined;

  /** 更新实例状态（含流转合法性校验） */
  setStatus(instanceId: string, status: AgentStatus): boolean;

  /** 回收 Agent 实例 */
  destroy(agentType: AgentType, instanceId: string): void;
}
```

### 4.4 IPipelineObserver — 事件管道

```typescript
/**
 * IPipelineObserver —— 可观测事件管道。
 * 替代传统 EventBus。所有调度生命周期事件通过此管道发布。
 *
 * 订阅约定（外部约定，非接口强制）：
 *   Sentinel   → CRITICAL + HIGH
 *   MemoryStore → ALL (CRITICAL + HIGH + NORMAL)
 *   管家        → HIGH + NORMAL
 */
export interface IPipelineObserver {
  /** 注册回调。同优先级按注册顺序执行 */
  on(priority: PipelinePriority, handler: PipelineHandler): void;

  /** 移除回调。不传 handler 则移除该优先级下所有 */
  off(priority: PipelinePriority, handler?: PipelineHandler): void;

  /** 发射事件。单 handler 异常不阻断后续 handler */
  emit(event: ObservableEvent): void;
}
```

### 4.5 IDispatchStep — 调度管线步骤

```typescript
/**
 * IDispatchStep —— 调度分发管道中的一个可插拔步骤。
 * 与 IStep (PipelineRunner) 模式一致：单一步骤只做一件事。
 *
 * 上下文传递模式：run(ctx) → 返回更新后的 ctx
 * 失败传值：步骤失败时设置 ctx.result 为错误 NodeResult
 */
export interface IDispatchStep {
  /** 步骤名——用于调试和日志 */
  readonly name: string;

  /** 执行此步骤，返回更新后的上下文 */
  run(ctx: DispatchCtx): Promise<DispatchCtx>;
}
```

### 4.6 DispatchCtx — 调度管线上下文

```typescript
/**
 * DispatchCtx —— 调度分发管道的共享上下文。
 *
 * 设计原则：
 * - 只读字段 (agents/models/board/pool/observer) Step 不应修改
 * - 可变状态 (agentType/agent/instanceId/result 等) 在管道推进中逐步填充
 * - Step 通过 run(ctx) → 返回新 ctx 传递状态
 */
export interface DispatchCtx {
  // ── 只读配置（由 Scheduler 注入） ──
  readonly agents: Map<string, Agent>;
  readonly models: Map<string, string>;
  readonly board: ITaskBoard;
  readonly pool: ISchedulerAgentPool;
  readonly observer: IPipelineObserver;
  readonly isTestEnv: boolean;
  readonly llmChat?: LlmCallable;    // RLM 拆解用的 LLM 入口

  // ── 分发起点 ──
  node: TaskNode;

  // ── Step 间流转状态（逐步填充） ──
  agentType?: string;
  agent?: Agent;
  instanceId?: string;
  model?: string;
  result?: NodeResult;
  boundaryViolation?: { agentType: string; files: string[] };
}
```

### 4.7 IStep / PipelineCtx — Agent 内部执行管线

```typescript
/**
 * PipelineCtx —— Agent 内部执行管线的共享上下文。
 * 用于 Agent.execute() 内部的 MemoryRetrieval → ReActLoop → MemoryWrite 管线。
 * 与 DispatchCtx 职责分离：DispatchCtx 处理调度层，PipelineCtx 处理执行层。
 */
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

  // ── 管道状态（Step 间流转） ──
  node: TaskNode;
  enrichedNode?: TaskNode;
  result?: NodeResult;
}

/**
 * IStep —— Agent 内部执行管道的可插拔步骤。
 * 与 IDispatchStep 平行的 Step 接口，不同上下文类型。
 */
export interface IStep {
  readonly name: string;
  run(ctx: PipelineCtx): Promise<PipelineCtx>;
}
```

### 4.8 LoopContext / ExecutionContext — 三抽象上下文

```typescript
/**
 * LoopContext —— ILoopDriver 的执行上下文。
 * 包含循环执行所需的所有依赖,由 CompositeScheduler 注入。
 */
export interface LoopContext {
  board: ITaskBoard;
  pool: ISchedulerAgentPool;
  observer: IPipelineObserver;
  agents: Map<string, Agent>;
  models: Map<string, string>;
  metaAgent?: MetaAgent;            // 重规划用（可选，无则 replan 静默排空）
  replanManager: ReplanManager;
  config: Required<EngineConfig>;
  strategy: IScheduleStrategy;
  executionModel: IExecutionModel;
}

/**
 * ExecutionContext —— IExecutionModel 的执行上下文。
 * 用于单节点执行范式所需的依赖。
 */
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

### 4.9 三抽象接口

```typescript
/**
 * IScheduleStrategy —— 调度策略。
 * 决定任务节点由哪个/哪些 Agent 执行。
 */
export interface IScheduleStrategy {
  readonly name: string;
  findMatchingAgent(node: TaskNode, agents: Map<string, Agent>): string | null;
  findAllMatchingAgents(node: TaskNode, agents: Map<string, Agent>): string[];
}

/**
 * ILoopDriver —— 循环驱动。
 * 控制执行循环如何推进——单节点如何被组织成轮次和层。
 */
export interface ILoopDriver {
  readonly name: string;
  run(ctx: LoopContext): Promise<LoopResult>;
}

/**
 * IExecutionModel —— 执行范式。
 * 控制单个任务节点的执行方式（单视角/多视角）。
 */
export interface IExecutionModel {
  readonly name: string;
  dispatchSingle(ctx: ExecutionContext): Promise<NodeResult>;
  dispatchMulti(ctx: ExecutionContext): Promise<NodeResult>;
}
```

---

## 5. 模块详解

### 5.1 调度核心 (core/)

| 模块 | 类/函数 | 职责 |
|------|---------|------|
| `scheduler.ts` | `Scheduler` implements `IScheduler` | 默认调度器：拓扑排序→分层并行→Dispatch Pipeline→重规划闭环 |
| `composite-scheduler.ts` | `CompositeScheduler` implements `IScheduler` | 组合式调度器：三抽象可替换，作为 Scheduler 的 drop-in 替换 |
| `scheduling-types.ts` | 接口定义 | IScheduleStrategy / ILoopDriver / IExecutionModel / CompositeSchedulerConfig |
| `scheduling-implementations.ts` | 实现类 | TagMatchingStrategy / RoundRobinStrategy / PriorityFirstStrategy / TopologicalLayeredDriver / SequentialDriver / WaveDriver / PipelineModel / SimpleExecuteModel |
| `task-board.ts` | `TaskBoard` implements `ITaskBoard` | DAG 节点状态机：入板→认领→完成/失败，多视角等齐 |
| `agent-pool.ts` | `AgentPool` implements `IAgentPool` | Agent 实例 spawn/destroy/状态机，配额控制 (maxInstances) |
| `pipeline-observer.ts` | `PipelineObserver` implements `IPipelineObserver` | 优先级回调注册表，事件发射 |
| `pipeline-runner.ts` | `PipelineRunner` | 通用管道执行器：按顺序执行 IStep 数组 |
| `replan-manager.ts` | `ReplanManager` | 重规划队列管理：入队→tryFireReplan→resolveChains→reset |
| `confirm-gate.ts` | `ConfirmGate` | 基于可逆性等级 (L0-L3) 拦截/放行工具调用 |
| `trust-model.ts` | `TrustModel` implements `ITrustModel` | 按 (AgentType, RiskDomain) 聚合接受率，晋升/衰减/拒绝 |
| `topological-sort.ts` | `topologicalSort()` | 纯函数：按 parentId + edgeType 分层 |
| `agent-matcher.ts` | `findMatchingAgent()` / `findAllMatchingAgents()` | 纯函数：标签匹配 + 密度打破平局 |
| `rlm-decompose.ts` | `decompose()` / `shouldDecompose()` / `shouldExecuteDecomposition()` | LLM 驱动的递归任务拆解 |
| `density-compress.ts` | 密度标注/压缩/合并工具 | 子任务间上下文按 density 级别传递 |

### 5.2 Scheduler — 调度循环核心逻辑

```
executeAll()
  ├── 生成 sessionId, 注入 MemoryStore 会话
  ├── 注册边界违规监听 (AgentBoundaryViolation → replanManager.enqueue)
  ├── while(有 pending 节点)
  │   ├── 全局超时检查 → 标记剩余节点为 failed → break
  │   ├── topologicalSort(pendingNodes) 分层
  │   ├── 循环依赖检测 → 标记为 failed → continue
  │   ├── 逐层 Promise.allSettled(dispatchNode)
  │   │   └── dispatchNode(nodeId)
  │   │       ├── needsMultiPerspective? _dispatchMulti
  │   │       │   └── 所有匹配 Agent 并行: Claim→Spawn→Execute→BoundaryGuard→Cleanup
  │   │       └── _dispatchSingle
  │   │           └── Claim→Spawn→RlmExecute→BoundaryGuard→Cleanup
  │   └── replanManager.tryFireReplan() 处理重规划
  ├── 退订边界违规监听
  ├── 悬空节点兜底 (非 done/failed 节点自动标记 failed)
  ├── emit SchedulerDone
  └── 返回 ExecutionReport { totalNodes, completed, failed, results, durationMs, sessionId }
```

### 5.3 Dispatch Pipeline 步骤详解

| 步骤 | 文件 | 前置条件 | 后置条件 | 失败场景 |
|------|------|---------|---------|---------|
| **ClaimStep** | `claim-step.ts` | `ctx.node` 存在, `ctx.agents` 已注册 | `ctx.agentType`/`ctx.agent` 已填充 | 无匹配 Agent / 认领失败 → board.failNode |
| **SpawnStep** | `spawn-step.ts` | `ctx.agentType`/`ctx.agent` 已填充 | `ctx.instanceId` 已填充, Agent 已唤醒 | mHC 超时 / 池耗尽 / 状态非法 → board.release + board.failNode |
| **ExecuteStep** | `execute-step.ts` | `ctx.agent` 可用 | `ctx.result` 已填充 | agent.execute() 异常 → 捕获为失败 result |
| **RlmExecuteStep** | `rlm-execute-step.ts` | `ctx.llmChat` 可选 | `ctx.result` 已填充 | 拆解失败 → 回退直接执行 |
| **BoundaryGuardStep** | `boundary-guard-step.ts` | `ctx.result.success=true` | 越界时 `ctx.boundaryViolation` 已标记 | 扫描失败不阻塞管线 |
| **CleanupStep** | `cleanup-step.ts` | 无（始终执行） | mHC 释放 + Pool 销毁 + Board 落盘 | Pool 销毁异常 → emit PoolDestroyFailed |

**三阶段释放协议**（CleanupStep 保证顺序）：

```
1. ManifoldGate.release()        ← 优先释放流控槽位，提高系统吞吐
2. Pool 生命周期 (Draining→Destroyed) ← 优雅降级
3. board.complete()               ← 落盘（防节点卡 claimed）
```

### 5.4 AgentPool 状态机

```
                      ┌───────────┐
                      │  Created  │
                      └─────┬─────┘
                            │
                    spawn() │ 合法流转
                            ▼
                      ┌───────────┐
         ┌────────────│   Awake   │◄────────────┐
         │            └─────┬─────┘             │
         │                  │                   │
         │          setStatus() │               │
         │                  ▼                   │
         │            ┌───────────┐             │
         │            │  Active   │─────────────┘
         │            └─────┬─────┘  (允许多次 active)
         │                  │
         │          setStatus() │
         │                  ▼
         │            ┌───────────┐
         └────────────│ Draining  │
                      └─────┬─────┘
                            │
                    destroy() │
                            ▼
                      ┌───────────┐
                      │ Destroyed │
                      └───────────┘
```

### 5.5 ManifoldGate — mHC 流形约束

```typescript
/**
 * ManifoldGate —— mHC 流形约束门控（全局静态单例）。
 *
 * 语义：同类型 Agent 并发数 ≤ maxInstances
 * 队列：FIFO 公平排队，无饥饿
 * 超时：acquireTimeoutMs 后返回 false（调用方优雅失败）
 *
 * 集成方式：
 *   SpawnStep:  spawn 前 acquire(type)，失败时 release(type)
 *   CleanupStep: destroy 后 release(type)
 *   RLM 子任务: isRlmSubtask=true 不走流约束（pool.spawnSubtask()）
 */
export class ManifoldGate {
  static setObserver(observer: IPipelineObserver): void;
  static register(agentType: string, maxInstances: number): void;
  static updateMax(agentType: string, newMax: number): void;
  static active(agentType: string): number;
  static waiting(agentType: string): number;
  static max(agentType: string): number;
  static async acquire(agentType: AgentType | string, acquireTimeoutMs?: number): Promise<boolean>;
  static release(agentType: AgentType | string): void;
  static reset(): void;
  static async drain(agentType: string): Promise<void>;
}
```

### 5.6 ReplanManager — 重规划队列

```
失败节点 → replanManager.enqueue(node, reason)
  → tryFireReplan()
    → MetaAgent.requestReplan(node, reason)  [可选依赖, 无则静默排空]
      → TaskBoard.addNode(newNodes)
        → 下一轮调度循环自动消费（"领而不执"）
  → resolveChains(allResults)  [执行结束后解析重规划链]
    → 若任意后代成功, 原始节点修正为成功
  → reset()  [每次 executeAll() 结束后调用]
```

**配额控制**:
- `maxReplanPerNode`: 单节点最大重规划次数（默认 3）
- `maxTotalReplans`: 单次 executeAll() 全局重规划上限（默认 50）
- ReAct 超时 (`Exceeded max loops`) 不触发重规划

### 5.7 ConfirmGate — 确认门

```
可逆性等级判定矩阵:
                     L0 (读取)  L1 (可回滚写)  L2 (难回滚)  L3 (不可逆)
─────────────────────────────────────────────────────────────
需要确认？         永不确认   信任模型判定    永远确认      永远确认
TrustModel ≥ L3    —          免确认         仍确认         仍确认

核心协议:
  request(req) → waitFor(id) → resolve(response) / handleTimeout(id)

集成方式:
  SpawnStep / ExecuteStep 可通过 needsConfirmation() 决定是否等待用户确认
```

### 5.8 TrustModel — 信任模型

```
晋升规则:
  L1 → L2: 连续 5 次接受 (同一 (AgentType, RiskDomain) 对)
  L2 → L3: 连续 15 次接受

衰减规则:
  7 天无确认活动 → 降一级, 不低于 L1

拒绝规则:
  任一拒绝 → 立即重置为 L1

冷启动: 首次查询 → 初始化 L1
```

---

## 6. 扩展点：三抽象

### 6.1 组合空间

```
                  IScheduleStrategy
                  ┌──────────────┐
                  │ TagMatching   │
                  │ RoundRobin    │
                  │ PriorityFirst │
                  │ (自定义)       │
                  └──────┬───────┘
                         │
                         ▼
    ┌─────────────────────────────────────┐
    │         CompositeScheduler          │
    │  strategy × loopDriver × execModel  │
    └─────────────────────────────────────┘
            ▲                      ▲
            │                      │
   ┌────────┴───────┐    ┌────────┴────────┐
   │  ILoopDriver   │    │ IExecutionModel │
   │ Topological    │    │ PipelineModel   │
   │ Sequential     │    │ SimpleExecute   │
   │ Wave           │    │ (自定义)         │
   │ (自定义)       │    └─────────────────┘
   └────────────────┘
```

### 6.2 推荐组合

| 场景 | 策略 | 驱动 | 范式 | 说明 |
|------|------|------|------|------|
| **通用（默认）** | TagMatchingStrategy | TopologicalLayeredDriver | PipelineModel | 全功能调度 |
| **调试/测试** | TagMatchingStrategy | SequentialDriver | SimpleExecuteModel | 跳过管线，顺序执行 |
| **软件工程** | PriorityFirstStrategy | WaveDriver | PipelineModel | design→implement→review→verify |
| **负载均衡** | RoundRobinStrategy | TopologicalLayeredDriver | PipelineModel | 同构 Agent 池均分任务 |
| **快速验证** | TagMatchingStrategy | TopologicalLayeredDriver | SimpleExecuteModel | 无安全守卫的快速执行 |

### 6.3 扩展方式

```typescript
// 自定义调度策略
class SkillBasedStrategy implements IScheduleStrategy {
  readonly name = "skill-based";
  findMatchingAgent(node: TaskNode, agents: Map<string, Agent>): string | null {
    // 按技能模板匹配...
  }
  findAllMatchingAgents(node: TaskNode, agents: Map<string, Agent>): string[] {
    // ...
  }
}

// 注入 CompositeScheduler
const scheduler = new CompositeScheduler(board, pool, observer, metaAgent, config, {
  strategy: new SkillBasedStrategy(),
  loopDriver: new WaveDriver(),
  executionModel: new PipelineModel(),
});
```

---

## 7. 数据流全景

### 7.1 完整调度链路

```
MetaAgent / CLI
    │
    │  addNode(node)
    ▼
┌───────────┐          ┌──────────────┐
│ TaskBoard  │──────────│   Scheduler  │
│ (DAG存储)  │          │  executeAll()│
└───────────┘          └──────┬───────┘
         ▲                     │
         │            topologicalSort()
         │                     ▼
         │              ┌──────────────┐
         │              │  分层结果     │
         │              │ layers[][]    │
         │              └──────┬───────┘
         │                     │
         │          逐层并行分发 (Promise.allSettled)
         │                     │
         │              ┌──────┴───────┐
         │              │ DispatchNode │
         │              └──────┬───────┘
         │                     │
         │          ┌──────────┴──────────┐
         │          │                     │
         │    needsMultiPerspective?     │
         │          │                     │
         │    ┌─────┴─────┐       ┌──────┴──────┐
         │    │ _dispatch  │       │ _dispatch   │
         │    │ Multi     │       │ Single      │
         │    └─────┬─────┘       └──────┬──────┘
         │          │                     │
         │    并行多 Agent          Dispatch Pipeline:
         │     ┌──────┐           Claim → Spawn →
         │     │AgentA│            RlmExecute →
         │     │AgentB│            BoundaryGuard →
         │     └──────┘            Cleanup
         │          │                     │
         │          ▼                     ▼
         │    ┌──────────────────────────────┐
         │    │     agent.execute(node)      │
         │    └──────────────┬───────────────┘
         │                   │
         │             NodeResult
         │                   │
         │    ┌──────────────┴───────────────┐
         │    │     CleanupStep:             │
         │    │   • ManifoldGate.release()   │
         │    │   • pool.destroy()           │
         │    │   • board.complete()         │
         │    └──────────────┬───────────────┘
         │                   │
         │            失败节点?
         │                   │
         │           ┌───────┴───────┐
         │           │               │
         │        replanManager   跳过
         │        .enqueue()
         │           │
         │    tryFireReplan()
         │      → MetaAgent
         │      → addNode(新节点)
         │           │
         └───────────┘ (新节点入板, 下轮消费)
```

### 7.2 事件流

```
PipelineObserver 事件发射时序:

Scheduler Layer Start
  → NodeStart
    → ClaimStep 完成
    → SpawnStep 完成 (含 mHC 事件)
    → RlmExecuteStep / ExecuteStep 完成
      → NodeComplete / NodeFailed
    → BoundaryGuardStep (违规时 AgentBoundaryViolation)
    → CleanupStep 完成
  → 层结束
Scheduler Done / Scheduler Loop Crashed
  → 异常时: SchedulerInvariantViolation / SchedulerReplanLimit
  → mHC 事件: ManifoldGateWaitStart / ManifoldGateWaitEnd / ManifoldGateAcquireTimeout
```

---

## 8. 依赖关系与外部契约

### 8.1 包依赖

```
@cortex/scheduler
  ├── devDependencies
  │   ├── @cortex/shared   (workspace:*)  — 共享类型, 仅类型导入
  │   ├── @cortex/config   (workspace:*)  — 配置类型
  │   ├── typescript        — 编译
  │   ├── vitest            — 测试
  │   └── eslint            — 代码检查
  │
  └── 运行时零依赖 (纯 TypeScript 类型系统)
```

**设计决策**: `@cortex/scheduler` **无运行时依赖**。所有类型来自 `@cortex/shared`（编译期 devDependency）。这使得 scheduler 可被任意项目引入而不会产生运行时包袱。

### 8.2 外部契约: @cortex/shared 类型依赖

`@cortex/scheduler` 依赖 `@cortex/shared` 的以下类型（均通过编译期类型导入）：

```
从 @cortex/shared 导入的类型:
  ── Agent 域 ──
  Agent, AgentType, AgentStatus, AgentConfig
  MemoryAware, Executable

  ── 任务域 ──
  TaskNode, NodeResult, ExecutionReport
  EdgeType, DensityLevel, DensityAnnotated
  SubTask, DecomposeResult
  ImpactScope, ReplanResult

  ── 事件域 ──
  IPipelineObserver, PipelineHandler, ObservableEvent
  PipelineEventType, PipelinePriority
  HandlerErrorReporter, HandlerErrorContext
  SafeErrorReporter, SafeErrorContext
  InvariantReporter, InvariantViolation

  ── 确认/信任域 ──
  ConfirmationRequest, ConfirmationResponse
  ReversibilityLevel, PlatformBridge
  ITrustModel, TrustLevel, TrustEntry, RiskDomain
  toolNameToRiskDomain

  ── 记忆域 (仅用于 PipelineCtx) ──
  MemoryEntry, MemoryQuery, ReadMode, IMemoryStore

  ── 工具域 ──
  Tag, AgentDisplayInfo, SkillTemplate
```

### 8.3 外部契约: @cortex/config

```typescript
从 @cortex/config 导入的类型:
  EngineConfig (用于 scheduler 构造参数)
  resolveConfig, DEFAULT_ENGINE_CONFIG
  DEFAULT_CLI_CHAT_MODEL
```

### 8.4 外部契约: @cortex/llm (可选)

```typescript
从 @cortex/llm 导入的类型:
  LlmAdapter (仅 PipelineCtx 中使用, 通过 interface 导入)
```

### 8.5 与 @cortex/engine 的边界契约

```
@cortex/engine → 依赖 → @cortex/scheduler

engine 对 scheduler 的调用模式:
  1. 构造 Scheduler/CompositeScheduler（注入 board/pool/observer/metaAgent）
  2. 调用 scheduler.register(agentType, agent, model) 注册 Agent
  3. 调用 scheduler.executeAll() 执行全部节点
  4. 消费 ExecutionReport

engine 提供给 scheduler 的回调契约:
  1. MetaAgent (可选, 通过 ReplanManager 调用)
     - requestReplan(failedNode, reason, count): ReplanResult
     - requestBoundaryReplan(violatingNode, reason, count): ReplanResult
  2. IMemoryStore (可选, 通过 setMemoryStore 注入)
     - beginSession(sessionId): void
     - endSession(): Promise<number>
```

---

## 9. 文件组织方案

### 9.1 目录结构

```
packages/scheduler/
├── package.json
├── tsconfig.json                  # 引用 tsconfig.src.json + tsconfig.test.json
├── tsconfig.src.json              # 编译配置 (extends ../../tsconfig.base.json)
├── tsconfig.test.json             # 测试配置
├── vitest.config.ts               # Vitest 配置
├── vitest.ci.config.ts            # CI 测试配置
│
├── src/
│   ├── index.ts                   # 桶导出 (barrel)
│   │
│   ├── core/
│   │   ├── scheduler.ts           # IScheduler + Scheduler 实现
│   │   ├── composite-scheduler.ts # CompositeScheduler（三抽象组合）
│   │   ├── scheduling-types.ts    # 三抽象接口定义 (IScheduleStrategy / ILoopDriver / IExecutionModel)
│   │   ├── scheduling-implementations.ts  # 三抽象内置实现
│   │   ├── task-board.ts          # ITaskBoard + TaskBoard
│   │   ├── agent-pool.ts          # ISchedulerAgentPool + IAgentPool + AgentPool
│   │   ├── pipeline-observer.ts   # IPipelineObserver + PipelineObserver
│   │   ├── pipeline-runner.ts     # IStep + PipelineCtx + PipelineRunner
│   │   ├── replan-manager.ts      # ReplanManager + ReplanItem
│   │   ├── confirm-gate.ts        # ConfirmGate
│   │   ├── trust-model.ts         # TrustModel implements ITrustModel
│   │   ├── topological-sort.ts    # topologicalSort 纯函数
│   │   ├── agent-matcher.ts       # findMatchingAgent / findAllMatchingAgents 纯函数
│   │   ├── rlm-decompose.ts       # decompose / shouldDecompose / shouldExecuteDecomposition
│   │   └── density-compress.ts    # DENSITY 标注/压缩/合并工具
│   │
│   ├── dispatch-steps/
│   │   ├── types.ts               # DispatchCtx / IDispatchStep
│   │   ├── claim-step.ts          # ClaimStep
│   │   ├── spawn-step.ts          # SpawnStep（mHC 流约束版）
│   │   ├── execute-step.ts        # ExecuteStep
│   │   ├── rlm-execute-step.ts    # RlmExecuteStep
│   │   ├── boundary-guard-step.ts # BoundaryGuardStep + BOUNDARY_RULES
│   │   ├── cleanup-step.ts        # CleanupStep
│   │   └── manifold-gate.ts       # ManifoldGate（mHC 流形约束）
│   │
│   └── __tests__/                 # 测试目录
│       ├── scheduler.test.ts
│       ├── task-board.test.ts
│       ├── agent-pool.test.ts
│       ├── topological-sort.test.ts
│       ├── manifold-gate.test.ts
│       ├── confirm-gate.test.ts
│       ├── pipeline-observer.test.ts
│       ├── trust-model.test.ts
│       ├── dispatch-steps/
│       │   ├── claim-step.test.ts
│       │   ├── spawn-step.test.ts
│       │   ├── execute-step.test.ts
│       │   ├── rlm-execute-step.test.ts
│       │   ├── boundary-guard-step.test.ts
│       │   └── cleanup-step.test.ts
│       └── integration.test.ts
│
└── docs/                          # 文档（可选）
    └── API_REFERENCE.md
```

### 9.2 桶导出 (src/index.ts)

```typescript
// ============================================================
// @cortex/scheduler —— 桶导出（Public API Surface）
// ============================================================

// ── 核心调度接口与类 ──
export { IScheduler, Scheduler } from "./core/scheduler.js";
export { CompositeScheduler } from "./core/composite-scheduler.js";

// ── 任务板 ──
export { ITaskBoard, TaskBoard } from "./core/task-board.js";

// ── Agent 池 ──
export { ISchedulerAgentPool, IAgentPool, AgentPool } from "./core/agent-pool.js";

// ── 事件管道 ──
export { PipelineObserver } from "./core/pipeline-observer.js";

// ── 执行管线 ──
export { PipelineRunner, type PipelineCtx, type IStep } from "./core/pipeline-runner.js";

// ── 重规划 ──
export { ReplanManager, type ReplanItem } from "./core/replan-manager.js";

// ── 确认门 & 信任模型 ──
export { ConfirmGate } from "./core/confirm-gate.js";
export { TrustModel } from "./core/trust-model.js";

// ── 纯函数 ──
export { topologicalSort } from "./core/topological-sort.js";
export { findMatchingAgent, findAllMatchingAgents } from "./core/agent-matcher.js";
export { decompose, shouldDecompose, shouldExecuteDecomposition, MAX_RLM_DEPTH } from "./core/rlm-decompose.js";
export { parseDensityTag, stripDensityTag, compressByDensity, annotateAndCompress, mergeContext, densityToStrategy } from "./core/density-compress.js";

// ── 三抽象接口与类型 ──
export type {
  IScheduleStrategy, ILoopDriver, IExecutionModel,
  LoopContext, LoopResult, ExecutionContext, CompositeSchedulerConfig,
} from "./core/scheduling-types.js";

// ── 三抽象实现 ──
export {
  TagMatchingStrategy, RoundRobinStrategy, PriorityFirstStrategy,
  TopologicalLayeredDriver, SequentialDriver, WaveDriver,
  PipelineModel, SimpleExecuteModel,
} from "./core/scheduling-implementations.js";

// ── 调度分发步骤 ──
export type { DispatchCtx, IDispatchStep } from "./dispatch-steps/types.js";
export { ClaimStep } from "./dispatch-steps/claim-step.js";
export { SpawnStep } from "./dispatch-steps/spawn-step.js";
export { ExecuteStep } from "./dispatch-steps/execute-step.js";
export { RlmExecuteStep, MAX_PARALLEL_SUBTASKS } from "./dispatch-steps/rlm-execute-step.js";
export { BoundaryGuardStep, type AgentBoundaryRule, BOUNDARY_RULES } from "./dispatch-steps/boundary-guard-step.js";
export { CleanupStep } from "./dispatch-steps/cleanup-step.js";
export { ManifoldGate } from "./dispatch-steps/manifold-gate.js";
```

---

## 10. 从 engine 提取的迁移路径

### 10.1 迁移步骤

```
Phase 1: 创建包骨架
  (1) 创建 packages/scheduler/ 目录结构
  (2) 复制 src/ 文件（保持代码不变，仅调整 import 路径）
  (3) 配置 tsconfig / package.json / vitest

Phase 2: 调整导入路径
  (4) 所有 @cortex/shared 导入改为 devDependency
  (5) 所有 @cortex/config 导入改为 devDependency
  (6) 移除对 engine 内部模块的引用（test-env.ts 等）

Phase 3: engine 迁移
  (7) engine 的 package.json 添加 @cortex/scheduler: workspace:*
  (8) engine 的 index.ts 中 scheduler 相关导出改为 re-export from @cortex/scheduler
  (9) engine 的 src/core/scheduler.ts 等文件标记为 deprecated, 后续删除
  (10) 更新 engine 的 tsconfig.src.json, 添加 scheduler 引用

Phase 4: 集成测试
  (11) 运行 engine 完整测试套件, 验证 scheduler 解耦后行为不变
  (12) 运行 scheduler 独立测试套件
```

### 10.2 需要处理的跨包依赖

| 当前文件 | 依赖 engine 内部模块 | 迁移方案 |
|---------|---------------------|---------|
| `scheduler.ts` | `import { isTestEnv } from "../test-env.js"` | 将 `isTestEnv()` 提取到 `DispatchCtx` 中作为字段传递 |
| `spawn-step.ts` | `import { DEFAULT_CLI_CHAT_MODEL } from "@cortex/config"` | 保留（config 是合法依赖） |
| `rlm-execute-step.ts` | `import { DEFAULT_CLI_CHAT_MODEL } from "@cortex/config"` | 保留 |
| `agent-pool.ts` | `import { isTestEnv } from "../test-env.js"` | 同 `scheduler.ts`, 提取为注入字段 |
| `pipeline-runner.ts` | `import { LlmAdapter } from "@cortex/llm"`, `import { Toolkit } from "../platform/toolkit.js"`, `import { MemoryStore } from "../memory/memory-store.js"` | 使用 `@cortex/shared` 中的接口类型替代具体类类型；`PipelineCtx` 改为泛型或接口类型 |
| `confirm-gate.ts` | `import { DEFAULT_ENGINE_CONFIG, ENV_CONFIRM_GATE_TIMEOUT_MS, ENV_NODE_ENV } from "@cortex/config"` | 保留 |

### 10.3 关键解耦点: PipelineCtx

`PipelineCtx` 当前引用了 `@cortex/engine` 的具体类 (`Toolkit`, `MemoryStore`) 和 `@cortex/llm` 的 `LlmAdapter`。

**重构方案**: 将 `PipelineCtx` 中 `@cortex/engine` 的具体类型改为 `@cortex/shared` 中定义的接口类型：

```typescript
// 当前 (在 engine 中):
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "../platform/toolkit.js";
import type { MemoryStore } from "../memory/memory-store.js";

export interface PipelineCtx {
  readonly llm: LlmAdapter;       // ← 来自 @cortex/llm
  readonly toolkit: Toolkit;       // ← 来自 engine
  readonly memory?: MemoryStore;   // ← 来自 engine
  // ...
}

// 迁移后 (在 scheduler 中):
import type { LlmAdapter } from "@cortex/llm";  // 合法: @cortex/llm 是 @cortex/shared 级别的包
// Toolkit / MemoryStore 改为泛型:
export interface PipelineCtx<TToolkit = unknown, TMemory = unknown> {
  readonly llm: LlmAdapter;
  readonly toolkit: TToolkit;
  readonly memory?: TMemory;
  // ...
}
```

### 10.4 向后兼容

engine 的 barrel 导出 (`packages/engine/src/index.ts`) 保留所有 scheduler 相关导出，通过 re-export 实现：

```typescript
// @cortex/engine 保持向前兼容的 barrel 导出
export { Scheduler, CompositeScheduler, TaskBoard, AgentPool, ... } from "@cortex/scheduler";
```

外部消费者（CLI / 测试代码）无需修改 import 路径，仍从 `@cortex/engine` 导入。

---

## 附录 A: 关键设计决策日志

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| PipelineCtx 是否泛型化 | 保持具体 / 泛型化 | 泛型化 | 解耦 Toolkit/MemoryStore 具体类型，scheduler 不依赖 engine 实现 |
| ManifoldGate 单例 vs 实例 | 静态单例 / 实例注入 | 静态单例 | Scheduler 单例运行期间只存在一个调度循环，静态 Map 省去传递引用 |
| 三抽象是否默认内置 | 仅接口 / 接口+默认实现 | 接口+默认实现 | 开箱即用，TagMatchingStrategy + TopologicalLayeredDriver + PipelineModel 作为默认组合 |
| ConfirmGate 是否常驻 | 注入可选 / 强制实例化 | 注入可选 | 无 bridge 时 bypass，测试友好 |
| ReplanManager 依赖 MetaAgent | 强依赖 / 可选 | 可选 | 无 MetaAgent 时 replan 静默排空，不阻塞调度 |
| 从 engine 提取时的文件拆分 | 保留原结构 / 重新组织 | 保留原结构 | 最小化 diff，降低迁移风险和 review 成本 |

---

## 附录 B: 与 @cortex/fsm-compiler 的关系

`@cortex/scheduler` 和 `@cortex/fsm-compiler` 是正交的独立包：

```
@cortex/fsm-compiler: 有限状态机编译工具链 (JSON DSL → 校验 → 代码生成 → 运行时)
@cortex/scheduler:    任务调度执行引擎 (DAG → 拓扑排序 → 分发 → 执行 → 落盘)

交叉点:
  - scheduler 可使用 fsm-compiler 建模 TaskNode 状态机
  - TaskBoard 的状态流转 (pending → claimed → done/failed) 可用 FSM 编译实现
  - ConfirmGate 的 L0-L3 判定可用 FSM 建模

当前关系: 各自独立，无强制依赖
未来可能: scheduler 引入 @cortex/fsm-compiler 作为可选优化
```

---

> **文档约定**:
> - 所有 Mermaid 图遵循纯字母+数字节点 ID 规范
> - 接口优先于实现：每个模块先列出接口，再列出实现
> - 上下文类型命名使用 `XxxCtx` 后缀（DispatchCtx / PipelineCtx / LoopContext / ExecutionContext）
> - 步骤接口使用 `IXxxStep` 命名（IDispatchStep / IStep）
