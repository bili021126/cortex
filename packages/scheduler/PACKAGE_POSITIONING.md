# @cortex/scheduler —— 包定位文档

> **包名**: `@cortex/scheduler`
> **层级**: Layer 1 — 调度 / 引擎 / 执行层
> **版本**: v0.1.0
> **状态**: 从 @cortex/engine 独立拆出中
> **最后更新**: 2026-05-31

---

## 一句话定位

**任务调度执行引擎** —— 接收 DAG 任务树，通过三抽象（策略 Strategy × 驱动 Driver × 模型 Model）将任务分发至 Agent 池执行，含完整重规划闭环与分发管线。

---

## 解决的问题

| # | 问题 | 解决方案 |
|---|------|---------|
| 1 | @cortex/engine 膨胀到不可维护 | 将调度逻辑独立成包，职责边界清晰 |
| 2 | 调度行为硬编码，无法按场景组合 | 三抽象可组合体系：Strategy × Driver × Model 正交替换 |
| 3 | 调度核心逻辑无法独立测试 | 纯逻辑组件（topologicalSort、ReplanManager）可零 mock 测试 |
| 4 | MetaAgent 耦合导致循环依赖 | IReplanProvider 接口解耦，scheduler 不依赖 MetaAgent 具体类 |

---

## 职责边界

### 本包负责

- 任务节点拓扑排序（DAG → 分层并行）
- Agent 标签匹配与分发策略
- 分发管线执行（Claim → Spawn → Execute → BoundaryGuard → Cleanup）
- 重规划队列管理（失败/越界 → MetaAgent replan → 新节点注入）
- mHC 流形约束（ManifoldGate Agent 并发数控制）
- RLM 递归拆解与密度压缩
- 确认门（ConfirmGate）与信任模型（TrustModel）

### 本包不负责

| 功能 | 归属 |
|------|------|
| Agent 实例创建 (new Agent / agent.wakeup) | @cortex/engine (factory) |
| Agent 注册与类型定义 | @cortex/engine (bootstrap/plugin) |
| LLM 调用 | @cortex/llm |
| 记忆存取 | @cortex/engine (MemoryStore) |
| 任务节点持久化 | TaskBoard 实现层（本包提供接口） |
| CLI / IPC 接口 | @cortex/cli |

---

## 依赖关系

```
@cortex/scheduler
    ├── @cortex/shared    (类型协议: TaskNode, AgentType, IPipelineObserver...)
    └── @cortex/config    (环境变量常量: ENV_VITEST, ENV_NODE_ENV)

被依赖:
    └── @cortex/engine    (通过 barrel 重导出 scheduler 的全部公开符号)
```

**关键原则**: scheduler 不依赖 engine。这是单向下行依赖——engine 消费 scheduler，scheduler 不感知 engine。

---

## 核心接口

| 接口 | 说明 | 定义位置 |
|------|------|---------|
| `ITaskBoard` | 任务板最小契约 | `core/task-board.ts` |
| `ISchedulerAgentPool` | Agent 池最小契约 | `core/agent-pool.ts` |
| `IScheduleStrategy` | 调度策略抽象 | `core/scheduling-types.ts` |
| `ILoopDriver` | 循环推进方式抽象 | `core/scheduling-types.ts` |
| `IExecutionModel` | 单节点执行范式抽象 | `core/scheduling-types.ts` |
| `IReplanProvider` | 重规划回调解耦接口 | `core/replan-manager.ts` |
| `IDispatchStep` | 分发管线步骤抽象 | `dispatch-steps/types.ts` |

---

## 模块目录

```
src/
├── index.ts                      # barrel 导出
├── core/
│   ├── task-board.ts             # 任务板 (ITaskBoard + TaskBoard)
│   ├── agent-pool.ts             # Agent 池 (ISchedulerAgentPool + AgentPool)
│   ├── topological-sort.ts       # DAG 拓扑排序 (硬边/软边/触发边)
│   ├── scheduling-types.ts       # 三抽象类型定义
│   ├── agent-matcher.ts          # Agent 标签匹配算法
│   ├── replan-manager.ts         # 重规划队列管理
│   ├── rlm-decompose.ts          # RLM 递归拆解
│   ├── density-compress.ts       # 密度压缩
│   ├── confirm-gate.ts           # 确认门
│   ├── trust-model.ts            # 信任模型
│   ├── pipeline-observer.ts      # 事件管道
│   └── pipeline-runner.ts        # 管线运行器
├── dispatch-steps/
│   ├── types.ts                  # IDispatchStep, DispatchCtx
│   ├── claim-step.ts             # 认领步骤
│   ├── spawn-step.ts             # 实例生成步骤
│   ├── execute-step.ts           # 执行步骤
│   ├── boundary-guard-step.ts    # 文件边界守卫
│   ├── rlm-execute-step.ts       # RLM 子任务执行
│   ├── cleanup-step.ts           # 清理释放步骤
│   └── manifold-gate.ts          # 流形门 (mHC 并发约束)
├── types/
│   └── internal.ts               # 内部工具 (isTestEnv, ifNotTest)
└── __tests__/
    ├── task-board.test.ts
    ├── agent-pool.test.ts
    └── topological-sort.test.ts
```

---

## 与 @cortex/engine 的关系

当前处于 **复制+适配阶段**：
- scheduler 已有一份完整的调度逻辑副本（24 个源文件）
- engine 仍保留原始副本（Phase 4 前不移除）
- engine barrel 计划重导出 scheduler 的公开符号（见 DESIGN.md §9.3）
- 迁移完成后，engine/src/core/ 中的调度相关文件将删除

---

## 宪法一致性

| 原则 | 遵行方式 |
|------|---------|
| 原则一 — 可替换 | 三抽象（Strategy/Driver/Model）均可独立替换 |
| 原则二 — 可验证 | 3 个单元测试覆盖核心逻辑 |
| 原则三 — 安全边界 | BoundaryGuardStep 文件越界检测 |
| 原则四 — 职责清晰 | 本文档明确界定"负责/不负责" |
| 原则五 — 统一事件管道 | PipelineObserver 全事件走 observer.emit |
| 原则六 — 无循环依赖 | 仅依赖 shared + config（两个零依赖核心包） |
