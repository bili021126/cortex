# 🌳 架构全景分析（补充勘察）

> **分析者**：纳西妲（Analysis Agent）
> **分析范围**：`packages/` + `docs/`
> **分析日期**：2026-05-13
> **前人的笔记**：翻阅了上一版纳西妲考察报告（2026-05-10），已覆盖依赖图和 shared 边界。本次在其基础上补充扇入扇出、单点脆弱、扩展成本三个未深入勘探的地层。

---

## 一、包依赖图（地面植被层）— 印证前人发现

```
@cortex/shared  (leaf, zero runtime deps)
  ├─→ @cortex/engine   (deps: shared + sql.js)
  └─→ @cortex/testing  (deps: shared + uuid)

Dev only: engine ─→ testing
```

### import 证据摘要

**shared → (无外部依赖)**
```
infra.ts: import type { AgentType } from "./agent.js";      // 仅内部跨文件引用
task.ts:  import type { AgentType, Tag } from "./agent.js";
memory.ts:import type { AgentType } from "./agent.js";
```
零第三方运行时依赖，纯类型/枚举/接口。与前人勘查一致 ✅。

**engine → shared（全部 engine 源文件）**
```
base-agent.ts:        import type { TaskNode, NodeResult, AgentType, MemoryQuery, SafeErrorReporter } from "@cortex/shared"
scheduler.ts:         import type { TaskNode, NodeResult, ExecutionReport, AgentType, Agent } from "@cortex/shared"
memory-store.ts:      import type { MemoryEntry, MemoryLink, MemoryQuery, MemoryType, AgentType } from "@cortex/shared"
toolkit.ts:           import type { ToolInvocation, ToolResult, ToolDefinition, ToolHandler, ReversibilityLevel, AgentType } from "@cortex/shared"
agent-pool.ts:        import type { AgentType, AgentConfig } from "@cortex/shared"
task-board.ts:        import type { AgentType, TaskNode } from "@cortex/shared"
pipeline-observer.ts: import type { ObservableEvent, PipelineHandler, SafeErrorReporter, SafeErrorContext } from "@cortex/shared"
llm-adapter.ts:       import type { LlmMessage, LlmToolCall, LlmResponse, ToolDef, LlmAdapterConfig, SafeErrorReporter } from "@cortex/shared"
confirm-gate.ts:      import type { ConfirmationRequest, ConfirmationResponse, ReversibilityLevel, PlatformBridge } from "@cortex/shared"
cli-adapter.ts:       import type { PlatformBridge, ConfirmationRequest, ConfirmationResponse, PlatformContext } from "@cortex/shared"
butler-agent.ts:      import type { AgentType, AgentStatus, ObservableEvent } from "@cortex/shared"
file-lock-manager.ts: import { LockType } from "@cortex/shared"
```
engine 的 **12 个核心源文件**全部从 shared 导入类型。单向依赖无反向。与前人勘查一致 ✅。

**testing → shared**
```
src/index.ts: import { AgentType, MemoryType, MemoryState } from "@cortex/shared"
src/index.ts: import type { TaskNode, Tag } from "@cortex/shared"
```

**前人的结论「依赖方向严格单向」经重新验证，仍然成立。**

---

## 二、扇入扇出（新勘探地层）

### 2.1 包级别扇入扇出

| 包 | 扇入（谁依赖我） | 扇出（我依赖谁） | 角色 |
|---|---|---|---|
| `@cortex/shared` | **2**（engine, testing） | **0** | 类型枢纽 |
| `@cortex/engine` | **0** | **2**（shared + sql.js） | 实现容器 |
| `@cortex/testing` | **1**（engine devDep） | **2**（shared + uuid） | 测试辅助 |

shared 的扇入为 2，扇出为 0——它是**纯流入节点**。engine 的扇入为 0，扇出为 2——它是**纯流出节点**。这种拓扑意味着：

- shared 的改动会向 engine 和 testing 双向传播
- engine 的改动不会反向影响任何包
- testing 不会被 engine 的生产构建引用（仅在 devDep）

### 2.2 模块级扇入（engine/src 内部）

