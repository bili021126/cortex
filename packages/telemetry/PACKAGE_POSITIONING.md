# @cortex/telemetry 包定位说明

> **文件版本**: v0.1.0  
> **更新日期**: 2026-05-31

---

## 一、为什么需要 @cortex/telemetry？

### 1.1 母项目可观测性缺口矩阵

在创建本包之前，我们对母项目全部 17+ 个现有包进行了系统性审查，识别出六维可观测性缺口：

| 缺口维度 | 当前状态 | 后果 |
|---------|---------|------|
| **指标采集** | 零散、无聚合——只有 LlmAdapter 内部 `t0` + `duration_ms` 日志 | 无法计算 P50/P95/P99，无法做容量规划 |
| **调用追踪** | 无 span 关联——Agent → Tool → LLM → Memory 调用链不可追溯 | 排查"哪个 Agent 导致 LLM 超时"需手动 grep 日志 |
| **结构化日志** | `console.log` 散落 + PipelineObserver 事件不可按 level 过滤 | 违反 coding-standards §五，生产环境无法按级别路由日志 |
| **指标导出** | 无统一出口——不存在 Console/Prometheus/OTLP 导出器 | 指标仅存在于进程内存，无法被外部监控系统采集 |
| **健康检查** | 仅 `@cortex/doctor` 的构建时静态诊断 | 运行时组件（LLM、Memory、AgentPool）健康状态完全不可知 |
| **审计轨迹** | 仅 LlmAdapter 自建 `api-calls.jsonl` | 工具执行、Agent 生命周期、配置变更等关键操作无审计 |

### 1.2 本包的填补方式

`@cortex/telemetry` 从最基础的**采集层**开始填补——提供 `ITelemetryCollector` 接口及其实现（ConsoleCollector / FileCollector），配合采样（Sampler）和批处理（Batcher）策略，为上层指标聚合、追踪、日志、导出模块奠定基础。

---

## 二、本包的定位

### 2.1 一句话定位

> **`@cortex/telemetry` 是 Cortex 运行时的统一遥测采集层——提供可插拔的 Collector 接口、采样策略、批处理策略和注册机制，是所有遥测数据（指标、日志、审计）进入管线的第一道关卡。**

### 2.2 在 Cortex 可观测性三层架构中的位置

```
                    ┌──────────────────────────────────────────┐
                    │      Cortex 可观测性三层架构               │
                    ├──────────────────────────────────────────┤
                    │                                          │
┌─────────────────┐  │  ┌──────────────────────────────────┐    │
│ PipelineObserver│  │  │  @cortex/telemetry（采集层）       │    │
│ (事件总线)      │  │  │                                   │    │
│                 │  │  │  Sampler（采样）                   │    │
│ ObservableEvent │  │  │   ├─ RateSampler                  │    │
│ emit/on         │  │  │   └─ ThresholdSampler             │    │
│ 数据源          │──│──│                                   │    │
│    ↓            │  │  │  Batcher（批处理）                  │    │
│                 │  │  │   ├─ SizeBatcher                  │    │
│                 │  │  │   └─ TimeBatcher                  │    │
│                 │  │  │                                   │    │
│                 │  │  │  Collector（采集器）               │    │
│                 │  │  │   ├─ ConsoleCollector             │    │
│                 │  │  │   ├─ FileCollector                │    │
│                 │  │  │   └─ (未来: HttpCollector 等)     │    │
│                 │  │  │                                   │    │
│                 │  │  │  CollectorRegistry（注册表）       │    │
│                 │  │  │   ├─ register()                   │    │
│                 │  │  │   ├─ registerFactory()            │    │
│                 │  │  │   └─ get()                        │    │
│                 │  │  └──────────────────────────────────┘    │
│                 │  │                                          │
│                 │  │  上层能力（未来 Phase 2+）                │
│                 │  │  MetricRegistry / Tracer / Logger / ...  │
│                 │  │  这些模块消费本包的 Collector 接口       │
└─────────────────┘  └──────────────────────────────────────────┘
```

### 2.3 与类似包的边界

| 对比维度 | `@cortex/telemetry` | `@cortex/shared` | `@cortex/notification` | `@cortex/doctor` |
|---------|-------------------|-----------------|----------------------|-----------------|
| **核心职责** | 遥测数据采集、采样、批处理 | 共享类型、枚举、工具函数 | 用户通知管道 | 构建时健康诊断 |
| **数据消费方** | 开发者/运维/监控系统 | 所有包的类型消费者 | 需要被通知的用户 | CI/开发者 |
| **运行时/构建时** | 运行时 | 编译时+运行时 | 运行时 | 构建时 |
| **生命周期** | 进程级（跟随 engine） | 类型级（无状态） | 进程级 | 命令级（一次执行） |
| **存储** | 文件/控制台（通过 Collector） | 无 | 无（即时推送） | 无 |

---

## 三、本包补足的"缺失领域"

### 3.1 缺失①：统一的遥测采集接口

**之前**：每个模块自己决定如何输出观测数据——`console.log`、`PipelineObserver.emit()`、自建 JSONL 文件，各自为政。

**之后**：所有遥测数据通过 `ITelemetryCollector` 接口统一采集。模块不关心数据最终写到控制台、文件还是远端，只需调用 `collector.collect(data)`。

### 3.2 缺失②：可配置的采样策略

**之前**：要么全采（性能开销大），要么全不采（观测盲区），没有中间选项。

