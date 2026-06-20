## Cortex 系统架构分析报告

**分析范围**: 27 包 monorepo 全量源码  
**分析日期**: 2026-06-21  

---

### 一、架构总览

Cortex 是一个**插件化多 Agent 编排运行时**，采用 pnpm monorepo 组织，27 个包分为四层：

```
┌─────────────────────────────────────────────────────────┐
│  应用层  │  cli (CLI命令)  ·  tui (终端UI)              │
├─────────────────────────────────────────────────────────┤
│  集成层  │  engine (运行时核心) — 依赖 15 个包            │
├─────────────────────────────────────────────────────────┤
│  能力层  │  scheduler · memory-store · llm · platform   │
│         │  resilience · notification · governance       │
│         │  consistency · prompt-kit · skill-kit         │
├─────────────────────────────────────────────────────────┤
│  基础层  │  shared (类型中枢) · config · logging        │
│         │  fsm-compiler · parser · cache · pm           │
│         │  telemetry · tools · testing · doctor         │
└─────────────────────────────────────────────────────────┘
```

**两个枢纽包**：`@cortex/shared` 是类型枢纽（被所有包依赖，自身零依赖），`@cortex/engine` 是集成枢纽（依赖 15 个包，串联全部子系统）。

---

### 二、包依赖图谱

#### 2.1 分层分类

| 分类 | 包 | 特征 |
|------|-----|------|
| **Foundation** (被依赖多、依赖少) | shared, config, logging, fsm-compiler | 零或极少 `@cortex/*` 依赖，提供类型/配置/基础设施 |
| **Hub** (连接多子系统) | engine, scheduler, memory-store | 被多个上层包依赖，自身也有较深依赖链 |
| **Leaf** (终端消费者) | cli, tui | 依赖众多底层包但不被其他包依赖 |
| **Standalone** (无 `@cortex` 依赖) | parser, pm, cache, tools, pattern-extractor | 完全自包含 |

#### 2.2 依赖深度

最长依赖链为 **4 层**：

```
cli → engine → memory-store → fsm-compiler
                  ↓            ↑
              memory ─────────┘
```

#### 2.3 关键发现

**幽灵依赖** (实际 import 了未在 `package.json` 声明的包): 未发现。  
**死依赖** (声明了但 `src/` 中从未 import): 17 处 — 多个包声明了 `@cortex/shared` 但仅通过 `import type` 使用，建议改为 `devDependencies` 或使用 `import type` 标注。  
**循环依赖**: 无包级循环依赖。`engine` 和 `scheduler` 之间是单向依赖 (engine → scheduler)。

---

### 三、核心运行时——七步执行管线

#### 3.1 完整执行链路

```
用户意图
  │
  ▼
S1. Bootstrap ─── 加载 cortex-agents.json + cortex-cognition.json
  │                 10 个插件拓扑排序 → init() → postInit() → start()
  │                 Core-2 模块接线 (Router, Sentinel, Notification, Resilience, Governance)
  ▼
S2. MetaAgent.plan() ─── LLM 分解意图为 TaskNode[] 树
  │                        写入 TaskBoard，标注 edgeType / preferredStrategy
  ▼
S3. Scheduler.executeAll() ─── 生成 sessionId，beginSession()
  │
  ▼
S4. TopologicalLayeredDriver ──── while (pending nodes) {
  │                                  topologicalSort() → 按层并行
  │                                  for each layer: Promise.allSettled(
  │                                    node => DispatchPipeline
  │                                  )
  │                                }
  ▼
S5. Dispatch Pipeline (per node) ──
  │   ClaimStep     → findMatchingAgent() + board.claim()
  │   SpawnStep     → ManifoldGate.acquire() + pool.spawn()
  │   ExecuteStep   → agent.execute(node, model)
  │   BoundaryGuard → 文件边界扫描 → 违规 → replan
  │   CleanupStep   → release + destroy + board.complete()
  ▼
S6. Agent.execute() ──
  │   PoolAwareState → Active
  │   executeWithMemoryPipeline():
  │     MemoryRetrievalStep → ContextBuilder 或关键词检索
  │     ReActLoopStep ────── while (loops < max && !timeout) {
  │                             llm.chat() → tool_calls? → toolkit.execute()
  │                             push tool results → next iteration
  │                           }
  │     MemoryWriteStep ──── writePending() → commitMemory()
  │   PoolAwareState → Awake
  ▼
S7. ExecutionReport ── { totalNodes, completed, failed, results, durationMs }
      │
      ▼
   endSession() → shutdown()
```