```
模块                   扇入    被谁引用
─────────────────────────────────────────
llm-adapter.ts        ✔ 10    base-agent + 8 个 Agent + react-helper + meta-agent
base-agent.ts         ✔  8    Code / Review / Analysis / Ops / Loop / DocGovern / Inspector / Browser
toolkit.ts            ✔  8    base-agent + 7 个 Agent（Butler 除外）
memory-store.ts       ✔  5    base-agent + 4 个 Agent（覆写 getMemoryQuery 的）
agent-pool.ts         ✔  3    base-agent + butler-agent + scheduler
pipeline-observer.ts  ✔  3    scheduler + butler + memory-store
scheduler.ts          ✔  0    （无人依赖，它是调度发起者）
task-board.ts         ✔  1    scheduler
react-helper.ts       ✔  1    base-agent
confirm-gate.ts       ✔  1    toolkit
file-lock-manager.ts  ✔  1    toolkit
cli-adapter.ts        ✔  0    独立适配器
```

**高扇入热点分析**：

1. **LlmAdapter（扇入 10）**——全系统的大脑皮层。每个 Agent 的 ReAct 循环都通过它与 LLM 通信。如果它挂了，整个 Agent 系统全部瘫痪。这是**最高优先级的容错目标**。

2. **BaseAgent（扇入 8）**——8 个 Agent 子类的抽象基类。模板方法模式在此处发挥了作用：公共逻辑集中，子类只需覆写少量方法。但这也意味着 BaseAgent 是**单点知识集中地**——如果一个子类需要行为差异，必须修改 BaseAgent 本身或覆写方法。

3. **Toolkit（扇入 8）**——安全边界执行者。所有 Agent 的工具调用都经过它。扇入仅次于 LlmAdapter。

4. **MemoryStore（扇入 5）**——记忆系统的单点故障。

### 2.3 模块级扇出（engine/src 内部）

```
模块                   扇出    它依赖谁
─────────────────────────────────────────
scheduler.ts          ✔  6    shared + task-board + agent-pool + pipeline-observer + confirm-gate + meta-agent
base-agent.ts         ✔  5    shared + llm-adapter + toolkit + memory-store + react-helper
memory-store.ts       ✔  3    shared + pipeline-observer + sql.js
toolkit.ts            ✔  3    shared + confirm-gate + file-lock-manager
butler-agent.ts       ✔  3    shared + pipeline-observer + agent-pool
pipeline-observer.ts  ✔  1    shared
agent-pool.ts         ✔  1    shared
task-board.ts         ✔  1    shared
react-helper.ts       ✔  3    shared + llm-adapter + toolkit
```

**scheduler.ts（扇出 6）是依赖面最宽的模块**。它需要理解 task-board（任务调度）、agent-pool（生命周期）、pipeline-observer（事件）、confirm-gate（确认）、meta-agent（重规划）五个子系统的接口语义。改动 scheduler 的复杂度最高。

---

## 三、shared/ 边界巩固度检查（新勘探地层）

### 3.1 边界守卫者：tsconfig project references

```json
// packages/engine/tsconfig.json
{
  "references": [{ "path": "../shared" }]
}

// packages/testing/tsconfig.json
{
  "references": [{ "path": "../shared" }]
}
```

**engine 和 testing 都只在 references 中声明 shared，不互相引用。** 这提供了编译时的依赖方向强制执行：

- engine 试图 import testing → ❌ 编译错误
- testing 试图 import engine → ❌ 编译错误
- shared 试图 import 任何 workspace 包 → ❌ 不存在 import 路径

### 3.2 shared 的内部组织

```
shared/src/
├── agent.ts    — AgentType 枚举（12 种）、AgentStatus 状态机（5 态）、标签词汇表（24 个）、权限表（12 种）
├── task.ts     — TaskNode、NodeResult、ReplanResult、ExecutionReport
├── memory.ts   — MemoryType（4 种）、MemoryState（4 态）、MemoryEntry、MemoryLink、MemoryQuery
├── infra.ts    — ToolCategory、ToolDefinition、ReversibilityLevel（4 级）、PipelinePriority（4 级）、
│                 LockType（2 种）、SafeErrorReporter 协议、PlatformBridge 接口
└── index.ts    — 桶导出
```

**文件粒度评价**：🟢 良好。按领域拆分（agent / task / memory / infra），每个文件 150-230 行。没有出现"大统一类型文件"的反模式。

### 3.3 边界违规检查

