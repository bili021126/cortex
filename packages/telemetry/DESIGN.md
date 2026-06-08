# @cortex/telemetry — 运行时遥测与可观测性套件

> **版本**: v0.1.0-draft  
> **状态**: 设计阶段  
> **作者**: 基于母项目 17 个现有包结构分析 + `coding-standards.md` §一~§十四 编码法典 + 现有抽象约束推导  
> **宪法依据**: 原则五（可观测事件走统一管道）、§九（内部明细化 + 外部具体化）、§十三（接口隔离）、§十四（设计模式约定）

---

## 目录

1. [Q1: 现有体系缺什么？](#q1-现有体系缺什么)
2. [Q2: @cortex/telemetry 的定位是什么？](#q2-cortextelemetry-的定位是什么)
3. [Q3: 价值在哪里？](#q3-价值在哪里)
4. [上下游关系](#上下游关系)
5. [核心类型定义](#核心类型定义)
6. [核心模块设计](#核心模块设计)
7. [注册机制](#注册机制)
8. [架构图](#架构图)
9. [文件结构](#文件结构)
10. [API 设计](#api-设计)
11. [与现有系统的集成](#与现有系统的集成)
12. [宪法一致性声明](#宪法一致性声明)
13. [实现计划](#实现计划)

---

## Q1: 现有体系缺什么？

### 1.1 现有可观测性能力清单

逐一审查现有 17 个包的可观测性相关能力：

| 包 | 现有能力 | 缺口 |
|------|---------|------|
| **`@cortex/engine`** | `PipelineObserver` 事件管道（`ObservableEvent` + `emit/on` 模式） | 仅有事件发布/订阅，无度量聚合、无结构化日志、无 span 追踪 |
| **`@cortex/notification`** | 四通道通知管线（urgent/important/routine/info） | 聚焦用户通知，不覆盖运行时指标 |
| **`@cortex/llm`** | 自包含的 `_auditLog`（写入 `.cortex/logs/api-calls.jsonl`） | 独自实现审计日志，非通用框架；指标（latency/token/error）无聚合接口 |
| **`@cortex/doctor`** | 构建时 monorepo 健康诊断 | 运行时组件健康检查完全空白 |
| **`@cortex/shared`** | `SafeErrorReporter`、`PipelineEventType`、`InvariantReporter` | 仅有类型定义，无统一采集/导出/聚合实现 |
| **`@cortex/config`** | `ENV_CORTEX_API_AUDIT` 环境变量 | 仅 LLM 审计相关，无通用 telemetry 配置域 |

### 1.2 六维缺口分析

#### 缺口①：运行时指标采集（Metrics）

当前没有任何机制能回答以下问题：

| 问题 | 现状 | 后果 |
|------|------|------|
| "LLM 单次请求平均耗时是多少？" | 只有 LlmAdapter 内部 `t0` + `duration_ms` 日志 | 无法聚合 P50/P95/P99 |
| "最近 5 分钟工具调用失败率？" | 散落在 PipelineObserver `NodeFailed` 事件中 | 需手动 grep 日志分析 |
| "MemoryStore 写入 QPS？" | 完全没采集 | 无法做容量规划 |
| "各 Agent 类型的 token 消耗趋势？" | LlmAdapter 有 `limiter.recordTokens()` 但仅用于配额 | 无法做成本追溯 |

**缺什么 → `@cortex/telemetry` 的 `MetricRegistry` + `Counter`/`Gauge`/`Histogram`**

#### 缺口②：分布式调用追踪（Tracing）

Agent 执行链 `Agent → Tool → LLM → Memory` 缺乏统一的 trace/span 关联：

```
当前：
  LlmAdapter.chat()           → 打印 "[LLM] 请求..." + "[LLM] 响应..."
  Toolkit.execute()           → 可能有自己的日志
  MemoryStore.write()         → 无日志
  PipelineObserver.emit()     → 独立事件，无父子 span 关联

期望：
  executeAll() ─── Span-1 (executeAll)
                   ├── Span-2 (Agent.spawn)
                   ├── Span-3 (Tool.execute) ─── Span-4 (LLM.chat)
                   │                               └── Span-5 (Memory.read)
                   └── Span-6 (Memory.write)
```

**缺什么 → `@cortex/telemetry` 的 `Tracer` + `Span`**

#### 缺口③：结构化日志（Structured Logging）

当前代码混杂两种日志模式：

| 模式 | 示例 | 问题 |
|------|------|------|
| `console.log("  🌐 [LLM] 请求...")` | LlmAdapter 中 10+ 处 | 不可按 level 过滤、不可 JSON 序列化、不可路由 |
| `console.warn(...)` | 零散分布 | 违反 coding-standards §五（禁止裸 console.warn） |
| `SafeErrorReporter(...)` | 统一但仅限错误 | 仅覆盖 error 场景，不覆盖 info/debug/warn |

宪法 §五 要求"生产代码走 PipelineObserver 管道"，但 PipelineObserver 是事件总线，不是日志框架——它缺少**级别控制**、**采样**、**结构化元数据**。

**缺什么 → `@cortex/telemetry` 的 `Logger`（leveled + structured）**

#### 缺口④：指标导出与后端适配（Export）

即使采集了指标，当前没有任何机制将其导出到外部系统：

| 后端 | 现状 |
|------|------|
| **Prometheus** | `/metrics` endpoint 不存在 |
| **OpenTelemetry** | OTLP exporter 不存在 |
| **Datadog** | DD StatsD 客户端不存在 |
| **JSON Lines 文件** | 仅有 LlmAdapter 自建的 audit log |
| **内存轮询** | 无 `snapshot()` API 供管理命令查询 |

**缺什么 → `@cortex/telemetry` 的 `MetricExporter` 接口 + 内置实现**

#### 缺口⑤：运行时健康检查（Health Check）

`@cortex/doctor` 是**构建时/静态**健康诊断，不覆盖运行时组件健康：

| 组件 | 运行时健康检查 | 现状 |
|------|--------------|------|
| LlmAdapter | API key 是否有效？ | 无检查 |
| MemoryStore | 数据库连接是否正常？ | 无检查 |
| AgentPool | 所有 Agent 是否存活？ | 无检查 |
| Toolkit | 文件系统是否可读写？ | 无检查 |
| Scheduler | 任务板是否有死锁？ | 无检查 |

**缺什么 → `@cortex/telemetry` 的 `HealthRegistry` + `HealthCheck` 接口**

#### 缺口⑥：统一审计轨迹（Audit Trail）

LlmAdapter 有自己的审计日志（`api-calls.jsonl`），但其他关键操作无审计：

| 操作 | 是否有审计 | 现状 |
|------|-----------|------|
| LLM API 调用 | ✅ LlmAdapter 自建 | 但格式非标准化，无法统一消费 |
| 工具执行 | ❌ 无 | 不知道谁调了什么工具、结果如何 |
| Agent 生成/销毁 | ❌ 无 | 不知道 Agent 生命周期 |
| 配置变更 | ❌ 无 | 不知道配置何时被修改 |
| 记忆写入/归档 | ❌ 无 | 不可追溯记忆变化 |

**缺什么 → `@cortex/telemetry` 的 `Auditor` + `AuditEvent`**

### 1.3 缺口总览矩阵

| 缺口维度 | 当前状态 | 本包填补方式 | 优先 |
|---------|---------|-------------|------|
| **指标采集** | 零散、无聚合 | `MetricRegistry` + `Counter`/`Gauge`/`Histogram`/`Duration` | **P0** |
| **调用追踪** | 无 span 关联 | `Tracer` + `Span`（轻量，不依赖 OpenTelemetry SDK） | **P0** |
| **结构化日志** | `console.log` 散落 + PipelineObserver 事件不可按 level 过滤 | `Logger`（leveled + 结构化字段 + 采样） | **P1** |
| **指标导出** | 无统一出口 | `MetricExporter` 接口 + 内置 Console/JSONL/Prometheus 实现 | **P1** |
| **健康检查** | 仅构建时静态 | `HealthRegistry` + `IHealthCheck` 接口 | **P2** |
| **审计轨迹** | 仅 LLM 调用自建 | `Auditor` + `AuditEvent` + 可插拔 AuditStore | **P2** |

---

## Q2: @cortex/telemetry 的定位是什么？

### 2.1 一句话定位

> **`@cortex/telemetry` 是 Cortex 运行时的统一遥测套件——提供指标采集、调用追踪、结构化日志、健康检查与审计轨迹的标准化接口和默认实现，填补从 PipelineObserver 事件总线到生产级可观测性之间的六维缺口。**

### 2.2 核心原则

1. **轻量内聚** — 不依赖 OpenTelemetry SDK、Prometheus 客户端等外部遥测库。核心接口纯 TypeScript，零外部依赖。
2. **可插拔后端** — 所有数据（指标/日志/审计）通过 Exporter 接口输出，内置 Console/JSONL 实现，Prometheus/OTLP 等可通过 Adapter 模式接入。
3. **与 PipelineObserver 互补而非替代** — PipelineObserver 是进程内事件管道（emit/handler），`@cortex/telemetry` 是观测数据采集与导出层。Observer 事件是 telemetry 的**数据源之一**，而非输出目标。
4. **宪法 §十三 接口隔离** — 每个角色（仪表采集者、追踪者、日志记录者、健康检查者）独立接口，无"瑞士军刀接口"。
5. **宪法 §九 外部具体化** — 对外暴露最小化稳定契约，内部实现可随时替换。

### 2.3 定位边界

```
                    ┌──────────────────────────────────────────┐
                    │      Cortex 可观测性三层架构（v2 提升）    │
                    ├──────────────────────────────────────────┤
                    │                                          │
┌─────────────────┐  │  ┌──────────────────────────────────┐    │
│ PipelineObserver│  │  │  @cortex/telemetry（新增）         │    │
│ (事件总线)      │  │  │                                   │    │
│                 │  │  │  MetricRegistry    ← 采集运行时   │    │
│ ObservableEvent │  │  │  ├─ Counter                      │    │
│ emit/on         │  │  │  ├─ Gauge                        │    │
│ 进程内          │  │  │  ├─ Histogram                    │    │
│                 │  │  │  └─ Duration                     │    │
│ 数据源          │──│──│                                   │    │
│    ↓            │  │  │  Tracer / Span     ← 调用追踪    │    │
│ 本包消费        │  │  │  Logger            ← 结构化日志  │    │
│ PipelineObserver│  │  │  HealthRegistry    ← 健康检查     │    │
│ 事件并转化为    │  │  │  Auditor           ← 审计轨迹     │    │
│ 指标/日志       │  │  │                                   │    │
│                 │  │  │  MetricExporter    ← 可插拔导出   │    │
│                 │  │  │  ├─ ConsoleExporter              │    │
│                 │  │  │  ├─ JsonlExporter                │    │
│                 │  │  │  ├─ PrometheusExporter (Adapter) │    │
│                 │  │  │  └─ OtlpExporter (Future)        │    │
│                 │  │  └──────────────────────────────────┘    │
│                 │  │                                          │
│ @cortex/doctor  │  │  构建时静态健康诊断                      │
│ (静态健康)      │  │  ↑ 互补 ↑                                │
│                 │  │  @cortex/telemetry 运行时动态健康检查    │
└─────────────────┘  └──────────────────────────────────────────┘
```

### 2.4 职责清单

#### ✅ 属于本包职责

| 职责 | 说明 |
|------|------|
| **指标采集** | Counter（计数）、Gauge（瞬时值）、Histogram（分布）、Duration（耗时） |
| **指标聚合** | Histogram 的 P50/P90/P95/P99 分位值计算 |
| **调用追踪** | Span 创建/结束、父子 Span 关联、Span 属性注入 |
| **结构化日志** | 按级别（debug/info/warn/error/fatal）输出结构化 JSON 日志 |
| **健康检查** | 组件健康检查接口、健康注册表、聚合健康状态 |
| **审计轨迹** | 审计事件记录、查询历史、可插拔审计存储 |
| **指标导出** | 统一 Exporter 接口 + Console/JSONL 内置实现 + Prometheus Adapter |
| **PipelineObserver 桥接** | 自动将 Observer 事件转化为指标/日志的 `BridgeObserver` |
| **TelemetryProvider 注册** | 全局遥测工厂注册机制（与 engine 插件体系对齐） |
| **根 Span 自动注入** | `withRootSpan(name, fn)` 自动为引擎顶层操作创建根 Span |

#### ❌ 不属于本包职责

| 职责 | 归属 |
|------|------|
| 进程内事件管道 | `@cortex/shared` 的 `PipelineObserver` |
| 用户通知推送 | `@cortex/notification` |
| 构建时静态健康诊断 | `@cortex/doctor` |
| 服务发现/配置中心 | 非当前架构范围 |
| 日志文件轮转/管理 | 运行时环境或 PM2 等外部工具负责 |
| 告警规则引擎 | 外部监控系统（Prometheus AlertManager / Datadog Monitor） |
| 错误跟踪（Sentry） | Sentry SDK 独立接入，本包提供 Adapter 桥接 |

### 2.5 依赖方向

```
@cortex/telemetry
  ├── 依赖: @cortex/shared（ObservableEvent, PipelineEventType, SafeErrorContext 等类型）
  ├── 依赖: @cortex/config（ENV_* 常量, TelemetryConfig 接口）
  ├── 依赖: 无外部遥测库（核心零外部依赖）
  │
  ├── 被依赖: @cortex/engine（bootstrapEngine 中初始化 telemetry）
  ├── 被依赖: @cortex/cli（doctor 子命令展示运行时健康状态）
  └── 被依赖: CI/管理脚本（导出指标快照）
```

---

## Q3: 价值在哪里？

### 3.1 直接价值（开发者体验）

| 价值点 | 场景 | 收益 |
|-------|------|------|
| **一键查看运行时健康** | `telemetry.health()` 返回全部组件健康状态 | 从 grep 日志的 5 分钟缩短到 < 100ms |
| **LLM 调用延迟可视化** | `telemetry.metric("llm.chat.duration").histogram()` 输出 P95 | 发现性能退化时可快速定位到模型或 API Key |
| **工具调用审计追溯** | `auditor.query({ type: "tool.execute", timeRange })` | 排查"谁在什么时候调了什么工具" |
| **结构化日志替代 console.log** | `logger.info("Agent spawned", { agentType, instanceId })` | 日志可 JSON 序列化、可按 level 过滤、可路由到文件/控制台/外部系统 |
| **PipelineObserver 事件自动转化指标** | BridgeObserver 自动统计 `NodeFailed` 事件计数 | 无需手写计数代码即可获得错误率指标 |

### 3.2 架构价值

| 价值点 | 说明 |
|-------|------|
| **填补可观测性六维缺口** | Metrics / Tracing / Logging / Export / Health / Audit 全覆盖 |
| **与 PipelineObserver 互补** | Observer 是事件总线（"发生了什么"），Telemetry 是观测层（"数据是多少"） |
| **零外部依赖核心** | 核心接口纯 TypeScript，不绑定 OpenTelemetry/Prometheus 等重型 SDK |
| **可插拔 Exporter** | Adapter 模式接入任意后端，内置 Console/JSONL 开箱即用 |
| **宪法合规** | 用 Logger 替代裸 console.log/console.warn（§五），用 Span 实现执行追踪（§九内部明细化） |

### 3.3 与 `@cortex/notification` 的边界

| 维度 | `@cortex/notification` | `@cortex/telemetry` |
|------|----------------------|---------------------|
| **消费者** | 用户（需要被通知的人） | 开发者/运维/监控系统 |
| **数据模型** | `NotificationEvent`（需 ack 的告警） | `MetricPoint` / `LogEntry` / `Span` / `AuditEvent` |
| **通道** | urgent/important/routine/info（用户交互） | exporter（Push/Pull 到后端） |
| **确认语义** | ackRequired（用户必须回应） | 无（观测数据无需确认） |
| **粒度** | 事件级（每事件一条通知） | 聚合级（Counter/Histogram 聚合后导出） |

**关系**：`@cortex/notification` 负责"需要用户知道并回应的事情"，`@cortex/telemetry` 负责"需要开发者/系统知道的事情"。

---

## 上下游关系

### 4.1 消费关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                      @cortex/telemetry                           │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ MetricModule  │  │ TraceModule  │  │ LoggerModule  │           │
│  │ (Counter,     │  │ (Tracer,     │  │ (Logger,      │           │
│  │  Gauge,       │  │  Span)       │  │  LogLevel)    │           │
│  │  Histogram,   │  └──────┬───────┘  └──────┬───────┘           │
│  │  Duration)    │         │                  │                   │
│  └──────┬───────┘         │                  │                   │
│         │                 │                  │                   │
│         ▼                 ▼                  ▼                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                    TelemetryPipeline                      │    │
│  │  (统一管线：采样 → 聚合 → 格式化 → 路由到 Exporter)       │    │
│  └────────────────────────┬─────────────────────────────────┘    │
│                           │                                       │
│         ┌─────────────────┼─────────────────┐                     │
│         ▼                 ▼                 ▼                     │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Console    │  │ JSONL        │  │ Prometheus   │              │
│  │ Exporter   │  │ Exporter     │  │ Exporter     │              │
│  │ (stdout)   │  │ (.jsonl)     │  │ (/metrics)   │              │
│  └────────────┘  └──────────────┘  └──────────────┘              │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ HealthModule │  │ AuditModule  │  │ BridgeObserver            │
│  │ (HealthCheck,│  │ (Auditor,    │  │ (PipelineObserver         │
│  │  Registry)   │  │  AuditEvent) │  │  → Telemetry 桥接)        │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐
│  @cortex/engine   │  │  @cortex/cli │  │  外部监控系统     │
│  PluginLoader     │  │  doctor 命令 │  │  Prometheus /    │
│  → 初始化 Telemetry│  │  → 展示健康  │  │  Datadog / OTLP  │
└──────────────────┘  └──────────────┘  └──────────────────┘
```

### 4.2 与 PipelineObserver 的协作模式

```
PipelineObserver 事件流                          Telemetry 管道
┌─────────────────────┐                      ┌──────────────────┐
│  Scheduler          │                      │  MetricRegistry   │
│  emit(NodeComplete) │── BridgeObserver ──▶ │  counter("node.   │
│                     │  监听 → 转化          │  complete").inc() │
│  emit(NodeFailed)   │── BridgeObserver ──▶ │  counter("node.   │
│                     │  监听 → 转化          │  failed").inc()   │
│  LlmAdapter         │                      │                   │
│  emit(?)            │── Logger.info() ────▶│  log { level:     │
│                     │  结构化日志           │  "info", msg, ... │
│  Toolkit.execute()  │── Tracer.start() ──▶ │  span {           │
│                     │  创建子 Span          │  parent: span-1,  │
│                     │                      │  name: "tool.x" } │
└─────────────────────┘                      └──────────────────┘
```

---

## 核心类型定义

### 5.1 指标核心类型（Metrics）

```typescript
// ============================================================
// 指标核心类型
// ============================================================

/** 指标类型枚举 */
export enum MetricType {
  Counter = "counter",     // 单调递增计数
  Gauge = "gauge",         // 可增可减的瞬时值
  Histogram = "histogram", // 数值分布统计
  Duration = "duration",   // 耗时统计（本质是 Histogram，但自动记录耗时单位）
}

/** 标签键值对 */
export interface MetricLabel {
  readonly key: string;
  readonly value: string;
}

/** 指标点——单个采集点的数据 */
export interface MetricPoint {
  /** 指标名称（如 "llm.chat.duration_ms"） */
  readonly name: string;
  /** 指标类型 */
  readonly type: MetricType;
  /** 值 */
  readonly value: number;
  /** 标签 */
  readonly labels: readonly MetricLabel[];
  /** 时间戳（Unix 毫秒） */
  readonly timestamp: number;
  /** Histogram 额外桶数据（仅在 type=Histogram 时存在） */
  readonly buckets?: ReadonlyArray<{ le: number; count: number }>;
}

/** 指标快照——某时刻全部指标的完整状态 */
export interface MetricSnapshot {
  readonly points: readonly MetricPoint[];
  readonly capturedAt: number;
}

// ─── Metric Instruments ──────────────────────────

/** Counter —— 单向递增计数器 */
export interface Counter {
  /** 名称 */
  readonly name: string;
  /** 标签 */
  readonly labels: readonly MetricLabel[];

  /** 递增（默认 +1） */
  inc(value?: number): void;
  /** 读取当前值 */
  get value(): number;
  /** 重置为 0 */
  reset(): void;
}

/** Gauge —— 可增减的瞬时值 */
export interface Gauge {
  readonly name: string;
  readonly labels: readonly MetricLabel[];

  /** 设为指定值 */
  set(value: number): void;
  /** 增加 */
  add(value: number): void;
  /** 减少 */
  sub(value: number): void;
  /** 读取当前值 */
  get value(): number;
}

/** Histogram —— 数值分布统计 */
export interface Histogram {
  readonly name: string;
  readonly labels: readonly MetricLabel[];

  /** 记录一个观测值 */
  observe(value: number): void;
  /** 读取分位值 */
  quantile(q: number): number;
  /** 读取所有桶计数 */
  get buckets(): ReadonlyArray<{ le: number; count: number }>;
  /** 读取当前总计数 */
  get count(): number;
  /** 读取当前总和 */
  get sum(): number;
  /** 重置 */
  reset(): void;
}

/** Duration —— 耗时统计（特殊 Histogram） */
export interface Duration {
  readonly name: string;
  readonly labels: readonly MetricLabel[];

  /** 记录耗时（毫秒） */
  record(ms: number): void;
  /** 获取耗时统计器（自动计算 start → stop 的差值） */
  timer(): DurationTimer;
  /** 读取 P50/P90/P95/P99 */
  get p50(): number;
  get p90(): number;
  get p95(): number;
  get p99(): number;
  get count(): number;
  get sum(): number;
  reset(): void;
}

/** 耗时计时器——start() 后 stop() 自动记录耗时 */
export interface DurationTimer {
  /** 开始计时 */
  start(): void;
  /** 结束计时，记录耗时到 Duration */
  stop(): number;
  /** 是否正在计时 */
  get running(): boolean;
}
```

### 5.2 追踪核心类型（Tracing）

```typescript
// ============================================================
// 追踪核心类型
// ============================================================

/** Span 状态 */
export enum SpanStatus {
  Ok = "ok",
  Error = "error",
  Unset = "unset",
}

/** Span 属性键值对 */
export interface SpanAttribute {
  readonly key: string;
  readonly value: string | number | boolean;
}

/** Span——一次操作的时间片段 */
export interface Span {
  /** Span ID */
  readonly spanId: string;
  /** Trace ID（关联同一调用链的全部 Span） */
  readonly traceId: string;
  /** 父 Span ID（undefined = 根 Span） */
  readonly parentSpanId?: string;
  /** Span 名称 */
  readonly name: string;
  /** 开始时间（Unix 毫秒） */
  readonly startTime: number;
  /** 结束时间（undefined = 未结束） */
  readonly endTime?: number;
  /** 状态 */
  status: SpanStatus;
  /** 属性 */
  readonly attributes: readonly SpanAttribute[];

  /** 设置属性 */
  setAttribute(key: string, value: string | number | boolean): void;
  /** 设置状态 */
  setStatus(status: SpanStatus): void;
  /** 记录错误 */
  recordError(error: Error): void;
  /** 结束 Span */
  end(): void;
  /** 是否已结束 */
  get ended(): boolean;
}

/** SnapshottedSpan——Span 的不可变快照（用于导出） */
export interface SpanSnapshot {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startTime: number;
  readonly endTime: number;
  readonly status: SpanStatus;
  readonly attributes: readonly SpanAttribute[];
  readonly durationMs: number;
}

/** Span 类型 */
export enum SpanKind {
  Internal = "internal",     // 内部操作
  Client = "client",         // 客户端请求（如 LLM API 调用）
  Server = "server",         // 服务端处理（如工具执行）
  Producer = "producer",     // 生产消息
  Consumer = "consumer",     // 消费消息
}

/** Tracer——Span 工厂 */
export interface Tracer {
  /** 创建并开始一个新的 Span */
  startSpan(
    name: string,
    options?: {
      kind?: SpanKind;
      parentSpan?: Span;
      attributes?: SpanAttribute[];
    },
  ): Span;

  /** 在有根 Span 的上下文中执行函数（自动传参根 Span） */
  withRootSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T>;

  /** 获取当前活动的 Span（用于自动注入父子关系） */
  getCurrentSpan(): Span | undefined;

  /** 设置当前活动的 Span */
  setCurrentSpan(span: Span | undefined): void;

  /** 强制 flush 所有 Span（仅对异步 Exporter 有意义） */
  flush(): Promise<void>;
}
```

### 5.3 结构化日志核心类型（Logging）

```typescript
// ============================================================
// 结构化日志核心类型
// ============================================================

/** 日志级别——与 SafeErrorReporter 严重级对齐扩展 */
export enum LogLevel {
  Debug = "debug",
  Info = "info",
  Warn = "warn",
  Error = "error",
  Fatal = "fatal",
}

/** 结构化日志字段 */
export interface LogField {
  readonly key: string;
  readonly value: unknown;
}

/** 日志条目 */
export interface LogEntry {
  readonly timestamp: number;
  readonly level: LogLevel;
  readonly message: string;
  readonly logger: string;      // 来源标识，如 "LlmAdapter", "Scheduler"
  readonly fields: readonly LogField[];
  readonly error?: { name: string; message: string; stack?: string };
  readonly spanId?: string;     // 关联的 Span ID（如果有）
  readonly traceId?: string;    // 关联的 Trace ID（如果有）
}

/** Logger——结构化日志记录器 */
export interface Logger {
  /** 记录 debug 级别日志 */
  debug(message: string, fields?: LogField[]): void;
  /** 记录 info 级别日志 */
  info(message: string, fields?: LogField[]): void;
  /** 记录 warn 级别日志 */
  warn(message: string, fields?: LogField[]): void;
  /** 记录 error 级别日志 */
  error(message: string, error?: Error, fields?: LogField[]): void;
  /** 记录 fatal 级别日志 */
  fatal(message: string, error?: Error, fields?: LogField[]): void;

  /** 带级别参数的通用日志方法 */
  log(level: LogLevel, message: string, options?: { error?: Error; fields?: LogField[] }): void;

  /** 创建子 Logger（继承父 Logger 的字段和配置） */
  child(fields: LogField[]): Logger;

  /** 获取当前日志级别 */
  get level(): LogLevel;

  /** 设置日志级别（低于此级别的不输出） */
  setLevel(level: LogLevel): void;
}
```

### 5.4 健康检查核心类型（Health）

```typescript
// ============================================================
// 健康检查核心类型
// ============================================================

/** 组件健康状态 */
export enum HealthStatus {
  Healthy = "healthy",
  Degraded = "degraded",   // 部分可用
  Unhealthy = "unhealthy", // 不可用
}

/** 健康检查结果 */
export interface HealthResult {
  readonly component: string;
  readonly status: HealthStatus;
  readonly message: string;
  readonly checkedAt: number;
  readonly durationMs: number;
  readonly metadata?: Record<string, unknown>;
}

/** 健康检查函数签名 */
export type HealthCheckFn = () => Promise<HealthResult> | HealthResult;

/** 健康检查注册项 */
export interface HealthRegistration {
  readonly component: string;
  readonly check: HealthCheckFn;
  readonly intervalMs?: number; // 可选：自动检查间隔
  readonly tags?: string[];     // 可选：分类标签
}

/** 聚合健康报告 */
export interface HealthReport {
  readonly overall: HealthStatus;
  readonly components: HealthResult[];
  readonly summary: {
    healthy: number;
    degraded: number;
    unhealthy: number;
    total: number;
  };
  readonly reportedAt: number;
}
```

### 5.5 审计轨迹核心类型（Audit）

```typescript
// ============================================================
// 审计轨迹核心类型
// ============================================================

/** 审计事件严重级别 */
export enum AuditSeverity {
  Info = "info",
  Warning = "warning",
  Critical = "critical",
}

/** 审计事件 */
export interface AuditEvent {
  /** 全局唯一 ID */
  readonly id: string;
  /** 事件类型（如 "llm.call", "tool.execute", "agent.spawn"） */
  readonly type: string;
  /** 严重级别 */
  readonly severity: AuditSeverity;
  /** 发生时间 */
  readonly timestamp: number;
  /** 来源组件 */
  readonly source: string;
  /** 操作摘要 */
  readonly summary: string;
  /** 操作细节（JSON 序列化后的字符串） */
  readonly detail?: string;
  /** 关联的 Trace ID（可选） */
  readonly traceId?: string;
  /** 关联的 Span ID（可选） */
  readonly spanId?: string;
  /** 是否成功 */
  readonly success: boolean;
}

/** 审计事件查询 */
export interface AuditQuery {
  readonly types?: string[];
  readonly sources?: string[];
  readonly severities?: AuditSeverity[];
  readonly timeRange?: { start: number; end: number };
  readonly success?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/** 审计事件查询结果 */
export interface AuditQueryResult {
  readonly events: AuditEvent[];
  readonly total: number;
  readonly hasMore: boolean;
}

/** 审计存储接口 */
export interface AuditStore {
  /** 写入审计事件 */
  write(event: AuditEvent): Promise<void>;
  /** 查询审计事件 */
  query(query: AuditQuery): Promise<AuditQueryResult>;
  /** 清理过期事件 */
  prune(olderThan: number): Promise<number>;
  /** 获取事件总数 */
  count(): Promise<number>;
}

/** Auditor——审计记录器 */
export interface Auditor {
  /** 记录审计事件 */
  record(event: Omit<AuditEvent, "id" | "timestamp">): Promise<string>;
  /** 查询审计事件 */
  query(query: AuditQuery): Promise<AuditQueryResult>;
  /** 创建子 Auditor（自动注入 source） */
  child(source: string): Auditor;
  /** 获取底层存储 */
  getStore(): AuditStore;
}
```

### 5.6 导出核心类型（Export）

```typescript
// ============================================================
// 导出核心类型
// ============================================================

/** Exporter 配置 */
export interface ExporterConfig {
  /** 导出间隔（毫秒）。0 = 实时导出 */
  readonly intervalMs: number;
  /** 是否启用 */
  readonly enabled: boolean;
}

/** MetricExporter——指标导出器接口 */
export interface MetricExporter {
  /** 导出器名称 */
  readonly name: string;
  /** 导出指标快照 */
  export(snapshot: MetricSnapshot): Promise<void>;
  /** 关闭导出器 */
  shutdown(): Promise<void>;
}

/** SpanExporter——Span 导出器接口 */
export interface SpanExporter {
  readonly name: string;
  export(spans: readonly SpanSnapshot[]): Promise<void>;
  shutdown(): Promise<void>;
}

/** LogExporter——日志导出器接口 */
export interface LogExporter {
  readonly name: string;
  export(entries: readonly LogEntry[]): Promise<void>;
  shutdown(): Promise<void>;
}

/** AuditExporter——审计事件导出器接口 */
export interface AuditExporter {
  readonly name: string;
  export(events: readonly AuditEvent[]): Promise<void>;
  shutdown(): Promise<void>;
}
```

### 5.7 Telemetry 配置类型

```typescript
// ============================================================
// Telemetry 配置（注册到 @cortex/config 的 TelemetryConfig 域）
// ============================================================

/** 指标采集配置 */
export interface MetricsConfig {
  /** 是否启用指标采集 */
  enabled: boolean;
  /** 默认标签（自动附加到所有指标） */
  defaultLabels?: Record<string, string>;
  /** Histogram 默认桶边界（毫秒） */
  histogramBucketsMs?: number[];
}

/** 追踪配置 */
export interface TracingConfig {
  /** 是否启用追踪 */
  enabled: boolean;
  /** 采样率（0.0 ~ 1.0）。1.0 = 全量采样 */
  sampleRate: number;
  /** 最大同时活跃 Span 数 */
  maxActiveSpans: number;
}

/** 日志配置 */
export interface LoggingConfig {
  /** 是否启用结构化日志 */
  enabled: boolean;
  /** 最低日志级别 */
  level: LogLevel;
  /** 格式化方式 */
  format: "json" | "pretty";
}

/** 健康检查配置 */
export interface HealthConfig {
  /** 是否启用健康检查 */
  enabled: boolean;
  /** 自动检查间隔（毫秒） */
  checkIntervalMs: number;
}

/** 审计配置 */
export interface AuditConfig {
  /** 是否启用审计 */
  enabled: boolean;
  /** 审计存储路径 */
  storePath?: string;
  /** 审计事件保留天数 */
  retentionDays: number;
}

/** 导出配置 */
export interface ExportConfig {
  /** Console 导出器配置 */
  console?: ExporterConfig & { format?: "json" | "pretty" };
  /** JSONL 文件导出器配置 */
  jsonl?: ExporterConfig & { path?: string };
  /** Prometheus 导出器配置 */
  prometheus?: ExporterConfig & { port?: number; path?: string };
}

/** 完整 Telemetry 配置 */
export interface TelemetryConfig {
  metrics: MetricsConfig;
  tracing: TracingConfig;
  logging: LoggingConfig;
  health: HealthConfig;
  audit: AuditConfig;
  export: ExportConfig;
}
```

---

## 核心模块设计

### 6.1 MetricRegistry — 指标注册表

**职责**：统一管理所有指标的创建、查询、快照采集。

```typescript
/**
 * MetricRegistry —— 指标注册表。
 *
 * 全局唯一实例，所有 Counter/Gauge/Histogram/Duration 通过此注册表创建。
 * 提供 snapshot() 方法供 Exporter 拉取全量指标快照。
 */
export interface MetricRegistry {
  /** 创建或获取 Counter */
  counter(name: string, options?: { labels?: MetricLabel[]; description?: string }): Counter;
  /** 创建或获取 Gauge */
  gauge(name: string, options?: { labels?: MetricLabel[]; description?: string }): Gauge;
  /** 创建或获取 Histogram */
  histogram(name: string, options?: { labels?: MetricLabel[]; description?: string; buckets?: number[] }): Histogram;
  /** 创建或获取 Duration */
  duration(name: string, options?: { labels?: MetricLabel[]; description?: string }): Duration;

  /** 采集当前所有指标的快照 */
  snapshot(): MetricSnapshot;

  /** 获取已注册的所有指标名称 */
  getMetricNames(): string[];

  /** 重置所有指标 */
  reset(): void;
}
```

**实现要点**：
- 内部使用 `Map<string, Instrument>` 存储，key = `name|labels_json`
- `counter()` 等方法是幂等的——同名+同标签返回同一实例
- `snapshot()` 遍历所有仪器，采集原子值
- 线程安全（Node.js 单线程无需锁）

### 6.2 TracerProvider — 追踪器工厂

**职责**：创建 Tracer 实例，管理 Span 生命周期，维护父子 Span 关系链。

```typescript
/**
 * TracerProvider —— 追踪器工厂。
 *
 * 管理 Trace ID 生成、Span 父子关系、活跃 Span 上下文。
 * 每个模块可通过 getTracer(name) 获取自己的 Tracer。
 */
export interface TracerProvider {
  /** 获取指定名称的 Tracer */
  getTracer(name: string): Tracer;

  /** 设置 SpanExporter */
  setExporter(exporter: SpanExporter): void;

  /** 强制 flush 所有 Tracer 的 Span */
  flushAll(): Promise<void>;

  /** 关闭 */
  shutdown(): Promise<void>;
}
```

**Span 父子关系实现**：
```
Tracer.startSpan("parent")
  → span.traceId = "trace-1"
  → span.spanId = "span-1"
  → setCurrentSpan(span)

Tracer.startSpan("child")
  → span.traceId = "trace-1"   // 继承父 trace
  → span.parentSpanId = "span-1"
  → span.spanId = "span-2"
```

**Span 导出时机**：
- `span.end()` 被调用时立即推送到 Exporter 缓冲区
- `flush()` 将缓冲区全部发送到 Exporter
- 缓冲区满（默认 64 条）自动 flush

### 6.3 LoggerFactory — 日志记录器工厂

**职责**：创建 Logger 实例，管理 LogExporter 管道。

```typescript
/**
 * LoggerFactory —— 日志记录器工厂。
 *
 * 每个模块通过 getLogger(name) 获取自己的 Logger。
 * Logger 输出的每条日志经过：过滤(level) → 格式化 → 路由到 Exporter。
 */
export interface LoggerFactory {
  /** 获取指定名称的 Logger */
  getLogger(name: string): Logger;

  /** 注册 LogExporter */
  addExporter(exporter: LogExporter): void;

  /** 移除 LogExporter */
  removeExporter(name: string): void;

  /** 设置全局最低日志级别 */
  setGlobalLevel(level: LogLevel): void;

  /** 关闭 */
  shutdown(): Promise<void>;
}
```

**结构化日志输出示例（JSON）**：
```json
{
  "timestamp": 1717200000000,
  "level": "info",
  "logger": "LlmAdapter",
  "message": "LLM chat completed",
  "fields": [
    { "key": "model", "value": "deepseek-v4-flash" },
    { "key": "duration_ms", "value": 1234 },
    { "key": "prompt_tokens", "value": 456 },
    { "key": "completion_tokens", "value": 789 }
  ],
  "spanId": "span-abc123",
  "traceId": "trace-def456"
}
```

### 6.4 HealthRegistry — 健康检查注册表

**职责**：管理健康检查函数的注册、执行、结果缓存。

```typescript
/**
 * HealthRegistry —— 健康检查注册表。
 *
 * 组件在初始化阶段 register() 自己的健康检查函数。
 * health() 执行所有检查并聚合为 HealthReport。
 * 支持缓存——intervalMs 内的检查结果不重复执行。
 */
export interface HealthRegistry {
  /** 注册健康检查 */
  register(registration: HealthRegistration): void;
  /** 注销健康检查 */
  unregister(component: string): void;
  /** 执行所有健康检查，返回聚合报告 */
  health(): Promise<HealthReport>;
  /** 获取指定组件的健康状态 */
  getComponentHealth(component: string): Promise<HealthResult | undefined>;
  /** 获取当前缓存的健康报告（不重新执行） */
  getCachedReport(): HealthReport | undefined;
}
```

### 6.5 AuditorProvider — 审计提供者

**职责**：创建 Auditor 实例，管理 AuditStore。

```typescript
/**
 * AuditorProvider —— 审计提供者。
 *
 * 每个模块通过 getAuditor(source) 获取自己的 Auditor。
 * Auditor 记录的事件统一写入 AuditStore。
 */
export interface AuditorProvider {
  /** 获取指定来源的 Auditor */
  getAuditor(source: string): Auditor;
  /** 设置 AuditStore */
  setStore(store: AuditStore): void;
  /** 设置 AuditExporter */
  setExporter(exporter: AuditExporter): void;
  /** 关闭 */
  shutdown(): Promise<void>;
}
```

### 6.6 BridgeObserver — PipelineObserver 桥接器

**职责**：监听 PipelineObserver 事件，自动转化为指标/日志。

```typescript
/**
 * BridgeObserver —— PipelineObserver 桥接器。
 *
 * 自动将 ObservableEvent 转化为：
 *   - Metric: 事件计数、耗时分布（从 payload 中提取）
 *   - Log: 结构化日志条目
 *   - Span: 事件关联 Span（若事件在 Span 上下文中）
 *
 * 映射规则通过注册表配置，默认映射见表 §6.6.1。
 */
export interface BridgeObserverConfig {
  /** 是否启用桥接 */
  enabled: boolean;
  /** 事件→指标的映射规则 */
  metricMappings: EventMetricMapping[];
  /** 事件→日志的映射规则 */
  logMappings: EventLogMapping[];
}

export interface EventMetricMapping {
  /** 事件类型（支持通配符后缀 *，如 "node.*" 匹配所有 node 事件） */
  eventType: string | "*";
  /** 目标指标名称 */
  metricName: string;
  /** 指标类型 */
  metricType: "counter" | "duration";
  /** 从 event payload 中提取 value 的字段路径（duration 类型用） */
  valueField?: string;
  /** 从 event payload 中提取标签的字段路径映射 */
  labelMappings?: Record<string, string>;
}

export interface EventLogMapping {
  eventType: string | "*";
  /** 日志级别 */
  logLevel: LogLevel;
  /** 消息模板（支持 {{payload.field}} 占位符） */
  messageTemplate: string;
}
```

**默认映射表**：

| 事件类型 | 指标 | 日志 |
|---------|------|------|
| `node.start` | `counter("node.start")` | `info("Node started: {{payload.nodeId}}")` |
| `node.complete` | `counter("node.complete")`, `duration("node.duration_ms")` | `info("Node completed: {{payload.nodeId}}")` |
| `node.failed` | `counter("node.failed")` | `error("Node failed: {{payload.nodeId}}", payload.error)` |
| `scheduler.layer.start` | `counter("scheduler.layer")` | `debug("Layer {{payload.layer}} started")` |
| `scheduler.done` | `duration("scheduler.total_duration_ms")` | `info("Scheduler done: {{payload.completed}}/{{payload.total}}")` |
| `memory.db_write_failed` | `counter("memory.write_failed")` | `error("Memory write failed")` |
| `agent_pool.invariant_violation` | `counter("agent_pool.invariant")` | `warn("Agent pool invariant violation")` |
| 未匹配事件 | — | `debug("Event: {{type}}")` |

### 6.7 TelemetryPipeline — 统一管线

**职责**：组合所有模块，提供统一初始化和生命周期管理。

```typescript
/**
 * TelemetryPipeline —— 遥测统一管线。
 *
 * 组合 MetricRegistry + TracerProvider + LoggerFactory +
 * HealthRegistry + AuditorProvider + BridgeObserver 为统一入口。
 * 在 bootstrapEngine 阶段初始化。
 */
export interface TelemetryPipeline {
  // ── 子模块访问 ──
  readonly metrics: MetricRegistry;
  readonly tracerProvider: TracerProvider;
  readonly loggerFactory: LoggerFactory;
  readonly health: HealthRegistry;
  readonly auditor: AuditorProvider;
  readonly bridge: BridgeObserver;

  // ── 初始化 ──
  /** 初始化所有子模块并启动后台任务 */
  init(config: TelemetryConfig): Promise<void>;

  // ── 导出 ──
  /** 注册 MetricExporter */
  addMetricExporter(exporter: MetricExporter): void;
  /** 注册 SpanExporter */
  addSpanExporter(exporter: SpanExporter): void;
  /** 注册 LogExporter */
  addLogExporter(exporter: LogExporter): void;

  // ── 生命周期 ──
  /** 关闭所有子模块 */
  shutdown(): Promise<void>;

  // ── 便捷方法 ──
  /** 获取当前快照 + 健康报告 + 审计摘要 的统一状态对象 */
  status(): Promise<TelemetryStatus>;
}

/** Telemetry 统一状态 */
export interface TelemetryStatus {
  health: HealthReport;
  metrics: MetricSnapshot;
  activeSpanCount: number;
  loggerCount: number;
  auditCount: number;
  uptimeMs: number;
}
```

---

## 注册机制

### 7.1 设计动机

现有 engine 插件体系（`EnginePlugin` + `PluginLoader`）是子系统级别的注册——适合 `PipelineObserver`、`Scheduler`、`MemoryStore` 等重量级组件。Telemetry 的注册需求不同：

| 维度 | Engine 插件 | Telemetry 注册 |
|------|------------|----------------|
| 粒度 | 子系统级（~10 个） | 仪器/Exporter/健康检查级（可能 50+ 个） |
| 注册时机 | bootstrap 时一次 | 运行时动态（工具调用时创建临时指标） |
| 消费者 | 开发者 | 开发者 + 各模块内部 |
| 生命周期 | 跟随引擎 | 跟随 TelemetryPipeline |

因此 telemetry 采用**注册表模式**而非**插件模式**——注册表是 Map-like 的键值存储，运行时可动态增减。

### 7.2 TelemetryProvider — 全局遥测提供者

```typescript
/**
 * TelemetryProvider —— 全局遥测提供者。
 *
 * 提供全局静态访问点，供运行时各模块获取 MetricRegistry / Tracer / Logger 等。
 * 在 bootstrapEngine 阶段由 TelemetryPipeline.init() 注入。
 *
 * 使用示例：
 * ```typescript
 * // 在任意模块中
 * const counter = TelemetryProvider.metrics.counter("tool.executions");
 * counter.inc();
 *
 * const tracer = TelemetryProvider.tracerProvider.getTracer("Toolkit");
 * const span = tracer.startSpan("tool.execute");
 * // ... 执行操作 ...
 * span.end();
 *
 * const logger = TelemetryProvider.loggerFactory.getLogger("FileLockManager");
 * logger.info("Lock acquired", [{ key: "file", value: "config.json" }]);
 * ```
 */
export class TelemetryProvider {
  private static _instance: TelemetryPipeline | null = null;

  /** 注入 TelemetryPipeline 实例（由 bootstrapEngine 调用） */
  static inject(pipeline: TelemetryPipeline): void {
    TelemetryProvider._instance = pipeline;
  }

  /** 获取当前的 TelemetryPipeline 实例 */
  static get pipeline(): TelemetryPipeline {
    if (!TelemetryProvider._instance) {
      throw new Error("TelemetryProvider not initialized. Call TelemetryProvider.inject(pipeline) first.");
    }
    return TelemetryProvider._instance;
  }

  /** 获取 MetricRegistry */
  static get metrics(): MetricRegistry {
    return TelemetryProvider.pipeline.metrics;
  }

  /** 获取 TracerProvider */
  static get tracerProvider(): TracerProvider {
    return TelemetryProvider.pipeline.tracerProvider;
  }

  /** 获取 LoggerFactory */
  static get loggerFactory(): LoggerFactory {
    return TelemetryProvider.pipeline.loggerFactory;
  }

  /** 获取 HealthRegistry */
  static get health(): HealthRegistry {
    return TelemetryProvider.pipeline.health;
  }

  /** 获取 AuditorProvider */
  static get auditor(): AuditorProvider {
    return TelemetryProvider.pipeline.auditor;
  }

  /** 是否已初始化 */
  static get initialized(): boolean {
    return TelemetryProvider._instance !== null;
  }

  /** 重置（主要用于测试） */
  static reset(): void {
    TelemetryProvider._instance = null;
  }
}
```

### 7.3 Exporter 注册机制

```typescript
// MetricExporter 注册（在 TelemetryPipeline.init 前注册）
const pipeline = new TelemetryPipelineImpl();
pipeline.addMetricExporter(new ConsoleMetricExporter());
pipeline.addMetricExporter(new JsonlMetricExporter({ path: "./telemetry/metrics.jsonl" }));
pipeline.addSpanExporter(new ConsoleSpanExporter());
pipeline.addLogExporter(new JsonlLogExporter({ path: "./telemetry/logs.jsonl" }));

// 初始化
await pipeline.init(config);
TelemetryProvider.inject(pipeline);
```

### 7.4 健康检查注册机制

```typescript
// 组件在 init 阶段注册健康检查
class MyComponent {
  async init(telemetry: TelemetryPipeline): Promise<void> {
    telemetry.health.register({
      component: "my-component",
      check: async () => {
        const ok = await this.ping();
        return {
          component: "my-component",
          status: ok ? HealthStatus.Healthy : HealthStatus.Unhealthy,
          message: ok ? "Component is operational" : "Component ping failed",
          checkedAt: Date.now(),
          durationMs: 0,
        };
      },
      intervalMs: 30_000, // 每 30 秒自动检查
      tags: ["core"],
    });
  }
}
```

### 7.5 预定义指标注册清单

TelemetryPipeline.init() 时自动注册以下内置指标：

| 指标名称 | 类型 | 标签 | 用途 |
|---------|------|------|------|
| `telemetry.uptime_ms` | Gauge | — | Telemetry 运行时长 |
| `telemetry.metric_count` | Gauge | — | 已注册指标数量 |
| `telemetry.active_spans` | Gauge | — | 当前活跃 Span 数 |
| `telemetry.export.errors` | Counter | `exporter` | Exporter 导出失败次数 |
| `telemetry.export.batch_size` | Histogram | `exporter`, `type` | Exporter 每批导出条数 |
| `telemetry.bridge.events_received` | Counter | `event_type` | BridgeObserver 收到的事件数 |
| `telemetry.bridge.events_mapped` | Counter | `event_type` | 成功映射的事件数 |

### 7.6 与 Engine 插件体系的集成

Telemetry 作为一个特殊的"基础设施插件"在 bootstrapEngine 中初始化：

```
bootstrapEngine()
  ├── 1. loadConfig()
  ├── 2. injectRegistryFromConfig()
  ├── 3. initTelemetry()          ← 新增：在加载 Engine 插件之前初始化
  │      ├── new TelemetryPipelineImpl()
  │      ├── 注册 Exporter（从 config 读取）
  │      ├── pipeline.init(telemetryConfig)
  │      └── TelemetryProvider.inject(pipeline)
  ├── 4. PluginLoader.load()      ← Engine 插件启动时可使用 TelemetryProvider
  └── 5. assemble()
```

Engine 插件可安全使用 `TelemetryProvider`，因为它在插件加载前已初始化。

---

## 架构图

### 8.1 模块依赖

```
┌─────────────────────────────────────────────────────────────────┐
│                      @cortex/telemetry                           │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │                    TelemetryPipeline                          ││
│  │                   （统一门面 + 生命周期）                       ││
│  └──┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬─────────┘│
│     │      │      │      │      │      │      │      │          │
│     ▼      ▼      ▼      ▼      ▼      ▼      ▼      ▼          │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐      │
│  │Metrics│Tracer│Logger│Health│Auditor│Bridge│Exporter│Provider││
│  │Reg. │Prov.│Factory│Reg. │Prov.│Obs.  │Mgr.  │(static)│      │
│  └──┬──┘ └──┬─┘ └──┬──┘ └──┬──┘ └──┬─┘ └──┬─┘ └──┬──┘ └──────┘│
│     │       │       │       │       │      │       │            │
│     ▼       ▼       ▼       ▼       ▼      ▼       ▼            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Exporter 实现层                                           │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐              │   │
│  │  │ Console  │ │ JSONL    │ │ Prometheus   │              │   │
│  │  │ Exporter │ │ Exporter │ │ Exporter     │              │   │
│  │  └──────────┘ └──────────┘ └──────────────┘              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  审计存储层                                                  │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                   │   │
│  │  │ Memory   │ │ JSONL    │ │ SQLite   │                   │   │
│  │  │ AuditStore│ │ AuditStore│ │ AuditStore│                   │   │
│  │  └──────────┘ └──────────┘ └──────────┘                   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
         │          │          │           │
         ▼          ▼          ▼           ▼
┌────────────┐ ┌────────┐ ┌────────┐ ┌──────────┐
│@cortex/    │ │@cortex/│ │@cortex/│ │外部监控    │
│engine      │ │cli     │ │shared  │ │Prometheus  │
│(telemetry  │ │(doctor │ │(类型)  │ │Datadog    │
│ plugin)    │ │展示)   │ │        │ │OTLP       │
└────────────┘ └────────┘ └────────┘ └──────────┘
```

### 8.2 数据流

```
运行时操作（如 Tool.execute）
       │
       ├─ 1. Tracer.startSpan("tool.execute")
       │      → TracerProvider 创建 Span（traceId/spanId/父Span关联）
       │
       ├─ 2. MetricRegistry.counter("tool.executions").inc()
       │      → MetricRegistry 更新计数器
       │
       ├─ 3. LoggerFactory.getLogger("Toolkit").info(...)
       │      → LoggerFactory 过滤 level → 格式化 → 推送到 LogExporter
       │
       ├─ 4. PipelineObserver.emit(NodeComplete)
       │      → BridgeObserver 监听 →
       │         ├─ counter("node.complete").inc()
       │         └─ logger.info("Node completed: ...")
       │
       ├─ 5. Duration("tool.execute.duration").record(elapsed)
       │      → MetricRegistry 更新 Histogram 桶
       │
       └─ 6. Span.end()
              → TracerProvider flush SpanSnapshot → SpanExporter

导出周期（每 60s 或缓冲区满）：
       ├─ MetricRegistry.snapshot() → MetricExporter.export(snapshot)
       ├─ TracerProvider.flushAll() → SpanExporter.export(spans)
       ├─ LogExporter buffer flush
       └─ Auditor 查询 + AuditExporter.export(events)
```

---

## 文件结构

```
packages/telemetry/
├── DESIGN.md                          ← 本文档
├── package.json                       ← @cortex/telemetry
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                       ← 桶导出
│   │
│   ├── types/                         ← 核心类型定义
│   │   ├── index.ts                   ← 重导出
│   │   ├── metrics.ts                 ← MetricType, MetricPoint, Counter, Gauge, Histogram, Duration
│   │   ├── tracing.ts                 ← SpanStatus, SpanAttribute, Span, SpanSnapshot, SpanKind, Tracer
│   │   ├── logging.ts                 ← LogLevel, LogField, LogEntry, Logger
│   │   ├── health.ts                  ← HealthStatus, HealthResult, HealthCheckFn, HealthRegistration, HealthReport
│   │   ├── audit.ts                   ← AuditSeverity, AuditEvent, AuditQuery, AuditQueryResult, AuditStore, Auditor
│   │   ├── export.ts                  ← MetricExporter, SpanExporter, LogExporter, AuditExporter, ExporterConfig
│   │   ├── bridge.ts                  ← BridgeObserverConfig, EventMetricMapping, EventLogMapping
│   │   └── config.ts                  ← MetricsConfig, TracingConfig, LoggingConfig, HealthConfig, AuditConfig, ExportConfig, TelemetryConfig
│   │
│   ├── metrics/                       ← 指标模块
│   │   ├── index.ts
│   │   ├── metric-registry.ts         ← MetricRegistry 实现
│   │   ├── counter.ts                 ← CounterImpl
│   │   ├── gauge.ts                   ← GaugeImpl
│   │   ├── histogram.ts              ← HistogramImpl（带 HDR 分位值近似计算）
│   │   └── duration.ts               ← DurationImpl + DurationTimerImpl
│   │
│   ├── tracing/                       ← 追踪模块
│   │   ├── index.ts
│   │   ├── tracer-provider.ts         ← TracerProvider 实现
│   │   ├── tracer.ts                  ← TracerImpl
│   │   ├── span.ts                    ← SpanImpl
│   │   └── id-generator.ts           ← Trace ID / Span ID 生成
│   │
│   ├── logging/                       ← 日志模块
│   │   ├── index.ts
│   │   ├── logger-factory.ts          ← LoggerFactory 实现
│   │   └── logger.ts                  ← LoggerImpl（支持子 Logger）
│   │
│   ├── health/                        ← 健康检查模块
│   │   ├── index.ts
│   │   └── health-registry.ts         ← HealthRegistry 实现
│   │
│   ├── audit/                         ← 审计模块
│   │   ├── index.ts
│   │   ├── auditor-provider.ts        ← AuditorProvider 实现
│   │   ├── auditor.ts                 ← AuditorImpl
│   │   └── stores/                    ← 审计存储实现
│   │       ├── index.ts
│   │       ├── memory-audit-store.ts  ← 纯内存（默认，重启丢失）
│   │       ├── jsonl-audit-store.ts   ← JSONL 文件（进程间持久）
│   │       └── sqlite-audit-store.ts  ← SQLite（高性能查询，可选）
│   │
│   ├── bridge/                        ← PipelineObserver 桥接
│   │   ├── index.ts
│   │   ├── bridge-observer.ts         ← BridgeObserver 实现
│   │   └── default-mappings.ts        ← 默认事件→指标/日志映射表
│   │
│   ├── export/                        ← 导出模块
│   │   ├── index.ts
│   │   ├── exporter-manager.ts        ← Exporter 管理器（定时调度 + 缓冲区）
│   │   └── exporters/                 ← 内置 Exporter 实现
│   │       ├── index.ts
│   │       ├── console-metric.ts      ← ConsoleMetricExporter
│   │       ├── console-span.ts        ← ConsoleSpanExporter
│   │       ├── console-log.ts         ← ConsoleLogExporter
│   │       ├── jsonl-metric.ts        ← JsonlMetricExporter
│   │       ├── jsonl-span.ts          ← JsonlSpanExporter
│   │       ├── jsonl-log.ts           ← JsonlLogExporter
│   │       ├── jsonl-audit.ts         ← JsonlAuditExporter
│   │       └── prometheus-metric.ts   ← PrometheusMetricExporter（Adapter）
│   │
│   ├── pipeline/                      ← TelemetryPipeline 实现
│   │   ├── index.ts
│   │   ├── telemetry-pipeline.ts      ← TelemetryPipelineImpl
│   │   └── telemetry-provider.ts      ← TelemetryProvider（静态全局访问点）
│   │
│   ├── defaults.ts                    ← 默认配置常量
│   └── errors.ts                      ← 自定义错误类型（TelemetryError）
│
├── tests/
│   ├── unit/
│   │   ├── metrics/
│   │   │   ├── counter.test.ts
│   │   │   ├── gauge.test.ts
│   │   │   ├── histogram.test.ts
│   │   │   ├── duration.test.ts
│   │   │   └── metric-registry.test.ts
│   │   ├── tracing/
│   │   │   ├── span.test.ts
│   │   │   ├── tracer.test.ts
│   │   │   └── tracer-provider.test.ts
│   │   ├── logging/
│   │   │   ├── logger.test.ts
│   │   │   └── logger-factory.test.ts
│   │   ├── health/
│   │   │   └── health-registry.test.ts
│   │   ├── audit/
│   │   │   ├── auditor.test.ts
│   │   │   └── memory-audit-store.test.ts
│   │   ├── bridge/
│   │   │   └── bridge-observer.test.ts
│   │   └── export/
│   │       ├── console-exporters.test.ts
│   │       └── jsonl-exporters.test.ts
│   └── integration/
│       └── telemetry-pipeline.test.ts
```

---

## API 设计

### 9.1 核心 API（面向模块开发者）

```typescript
import { TelemetryProvider } from "@cortex/telemetry";
import type { SpanKind, LogField } from "@cortex/telemetry";

// ── 指标采集 ──
const execCounter = TelemetryProvider.metrics.counter("tool.executions", {
  labels: [{ key: "tool", value: "read_file" }],
  description: "工具执行次数",
});
execCounter.inc(); // +1
execCounter.inc(5); // +5

const activeTools = TelemetryProvider.metrics.gauge("tool.active");
activeTools.set(3);  // 设为 3
activeTools.add(1);  // +1 → 4
activeTools.sub(1);  // -1 → 3

const llmDuration = TelemetryProvider.metrics.duration("llm.chat.duration_ms", {
  labels: [{ key: "model", value: "deepseek-v4-flash" }],
});
const timer = llmDuration.timer();
timer.start();
// ... 执行 LLM 调用 ...
timer.stop(); // 自动记录耗时

const batchSize = TelemetryProvider.metrics.histogram("export.batch_size");
batchSize.observe(42);
batchSize.observe(128);
console.log(batchSize.quantile(0.95)); // P95

// ── 调用追踪 ──
const tracer = TelemetryProvider.tracerProvider.getTracer("Toolkit");
const span = tracer.startSpan("tool.execute", {
  kind: SpanKind.Client,
  attributes: [{ key: "tool.name", value: "read_file" }],
});
try {
  const result = await executeTool(params);
  span.setStatus(SpanStatus.Ok);
} catch (e) {
  span.recordError(e as Error);
  span.setStatus(SpanStatus.Error);
} finally {
  span.end();
}

// ── 根 Span 自动包装 ──
await tracer.withRootSpan("executeAll", async (rootSpan) => {
  // 在此函数内创建的 Span 自动以 rootSpan 为父
  const childSpan = tracer.startSpan("step1", { parentSpan: rootSpan });
  // ...
  childSpan.end();
});

// ── 结构化日志 ──
const logger = TelemetryProvider.loggerFactory.getLogger("FileLockManager");
logger.info("Lock acquired", [
  { key: "file", value: "config.json" },
  { key: "lockType", value: "exclusive" },
]);

try {
  await riskyOperation();
} catch (e) {
  logger.error("Operation failed", e as Error, [
    { key: "operation", value: "riskyOperation" },
  ]);
}

const childLogger = logger.child([{ key: "component", value: "sub-module" }]);
childLogger.debug("Sub module initialized");

// ── 审计 ──
const auditor = TelemetryProvider.auditor.getAuditor("Toolkit");
await auditor.record({
  type: "tool.execute",
  severity: AuditSeverity.Info,
  source: "Toolkit",
  summary: `Executed tool ${toolName}`,
  detail: JSON.stringify({ toolName, params }),
  success: true,
});

// ── 健康检查注册 ──
TelemetryProvider.health.register({
  component: "my-component",
  check: async () => ({
    component: "my-component",
    status: ok ? HealthStatus.Healthy : HealthStatus.Unhealthy,
    message: ok ? "OK" : "Failed",
    checkedAt: Date.now(),
    durationMs: 5,
  }),
  intervalMs: 30_000,
});

// ── 统一状态查询 ──
const status = await TelemetryProvider.pipeline.status();
console.log(status.health.overall);       // "healthy"
console.log(status.metrics.points.length); // 42
console.log(status.activeSpanCount);       // 3
```

### 9.2 面向集成方（bootstrapEngine / CLI）

```typescript
import { TelemetryPipelineImpl, ConsoleMetricExporter, JsonlLogExporter }
  from "@cortex/telemetry";

// 创建 TelemetryPipeline
const pipeline = new TelemetryPipelineImpl();

// 注册 Exporter
pipeline.addMetricExporter(new ConsoleMetricExporter());
pipeline.addMetricExporter(new JsonlMetricExporter({
  path: "./telemetry/metrics.jsonl",
}));
pipeline.addLogExporter(new JsonlLogExporter({
  path: "./telemetry/logs.jsonl",
}));

// 初始化
await pipeline.init({
  metrics: { enabled: true, histogramBucketsMs: [10, 50, 100, 500, 1000, 5000] },
  tracing: { enabled: true, sampleRate: 0.1, maxActiveSpans: 1000 },
  logging: { enabled: true, level: LogLevel.Info, format: "json" },
  health: { enabled: true, checkIntervalMs: 60_000 },
  audit: { enabled: true, retentionDays: 30 },
  export: {
    console: { enabled: true, intervalMs: 0, format: "pretty" },
    jsonl: { enabled: true, intervalMs: 10_000 },
  },
});

// 注入全局
import { TelemetryProvider } from "@cortex/telemetry";
TelemetryProvider.inject(pipeline);

// 关闭
await pipeline.shutdown();
```

### 9.3 CLI 集成（doctor 子命令）

```typescript
// packages/cli 新增 doctor telemetry 子命令
// $ cortex doctor telemetry

async function showTelemetryStatus(): Promise<void> {
  if (!TelemetryProvider.initialized) {
    console.log("Telemetry not initialized");
    return;
  }

  const status = await TelemetryProvider.pipeline.status();

  console.log("═══ Telemetry Status ═══");
  console.log(`Uptime: ${status.uptimeMs}ms`);
  console.log(`Metrics: ${status.metrics.points.length} points`);
  console.log(`Active Spans: ${status.activeSpanCount}`);
  console.log(`Audit Events: ${status.auditCount}`);

  console.log("\n─── Health ───");
  for (const comp of status.health.components) {
    const icon = comp.status === "healthy" ? "✅" : comp.status === "degraded" ? "⚠️" : "❌";
    console.log(`  ${icon} ${comp.component}: ${comp.message}`);
  }
  console.log(`\nOverall: ${status.health.overall}`);
}
```

---

## 与现有系统的集成

### 10.1 @cortex/shared 类型依赖

`@cortex/shared` 中已有 `PipelineEventType`、`ObservableEvent`、`SafeErrorContext`、`PipelinePriority` 等与 telemetry 直接相关的类型。

`@cortex/telemetry` **消费**这些类型（`BridgeObserver` 需要 `ObservableEvent`），但不新增 shared 中的类型——telemetry 的类型全部内聚在本包。

### 10.2 @cortex/config 配置域

在 `@cortex/config` 中新增 `TelemetryConfig` 域（如第五章所述）：

```typescript
// packages/config/src/interfaces/telemetry.ts (新增)
export interface TelemetryConfig {
  metrics: { enabled: boolean; histogramBucketsMs?: number[] };
  tracing: { enabled: boolean; sampleRate: number };
  logging: { enabled: boolean; level: "debug" | "info" | "warn" | "error" };
  health: { enabled: boolean; checkIntervalMs: number };
  audit: { enabled: boolean; retentionDays: number };
}
```

在 `CONFIG_DOMAINS` 注册表新增：
```typescript
{
  name: "telemetry",
  fileName: "telemetry.json",
  required: false,
  schema: telemetrySchema,
}
```

### 10.3 @cortex/engine bootstrap 集成

在 `bootstrapEngine()` 中新增一步：

```typescript
// bootstrap-engine.ts (新增 §3 位置)
import { TelemetryPipelineImpl, TelemetryProvider } from "@cortex/telemetry";
import { ConsoleMetricExporter, JsonlLogExporter } from "@cortex/telemetry";

async function initTelemetry(projectRoot: string, engineConfig: EngineConfig): Promise<TelemetryPipelineImpl> {
  const telemetryConfig = engineConfig.telemetry ?? DEFAULT_TELEMETRY_CONFIG;
  const pipeline = new TelemetryPipelineImpl();

  // 根据配置注册 Exporter
  if (telemetryConfig.export?.console?.enabled) {
    pipeline.addMetricExporter(new ConsoleMetricExporter({ format: telemetryConfig.export.console.format }));
  }
  if (telemetryConfig.export?.jsonl?.enabled) {
    const dir = path.join(projectRoot, ".cortex", "telemetry");
    pipeline.addMetricExporter(new JsonlMetricExporter({ path: path.join(dir, "metrics.jsonl") }));
    pipeline.addLogExporter(new JsonlLogExporter({ path: path.join(dir, "logs.jsonl") }));
  }

  await pipeline.init(telemetryConfig);
  TelemetryProvider.inject(pipeline);
  return pipeline;
}
```

### 10.4 PipelineObserver 桥接（BridgeObserver）

BridgeObserver 在 bootstrap 完成后自动挂载：

```typescript
// bootstrap-engine.ts (在 PluginLoader 加载后)
const observer = container.get<PipelineObserverPlugin>("pipelineObserver").getInstance();
const bridge = TelemetryProvider.pipeline.bridge;
bridge.attach(observer); // 监听所有 PipelineObserver 事件
```

### 10.5 与 @cortex/notification 的边界

当一个指标或事件**需要用户介入**时，telemetry 不直接调用 notification——而是通过 PipelineObserver 事件（其 notificationType 字段）间接驱动 notification：

```
LlmAdapter.chat() 失败
  → Logger.error("LLM API error", error, fields)     // telemetry：记日志
  → Counter("llm.chat.failed").inc()                 // telemetry：记指标
  → PipelineObserver.emit({                          // 事件总线（驱动 notification）
      type: PipelineEventType.NodeFailed,
      notificationType: "WARNING",
      ...
    })
  → NotificationPipe.push({                          // notification：通知用户
      type: "LLM_API_ERROR",
      channel: NotificationChannel.Important,
      ...
    })
```

---

## 宪法一致性声明

| 宪法条款 | 遵行方式 |
|---------|---------|
| **原则五** — 可观测事件走统一管道 | BridgeObserver 将 PipelineObserver 事件转化为指标/日志；本包不替代 PipelineObserver，而是增强 |
| **§五** — 禁止裸 console.* | Logger 提供结构化日志替代方案，模块通过 `TelemetryProvider.loggerFactory.getLogger(name)` 获取 Logger |
| **§九** — 内部明细化 + 外部具体化 | 内部：MetricRegistry/Counter/Gauge/Histogram 各司其职，数据流显式；外部：TelemetryPipeline 接口最小化（7 个子模块访问 + 3 个生命周期方法） |
| **§十一** — 方法签名三原则 | 所有公开函数显式返回类型；必选参数在前可选在后；禁止 boolean trap |
| **§十二** — 导入排序 | 遵循 Node 内置 → 第三方 → @cortex/* → 同包相对导入 |
| **§十三** — 接口隔离 | 6 个角色独立接口（MetricRegistry / TracerProvider / LoggerFactory / HealthRegistry / AuditorProvider / BridgeObserver），无瑞士军刀接口 |
| **§十三** — Discriminated Union | `SpanStatus` 枚举、`HealthStatus` 枚举、`LogLevel` 枚举替代 string 分叉 |
| **§十三** — readonly 优先 | 所有 `MetricPoint`、`SpanSnapshot`、`LogEntry`、`HealthResult`、`AuditEvent` 的字段均为 `readonly` |
| **§十四** — Adapter 模式 | PrometheusMetricExporter 通过 Adapter 模式接入，只需实现 `MetricExporter` 接口 |
| **§十四** — Observer 模式 | BridgeObserver 监听 PipelineObserver 事件，发布者不知晓 telemetry 的存在 |
| **§十四** — Factory 模式 | `MetricRegistry.counter()` / `TracerProvider.getTracer()` / `LoggerFactory.getLogger()` / `AuditorProvider.getAuditor()` 均为工厂方法 |
| **§七** — 硬编码禁令 | 所有配置值通过 `TelemetryConfig` 从 `@cortex/config` 注入，默认值在 `defaults.ts` 集中管理 |
| **§十** — 非空断言 | 禁止在 telemetry 代码中使用 `!` |
| **§十** — any 类型 | 公开 API 的返回类型禁止 any，用 `MetricSnapshot` 等具体类型替代 |
| **§四** — Barrel 铁律 | 新增公开符号必须更新 `src/index.ts` |

---

## 实现计划

### Phase 1: 核心基础设施（P0 — 3周）

| 模块 | 交付 | 依赖 |
|------|------|------|
| `types/` | 全部核心类型定义 | 无 |
| `metrics/` | MetricRegistry + Counter + Gauge + Histogram + Duration | types |
| `tracing/` | TracerProvider + Tracer + Span + ID 生成 | types |
| `logging/` | LoggerFactory + Logger（基本实现） | types |
| `pipeline/telemetry-pipeline.ts` | 组装 Metrics + Tracing + Logging 的最小管线 | 以上 |
| `pipeline/telemetry-provider.ts` | 全局静态访问点 | pipeline |
| `defaults.ts` | 默认配置常量 | types |

**验证标准**：
- Counter/Gauge/Histogram/Duration 的 inc/set/observe/record 全部正确
- Histogram 分位值计算准确（与已知分布验证）
- Span 父子关系正确，traceId 继承正确
- Logger 输出格式为合法 JSON
- TelemetryPipeline.init/shutdown 生命周期正确
- 全部测试通过

### Phase 2: 导出与桥接（P1 — 2周）

| 模块 | 交付 | 依赖 |
|------|------|------|
| `export/` | Console/JSONL exporter 系列 | Phase 1 |
| `bridge/` | BridgeObserver + 默认映射表 | Phase 1, @cortex/shared |
| `health/` | HealthRegistry + 健康检查接口 | Phase 1 |
| `export/exporter-manager.ts` | 定时调度 + 缓冲区管理 | export |

**验证标准**：
- ConsoleExporter 输出可读的指标/日志/span 文本
- JsonlExporter 输出合法的 `.jsonl` 文件
- BridgeObserver 正确监听 PipelineObserver 事件并转化为指标/日志
- HealthRegistry 的注册/执行/缓存正确
- ExporterManager 按 intervalMs 定时导出

### Phase 3: 审计与 Prometheus（P2 — 2周）

| 模块 | 交付 | 依赖 |
|------|------|------|
| `audit/` | AuditorProvider + Auditor + MemoryAuditStore + JsonlAuditStore | Phase 1 |
| `export/prometheus-metric.ts` | PrometheusMetricExporter（HTTP `/metrics` endpoint） | Phase 2 |
| `bridge/default-mappings.ts` | 完整的默认事件→指标/日志映射表 | Phase 2 |
| 集成测试 | bootstrapEngine 中的 initTelemetry 集成 | Phase 1+2 |

**验证标准**：
- Auditor 记录/查询正常，AuditQuery 过滤条件正确
- PrometheusExporter 的 `/metrics` 输出符合 Prometheus 格式
- 默认映射表覆盖全部 PipelineEventType
- 集成测试验证 bootstrap → telemetry init → Engine 插件使用 TelemetryProvider 的全链路

### Phase 4: 高级功能（P3 — 1周）

| 模块 | 交付 | 依赖 |
|------|------|------|
| `logging/logger.ts` | 子 Logger（`child()`）继承字段 | Phase 1 |
| `audit/stores/sqlite-audit-store.ts` | SQLite 审计存储（高性能查询） | Phase 3 |
| CLI 集成 | `cortex doctor telemetry` 子命令 | Phase 2 |
| 性能优化 | Histogram 预分配桶、Span 池化、批量导出 | Phase 1+2 |

**验证标准**：
- 子 Logger 继承父 Logger 的字段
- SQLite 审计存储支持复杂查询（按 type/source/severity 过滤）
- CLI 子命令展示 telemetry 状态
- 高性能场景下（1000 metrics/sec）CPU 使用率 < 2%

---

## 附录：指标命名规范

遵循 OpenTelemetry 指标命名约定：

| 模式 | 示例 |
|------|------|
| `{domain}.{subsystem}.{operation}` | `llm.chat.duration_ms` |
| `{domain}.{subsystem}.{state}` | `tool.executions.active` |
| `{domain}.{operation}.{unit}` | `memory.write.duration_ms` |
| 用 `.` 分隔命名空间 | 从通用到具体：`telemetry.export.errors` |
| 用 `_` 分隔单词 | `active_spans`、`batch_size` |
| 单位后缀（推荐） | `_ms`、`_bytes`、`_count` |

**预注册指标清单**：

| 名称 | 类型 | 说明 |
|------|------|------|
| `llm.chat.count` | Counter | LLM 调用总次数 |
| `llm.chat.duration_ms` | Duration | LLM 调用耗时 |
| `llm.chat.tokens_total` | Counter | 总 token 消耗 |
| `llm.chat.tokens_prompt` | Counter | Prompt token 消耗 |
| `llm.chat.tokens_completion` | Counter | Completion token 消耗 |
| `llm.chat.errors` | Counter | LLM 调用失败次数 |
| `tool.execute.count` | Counter | 工具执行总次数 |
| `tool.execute.duration_ms` | Duration | 工具执行耗时 |
| `tool.execute.errors` | Counter | 工具执行失败次数 |
| `tool.active` | Gauge | 当前活跃工具数 |
| `memory.write.count` | Counter | 记忆写入次数 |
| `memory.read.count` | Counter | 记忆读取次数 |
| `memory.write.duration_ms` | Duration | 记忆写入耗时 |
| `memory.read.duration_ms` | Duration | 记忆读取耗时 |
| `memory.size` | Gauge | 记忆库条目数 |
| `agent.spawn.count` | Counter | Agent 生成次数 |
| `agent.destroy.count` | Counter | Agent 销毁次数 |
| `agent.active` | Gauge | 当前活跃 Agent 数 |
| `scheduler.execute.count` | Counter | 调度器执行次数 |
| `scheduler.execute.duration_ms` | Duration | 调度器执行耗时 |
| `scheduler.nodes_completed` | Counter | 已完成节点数 |
| `scheduler.nodes_failed` | Counter | 失败节点数 |
| `scheduler.replan.count` | Counter | 重规划次数 |
| `telemetry.uptime_ms` | Gauge | 遥测系统运行时长 |
| `telemetry.active_spans` | Gauge | 当前活跃 Span 数 |
| `telemetry.export.errors` | Counter | 导出失败次数 |

---

*文档结束。本设计文档基于对母项目 17 个现有包的全面分析产出，填补 Metrics / Tracing / Logging / Export / Health / Audit 六维缺口，与现有 PipelineObserver 事件总线互补并存。*
