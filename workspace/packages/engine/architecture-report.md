# FSM 编译器架构：三层抽象设计与 Monorepo 共享类型分析

> **分析周期**: 2026.06.16  
> **分析范围**: `@cortex/shared` → `@cortex/engine` → `@cortex/factory`  
> **状态**: 综合审计完成

---

## 目录

1.  [Monorepo 共享类型全景分析](#1-monorepo-共享类型全景分析)
2.  [现有 FSM 模式目录](#2-现有-fsm-模式目录)
3.  [三层 FSM 编译器架构](#3-三层-fsm-编译器架构)
4.  [层一：DSL 描述层（规范层）](#4-层一dsl-描述层规范层)
5.  [层二：代码生成层（推导层）](#5-层二代码生成层推导层)
6.  [层三：运行时解释层（执行层）](#6-层三运行时解释层执行层)
7.  [三层的联通契约](#7-三层的联通契约)
8.  [与现有系统的集成策略](#8-与现有系统的集成策略)
9.  [API Surface 提案](#9-api-surface-提案)

---

## 1. Monorepo 共享类型全景分析

### 1.1 包依赖拓扑

```
@cortex/shared          ← 零依赖基座（枚举/接口/纯类型）
    ↑         ↑
@cortex/factory         ← 配置加载（依赖 shared）
@cortex/config          ← 引擎配置常量（依赖 shared）
    ↑         ↑
@cortex/engine          ← 运行时核心（依赖 shared + factory + config）
@cortex/llm             ← LLM 适配器（依赖 shared）
```

### 1.2 @cortex/shared 类型域清单（21 个模块）

| 模块 | 核心类型 | 用途 |
|------|----------|------|
| `agent-enums.ts` | `AgentType`, `AgentStatus`, `AgentContext` | Agent 枚举 | 
| `agent.ts` | 桶导出 | 整合导出 |
| `agent-tags.ts` | `Tag`, `TAG_VOCABULARY`, `AGENT_TAGS` | 标签词汇表 |
| `agent-permissions.ts` | `AGENT_TOOL_PERMISSIONS` | 工具权限表 |
| `agent-skill-types.ts` | `SkillTemplate`, `SkillKind`, `FeedbackEntry` | 技能模板 |
| `agent-protocols.ts` | `Agent`, `Executable`, `MemoryAware`, `AgentConfig` | 能力协议 |
| `agent-display.ts` | `AgentDisplay` 类型 | 展示信息 |
| `task.ts` | `TaskNode`, `NodeResult`, `SubTask`, `ExecutionReport` | 任务管线 |
| `memory.ts` | `MemoryEntry`, `MemoryQuery`, `IMemoryStore`, `LinkType` | 记忆系统 |
| `context-policy.ts` | `ContextPolicy`, `ConversationPolicy`, `RetrievalPolicy` | 上下文策略 |
| `toolkit.ts` | `Tool`, `ToolDefinition`, `ReversibilityLevel`, `ITrustModel` | 工具系统 |
| `infra.ts` | 基础设施类型 | 通用工具 |
| `fs-adapter.ts` | `IFileSystemAdapter` | 文件系统抽象 |
| `skill-registry.ts` | `ISkillRegistry` | 技能注册表 |
| `modification-record.ts` | `ModificationRecord` | 修改记录 |
| `doc-registry.ts` | `DocRegistry` 类型 | 文档注册 |
| `amendment.ts` | `AmendmentProposal`, `JudgmentResult`, `AmendmentStatus` | 修宪系统 |
| `kv-store.ts` | `KVStore` 类型 | 键值存储 |
| `file-lock-manager.ts` | 文件锁类型 | 并发写入控制 |
| `cli-adapter.ts` | `ICLIAdapter` | CLI 抽象 |
| `context-policy.ts` | `PRESET_CONTEXT_POLICIES` | 预设策略库 |

### 1.3 类型契约分析

**稳定契约**（跨包依赖的公共 API Surface）:

| 契约 | 定义包 | 消费包 | 稳定性 |
|------|--------|--------|--------|
| `Agent` 接口 | shared | engine, llm, cli | 稳定 |
| `TaskNode` | shared | engine, cli | 稳定 |
| `MemoryEntry` | shared | engine, llm | 稳定 |
| `IMemoryStore` | shared | engine | 稳定 |
| `ContextPolicy` | shared | engine, config | 稳定 |
| `AgentDefinition` | factory | engine | 稳定 |
| `BootstrapResult` | factory | engine, cli | 稳定 |

---

## 2. 现有 FSM 模式目录

代码库中已存在 6 个显式 FSM（有限状态机）模式：

### 2.1 Agent 生命周期 FSM

**位置**: `@cortex/engine/src/core/agent-pool.ts` L90-L98  
**定义**: `AgentPool.VALID_TRANSITIONS`

```
Created ──→ Awake ──→ Active ──→ Draining ──→ Destroyed
               ↑          │
               └──────────┘ (Active→Awake 回退)
               Active→Active (no-op, 同一实例并发分发)
```

**状态**: 5 个  
**流转表**: `Record<AgentStatus, Set<AgentStatus>>`  
**校验**: 运行时 `setStatus()` 查表，拒绝非法流转  
**消费者**: `PoolAwareState`（共享组件）、`BaseAgent`、`AgentFactory`  

### 2.2 TaskNode 任务节点 FSM

**位置**: `@cortex/shared/src/task.ts` L62-L66  
**定义**: `TaskNode.status`

```
pending ──→ claimed ──→ running ──→ done
                │                      ↑
                └─── running ───→ failed
```

**状态**: 5 个（pending / claimed / running / done / failed）  
**管理**: `TaskBoard`（原子 claim/complete/failNode）  
**并发模式**: needsMultiPerspective 允许多 Agent 并行认领，全部完成后等齐置 done  

### 2.3 修宪提案 FSM

**位置**: `@cortex/shared/src/amendment.ts` L54-L59  
**定义**: `AmendmentStatus`

```
draft ──→ pending_judgment ──→ approved ──→ applied
                                rejected
                          (NEEDS_CLARIFICATION 回退到 draft)
```

**状态**: 5 个  
**管理**: `GovernancePipeline`（阶段编排）  

### 2.4 记忆语义状态 FSM

**位置**: `@cortex/shared/src/memory.ts` L33  
**定义**: `SemanticState`

```
Active ──→ Archived ──→ Obliterated
```

**状态**: 3 个  
**操作**: `IMemoryStore.cas(memoryId, expected, newState)` — CAS 原子操作  
**并行语义**: CAS 模式确保并发安全，`_pending` 两阶段提交  

### 2.5 PipelineRunner IStep 管道

**位置**: `@cortex/engine/src/core/pipeline-runner.ts`  
**定义**: `IStep` 接口 + `PipelineRunner.run(steps, ctx)`  

```
// 默认管道
MemoryRetrieval → ReActLoop → MemoryWrite

// 直接管道（无记忆）
DirectStep → MemoryWrite

// 调度分发管道（Dispatch Pipeline）
Claim → Spawn → Execute → BoundaryGuard → Cleanup
```

**设计模式**: 线性管道（Sequential Pipeline），不是严格 FSM，但每一步的输出决定后续路径

### 2.6 组合调度器三抽象

**位置**: `@cortex/engine/src/core/scheduling-types.ts`  
**三抽象**: `IScheduleStrategy` × `ILoopDriver` × `IExecutionModel`  

| 抽象 | 实现 | 职责 |
|------|------|------|
| `IScheduleStrategy` | TagMatching / RoundRobin / PriorityFirst | 节点→Agent 匹配 |
| `ILoopDriver` | TopologicalLayered / Sequential / Wave | 循环推进方式 |
| `IExecutionModel` | Pipeline / SimpleExecute | 单节点执行范式 |

---

## 3. 三层 FSM 编译器架构

### 3.1 架构总览

```
┌──────────────────────────────────────────────────────────┐
│                    DSL 描述层（规范层）                     │
│  @cortex/fsm/dsl                                           │
│                                                            │
│  FsmSchema       StateMachineSpec     TransitionGraph      │
│  ┌──────────┐    ┌────────────────┐   ┌───────────────┐   │
│  │ states[] │    │ transitions[]   │   │ guards        │   │
│  │ initial  │    │ on<event>→state │   │ actions       │   │
│  │ final[]  │    │ guards         │   │ context       │   │
│  └──────────┘    └────────────────┘   └───────────────┘   │
│                                                            │
│  为每个存在的 FSM 提供声明式 DSL（JSON/YAML/TypeScript）     │
├──────────────────────────────────────────────────────────┤
│                    代码生成层（推导层）                       │
│  @cortex/fsm/codegen                                        │
│                                                            │
│  FsmCompiler       TypeEmitter        ValidatorGenerator    │
│  ┌──────────┐      ┌──────────┐       ┌──────────────┐    │
│  │ DSL→AST  │      │ AST→TS   │       │ 流程序列化   │    │
│  │ AST→stmt │      │ 类型推导 │       │ 流转表生成   │    │
│  └──────────┘      └──────────┘       └──────────────┘    │
│                                                            │
│  从 DSL 编译为：类型定义 + 流转表 + 校验函数 + 文档           │
├──────────────────────────────────────────────────────────┤
│                    运行时解释层（执行层）                      │
│  @cortex/fsm/runtime                                        │
│                                                            │
│  FsmRuntime        StateMachine      TransitionEngine       │
│  ┌──────────┐      ┌─────────────┐    ┌──────────────┐    │
│  │ 执行引擎 │      │ 当前状态    │    │ 流转决策     │    │
│  │ 事件队列 │      │ 上下文状态  │    │ Guard 评估   │    │
│  │ 中间件  │      │ 历史轨迹    │    │ Action 执行  │    │
│  └──────────┘      └─────────────┘    └──────────────┘    │
│                                                            │
│  运行时加载编译产物，提供高性能解释执行                        │
├──────────────────────────────────────────────────────────┤
│                    桥接层（现有系统适配）                      │
│  @cortex/fsm/bridge                                         │
│                                                            │
│  AgentLifecycleAdapter   TaskBoardAdapter   MemoryAdapter   │
│  GovernanceAdapter       PipelineAdapter                    │
└──────────────────────────────────────────────────────────┘
```

### 3.2 设计原则

1. **声明式 > 命令式**: FSM 用 DSL 描述，代码生成器推导实现
2. **编译时 > 运行时**: 尽可能在编译阶段完成流转表生成、类型推导、校验代码生成
3. **正交性**: 三层职责不重叠 — DSL 只描述、Codegen 只推导、Runtime 只执行
4. **渐进增强**: 现有代码不经重写即可通过桥接层接入
5. **可组合**: 子状态机嵌套 → 复合状态机（Hierarchical State Machine）

---

## 4. 层一：DSL 描述层（规范层）

### 4.1 FsmSchema 核心类型

```typescript
// ─── 基础 ────────────────────────────────────────

/** 状态定义 */
interface StateDef {
  id: string;                    // 状态唯一标识（如 "pending", "Awake"）
  label?: string;                // 人类可读标签
  description?: string;          // 用途描述
  type?: "normal" | "initial" | "final";
  metadata?: Record<string, unknown>;
}

/** 事件定义 */
interface EventDef {
  id: string;                    // 事件标识（如 "CLAIM", "SPAWN", "COMPLETE"）
  label?: string;
  payload?: Record<string, unknown>;  // 事件载荷 schema
}

/** Guard 条件 */
interface GuardDef {
  id: string;
  expression: string;            // 条件表达式（如 "status === 'pending'"）
  description?: string;
}

/** Action 副作用 */
interface ActionDef {
  id: string;
  expression: string;            // 动作表达式
  async?: boolean;               // 是否异步
}

/** 流转规则 */
interface TransitionDef {
  from: string;                  // 源状态
  to: string;                    // 目标状态
  on: string;                    // 触发事件
  guard?: string;                // Guard 条件引用
  actions?: string[];            // Action 引用列表
  priority?: number;             // 同一事件多目标时的优先级
  description?: string;
}
```

### 4.2 状态机规范

```typescript
interface StateMachineSpec {
  /** 元数据 */
  id: string;
  name: string;
  version: string;
  description?: string;
  
  /** 定义 */
  states: StateDef[];
  events: EventDef[];
  transitions: TransitionDef[];
  guards?: GuardDef[];
  actions?: ActionDef[];
  
  /** 初始与终结 */
  initialState: string;
  finalStates: string[];
  
  /** 扩展 */
  context?: Record<string, unknown>;  // 上下文 schema
  plugins?: string[];                 // 插件引用
  metadata?: {
    tags?: string[];
    author?: string;
    since?: string;
  };
}
```

### 4.3 现有 FSM 的 DSL 映射

#### 4.3.1 Agent 生命周期（Agent Lifecycle）

```yaml
id: "agent-lifecycle"
name: "Agent 生命周期状态机"
version: "2.0.0"

states:
  - { id: "Created",    type: "initial",  description: "实例已创建" }
  - { id: "Awake",      type: "normal",   description: "实例已就绪" }
  - { id: "Active",     type: "normal",   description: "执行中" }
  - { id: "Draining",   type: "normal",   description: "排空中" }
  - { id: "Destroyed",  type: "final",    description: "已销毁" }

events:
  - { id: "WAKE_UP",       label: "唤醒" }
  - { id: "ACTIVATE",      label: "激活执行" }
  - { id: "DEACTIVATE",    label: "回到就绪" }
  - { id: "START_DRAIN",   label: "开始排空" }
  - { id: "DESTROY",       label: "销毁" }

transitions:
  - { from: "Created",   to: "Awake",     on: "WAKE_UP" }
  - { from: "Created",   to: "Destroyed", on: "DESTROY" }
  - { from: "Awake",     to: "Active",    on: "ACTIVATE" }
  - { from: "Awake",     to: "Draining",  on: "START_DRAIN" }
  - { from: "Active",    to: "Awake",     on: "DEACTIVATE" }
  - { from: "Active",    to: "Draining",  on: "START_DRAIN" }
  - { from: "Active",    to: "Active",    on: "ACTIVATE" }  # no-op
  - { from: "Draining",  to: "Destroyed", on: "DESTROY" }
```

#### 4.3.2 任务节点 FSM（TaskNode Lifecycle）

```yaml
id: "task-node"
name: "任务节点状态机"
version: "2.0.0"

states:
  - { id: "pending",  type: "initial", description: "待调度" }
  - { id: "claimed",  type: "normal",  description: "已认领" }
  - { id: "running",  type: "normal",  description: "执行中" }
  - { id: "done",     type: "final",   description: "完成" }
  - { id: "failed",   type: "final",   description: "失败" }

events:
  - CLAIM, RELEASE, COMPLETE, FAIL, SPAWN

transitions:
  - { from: "pending", to: "claimed", on: "CLAIM" }
  - { from: "claimed", to: "pending", on: "RELEASE" }
  - { from: "claimed", to: "running", on: "SPAWN" }
  - { from: "running", to: "done",    on: "COMPLETE" }
  - { from: "running", to: "failed",  on: "FAIL" }
  - { from: "pending", to: "failed",  on: "FAIL" }  # 调度前失败
```

#### 4.3.3 修宪提案 FSM（Amendment Lifecycle）

```yaml
id: "amendment"
name: "修宪提案生命周期"
version: "1.0.0"

states:
  - { id: "draft",              type: "initial", description: "Agent 草稿中" }
  - { id: "pending_judgment",   type: "normal",  description: "待昔涟评判" }
  - { id: "approved",           type: "normal",  description: "开拓者裁决通过" }
  - { id: "rejected",           type: "final",   description: "开拓者裁决驳回" }
  - { id: "applied",            type: "final",   description: "已写入宪法" }

events:
  - SUBMIT, APPROVE, REJECT, REDRAFT, APPLY

transitions:
  - { from: "draft",            to: "pending_judgment", on: "SUBMIT" }
  - { from: "pending_judgment", to: "approved",         on: "APPROVE" }
  - { from: "pending_judgment", to: "rejected",         on: "REJECT" }
  - { from: "pending_judgment", to: "draft",            on: "REDRAFT" }  # NEEDS_CLARIFICATION
  - { from: "approved",         to: "applied",          on: "APPLY" }
```

---

## 5. 层二：代码生成层（推导层）

### 5.1 编译流水线

```
DSL (YAML/JSON/TS)
    │
    ▼
┌──────────────────────────┐
│  FsmCompiler.parse()      │  DSL → AST
│  - 词法分析               │
│  - 语法分析               │
│  - 语义校验               │
│  - 引用解析               │
└──────────┬───────────────┘
           │ FsmAst
           ▼
┌──────────────────────────┐
│  FsmCompiler.validate()   │  AST 校验
│  - 状态可达性分析         │
│  - 死锁检测               │
│  - 非法流转检测           │
│  - 初始/终结态完备性      │
└──────────┬───────────────┘
           │ ValidatedAst
           ▼
┌──────────────────────────┐
│  CodeGenerator            │  AST → 代码
│  ├─ TypeEmitter           │  → *.ts (类型定义)
│  ├─ TransitionTableGen    │  → *.transitions.ts (流转表)
│  ├─ GuardGenerator        │  → *.guards.ts (校验函数)
│  ├─ DocGenerator          │  → *.md (文档)
│  └─ Visualizer            │  → *.mermaid (可视化)
└──────────┬───────────────┘
           │ CodeTarget
           ▼
┌──────────────────────────┐
│  ArtifactWriter           │  写入包结构
│  - 编译器产物             │
│  - 运行时产物             │
│  - 文档产物               │
└──────────────────────────┘
```

### 5.2 生成产物

```typescript
// ============================================================
// 示例：从 Agent 生命周期 DSL 生成的代码
// ============================================================

// ─── Types (agent-lifecycle.types.ts) ──────────────────────

/** 状态字面量联合类型（编译时推导） */
export type AgentLifecycleState =
  | "Created"
  | "Awake"
  | "Active"
  | "Draining"
  | "Destroyed";

/** 事件字面量联合类型 */
export type AgentLifecycleEvent =
  | "WAKE_UP"
  | "ACTIVATE"
  | "DEACTIVATE"
  | "START_DRAIN"
  | "DESTROY";

/** 状态上下文类型 */
export interface AgentLifecycleContext {
  instanceId?: string;
  agentType?: string;
  poolRef?: unknown;
  safeReporter?: SafeErrorReporter;
}

// ─── Transition Table (agent-lifecycle.transitions.ts) ────

import { AgentLifecycleState, AgentLifecycleEvent } from "./agent-lifecycle.types.js";

interface TransitionEntry {
  from: AgentLifecycleState;
  to: AgentLifecycleState;
  event: AgentLifecycleEvent;
  guard?: string;
  action?: string;
}

/** 编译生成的流转表 */
export const AGENT_LIFECYCLE_TRANSITIONS: Record<
  AgentLifecycleState,
  Partial<Record<AgentLifecycleEvent, { to: AgentLifecycleState; guard?: string; action?: string }>>
> = {
  Created: {
    WAKE_UP:  { to: "Awake" },
    DESTROY:  { to: "Destroyed" },
  },
  Awake: {
    ACTIVATE:     { to: "Active" },
    START_DRAIN:  { to: "Draining" },
  },
  Active: {
    DEACTIVATE:   { to: "Awake" },
    START_DRAIN:  { to: "Draining" },
    ACTIVATE:     { to: "Active" },  // no-op
  },
  Draining: {
    DESTROY:      { to: "Destroyed" },
  },
  Destroyed: {},  // 终态，无外发流转
};

// ─── Validator (agent-lifecycle.validators.ts) ────────────

/** 运行时流转校验函数 */
export function validateAgentLifecycleTransition(
  from: AgentLifecycleState,
  event: AgentLifecycleEvent,
): AgentLifecycleState | null {
  const row = AGENT_LIFECYCLE_TRANSITIONS[from];
  if (!row) return null;
  const entry = row[event];
  if (!entry) return null;
  return entry.to;  // Guard 评估由调用方负责
}

/** 可达性分析 */
export function isFinalState(state: AgentLifecycleState): boolean {
  return state === "Destroyed";
}

export function isInitialState(state: AgentLifecycleState): boolean {
  return state === "Created";
}
```

### 5.3 编译时验证规则

| 规则 | 描述 | 检测方式 |
|------|------|----------|
| V1 — 状态完备性 | 所有状态有唯一 ID，initial/final 不重复 | 静态分析 |
| V2 — 流转完备性 | 非终态至少有一条出边 | 图遍历 |
| V3 — 可达性 | 所有状态从 initial 可达 | BFS |
| V4 — 无死锁 | 非终态不可在无事件时卡死 | 条件分析 |
| V5 — 无歧义 | 同一事件/源状态无多目标（或 priority 消歧） | 冲突检测 |
| V6 — 事件定义覆盖 | 所有 transition.on 引用的事件在 events[] 中 | 引用校验 |
| V7 — Guard 引用完整性 | guard 引用在 guards[] 中存在 | 引用校验 |
| V8 — 循环检测 | 非 final 自环需显式标注（no-op） | 环路分析 |

---

## 6. 层三：运行时解释层（执行层）

### 6.1 运行时架构

```typescript
// ─── 核心执行引擎 ────────────────────────────────

interface FsmEngine {
  /** 加载编译器产物 */
  load(spec: CompiledFsm): void;
  
  /** 创建状态机实例 */
  createInstance(initialContext?: Record<string, unknown>): FsmInstance;
  
  /** 注册中间件 */
  use(middleware: FsmMiddleware): void;
  
  /** 注册插件 */
  plugin(plugin: FsmPlugin): void;
}

interface FsmInstance {
  /** 当前状态 */
  readonly state: string;
  
  /** 上下文（运行时可变状态） */
  readonly context: Record<string, unknown>;
  
  /** 发送事件 */
  send(event: string, payload?: unknown): Promise<void>;
  
  /** 订阅状态变更 */
  onStateChange(listener: (from: string, to: string, event: string) => void): () => void;
  
  /** 订阅事件 */
  onEvent(listener: (event: string, payload?: unknown) => void): () => void;
  
  /** 获取历史轨迹 */
  getHistory(): StateTransition[];
  
  /** 检查是否在某个状态 */
  is(state: string): boolean;
  
  /** 检查状态可达 */
  can(event: string): boolean;
  
  /** 重置到初始状态 */
  reset(): void;
  
  /** 快照（序列化当前状态） */
  snapshot(): FsmSnapshot;
  
  /** 从快照恢复 */
  restore(snapshot: FsmSnapshot): void;
}

interface StateTransition {
  from: string;
  to: string;
  event: string;
  timestamp: number;
  payload?: unknown;
}

interface FsmSnapshot {
  state: string;
  context: Record<string, unknown>;
  history: StateTransition[];
  timestamp: number;
}
```

### 6.2 中间件架构

与现有 `PipelineObserver` / `PipelineRunner.IStep` 模式对齐：

```typescript
interface FsmMiddleware {
  name: string;
  
  /** 事件预处理（可阻止事件传播或修改 payload） */
  beforeEvent?: (event: string, payload?: unknown) => 
    { event: string; payload?: unknown } | null;  // null = 阻止
  
  /** 流转前钩子（可阻止本次流转） */
  beforeTransition?: (from: string, to: string, event: string, context: Record<string, unknown>) =>
    boolean | Promise<boolean>;
  
  /** 流转后钩子 */
  afterTransition?: (from: string, to: string, event: string, context: Record<string, unknown>) =>
    void | Promise<void>;
  
  /** 错误处理 */
  onError?: (error: Error, event: string, state: string) => 
    { recover?: string } | undefined;  // recover = 恢复目标状态
}
```

### 6.3 Guard 评估引擎

```typescript
// Guard 定义转为运行时函数
interface GuardEvaluator {
  /** 注册 Guard */
  register(id: string, fn: (context: Record<string, unknown>, payload?: unknown) => boolean): void;
  
  /** 评估 Guard */
  evaluate(
    guardId: string,
    context: Record<string, unknown>,
    payload?: unknown,
  ): boolean;
}

// 示例：AgentPool 的 MAX_INSTANCES Guard
const poolGuard = (ctx: { activeCount?: number; maxInstances?: number }) => {
  return (ctx.activeCount ?? 0) < (ctx.maxInstances ?? 1);
};
```

### 6.4 子状态机（嵌套 FSM）

```typescript
interface HierarchicalState {
  id: string;
  /** 子状态机引用（嵌套 FSM） */
  submachine?: string;  // 引用另一个 StateMachineSpec.id
}

// 示例：TaskNode 在 "running" 态时进入子状态机
// SubFsm: TaskExecution
//   spawned → executing → completing
```

---

## 7. 三层的联通契约

### 7.1 契约边界

```
DSL 层 ─── compile() ──→ CompiledFsm ──→ 代码生成层 ──→ 代码产物
                           ↑                              │
                           │                              │ load()
                           │                              ▼
                           └──────────── CompiledFsm ──→ 运行时层
```

**中间契约：`CompiledFsm`**

```typescript
interface CompiledFsm {
  /** 元数据 */
  id: string;
  name: string;
  version: string;
  
  /** 编译时产物 */
  types: {
    stateUnion: string;       // "Created | Awake | Active | Draining | Destroyed"
    eventUnion: string;       // "WAKE_UP | ACTIVATE | ..."
    contextType: string;      // 上下文类型字符串表示
  };
  
  /** 流转表（用于运行时查表，与 Codegen 产物同构） */
  transitionTable: TransitionTableJson;
  
  /** Guard 函数映射（序列号为字符串，运行时反序列化） */
  guards: Record<string, GuardSerialized>;
  
  /** 初始状态 */
  initialState: string;
  
  /** 终结状态集 */
  finalStates: string[];
  
  /** 状态元数据 */
  stateMetadata: Record<string, StateDef>;
  
  /** 事件元数据 */
  eventMetadata: Record<string, EventDef>;
  
  /** 图结构（可达性分析用） */
  graph: {
    adjacency: Record<string, string[]>;  // state → reachable states
    transitions: TransitionDef[];
  };
}
```

### 7.2 代码生成产物清单

| 文件 | 内容 | 格式 |
|------|------|------|
| `<id>.types.ts` | 状态/事件联合类型 + Context 接口 | TypeScript |
| `<id>.transitions.ts` | 流转表（`Record<State, Record<Event, Target>>`） | TypeScript |
| `<id>.validators.ts` | 运行时校验函数 | TypeScript |
| `<id>.spec.json` | 序列化的 CompiledFsm 契约 | JSON |
| `<id>.mermaid.md` | 可视化状态图 | Mermaid |
| `<id>.api.md` | API 文档 | Markdown |

---

## 8. 与现有系统的集成策略

### 8.1 桥接层设计

```
FSM 编译器（三层）               现有系统
                           ┌────────────────┐
  DSL → Codegen → Runtime │ AgentPool       │
      │                    │ BaseAgent       │
      │  bridge/           │ PoolAwareState  │
      │                    │ (VALID_TRANSITIONS)
      ├──→ AgentLifecycleAdapter ──→ 替换 PoolAwareState
      │                    │                │
      ├──→ TaskNodeAdapter ──→ 替换 TaskBoard.complete() 条件逻辑
      │                    │                │
      ├──→ GovernanceAdapter ──→ GovernancePipeline 阶段编排
      │                    │                │
      └──→ PipelineAdapter ──→ PipelineRunner IStep 组合
                           └────────────────┘
```

### 8.2 渐进替代路径（不破坏现有代码）

| 阶段 | 内容 | 风险等级 | 适配方式 |
|------|------|----------|----------|
| P0 | Agent 生命周期 FSM → DSL + 生成 | 低 | `PoolAwareState.transition()` 改为调用生成的校验函数 |
| P1 | TaskNode 状态机 → DSL + 生成 | 低 | `TaskBoard.claim/complete/failNode` 内部使用生成的流转表 |
| P2 | 修宪提案 FSM → DSL + 生成 | 低 | `AmendmentStatus` 改用生成的类型 |
| P3 | GovernancePipeline → FSM 运行时 | 中 | 用 FSM 中间件替代 hardcoded 阶段编排 |
| P4 | Memory SemanticState → FSM 运行时 | 低 | CAS 操作保持，内部用 FSM 引擎校验 |
| P5 | CompositeScheduler 三抽象 → DSL 描述 | 中 | 调度组合配置用 DSL 声明 |

### 8.3 与 PipelineRunner 的融合

现有 `PipelineRunner` 是线性 IStep 管道，可以优雅扩展为 FSM 驱动：

```typescript
// 现有模式
const steps: IStep[] = [new ClaimStep(), new SpawnStep(), new ExecuteStep()];
const result = await PipelineRunner.run(steps, ctx);

// FSM 增强模式
// 将 Step 链映射为状态机
const dispatchFsm: StateMachineSpec = {
  id: "dispatch-pipeline",
  states: [
    { id: "init", type: "initial" },
    { id: "claimed" },
    { id: "spawned" },
    { id: "executed" },
    { id: "guarded" },
    { id: "completed", type: "final" },
    { id: "failed", type: "final" },
  ],
  events: [
    { id: "CLAIM_DONE" },
    { id: "SPAWN_DONE" },
    { id: "EXECUTE_DONE" },
    { id: "GUARD_CHECK" },
    { id: "CLEANUP_DONE" },
    { id: "ERROR" },
  ],
  transitions: [
    // 主路径
    { from: "init",      to: "claimed",   on: "CLAIM_DONE" },
    { from: "claimed",   to: "spawned",   on: "SPAWN_DONE" },
    { from: "spawned",   to: "executed",  on: "EXECUTE_DONE" },
    { from: "executed",  to: "guarded",   on: "GUARD_CHECK" },
    { from: "guarded",   to: "completed", on: "CLEANUP_DONE" },
    // 失败路径
    { from: "claimed",   to: "failed",    on: "ERROR" },
    { from: "spawned",   to: "failed",    on: "ERROR" },
    { from: "executed",  to: "failed",    on: "ERROR" },
  ],
};
```

每个 IStep 跑完 emit 事件 → FSM 引擎推进状态 → 决定下一步。这在保留现有 Step 接口的同时引入了确定性状态管理。

---

## 9. API Surface 提案

### 9.1 `@cortex/fsm` 包结构

```
@cortex/fsm/
├── package.json
├── src/
│   ├── index.ts                    # 桶导出
│   ├── dsl/
│   │   ├── index.ts
│   │   ├── schema.ts              # FsmSchema + StateMachineSpec 类型
│   │   ├── parser.ts              # DSL 解析器（YAML/JSON → AST）
│   │   └── validator.ts           # DSL 语义校验
│   ├── codegen/
│   │   ├── index.ts
│   │   ├── compiler.ts            # FsmCompiler（AST → 多目标代码）
│   │   ├── type-emitter.ts        # TypeEmitter（类型定义生成）
│   │   ├── table-emitter.ts       # TransitionTableGen（流转表生成）
│   │   ├── guard-emitter.ts       # GuardGenerator（校验函数生成）
│   │   ├── doc-emitter.ts         # DocGenerator（文档生成）
│   │   └── visualizer.ts          # Mermaid 可视化
│   ├── runtime/
│   │   ├── index.ts
│   │   ├── engine.ts              # FsmEngine + FsmInstance
│   │   ├── middleware.ts          # FsmMiddleware
│   │   ├── guard-evaluator.ts     # GuardEvaluator
│   │   └── snapshot.ts            # FsmSnapshot + 序列化
│   ├── bridge/
│   │   ├── index.ts
│   │   ├── agent-lifecycle.ts     # AgentPool ↔ FSM 桥接
│   │   ├── task-node.ts           # TaskBoard ↔ FSM 桥接
│   │   ├── governance.ts          # GovernancePipeline ↔ FSM 桥接
│   │   └── pipeline.ts            # PipelineRunner ↔ FSM 桥接
│   └── specs/                     # 内置 DSL 定义
│       ├── agent-lifecycle.yaml
│       ├── task-node.yaml
│       ├── amendment.yaml
│       └── memory-state.yaml
```

### 9.2 公开类型

```typescript
// ── DSL 层 ──
export { StateDef, EventDef, GuardDef, ActionDef, TransitionDef } from "./dsl/schema.js";
export { StateMachineSpec } from "./dsl/schema.js";
export { FsmParser } from "./dsl/parser.js";
export { FsmDslValidator } from "./dsl/validator.js";

// ── 代码生成层 ──
export { FsmCompiler } from "./codegen/compiler.js";
export { TypeEmitter } from "./codegen/type-emitter.js";
export { TransitionTableGen } from "./codegen/table-emitter.js";
export { GuardGenerator } from "./codegen/guard-emitter.js";
export { DocGenerator } from "./codegen/doc-emitter.js";
export { Visualizer } from "./codegen/visualizer.js";
export { CompiledFsm } from "./codegen/compiler.js";

// ── 运行时层 ──
export { FsmEngine } from "./runtime/engine.js";
export { FsmInstance } from "./runtime/engine.js";
export { FsmMiddleware } from "./runtime/middleware.js";
export { GuardEvaluator } from "./runtime/guard-evaluator.js";
export { FsmSnapshot, StateTransition } from "./runtime/snapshot.js";

// ── 桥接层 ──
export { AgentLifecycleAdapter } from "./bridge/agent-lifecycle.js";
export { TaskNodeAdapter } from "./bridge/task-node.js";
export { GovernanceFsmAdapter } from "./bridge/governance.js";
export { PipelineFsmAdapter } from "./bridge/pipeline.js";
```

---

## 附录 A：现有 FSM 模式的直接映射收益

| 现有模式 | 当前痛点 | FSM 编译器收益 |
|----------|----------|---------------|
| `AgentPool.VALID_TRANSITIONS` (硬编码 Record) | 流转逻辑散落在 AgentPool + PoolAwareState + BaseAgent | 单一 DSL 源→编译产物→三方引用 |
| `TaskBoard.claim/complete` (if-else 条件逻辑) | 状态转移条件隐式在方法内，难以审计 | 显式流转表 + Guard 声明 |
| `AmendmentStatus` (字符串联合类型) | 无运行时校验，需手动 if 判断合法性 | 编译后生成校验函数 |
| `GovernancePipeline` (硬编码阶段编排) | 阶段顺序不可配置，扩展需改代码 | DSL 声明阶段拓扑 |
| `PipelineRunner` (线性 IStep) | 无法表达条件跳转和错误恢复 | FSM 运行时支持条件分支 |

## 附录 B：与 CompositeScheduler 三抽象的类比

`CompositeScheduler` 的三抽象设计（Strategy × Driver × Model）与 FSM 编译器的三层是**正交互补**关系：

| CompositeScheduler | FSM 编译器 | 结合方式 |
|-------------------|------------|----------|
| `IScheduleStrategy` | DSL 描述层 | 策略选择规则可用 DSL 声明（如标签匹配规则） |
| `ILoopDriver` | 代码生成层 | 循环推进可编译为 FSM 中嵌套的 SubFsm |
| `IExecutionModel` | 运行时解释层 | IStep 管道的每步由 FSM 事件驱动推进 |

结合后效果：`WaveDriver` 的波浪推进逻辑可用 DSL 描述波浪定义和波间依赖，由 FSM 编译器生成校验代码，运行时由 `FsmEngine` 处理波间串行/波内并行的复杂逻辑。