| 检查项 | 结果 | 证据 |
|---|---|---|
| shared 是否引用 engine 或 testing？ | ✅ 否 | shared 零 workspace 依赖 |
| shared 是否包含实现代码？ | ✅ 否 | 全部是 type / interface / enum / const |
| engine 是否在 src 中定义类型？ | ✅ 否 | 所有类型都从 shared 导入 |
| testing 是否在 src 中定义类型？ | ✅ 否 | 类型从 shared 导入 |

**边界非常干净。** 没有发现边界违反。

---

## 四、单点脆弱性分析（新勘探地层）

### 🟥 4.1 全局致命级

#### LlmAdapter（扇入 10）

```
脆弱路径：LlmAdapter.chat() 超时/异常
  → base-agent.execute() 异常
  → react-helper.ts 捕捉到异常但返回 [ReAct loop crashed]
  → 40 轮推理成果打水漂
  → 最终 NodeResult 标记为 failed
  → Scheduler 触发 MetaAgent.requestReplan()
  → 最多 3 轮重规划，超限交用户
```

**防御措施评价**：
- ✅ 30s 超时 + 3 次重试（已实现）
- ✅ LRU 缓存（命中时跳过 API 调用，已实现）
- ✅ `SafeErrorReporter` 三档上报（fatal / degraded / silent）（已实现）
- ⚠️ 但缓存最大 500 条 — 如果项目规模增长，缓存命中率可能下降

#### MemoryStore（931 行，最大源文件）

```
脆弱路径：SQLite 文件损坏 / 磁盘故障
  → MemoryStore 启动时 init() 失败
  → this._db 为 undefined
  → 后续所有 write/read 调用的 _safeDbRun 抛出异常
  → 记忆系统全量不可用
  → Agent 失去上下文
```

**防御措施评价**：
- ✅ 写路径 `_safeDbRun` + 失败回滚（已实现）
- ✅ 30 天 TTL 自动清理（已实现）
- ⚠️ 但**无备用存储**——MemoryStore 故障时没有降级到纯内存模式的后备策略
- ⚠️ 无定期完整性检查（如 `PRAGMA integrity_check`）

#### PipelineObserver 的隐式单订阅者

```typescript
// butler-agent.ts — 唯一调用 observer.on() 的模块
this.observer.on(PipelinePriority.CRITICAL, this._onCritical.bind(this));
this.observer.on(PipelinePriority.HIGH, this._onHigh.bind(this));
```

**脆弱路径**：ButlerAgent 未启动 / 崩溃 / 生命周期未进入 Awake
  → `observer.emit()` 被调用
  → 所有 handler 列表为空（因为只有 ButlerAgent 注册过）
  → 观测事件被静默丢弃
  → 用户不知道系统内部发生了什么

**风险评估**：`emit()` 的实现对空 handler 列表是 no-op，不会崩溃。但观测盲区意味着**故障发生时无人知晓**。这是沉默的降级——系统在跑，但不可观测。

### 🟧 4.2 局部严重级

#### BaseAgent 的知识集中

8 个 Agent 子类继承自 BaseAgent。**关键方法 `execute()` 的逻辑完全在 BaseAgent 和 `react-helper.ts` 中。** 如果未来需要某个 Agent 具有不同的执行策略（例如 InspectorAgent 需要更严格的循环控制），有两条路径：

1. 覆写 `execute()` 方法 — 但 `execute()` 目前在 BaseAgent 中不是虚方法，覆写需要修改 BaseAgent 的访问修饰符
2. 在 `react-helper.ts` 中加条件分支 — 会导致共享代码被 Agent 特定逻辑污染

当前 InspectorAgent 通过覆写 `maxLoops = 24` 来解决，这是模板方法模式的正确用法。但如果更多 Agent 需要更多差异，BaseAgent 的抽象边界会逐渐膨胀。

#### ButlerAgent 的代码重复

```typescript
// BaseAgent 的做法：
get status(): AS {
  if (this._pool && this._instanceId) { return this._pool.getStatus(this._instanceId); }
  return this._localStatus;
}

// ButlerAgent 的做法（不继承 BaseAgent，但复制了相同逻辑）：
get status(): AgentStatus {
  if (this._pool && this._instanceId) { return this._pool.getStatus(this._instanceId); }
  return this._localStatus;
}
```