**之后**：通过 `Sampler` 策略接口，可按比例（RateSampler）或按阈值（ThresholdSampler）精细控制采集范围。生产环境可用 10% 采样降低开销，调试时全量采集。

### 3.3 缺失③：可配置的批处理策略

**之前**：每条数据独立写入（I/O 开销大）或一次性全量写入（内存压力大），没有平衡策略。

**之后**：通过 `Batcher` 策略接口，可按数据量（SizeBatcher）或时间窗口（TimeBatcher）自动批量处理。文件 Collector 使用 SizeBatcher 减少写入次数，定时上报场景使用 TimeBatcher 控制上报频率。

### 3.4 缺失④：集中的 Collector 生命周期管理

**之前**：Collector 实例散落在各模块中，生命周期（初始化、刷新、关闭）无人统一管理。

**之后**：`CollectorRegistry` 统一管理所有 Collector 的注册、查找、刷新和关闭。支持惰性初始化（工厂模式），`flushAll()` / `shutdownAll()` 一键操作。

---

## 四、宪法一致性声明

| 宪法条款 | 遵行方式 |
|---------|---------|
| **原则五**（可观测事件走统一管道） | Collector 接口是遥测数据的统一入口。PipelineObserver 事件可通过 BridgeObserver（未来 Phase 2）转化为 TelemetryData 进入采集管线 |
| **§五**（禁止裸 console.*） | ConsoleCollector 集中管理控制台输出，替代各模块的裸 console.log |
| **§九**（内部明细化 + 外部具体化） | 内部：Collector → Sampler → Batcher 数据流清晰可追踪；外部：ITelemetryCollector 接口稳定、承诺薄 |
| **§十一**（方法签名三原则） | 所有公开方法显式返回类型；构造函数使用 options 对象避免 boolean trap |
| **§十二**（导入排序） | 遵循 Node 内置 → @cortex/* → 同包相对导入 |
| **§十三**（接口隔离） | ITelemetryCollector / ICollectorRegistry / Sampler / Batcher 各司其职，无瑞士军刀接口 |
| **§十三**（readonly 优先） | TelemetryData、TelemetryBatch、SamplerDecision 等共享数据字段均为 readonly |
| **§十三**（Discriminated Union） | FileCollectorOptions.mode 使用 "append" \| "overwrite" 字面量联合 |
| **§十四**（Adapter 模式） | ConsoleCollector / FileCollector 适配同一 ITelemetryCollector 接口 |
| **§十四**（Strategy 模式） | Sampler / Batcher 均为策略接口 + 多种实现，运行时可通过注册表切换 |
| **§十四**（Factory 模式） | CollectorRegistry.registerFactory() 支持惰性初始化 |
| **§七**（配置驱动） | 所有 Collector 配置通过 options 对象传入，默认值在构造函数中集中管理 |
| **§十**（禁止 any，禁止非空断言） | 公开 API 使用具体类型，无 `!` 非空断言 |
| **§四**（Barrel 铁律） | 所有公开符号在 src/index.ts 中统一导出 |

---

## 五、未来演化方向

### Phase 2 (规划中) — 度量与聚合

在采集层之上叠加：
- **MetricRegistry**：Counter、Gauge、Histogram、Duration 等指标仪器
- **Tracer / Span**：调用追踪的 span 创建与关联
- **Logger**：结构化日志的 leveled API
- **BridgeObserver**：PipelineObserver 事件 → TelemetryData 自动转化

### Phase 3 (远期) — 导出与集成

- **MetricExporter**：Prometheus / OTLP / Datadog 等后端适配
- **HealthRegistry**：运行时健康检查注册与聚合
- **Auditor**：统一审计轨迹

---

## 六、快速开始

```typescript
import {
  ConsoleCollector,
  FileCollector,
  CollectorRegistry,
  RateSampler,
  ThresholdSampler,
  SizeBatcher,
  TimeBatcher,
} from "@cortex/telemetry";
import type { TelemetryData } from "@cortex/telemetry";

// 1. 创建 Collector
const consoleCollector = new ConsoleCollector("dev", { format: "pretty" });
const fileCollector = new FileCollector("./telemetry/metrics.jsonl");

// 2. 注册到 Registry
const registry = new CollectorRegistry();
registry.register(consoleCollector);
registry.register(fileCollector);

// 3. 创建采样器（10% 比例采样 + 只采耗时 > 1000ms 的）
const rateSampler = new RateSampler(0.1);
const thresholdSampler = new ThresholdSampler(1000, "gt");

// 4. 创建批处理器（每 100 条一批 或 每 60 秒一批）
const sizeBatcher = new SizeBatcher(100);
const timeBatcher = new TimeBatcher(60_000);

// 5. 采集数据
const data: TelemetryData = {
  id: "evt-001",
  name: "llm.chat.duration_ms",
  value: 1234,
  tags: [{ key: "model", value: "deepseek-v4-flash" }],
  timestamp: Date.now(),
};

// 采样判断
if (rateSampler.decide(data).accept) {
  // 批处理
  const batch = sizeBatcher.add(data);
  if (batch) {
    // 分发批次到所有 Collector
    const collector = registry.get("dev");
    if (collector) {
      for (const entry of batch.entries) {
        await collector.collect(entry);
      }
    }
  }
}

// 6. 关闭
await registry.flushAll();
await registry.shutdownAll();
```

---

*本文件与 `DESIGN.md` 互补：DESIGN.md 描述完整设计蓝图，本文件聚焦本包在母项目中的定位与补齐逻辑。*