#### 3.2 调度四抽象

| 抽象 | 接口 | 实现 | 职责 |
|------|------|------|------|
| **Strategy** | `IScheduleStrategy` | TagMatching / RoundRobin / PriorityFirst | 节点 → Agent 匹配 |
| **Driver** | `ILoopDriver` | TopologicalLayered / Sequential / Wave | 任务树遍历方式 |
| **ExecutionModel** | `IExecutionModel` | Pipeline / SimpleExecute | 单节点执行方式 |
| **Router** | `IModelRouter` | Fixed / Semantic | LLM 模型选择 |

四个抽象均可通过 `CompositeSchedulerConfig` 注入替换，运行时组合。

#### 3.3 Tag Matching 算法

```
1. normalize(type) → replace _ with -, resolve aliases (inspect → inspector)
2. if normalized type ∈ AgentRegistry → direct match
3. fallback: score(agent) = |node.tags ∩ AGENT_TAGS[agent.type]|
   tiebreakers: exact type match +1 bonus, higher density (score/|tags|) wins
```

多视角节点 (`needsMultiPerspective: true`) 使用 `findAllMatchingAgents()` 返回所有有至少 1 个 tag 交集的 agent。

---

### 四、数据流与通信架构

#### 4.1 三层事件系统

| 系统 | 位置 | 事件数 | 作用域 |
|------|------|--------|--------|
| **PipelineObserver** | `scheduler/core/pipeline-observer.ts` | 40+ 类型 | 引擎全局，优先级路由 |
| **TuiEventBus** | `cli/tui/event-bus.ts` | 11 类型 | TUI 层局部，经典 pub/sub |
| **NotificationPipe** | `notification/notification-pipe.ts` | 4 通道 | 用户可见通知，路由表驱动 |

**PipelineObserver** 是系统骨干。每个事件携带 `PipelineEventType` + `PipelinePriority` (CRITICAL/HIGH/NORMAL) + 类型安全 payload（`EventPayloadMap` 编译期约束）。订阅者按优先级注册：Sentinel 订阅 CRITICAL+HIGH，MemoryStore 订阅 ALL，Butler 订阅 HIGH+NORMAL。

**事件桥接**：`NotificationRuntime` 将 PipelineObserver 事件桥接到 NotificationPipe；`LoggingPipelineBridge` 桥接到 `@cortex/logging`；`ConsoleBridge` 拦截 `console.warn/error` 转为 PipelineObserver 事件。

#### 4.2 状态管理——分布式共享内存

Cortex **没有全局状态存储**。状态分布在三个协调点：

| 状态容器 | 内容 | 生命周期 | 协调机制 |
|----------|------|----------|----------|
| **TaskBoard** | TaskNode DAG (status/claims/results) | 会话级 | claim/release/complete 原子操作 |
| **MemoryStore** | 语义记忆 (facts/insights/skills) | 持久化 | 两阶段提交 (writePending → commitMemory) |
| **AgentPool** | Agent 实例生命周期 | 会话级 | 状态机验证 (Created→Awake→Active→Draining→Destroyed) |

Agent 间状态共享通过三种路径：MemoryStore 异步持久化（A 写 → B 读）、TaskBoard 同步会话（MetaAgent 写 → Scheduler 调度）、PipelineObserver 同步瞬态（事件驱动下游响应）。

#### 4.3 核心数据模型

**TaskNode** — 任务节点，携带 18 个字段：id, parentId, edgeType (hard/soft/trigger), type, tags, payload, status (5 态 FSM), claimedBy, results, needsMultiPerspective, isRlmSubtask, preferredStrategy, recommendedTier, contextPolicyId, reasoningEffort, createdAt 等。

