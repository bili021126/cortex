# 调度器心跳重构设计

> 定位：PF-03（stale timeout 误报 NodeFailed）的根因修复。不是改超时值——是给 Scheduler 装脉搏传感器。
> 关联：`docs/core/remediation-roadmap.md` Stage 3、`packages/scheduler/src/core/scheduling-implementations.ts`。

---

## 段一：现状诊断

### 问题

```
dispatch_node → setTimeout(stale, 120s)
                    │
            agent 执行中（LLM 慢 / 工具卡 / 网络波动）
                    │
            stale 触发 → emit NodeFailed
                    │
            ReplanManager 重新规划
                    │
            但 agent 实际上还活着——只是没及时回报
```

**根因**：Scheduler 无法区分"慢"（slow）和"死"（dead）。两个信号混在同一个 `stale` timeout 里。

### 缺失

| 缺口 | 影响 |
|------|------|
| 无 Agent 状态机 | 无法查询 agent 当前状态（idle/dispatched/executing/timed_out） |
| 无心跳机制 | agent 执行中不向 Scheduler 发心跳，Scheduler 只能盲猜 |
| 超时和重试耦合 | stale → NodeFailed → Replan，中间没有任何缓冲级 |

---

## 段二：设计

### 总览

```
                     Scheduler
                    ┌──────────────────────────────────────────┐
                    │                                          │
  dispatch ──────→ │ AgentTracker                             │
                    │   ├─ agentStates: Map<AgentId, State>    │
                    │   ├─ heartbeats: Map<AgentId, lastBeat>  │
                    │   └─ onTimeout(state) → tiered decision  │
                    │                                          │
                    │  Tiered timeout:                         │
                    │   L1 stale_warn (60s) → emit NodeDelayed │
                    │   L2 stale_ping (90s)  → ping agent      │
                    │   L3 stale_dead (120s) → emit NodeFailed │
                    │        ↑ 仅当 L2 ping 无响应             │
                    │                                          │
                    └──────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              dispatch-steps   AgentPool        ReplanManager
              (不改逻辑)      (加 heartbeat)    (新增 NodeDelayed)
```

### 核心接口

```typescript
// packages/scheduler/src/core/agent-tracker.ts（新建）

enum AgentExecutionState {
  Idle = "idle",
  Dispatched = "dispatched",
  Executing = "executing",
  TimedOut = "timed_out",
  Failed = "failed",
}

interface AgentStateEntry {
  agentId: string;
  state: AgentExecutionState;
  nodeId: string;            // 当前分配的 node
  dispatchedAt: number;      // dispatch 时间戳
  lastHeartbeat: number;     // 最后一次心跳
  pingSent: boolean;         // L2 ping 是否已发
}

class AgentTracker {
  // 状态管理
  markDispatched(agentId: string, nodeId: string): void;
  recordHeartbeat(agentId: string): void;
  markCompleted(agentId: string): void;
  markFailed(agentId: string): void;

  // 超时检查（tick 驱动，每秒调用）
  checkTimeouts(now: number): TimeoutAction[];
}
```

### 分层超时

```typescript
interface TimeoutAction {
  type: 'warn' | 'ping' | 'kill';
  agentId: string;
  nodeId: string;
  elapsed: number;
}

// AgentTracker.checkTimeouts() 内部：
//   elapsed = now - dispatchedAt
//   if elapsed > L1 && !warned      → emit NodeDelayed, mark warned
//   if elapsed > L2 && !pingSent    → emit NodeDelayed(warning), mark pingSent, trigger ping
//   if elapsed > L3 && pingSent     → emit NodeFailed  ← 这才是真死了
```

### AgentPool 加 heartbeat

```typescript
// packages/scheduler/src/core/agent-pool.ts（修改）

interface IAgentPool {
  // 现有方法不变
  acquire(node: TaskNode): Promise<AgentInstance>;
  release(agentId: string): void;

  // 🆕
  heartbeat(agentId: string): void;        // agent 执行中调用
  ping(agentId: string): Promise<boolean>; // Scheduler 探测 agent 是否存活
}
```

### ReplanManager 新增 NodeDelayed 处理

```typescript
// packages/scheduler/src/core/replan-manager.ts（修改）

// 当前只处理 NodeFailed → 重新规划
// 新增：
onNodeDelayed(nodeId: string, elapsed: number, level: 'warn' | 'ping'): void {
  if (level === 'warn') {
    // 记录日志，不触发重规划——只是慢了
    this.observer.emit('NodeDelayed', { nodeId, elapsed, action: 'wait' });
  }
  if (level === 'ping') {
    // 加时：给 agent 额外的宽限期
    this.observer.emit('NodeDelayed', { nodeId, elapsed, action: 'extend' });
  }
}
```

### EventPayloadMap 补充

```typescript
// packages/shared/src/infra.ts 新增
'Exec:NodeDelayed': {
  nodeId: string;
  elapsed: number;
  action: 'wait' | 'extend';
  agentId: string;
};
```

---

## 段三：与现有代码的精确咬合

### 不改的

| 文件 | 原因 |
|------|------|
| `scheduling-implementations.ts` 的 dispatch 主逻辑 | 参数化超时常量，不改流程 |
| `dispatch-steps/execute-step.ts` | agent 执行逻辑不变，只加 heartbeat 调用点 |
| `ReplanManager` 的 `onNodeFailed` | 保留——L3 超时仍走此路径 |

### 要改的

| 文件 | 改动 | 行数 |
|------|------|------|
| 🆕 `scheduler/src/core/agent-tracker.ts` | AgentTracker 类 | ~80 |
| ✏️ `scheduler/src/core/agent-pool.ts` | 加 heartbeat() + ping() | ~20 |
| ✏️ `scheduler/src/core/scheduling-implementations.ts` | stale → tiered timeout | ~15 |
| ✏️ `scheduler/src/core/replan-manager.ts` | 加 onNodeDelayed() | ~15 |
| ✏️ `shared/src/infra.ts` | 加 Exec:NodeDelayed + EventPayloadMap | ~10 |
| ✏️ `dispatch-steps/execute-step.ts` | agent 执行循环中加 heartbeat 调用 | ~5 |

### 暂不改的

| 事项 | 延期原因 |
|------|---------|
| Agent 端主动心跳推送 | 当前 agent 通过 dispatch-steps 间接运行——heartbeat 在 execute-step 中调用即可 |
| 跨进程心跳 | 单进程架构不需要 |

---

## 段四：实施路径

| 优先级 | 事项 | 代码量 | 前置依赖 |
|--------|------|--------|---------|
| P0 | AgentTracker 类 | ~80行 | 无 |
| P0 | EventPayloadMap 补充 Exec:NodeDelayed | ~10行 | 无 |
| P1 | AgentPool.heartbeat/ping | ~20行 | P0 |
| P1 | scheduling-implementations tiered timeout | ~15行 | P0 |
| P2 | ReplanManager.onNodeDelayed | ~15行 | P0 |
| P2 | execute-step heartbeat 调用点 | ~5行 | P1 |

**P0 验收**：`AgentTracker.checkTimeouts()` 返回正确分层动作；`Exec:NodeDelayed` event 类型正确。

**全量验收**：`tsc --noEmit` 零报错；stale 不再直接触发 NodeFailed——必须先经过 L1/L2。
