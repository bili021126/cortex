# @cortex/scheduler — 调度器架构设计

> **版本**: v1.0.0  
> **状态**: 设计阶段 (RFC)  
> **最后更新**: 2026-01-xx

---

## 目录

1. [设计目标](#1-设计目标)
2. [职责边界](#2-职责边界)
3. [核心接口](#3-核心接口)
4. [模块划分](#4-模块划分)
5. [三抽象组合体系](#5-三抽象组合体系)
6. [数据流](#6-数据流)
7. [包依赖图](#7-包依赖图)
8. [文件目录结构](#8-文件目录结构)
9. [与现有代码的关系](#9-与现有代码的关系)
10. [测试策略](#10-测试策略)
11. [迁移路线](#11-迁移路线)

---

## 1. 设计目标

### 1.1 核心目标

| # | 目标 | 说明 |
|---|------|------|
| G1 | **接口化** | 所有外部依赖抽象为接口，Scheduler 不感知具体实现 |
| G2 | **可组合** | 调度行为拆解为策略 × 驱动 × 范式三个正交维度，每维可独立替换 |
| G3 | **可测试** | 纯逻辑与副作用的边界清晰，核心路径可 mock 全部依赖做单元测试 |
| G4 | **独立演进** | @cortex/scheduler 从 @cortex/engine 拆出，版本号独立，API surface 稳定 |
| G5 | **插件兼容** | 保持与现有 PluginContainer（PluginLoader）完全兼容 |

### 1.2 非目标

- ❌ 不负责 Agent 生命周期管理（归 AgentPool）
- ❌ 不负责任务节点持久化（归 TaskBoard 的实现层）
- ❌ 不负责 Agent 创建/注册（归 bootstrap/plugin 层）
- ❌ 不负责 LLM 调用（归 Agent / @cortex/llm）

---

## 2. 职责边界

### 2.1 Scheduler 的职责

```
                     ┌──────────────────────────────────────┐
                     │         @cortex/scheduler             │
                     │                                      │
  TaskBoard ────────►│  读取 pending 节点                    │
  (ITaskBoard)       │  拓扑排序 → 分层                      │
                     │  按策略匹配 Agent                      │
  AgentPool ────────►│  分发执行 → 收集结果                    │
  (IAgentPool)       │  处理重规划                            │
                     │  产出 ExecutionReport                 │
  PipelineObserver ─►│  事件发射 (start/complete/fail/tick)   │
  (IPipelineObserver)│                                      │
                     └──────────────────────────────────────┘
```

### 2.2 不在 Scheduler 内

| 功能 | 归属 |
|------|------|
| Agent 实例创建 (new Agent / agent.wakeup) | @cortex/engine (factory) |
| Agent 实例池管理 (spawn/destroy/maxInstances) | @cortex/engine (AgentPool) |
| 任务节点持久化 / 状态存储 | TaskBoard 实现层 |
| LLM / Tool / Memory 注入 | @cortex/engine (bootstrap) |
| CLI / IPC 接口 | @cortex/cli |

### 2.3 依赖契约 (Dependency Contract)

Scheduler 依赖以下接口（均在 @cortex/shared 或本包内定义）：

```typescript
// 外部注入的依赖
ITaskBoard            — 节点读写（getPendingNodes / claim / complete / failNode）
ISchedulerAgentPool   — 实例生命周期（spawn / destroy / getStatus / setStatus）
IPipelineObserver     — 事件管道（emit / on / off）
IMetaAgent            — 重规划（requestReplan）[可选]
IMemoryStore          — session 生命周期 [可选]

// 本包自包含
IScheduleStrategy     — 节点→Agent 匹配策略
ILoopDriver           — 执行循环推进方式
IExecutionModel       — 单节点执行范式
IDispatchStep         — 分发管线步骤
ReplanManager         — 重规划队列管理（纯逻辑，无可选依赖）
```

---

## 3. 核心接口

### 3.1 IScheduler — 调度器外部接口

```typescript
/**
 * IScheduler —— 调度器对外契约。
 *
 * register(): Agent 注册（由 bootstrap/plugin 层调用）
 * executeAll(): 执行 TaskBoard 上全部节点，产出 ExecutionReport
 * executeNode(): 执行单个节点（管理命令 "task redo" 用）
 * cancel(): 取消运行中的调度会话
 *
 * @note ExecutionReport.sessionId 作为 run 标识，用于 MemoryStore 会话锚定
 */
export interface IScheduler {
  /** 注册 Agent 及其使用的模型 */
  register(agentType: string, agent: Agent, model: string): void;

  /** 批量注册 Agent（替代多次 register()） */
  registerBatch(entries: Array<{ type: string; agent: Agent; model: string }>): void;

  /** 执行 TaskBoard 上所有节点 */
  executeAll(): Promise<ExecutionReport>;

  /** 取消当前执行（正在等待的节点标记 failed） */
  cancel(): Promise<void>;

  /** 查询已注册的 Agent 类型列表 */
  getRegisteredTypes(): string[];

  /** 注入 MemoryStore（用于 session 生命周期管理） */
  setMemoryStore(memory: IMemoryStore): void;
}
```

### 3.2 ISchedulerAgentPool — Agent 池最小契约

> 定义于 @cortex/shared 或本包；沿用现有 `ISchedulerAgentPool`。

```typescript
export interface ISchedulerAgentPool {
  spawn(agentType: AgentType, instanceId: string): boolean;
  spawnSubtask(agentType: AgentType, instanceId: string): boolean;
  getStatus(instanceId: string): AgentStatus | undefined;
  setStatus(instanceId: string, status: AgentStatus): boolean;
  destroy(agentType: AgentType, instanceId: string): void;
}
```

### 3.3 ITaskBoard — 任务板最小契约

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

### 3.4 IMetaAgent — 元智能体最小契约

```typescript
export interface IMetaAgent {
  requestReplan(node: TaskNode, reason: string, subType?: string): Promise<ReplanResult>;
  readonly llmAdapter?: LlmAdapter;
}
```

### 3.5 IScheduleStrategy — 调度策略

```typescript
/**
 * 调度策略：决定任务节点由哪个 Agent 执行。
 *
 * 内置实现：
 *   - TagMatchingStrategy（默认）：标签匹配 + 打分
 *   - RoundRobinStrategy：轮转
 *   - PriorityFirstStrategy：空闲 Agent 优先
 *   - SkillBasedStrategy（预留）：技能匹配
 */
export interface IScheduleStrategy {
  readonly name: string;
  findMatchingAgent(node: TaskNode, agents: Map<string, Agent>): string | null;
  findAllMatchingAgents(node: TaskNode, agents: Map<string, Agent>): string[];
}
```

### 3.6 ILoopDriver — 循环驱动

```typescript
/**
 * 循环方式：控制执行循环如何推进。
 *
 * 内置实现：
 *   - TopologicalLayeredDriver（默认）：拓扑排序 → 逐层并行
 *   - SequentialDriver：严格顺序
 *   - WaveDriver：波浪分组（design → code → review → verify）
 *   - ContinuousDriver（预留）：持续改进直到收敛
 */
export interface ILoopDriver {
  readonly name: string;
  run(ctx: LoopContext): Promise<LoopResult>;
}

export interface LoopContext {
  board: ITaskBoard;
  pool: ISchedulerAgentPool;
  observer: IPipelineObserver;
  agents: Map<string, Agent>;
  models: Map<string, string>;
  metaAgent?: IMetaAgent;
  replanManager: ReplanManager;
  config: Required<SchedulerConfig>;
  strategy: IScheduleStrategy;
  executionModel: IExecutionModel;
}

export interface LoopResult {
  completed: number;
  failed: number;
  results: NodeResult[];
}
```

### 3.7 IExecutionModel — 执行范式

```typescript
/**
 * 执行范式：控制单个任务节点的执行方式。
 *
 * 内置实现：
 *   - PipelineModel（默认）：Claim → Spawn → Execute → BoundaryGuard → Cleanup
 *   - SimpleExecuteModel：跳过管线直接执行
 *   - ReActModel（预留）：Reason → Act → Observe
 *   - ReflexionModel（预留）：Execute → Evaluate → Reflect → Retry
 */
export interface IExecutionModel {
  readonly name: string;
  dispatchSingle(ctx: ExecutionContext): Promise<NodeResult>;
  dispatchMulti(ctx: ExecutionContext): Promise<NodeResult>;
}

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

### 3.8 ReplanManager — 重规划管理器

```typescript
/**
 * ReplanManager —— 重规划队列管理。
 * 纯逻辑组件，不依赖外部实现。
 * 职责：收集失败节点 → 去重 → 调用 MetaAgent.requestReplan → 将新节点注入 TaskBoard
 *
 * @contract 无害失败：MetaAgent 不可用/重规划超限时，静默排空队列，不阻断主循环。
 */
export class ReplanManager {
  readonly hasPending: boolean;

  enqueue(node: TaskNode, reason: string, subType?: string): void;
  tryFireReplan(): Promise<void>;
  resolveChains(allResults: NodeResult[]): void;
  reset(): void;
}
```

### 3.9 CompositeSchedulerConfig — 组合式调度器配置

```typescript
export interface CompositeSchedulerConfig {
  strategy?: IScheduleStrategy;
  loopDriver?: ILoopDriver;
  executionModel?: IExecutionModel;
}
```

---

## 4. 模块划分

### 4.1 模块图

```
@cortex/scheduler
│
├── core/                  # 核心调度逻辑
│   ├── scheduler.ts           ── IScheduler 主要实现
│   ├── composite-scheduler.ts ── 组合式调度器（三抽象组合）
│   ├── replan-manager.ts      ── 重规划队列管理
│   ├── topological-sort.ts    ── DAG 拓扑排序
│   └── agent-matcher.ts       ── Agent 标签匹配算法
│
├── strategy/              # IScheduleStrategy 实现
│   ├── types.ts               ── IScheduleStrategy
│   ├── tag-matching.ts        ── 标签匹配（默认）
│   ├── round-robin.ts         ── 轮转
│   ├── priority-first.ts      ── 优先级优先
│   └── index.ts               ── barrel
│
├── driver/                # ILoopDriver 实现
│   ├── types.ts               ── ILoopDriver, LoopContext, LoopResult
│   ├── topological-layered.ts ── 拓扑分层（默认）
│   ├── sequential.ts          ── 顺序执行
│   ├── wave.ts                ── 波浪式
│   └── index.ts               ── barrel
│
├── model/                 # IExecutionModel 实现
│   ├── types.ts               ── IExecutionModel, ExecutionContext
│   ├── pipeline.ts            ── 管线执行（默认）
│   ├── simple.ts              ── 简化执行
│   └── index.ts               ── barrel
│
├── dispatch-steps/        # 分发管线步骤
│   ├── types.ts               ── DispatchCtx, IDispatchStep
│   ├── claim-step.ts          ── 认领节点
│   ├── spawn-step.ts          ── 生成实例
│   ├── execute-step.ts        ── 执行
│   ├── cleanup-step.ts        ── 清理释放
│   ├── boundary-guard-step.ts ── 文件边界守卫
│   ├── rlm-execute-step.ts    ── RLM 递归拆解执行
│   ├── manifold-gate.ts       ── 流控门（可选）
│   └── index.ts               ── barrel
│
├── utils/                 # 工具函数
│   ├── invariant.ts           ── invariant 违规上报
│   └── index.ts
│
├── index.ts               # barrel 导出
│
└── DESIGN.md              # 本文件
```

### 4.2 依赖方向

```
core/  ──depends-on──►  strategy/  driver/  model/  dispatch-steps/  utils/
                         ▲           ▲       ▲          ▲
                         │           │       │          │
                         全部只依赖 @cortex/shared 类型
```

**约束**: 各模块之间禁止反向依赖。`strategy/` 不引用 `driver/`，`driver/` 不引用 `model/`。

---

## 5. 三抽象组合体系

### 5.1 组合空间

```
              ┌──────────────────┐
              │  IScheduleStrategy │
              │  (节点→Agent 匹配) │
              └────────┬─────────┘
                       │
              ┌────────▼─────────┐
              │   ILoopDriver     │
              │  (循环推进方式)    │
              └────────┬─────────┘
                       │
              ┌────────▼─────────┐
              │  IExecutionModel  │
              │  (单节点执行范式)  │
              └──────────────────┘
```

### 5.2 推荐组合表

| 场景 | Strategy | Driver | Model | 说明 |
|------|----------|--------|-------|------|
| 默认 | TagMatching | TopologicalLayered | Pipeline | 现有行为，最通用 |
| 测试 | TagMatching | Sequential | Simple | 线性执行，无管线 |
| 设计→实现 | TagMatching | Wave | Pipeline | 按标签波浪分组 |
| 压力测试 | RoundRobin | TopologicalLayered | Simple | 负载均衡，轻量执行 |
| 稳定优先 | PriorityFirst | Sequential | Pipeline | 空闲优先，逐个执行 |
| 调试 | TagMatching | Sequential | Simple | 最小依赖，纯日志 |

### 5.3 CompositeScheduler 使用示例

```typescript
// 默认（与现有 Scheduler 行为一致）
const scheduler = new CompositeScheduler(board, pool, observer, metaAgent);

// 波浪分组 + 管线执行
const scheduler = new CompositeScheduler(board, pool, observer, metaAgent, config, {
  loopDriver: new WaveDriver(),
});

// 顺序执行 + 简化范式（轻量测试用）
const scheduler = new CompositeScheduler(board, pool, observer, undefined, config, {
  loopDriver: new SequentialDriver(),
  executionModel: new SimpleExecuteModel(),
});
```

---

## 6. 数据流

### 6.1 主执行路径

```
executeAll()
    │
    ▼
ILoopDriver.run(ctx)  ──►  while(有 pending 节点)
    │                              │
    │                    ┌─────────▼──────────┐
    │                    │ 拓扑排序 pending 节点  │
    │                    │ 按层分组 (layers)     │
    │                    └─────────┬──────────┘
    │                              │
    │                    ┌─────────▼──────────┐
    │                    │ 逐层 Promise.all    │
    │                    │ 每层内节点并行       │
    │                    └─────────┬──────────┘
    │                              │
    │                    ┌─────────▼──────────┐
    │                    │ IExecutionModel     │
    │                    │ .dispatchSingle()   │
    │                    │ or dispatchMulti()  │
    │                    └─────────┬──────────┘
    │                              │
    │                    ┌─────────▼──────────┐
    │                    │ IDispatchStep 管线   │
    │                    │ Claim → Spawn →     │
    │                    │ Execute → Guard →   │
    │                    │ Cleanup             │
    │                    └─────────┬──────────┘
    │                              │
    │                    ┌─────────▼──────────┐
    │                    │ NodeResult          │
    │                    │ (success / fail)    │
    │                    └─────────┬──────────┘
    │                              │
    │                    ┌─────────▼──────────┐
    │                    │ 失败? → ReplanManager│
    │                    │ .enqueue()          │
    │                    └─────────┬──────────┘
    │                              │
    │                    循环继续 / 处理重规划队列
    │
    ▼
ExecutionReport
(totalNodes / completed / failed / results / durationMs / sessionId)
```

### 6.2 错误处理路径

```
调度层异常
    │
    ├── 节点 execute() 抛异常
    │      → dispatch 捕获 → NodeResult { success: false, error }
    │      → ReplanManager.enqueue()
    │      → PipelineObserver.emit(NodeFailed)
    │
    ├── 全局超时
    │      → 剩余 pending 标记 failed
    │      → PipelineObserver.emit(SchedulerLoopCrashed)
    │      → break
    │
    ├── 循环内未预期异常
    │      → catch → pending 全部标记 failed
    │      → PipelineObserver.emit(SchedulerLoopCrashed)
    │      → break (返回已有结果，不崩溃)
    │
    └── 循环正常退出后悬空节点
           → orphaned 自动标记 failed
           → PipelineObserver.emit(SchedulerDone) 含孤儿节点计数
```

### 6.3 Resolve chain 数据流

```
ReplanManager.enqueue()  ──► 队列
    │
    ▼
tryFireReplan() ──► MetaAgent.requestReplan(node, reason)
    │                       │
    │           ┌───────────▼───────────┐
    │           │ ReplanResult           │
    │           │ { nodes, impactScope } │
    │           └───────────┬───────────┘
    │                       │
    ▼                       ▼
nodes 注入 TaskBoard    impactScope
(addNode)                  │
                    ┌──────┴──────┐
                    │             │
               "local"       "subtree"
                    │             │
              仅替换失败节点   递归移除子树
                             再注入新节点
```

---

## 7. 包依赖图

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│ @cortex/cli  │────►│@cortex/engine│────►│@cortex/shared│
└─────────────┘     └──────┬───────┘     └──────────────┘
                           │
              ┌────────────┼────────────┬──────────────┐
              ▼            ▼            ▼              ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐  ┌──────────────┐
       │scheduler  │ │   llm    │ │  config  │  │   factory    │
       │(新包)     │ │          │ │          │  │              │
       └──────────┘ └──────────┘ └──────────┘  └──────────────┘
              │
              ▼
       ┌──────────────┐
       │@cortex/shared │
       └──────────────┘
```

### 7.1 依赖说明

| 包 | 依赖 @cortex/scheduler 的什么 | @cortex/scheduler 依赖什么 |
|----|------|------|
| @cortex/engine | IScheduler, CompositeScheduler, ReplanManager | @cortex/shared (类型) |
| @cortex/engine (plugin) | IScheduler 实现实例 | 无反向依赖 |
| @cortex/testing | IScheduler (mock) | 无反向依赖 |

### 7.2 package.json

```jsonc
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
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc",
    "lint": "eslint src/",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@cortex/shared": "workspace:*"
  },
  "devDependencies": {
    "eslint": "^10.0.1",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

---

## 8. 文件目录结构

```
packages/scheduler/
├── package.json
├── tsconfig.json
├── tsconfig.src.json
├── vitest.config.ts
│
├── src/
│   ├── index.ts                          # barrels
│   │
│   ├── core/
│   │   ├── scheduler.ts                  # Scheduler（原始实现）
│   │   ├── composite-scheduler.ts        # CompositeScheduler（三抽象组合）
│   │   ├── replan-manager.ts             # ReplanManager
│   │   ├── topological-sort.ts           # DAG 拓扑排序
│   │   └── __tests__/                    # core 单元测试
│   │       ├── scheduler.test.ts
│   │       ├── composite-scheduler.test.ts
│   │       ├── replan-manager.test.ts
│   │       └── topological-sort.test.ts
│   │
│   ├── strategy/
│   │   ├── types.ts                      # IScheduleStrategy
│   │   ├── tag-matching.ts               # TagMatchingStrategy
│   │   ├── round-robin.ts                # RoundRobinStrategy
│   │   ├── priority-first.ts             # PriorityFirstStrategy
│   │   ├── index.ts
│   │   └── __tests__/
│   │       ├── tag-matching.test.ts
│   │       ├── round-robin.test.ts
│   │       └── priority-first.test.ts
│   │
│   ├── driver/
│   │   ├── types.ts                      # ILoopDriver, LoopContext, LoopResult
│   │   ├── topological-layered.ts        # TopologicalLayeredDriver
│   │   ├── sequential.ts                 # SequentialDriver
│   │   ├── wave.ts                       # WaveDriver
│   │   ├── index.ts
│   │   └── __tests__/
│   │       ├── topological-layered.test.ts
│   │       ├── sequential.test.ts
│   │       └── wave.test.ts
│   │
│   ├── model/
│   │   ├── types.ts                      # IExecutionModel, ExecutionContext
│   │   ├── pipeline.ts                   # PipelineModel
│   │   ├── simple.ts                     # SimpleExecuteModel
│   │   ├── index.ts
│   │   └── __tests__/
│   │       ├── pipeline.test.ts
│   │       └── simple.test.ts
│   │
│   ├── dispatch-steps/
│   │   ├── types.ts                      # DispatchCtx, IDispatchStep
│   │   ├── claim-step.ts                 # ClaimStep
│   │   ├── spawn-step.ts                 # SpawnStep
│   │   ├── execute-step.ts               # ExecuteStep
│   │   ├── cleanup-step.ts               # CleanupStep
│   │   ├── boundary-guard-step.ts        # BoundaryGuardStep
│   │   ├── rlm-execute-step.ts           # RlmExecuteStep
│   │   ├── manifold-gate.ts              # ManifoldGate
│   │   ├── index.ts
│   │   └── __tests__/
│   │       ├── claim-step.test.ts
│   │       ├── spawn-step.test.ts
│   │       ├── execute-step.test.ts
│   │       ├── cleanup-step.test.ts
│   │       ├── boundary-guard-step.test.ts
│   │       └── rlm-execute-step.test.ts
│   │
│   └── utils/
│       ├── invariant.ts                  # invariant 上报工具
│       ├── types.ts                      # 包内辅助类型
│       └── index.ts
│
└── DESIGN.md                             # 本文件
```

---

## 9. 与现有代码的关系

### 9.1 从 engine 迁移到 scheduler

现有 `@cortex/engine/src/core/` 中与调度相关的文件：

| 当前路径 | 新路径 | 说明 |
|----------|--------|------|
| `core/scheduler.ts` | `core/scheduler.ts` | 核心实现迁移，IScheduler 接口保留 |
| `core/composite-scheduler.ts` | `core/composite-scheduler.ts` | 组合式调度器迁移 |
| `core/scheduling-types.ts` | `strategy/types.ts` + `driver/types.ts` + `model/types.ts` | 三抽象类型拆分到各子模块 |
| `core/scheduling-implementations.ts` | `strategy/*.ts` + `driver/*.ts` + `model/*.ts` | 各实现拆分到对应子模块 |
| `core/replan-manager.ts` | `core/replan-manager.ts` | 重规划管理迁移 |
| `core/topological-sort.ts` | `core/topological-sort.ts` | 拓扑排序迁移 |
| `core/agent-matcher.ts` | `strategy/tag-matching.ts` 合入 | 标签匹配逻辑合入 TagMatchingStrategy |
| `core/dispatch-steps/*.ts` | `dispatch-steps/*.ts` | 管线步骤迁移 |
| `core/task-board.ts` | **留在 engine** | TaskBoard 是数据存储实现，非调度逻辑 |
| `core/agent-pool.ts` | **留在 engine** | AgentPool 是实例管理器，非调度逻辑 |
| `core/confirm-gate.ts` | **留在 engine** | 确认门是工具箱组件 |
| `core/pipeline-observer.ts` | **留在 engine** | 事件管道是基础设施 |
| `core/trust-model.ts` | **留在 engine** | 信任模型是工具箱组件 |

### 9.2 接口定义位置策略

| 接口 | 定义位置 | 说明 |
|------|----------|------|
| `IScheduler` | **@cortex/scheduler** | 本包对外契约 |
| `IScheduleStrategy` | **@cortex/scheduler** | 本包内部可组合 |
| `ILoopDriver` | **@cortex/scheduler** | 本包内部可组合 |
| `IExecutionModel` | **@cortex/scheduler** | 本包内部可组合 |
| `IDispatchStep` | **@cortex/scheduler** | 本包内部可组合 |
| `ITaskBoard` | **@cortex/shared** | 跨包共享 |
| `ISchedulerAgentPool` | **@cortex/shared** | 跨包共享 |
| `IPipelineObserver` | **@cortex/shared** | 跨包共享 |
| `TaskNode`, `NodeResult` | **@cortex/shared** | 跨包共享 |
| `ExecutionReport` | **@cortex/shared** | 跨包共享 |

### 9.3 迁移后 engine 的变化

```typescript
// @cortex/engine 的 barrel 导出变化：

// ── 旧：engine 自实现调度 ──
export { Scheduler, CompositeScheduler } from "./core/scheduler.js";
export { topologicalSort } from "./core/topological-sort.js";

// ── 新：engine 重导出 scheduler 包 ──
export { Scheduler, CompositeScheduler } from "@cortex/scheduler";
export { ReplanManager } from "@cortex/scheduler";
export {
  TagMatchingStrategy,
  RoundRobinStrategy,
  PriorityFirstStrategy,
  TopologicalLayeredDriver,
  SequentialDriver,
  WaveDriver,
  PipelineModel,
  SimpleExecuteModel,
} from "@cortex/scheduler";
export type {
  IScheduleStrategy,
  ILoopDriver,
  IExecutionModel,
  IScheduler,
  CompositeSchedulerConfig,
} from "@cortex/scheduler";
```

---

## 10. 测试策略

### 10.1 测试金字塔

```
         ╱ ╲
        ╱ e2e ╲              ← 1-2 条集成测试（scheduler + mock pool/board）
       ╱────────╲
      ╱ 集成测试  ╲          ← 各 driver × model 组合测试（5-8 条）
     ╱────────────╲
    ╱  单元测试     ╲        ← 每个 step / strategy / driver / model 单测
   ╱────────────────╲
  ╱  纯逻辑测试       ╲      ← ReplanManager / topological-sort / invariant 无副作用测试
 ╱────────────────────╲
```

### 10.2 纯逻辑测试（最高优先，无 mock）

| 测试 | 文件 | 说明 |
|------|------|------|
| topologicalSort | `topological-sort.test.ts` | DAG 排序、环检测、孤立节点 |
| ReplanManager.enqueue | `replan-manager.test.ts` | 入队/去重/重置 |
| ReplanManager.resolveChains | `replan-manager.test.ts` | 结果链解析 |
| agent-matcher (tag matching 算法) | `tag-matching.test.ts` | 标签打分、别名归一化、平局打破 |

### 10.3 单元测试（每个 step / strategy / driver / model 独立测试）

核心原则：使用 `createMockBoard()` / `createMockPool()` / `createMockObserver()` 工厂函数，不依赖真实实现。

```typescript
// 各 mock 工厂定义在 __tests__/mocks.ts 中
function createMockBoard(initialNodes?: TaskNode[]): jest.Mocked<ITaskBoard>;
function createMockPool(): jest.Mocked<ISchedulerAgentPool>;
function createMockObserver(): jest.Mocked<IPipelineObserver>;
function createMockAgent(agentType: string): jest.Mocked<Agent>;
```

| 模块 | 关键测试场景 |
|------|-------------|
| ClaimStep | 正常认领、已认领拒绝、标签不匹配、multi-perspective 并行认领 |
| SpawnStep | 正常生成、池满拒绝、子任务生成 |
| ExecuteStep | 正常执行、Agent 抛异常、超时 |
| CleanupStep | 正常释放、已释放节点幂等、multi-perspective 部分释放 |
| BoundaryGuardStep | 文件在边界内、越界检测、越界事件上报 |
| RlmExecuteStep | 子任务拆解、密度标注、子任务失败回退 |
| PipelineModel | 完整管线执行、中间步骤失败后 cleanup、multi-perspective 聚合 |
| SimpleExecuteModel | 直接执行、无 Agent 匹配兜底 |
| TopologicalLayeredDriver | 多层执行、重规划队列、超时、循环崩溃恢复 |
| SequentialDriver | 顺序执行、重规划 |
| WaveDriver | 波浪分组、跨波父依赖延迟、自定义波浪定义 |
| TagMatchingStrategy | 精确匹配、标签回退、别名、平局打破 |
| RoundRobinStrategy | 轮转分配、先精确后轮转 |
| PriorityFirstStrategy | 空闲 Agent 优先 |

### 10.4 集成测试（重要组合）

| 组合 | 测试场景 |
|------|---------|
| TagMatching + TopologicalLayered + Pipeline | **黄金路径**：三层依赖，多节点并行，部分失败 |
| TagMatching + Sequential + Simple | **轻量路径**：单 Agent 串行执行简单任务 |
| TagMatching + Wave + Pipeline | **波浪路径**：设计→代码→审查波浪执行 |
| RoundRobin + TopologicalLayered + Pipeline | **负载路径**：多 Agent 轮转分配，无竞争条件 |

### 10.5 边界测试

| 场景 | 说明 |
|------|------|
| 空 TaskBoard | 无节点时 executeAll 立即返回正确 report |
| 全部失败 | 所有节点标记失败，report 正确统计 |
| 环依赖 | topologicalSort 检测环，环中节点标记失败 |
| 全局超时 | 超时后剩余 pending 标记 failed，report 正确 |
| 重规划超限 | 超过 maxReplans 时静默排空，不阻塞 |
| executeAll 重入 | 新 executeAll 调用时取消前一次运行 |
| 超大 DAG (1000+ nodes) | 拓扑排序和分层性能不退化 |
| Multi-perspective 等齐 | 多 Agent 并行执行，最后一个完成时节点 done |

---

## 11. 迁移路线

### Phase 1: 包创建 (Day 1-2)

- [x] 创建 `packages/scheduler/` 目录结构
- [ ] 编写 `package.json`、`tsconfig.json`、`vitest.config.ts`
- [ ] 从 engine 复制调度相关源文件到 scheduler
- [ ] 替换 `@cortex/shared` 的相对导入为包名导入
- [ ] 确认 `pnpm build` 通过
- [ ] 本 DESIGN.md

### Phase 2: 接口提取 (Day 3-5)

- [ ] 将 `ITaskBoard`、`ISchedulerAgentPool` 接口定义提取到 `@cortex/shared`
- [ ] 定义 `IScheduler`、`IScheduleStrategy`、`ILoopDriver`、`IExecutionModel`、`IDispatchStep`
- [ ] 在 scheduler 内部实现纯逻辑版本（无 engine 依赖）
- [ ] 编写全部纯逻辑测试（topological-sort、ReplanManager、agent-matcher）

### Phase 3: 模块拆分 (Day 6-10)

- [ ] 将 `scheduling-types.ts` + `scheduling-implementations.ts` 拆分为 `strategy/`、`driver/`、`model/`
- [ ] 将 `agent-matcher.ts` 合入 `strategy/tag-matching.ts`
- [ ] 每个模块独立测试覆盖
- [ ] 确认三抽象组合可自由搭配

### Phase 4: engine 集成 (Day 11-13)

- [ ] `@cortex/engine` 添加 `@cortex/scheduler` 依赖
- [ ] engine barrel 重导出 scheduler 的所有公开符号
- [ ] engine 的 SchedulerPlugin 改为使用 @cortex/scheduler
- [ ] 确认现有测试全部通过
- [ ] 确认 CI gate 通过

### Phase 5: 收尾 (Day 14-15)

- [ ] 移除 engine 中已迁移的源文件
- [ ] 性能基准对比（迁移前后无退化）
- [ ] 更新架构文档（architecture-report.md）
- [ ] 更新所有 barrel 导出和 tsconfig 路径

---

## 附录 A: 事件关系表

Scheduler 发射的事件（通过 PipelineObserver.emit）：

| 事件 | 时机 | 优先级 |
|------|------|--------|
| `SchedulerLayerStart` | 每层开始执行前 | HIGH |
| `SchedulerLoopCrashed` | 循环崩溃/超时 | CRITICAL |
| `SchedulerDone` | executeAll 正常退出 | CRITICAL |
| `SchedulerReplanLimit` | 重规划达上限 | HIGH |
| `SchedulerReplanNoMetaAgent` | 重规划队列有数据但无 MetaAgent | CRITICAL |
| `SchedulerReplanFailed` | MetaAgent.requestReplan 失败 | CRITICAL |
| `SchedulerNonstandardType` | 节点类型无精确匹配 | NORMAL |
| `SchedulerInvariantViolation` | 调度不变量违反 | CRITICAL |
| `NodeStart` | 单节点开始执行 | HIGH |
| `NodeComplete` | 单节点执行成功 | HIGH |
| `NodeFailed` | 单节点执行失败 | CRITICAL |
| `NodeReplan` | 节点进入重规划 | HIGH |
| `NodeReplanQueued` | 重规划请求入队 | HIGH |
| `NodeSpawnFailed` | Agent 实例生成失败 | CRITICAL |
| `ManifoldGateWaitStart` | 槽位等待开始 | NORMAL |
| `ManifoldGateWaitEnd` | 槽位等待结束 | NORMAL |
| `ManifoldGateAcquireTimeout` | 槽位获取超时 | CRITICAL |
| `ManifoldGateReleased` | 流控槽位释放 | NORMAL |

## 附录 B: 关键设计决策记录

### ADR-001: 三抽象组合 vs 单 Scheduler 类

**决策**: 同时保留两种形态——`Scheduler`（原始单类）和 `CompositeScheduler`（三抽象组合）。

**理由**:
- `Scheduler` 是现有行为，迁移初期作为"不改动就能跑"的基线
- `CompositeScheduler` 提供组合灵活性，扩展点清晰
- 两者均实现 `IScheduler`，可互相替换，不破坏调用方

### ADR-002: 接口定义位置

**决策**: `ITaskBoard` / `ISchedulerAgentPool` / `IPipelineObserver` 留在 `@cortex/shared`，`IScheduler` / 三抽象接口定义在 `@cortex/scheduler`。

**理由**:
- `ITaskBoard` 和 `ISchedulerAgentPool` 由 engine 实现，scheduler 消费——定义在 shared 避免循环依赖
- `IScheduler` 是 scheduler 对外的契约，定义在 scheduler 是本包自包含的
- 三抽象接口是 scheduler 内部组合机制，定义在 scheduler 避免 pollute shared

### ADR-003: DispatchStep 管线 vs 硬编码分发

**决策**: 保留 `IDispatchStep` 管线模式，但不将其作为第四抽象暴露给外部。

**理由**:
- 管线步骤是 PipelineModel 的内部实现细节，外部不应感知
- 通过 IExecutionModel 抽象即可完成执行范式的替换
- 减少 API surface，降低认知负担

### ADR-004: 文件边界守卫放在 scheduler 还是 engine

**决策**: `BoundaryGuardStep` 留在 scheduler 的 `dispatch-steps/` 中。

**理由**:
- 文件边界守卫是分发管线的一步，与调度执行逻辑紧耦合
- 它依赖 PipelineObserver 和 Agent 输出，属于分发管线的标准环节
- 不依赖 engine 特定功能（Toolkit / FileSystemAdapter）

### ADR-005: ReplanManager 是否保留

**决策**: 保留，从 engine 迁移到 scheduler。

**理由**:
- ReplanManager 是纯逻辑组件，不依赖 engine 特定实现
- 其输入是 IMetaAgent 接口（可选），输出是 TaskNode[] 注入 TaskBoard
- 职责清晰（去重排队 + 调用重规划 + 结果解析），适合放在 scheduler

---

> **本文档基于 Cortex v2.9 调度系统现状编写，结合 v3.x 独立包演化路线。**
> 参考: `packages/engine/src/core/scheduler.ts`, `composite-scheduler.ts`, `scheduling-types.ts`, `dispatch-steps/`