**MemoryEntry** — 语义记忆，四层结构：Identity 层 (id/source/sessionId) + Cognitive 层 (kind/summary/semantic_gist/content_blob) + Lifecycle 层 (semantic_state/weight/accessCount) + Engineering 层 (embedding/content_hash/expires_at)。通过 LinkType (PRODUCED_BY / DERIVED_FROM / CONFIRMED_USEFUL / CONFIRMED_NOISE) 构成知识图谱。

**LlmMessage / LlmResponse** — LLM 协议，支持 system/user/assistant/tool 四种角色、tool_calls 结构化调用、reasoning_content 思维链。

---

### 五、基础设施横切层

#### 5.1 Resilience（弹性层）

三件套组合：CircuitBreaker (CLOSED → OPEN → HALF_OPEN → CLOSED) + RetryPolicy (指数退避) + TimeoutPolicy (固定/自适应 EMA)。

引擎集成点：`resilienceFactory` 为 `llm-call` 注册 3 次重试 / 120s 超时 / 5 次失败断路；为 `tool-exec` 注册 2 次重试 / 30s 超时 / 3 次失败断路。

**采用情况**：仅 engine 核心路径使用。memory-store、notification、plugin-runner 等包未集成。

#### 5.2 Logging（日志层）

分层设计：LogLevel (7 级) → Logger (带 scope) → Transport (Console/File/PipelineBridge) → Formatter (text/JSON)。

**采用情况**：engine bootstrap 阶段集成（通过 LoggingPipelineBridge 桥接到 PipelineObserver）。但 **12/27 包仍使用 `console.log`**，未迁移到 `@cortex/logging`。这是最大的横切层采用缺口。

#### 5.3 Telemetry（遥测层）

5 个模块：EventTelemetry (事件采集) + MetricsCollector (指标聚合) + EngineTelemetry (引擎遥测) + ConsoleBridge (控制台桥接) + types。

**采用情况**：engine 和 scheduler 有遥测事件发射。但与 logging 层没有桥接——遥测指标不进日志流，也不进 NotificationPipe。

#### 5.4 Config（配置层）

`loadConfig(projectRoot)` 三阶段管线：`loadAll()` (读 cortex-agents.json / cortex-cognition.json / cortex-docs.json) → `validateAll()` (交叉字段校验) → `assembleAll()` (产出 BootstrapResult)。

**缺口**：无 JSON Schema 验证——无效配置文件静默降级为默认值，不报错。

---

### 六、架构风险与瓶颈

#### 6.1 关键架构风险

| 风险 | 等级 | 描述 |
|------|------|------|
| **Engine 上帝包** | High | engine 依赖 15 个包，承载 bootstrap + agent factory + react loop + memory pipeline + governance bridge + plugin wiring + resilience integration + Core-2 modules。任何修改都可能牵动全局。 |
| **TUI 代码分裂** | High | `@cortex/tui` 和 `@cortex/cli/src/tui/` 存在大量重复代码，renderer / event-bus / query-loop 逻辑几乎镜像。修一处忘另一处的概率极高。 |
| **Shared 类型膨胀** | Medium | shared 的 17 个模块承载了所有跨包契约，但缺乏按领域分组（agent/task/memory/infra 散落在同一层）。新增类型时难以找到正确的归属文件。 |
| **单线程天花板** | Medium | 所有 "并行执行" 都是 `Promise.allSettled` 并发 I/O，受 Node.js 事件循环限制。CPU 密集操作（ONNX embedding、FSM 编译、BM25 索引）会阻塞 agent 调度。 |
| **日志采用鸿沟** | Medium | 12/27 包仍用 `console.log`，导致生产环境日志无法统一采集、无法按 scope 过滤、无法与 PipelineObserver 事件关联。 |
| **记忆写入延迟** | Low | 每个 TaskNode 完成后都要走 writePending → commitMemory 两阶段协议，对高频短任务场景增加可观测延迟。 |

#### 6.2 性能瓶颈