**两处完全相同的 status getter 逻辑。** 如果未来 AgentPool 的 status 获取方式发生变化（如增加缓存、异步化），必须同时修改 BaseAgent 和 ButlerAgent。这是**重复代码风险**。

### 🟨 4.3 轻微注意级

#### file-lock-manager.ts 的时间依赖

```typescript
private readonly timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS; // 30_000
```

锁超时依赖 `Date.now()` 单调递增。如果系统时钟发生大幅回拨（如 NTP 同步），可能导致锁提前过期或永不回收。但在个人工具链场景中风险极低。

---

## 五、扩展成本分析（新勘探地层）

### 5.1 新增 Agent 类型（如 DataAgent）

**触及点矩阵**：

| 步骤 | 文件 | 改动类型 | 编译影响 |
|---|---|---|---|
| 1 | `shared/src/agent.ts` | 枚举 + 常量 + 权限表各加一项 | shared 全量 |
| 2 | `engine/src/data-agent.ts` | 新建文件，extends BaseAgent | engine 增量 |
| 3 | `engine/src/index.ts` | 加一行 export | 桶导出 |
| 4 | `engine/src/scheduler.ts` | 可能在 dispatch 逻辑中注册 | scheduler |
| 5 | `engine/tests/data-agent.test.ts` | 新建测试文件 | 无 |
| — | `docs/` | 更新宪法文档 | 无 |

**成本**：**5-6 个 touchpoints / 2 个包。核心工作量在步骤 2（Agent 实现）。**

**阻力来源**：shared 的枚举是编译时封闭集合（`AgentType` enum + `AGENT_TAGS` Record + `AGENT_TOOL_PERMISSIONS` Record）。新增 Agent 必须三处同步修改，缺一不可。这种"声明式注册"机制的好处是**所有权限和标签在编译时可知**，缺点是每次新增都要改 shared。

### 5.2 修改 ReAct 循环策略

**触及点**：`engine/src/react-helper.ts`（核心）+ `engine/src/base-agent.ts`（参数传递）

**成本**：**1-2 个 touchpoints。极低。** ReAct 循环已集中到独立的 helper 函数，这是架构的好决策。所有 Agent 共用同一套循环逻辑，修改一处全局生效。

### 5.3 替换 LLM 提供商

**触及点**：`engine/src/llm-adapter.ts`（核心）+ `shared/src/infra.ts`（配置类型，如需变更）

**成本**：**1-2 个 touchpoints。低。** LlmAdapter 封装了所有 LLM 通信细节，对外只暴露 `chat()` 和 `injectMock()`。接口隔离良好。但当前的实现与 DeepSeek API 的格式有绑定（如 `reasoning_content` 字段、`reasonerModel` 配置）。切换提供商时需要适配这些差异。

### 5.4 修改持久化存储（SQLite → 其他）

**触及点**：`engine/src/memory-store.ts`（核心）+ `shared/src/memory.ts`（如需扩展 MemoryQuery）

**成本**：**1-2 个 touchpoints 但内部重构量大。中等。** MemoryStore 931 行，内部与 sql.js 耦合较紧。`_safeDbRun` 抽象了数据库操作，但查询构造（`buildQuery`）、关联边遍历（`_bfsTraverse`）等逻辑都直接操作 SQLite。迁移需要重写约 500 行的数据库操作层。

### 5.5 扩展成本总结表

| 变更场景 | Touchpoints | 涉及包数 | 风险等级 |
|---|---|---|---|
| 新增 Agent 类型 | 5-6 | 2 | 🟡 中等 |
| 修改 ReAct 循环 | 1-2 | 1 | 🟢 低 |
| 替换 LLM 提供商 | 1-2 | 1-2 | 🟢 低 |
| 替换持久化存储 | 1-2（但大重构） | 1 | 🟡 中等 |
| 修改调度策略 | 1-2 | 1 | 🟢 低（scheduler 为唯一入口） |
| 添加新工具 | 2 | 2 | 🟢 低 |

---

## 六、工程实践观察（偶然发现的地下根系）

### 6.1 测试覆盖密度

```
engine/tests/ 下有 23 个测试文件
shared/tests/ 下有 1 个测试文件（types.test.ts）
testing/tests/ 下有 1 个测试文件（synthetic.test.ts）
```

engine 的测试覆盖了所有核心模块：scheduler、task-board、memory-store（含生命周期/保存/回滚）、agent-pool、pipeline-observer、confirm-gate、file-lock-manager、以及 6 个 Agent 的独立测试。

测试文件命名规范：
- `memory-store-lifecycle.test.ts` — 记忆系统生命周期
- `memory-store-save.test.ts` — 记忆持久化
- `memory-store-write-rollback.test.ts` — 写路径回滚
- `scheduler-dispatch.test.ts` — 调度分发
- `multi-agent-collab.test.ts` — 多 Agent 协作
- `task-board-stress.test.ts` — 并发压力

功能维度的测试分离粒度很细，这是好的实践。

### 6.2 文档与代码的一致性

宪法的六条不可变原则在 `docs/Cortex 概念顶层设计 v2.5.md` 中定义，代码中能找到对应实现：

| 宪法原则 | 代码实现 |
|---|---|
| 原则一：确认在用户手里 | `confirm-gate.ts` — L2/L3 确认门 |
| 原则二：规划与执行分离 | `meta-agent.ts`（规划）× `scheduler.ts`（调度） |
| 原则三：安全边界在 Toolkit | `toolkit.ts` + `AGENT_TOOL_PERMISSIONS` |
| 原则四：谁调用谁负责 | 各 Agent 独立 execute() 调用链 |
| 原则五：PipelineObserver + SafeErrorReporter | `pipeline-observer.ts` + `base-agent.setSafeReporter()` |
| 原则六：用户是最终裁决者 | ButlerAgent → PlatformBridge 通道 |

### 6.3 值得注意的设计模式使用

| 模式 | 位置 | 评价 |
|---|---|---|
| 模板方法 | `BaseAgent` → `CodeAgent` 等 8 子类 | 🟢 恰当 |
| 桶导出（Barrel） | `shared/src/index.ts`, `engine/src/index.ts` | 🟢 标准实践 |
| 依赖注入 | `LlmAdapter` → `BaseAgent` 构造参数 | 🟢 可测试 |
| Mock 注入 | `LlmAdapter.injectMock()` | 🟢 测试友好 |
| 策略模式 | 各 Agent 的 `getMemoryQuery()` | 🟢 灵活 |
| 观察者 | `PipelineObserver` | 🟢 但只有一个订阅者 |
| 工厂 | 无显式工厂，Agent 在 scheduler 中直接 new | 🟡 耦合度略高 |

---

## 七、核心结论与三条生存建议

### 雨林的核心模式

这个项目是一个**类型驱动、模板方法组织的多 Agent 工具链**。架构的核心结构是：

> **shared（类型宪法）→ engine（实现容器）→ Agent（执行单元）**

shared 是宪法，engine 是政府，Agent 是各部门。宪法不可轻易修改，政府负责协调，各部门只管执行。

### 风险最集中的角落

| 排名 | 组件 | 风险类型 |
|---|---|---|
| 🥇 | **LlmAdapter** | 扇入 10，单点故障导致全系统不可用 |
| 🥈 | **PipelineObserver 单订阅者** | ButlerAgent 崩溃 → 观测盲区 |
| 🥉 | **ButlerAgent 的 status 逻辑重复** | 代码重复 → 维护不一致风险 |

### 如果未来有人要动这里，最需要注意的三件事

1. **改 shared 前先数消费者**。shared 是编译时全量重编的触发器。`AgentType` 枚举加一个值，engine 和 testing 都要重编。每次改动前先确认所有消费者都已同步——用 `search_code` 搜一下 `from "@cortex/shared"` 看看谁在用。

2. **新增 Agent 时把 ButlerAgent 也考虑进去**。ButlerAgent 不继承 BaseAgent，有自己的生命周期管理逻辑。如果未来 AgentPool 的状态机制发生变化（如 status 增加新状态），必须同时修改 BaseAgent 和 ButlerAgent 的 `status` getter——缺一个就会导致行为不一致。

3. **为 PipelineObserver 注册第二个订阅者**。当前只有一个 ButlerAgent 在监听事件。考虑在 bootstrap 阶段注册一个文件日志订阅者（比如把 `emit` 事件落盘到 `.cortex/logs/pipeline-events.log`），这样即使 ButlerAgent 未启动，关键事件也不会完全丢失。