| 位置 | 瓶颈 | 影响 |
|------|------|------|
| `ReActLoop` 内工具执行 | 串行 (非并行) 执行 LLM 返回的多个 tool_calls | 多工具任务耗时线性叠加 |
| `TopologicalLayeredDriver` | 每轮重做 topologicalSort O(V+E) | 大 DAG (100+ nodes) 场景排序开销可观测 |
| `BoundaryGuardStep` | 每次 node 完成后做 readdir + stat 文件扫描 | 大工作区 (1000+ files) 扫描耗时 |
| `MemoryWriteStep` | 两阶段提交 + ONNX embedding 计算 | 每次任务完成固定增加 50-200ms |
| `config` 加载 | `readFileSync` 同步读取配置文件 | bootstrap 阶段阻塞 |

#### 6.3 扩展性评估

| 维度 | 现状 | 评估 |
|------|------|------|
| 新增 Agent 类型 | registry.ts 注册 + AGENT_TAGS + memory query strategy | **良好** — 声明式，3 处改动 |
| 新增 Tool | toolkit 注册 + tool permissions | **良好** — 插件式 |
| 新增调度策略 | 实现 IStrategy/ILoopDriver 接口 | **优秀** — 四抽象均可替换 |
| 新增记忆类型 | MemoryKind 枚举 + ContextBuilder policy | **一般** — 需改枚举和查询注册 |
| 新增 LLM Provider | LlmAdapter 只有一个实现 (DeepSeek) | **薄弱** — baseUrl 换即可，但无 provider 抽象层 |
| 新增通知通道 | NotificationPipe channel 注册 | **良好** — 路由表驱动 |

---

### 七、演进建议

#### 第一优先级：安全与稳定性

1. **拆分 Engine 上帝包**：将 bootstrap、agent factory、react-loop、memory pipeline 各自独立为 `@cortex/engine-bootstrap`、`@cortex/engine-agents`、`@cortex/engine-loop`、`@cortex/engine-memory`。当前 `@cortex/engine` 降级为 barrel re-export。

2. **统一 TUI 代码**：`@cortex/cli/src/tui/` 完全删除，改为 `re-export @cortex/tui`。消除维护同步风险。

3. **补全 workspaceRoot 动态解析**：platform 工具的沙箱根路径改为每次调用时从 Toolkit 实例获取，而非构造时捕获。

#### 第二优先级：可观测性

4. **日志迁移运动**：12 个零采用包逐步迁移到 `@cortex/logging`。优先级：memory-store > scheduler > resilience > platform（按日志量排序）。

5. **Logging-Telemetry 桥接**：让 Telemetry 指标通过 LoggingPipelineBridge 进入统一日志流，支持 "一条日志同时包含事件 + 指标 + trace"。

6. **Config Schema 验证**：引入 zod 或 arktype 做运行时 schema 验证，无效配置在 bootstrap 阶段 fail-fast。

#### 第三优先级：性能

7. **工具并行执行**：ReActLoop 中同一轮 LLM 返回的多个 tool_calls，L0 (read-only) 工具可 `Promise.allSettled` 并行执行。

8. **增量拓扑排序**：TopologicalLayeredDriver 维护增量拓扑缓存，仅在 replan 产生新节点时重算受影响的层，而非全量重排。

9. **CPU 密集操作 Worker 化**：ONNX embedding、BM25 索引、FSM 编译迁移到 `worker_threads`，避免阻塞事件循环。

---

### 八、架构模式总结

Cortex 采用了一套**高度一致的架构模式**贯穿全部子系统：

**管线模式 (Pipeline)**：`IStep[]` 链由 `PipelineRunner` 串行执行，cleanup 逆序调用。Memory pipeline、Dispatch pipeline、Governance pipeline 均遵循此模式。

**四抽象调度**：Strategy / Driver / ExecutionModel / ModelRouter 四个正交维度组合成调度行为，每个维度独立可替换。

**分布式状态 + 事件协调**：无全局 store，三个状态容器 (TaskBoard / MemoryStore / AgentPool) 通过 PipelineObserver 事件实现松耦合协调。

**声明式注册**：Agent 类型、Tool 权限、Memory 查询策略、Context Policy 均通过声明式注册表配置，而非硬编码分支。

**两阶段提交**：MemoryStore 的 writePending → commitMemory/rollback 确保记忆写入的原子性，失败可完整回滚。

这些模式设计质量高，一致性强，降低了新模块接入的认知成本。主要风险集中在 engine 的职责集中度和 TUI 代码分裂上。
