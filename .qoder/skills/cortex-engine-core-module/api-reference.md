# API Reference — Engine Core 模块集成速查

## @cortex/resilience

### FixedTimeout（超时策略）

```typescript
import { FixedTimeout, type FixedTimeoutOptions } from "@cortex/resilience";

// ⚠️ 字段名是 durationMs，不是 timeoutMs！
const timeout = new FixedTimeout({
  durationMs: 30_000,        // 必填，正整数，毫秒
  cancelOnTimeout: true,     // 可选，默认 true
});

// 执行：返回 TimeoutResult<T>，不是直接 T
const result = await timeout.execute(async (signal) => {
  return await fetchData({ signal });
});

if (result.success) {
  console.log(result.value);      // T
  console.log(result.elapsedMs);  // number
} else {
  console.error(result.error);    // Error
}
```

### ExponentialBackoff（重试策略）

```typescript
import { ExponentialBackoff, type RetryOptions } from "@cortex/resilience";

const retry = new ExponentialBackoff({
  maxAttempts: 3,        // 必填
  baseDelayMs: 1000,     // 必填
  maxDelayMs: 10_000,    // 必填
});
```

### SimpleCircuitBreaker（断路器）

```typescript
import { SimpleCircuitBreaker, type SimpleCircuitBreakerOptions } from "@cortex/resilience";

const cb = new SimpleCircuitBreaker({
  name: "my-component",     // ⚠️ 必填！用于标识
  threshold: 5,              // 连续失败次数阈值
  halfOpenAfterMs: 60_000,   // 半开恢复时间
});
```

### Registry（统一编排）

```typescript
import { Registry, type ResilienceEvent } from "@cortex/resilience";

const registry = new Registry();

// 注册三件套
registry.register("component-name", { retry, circuitBreaker, timeout });

// 执行（自动 retry + breaker + timeout）
const result = await registry.execute("component-name", async () => {
  return await doSomething();
});

// 监听事件
registry.onEvent((event: ResilienceEvent) => {
  console.log(event.type, event.name);
});
```

### ResiliencePolicyFactory（引擎集成封装）

```typescript
import { ResiliencePolicyFactory, resilienceFactory } from "@cortex/engine";

// 使用全局单例
resilienceFactory.registerPolicies("my-component", {
  retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10000 },
  circuitBreaker: { threshold: 5, halfOpenAfterMs: 60000 },
  timeout: { timeoutMs: 30000 },  // ⚠️ 这里用的是 timeoutMs（ResilienceOptions 接口字段名）
});

const result = await resilienceFactory.execute("my-component", async () => {
  return await doSomething();
});
```

> **注意区分**：`ResilienceOptions.timeout.timeoutMs`（engine 层配置接口） vs `FixedTimeoutOptions.durationMs`（resilience 底层构造参数）。Factory 内部会做映射。

---

## @cortex/notification

### NotificationPipe

```typescript
import { NotificationPipe, NotificationChannel, type NotificationEvent } from "@cortex/notification";

// ⚠️ 方法名是 push，不是 send！
pipe.push({
  type: "scheduler.loop.crashed",  // 必填
  channel: NotificationChannel.Urgent,
  ackRequired: true,
  summary: "调度循环崩溃",
  detail: "第 3 轮未响应",
  sourceAgent: "scheduler",
  requestId: "req-xxx",            // 可选，自动生成
  timestamp: Date.now(),           // 可选，自动填充
});
```

### NotificationChannel 枚举

```typescript
NotificationChannel.Urgent     // 紧急（需 ack）
NotificationChannel.Important  // 重要
NotificationChannel.Routine    // 常规
NotificationChannel.Info       // 信息
```

### withSemantics（语义标注）

```typescript
import { withSemantics, type NotificationSemantics } from "@cortex/notification";

// NotificationSemantics = "FYI" | "WARNING" | "DECISION_REQUIRED"
const enhanced = withSemantics(baseEvent, "DECISION_REQUIRED");
```

### NotificationRuntime（引擎集成封装）

```typescript
import { NotificationRuntime, type NotificationRuntimeOptions } from "@cortex/engine";

const runtime = new NotificationRuntime(observer, notificationPipe, {
  eventSemantics: {
    [PipelineEventType.SchedulerLoopCrashed]: "DECISION_REQUIRED",
    [PipelineEventType.ErrorReported]: "WARNING",
  },
  enableTelemetry: true,  // 默认 true
});

runtime.start();
// ... later
runtime.stop();
```

---

## @cortex/telemetry

### recordTelemetry

```typescript
import { recordTelemetry } from "@cortex/telemetry";

// ⚠️ value 必须是 number，tags.value 必须是 string
await recordTelemetry(
  "component.event.name",     // name: string
  Date.now() - startTime,     // value: number（严禁传字符串！）
  [                           // tags: { key: string, value: string }[]
    { key: "component", value: "my-module" },
    { key: "error", value: String(err).slice(0, 200) },  // ⚠️ 数字/错误对象需 String() 转换
  ],
);

// 无 tags 时传空数组或不传
await recordTelemetry("simple.metric", 42);
```

### TelemetryData 完整结构

```typescript
interface TelemetryData {
  id: string;                      // 自动生成
  name: string;                    // 指标名
  value: number;                   // ⚠️ 必须是 number
  tags: readonly TelemetryTag[];   // { key: string, value: string }[]
  timestamp: number;               // 自动填充
  metadata?: Record<string, unknown>;
}
```

### 引擎遥测辅助函数

```typescript
import { getTelemetry, setTelemetry, shutdownTelemetry } from "@cortex/telemetry";

// 获取当前 collector 实例
const collector = getTelemetry();

// 替换 collector（测试用）
setTelemetry(mockCollector);

// 关闭
await shutdownTelemetry();
```

---

## @cortex/shared（PipelineObserver）

### 事件订阅

```typescript
import {
  type IPipelineObserver,
  type ObservableEvent,
  type PipelineHandler,
  PipelineEventType,
  PipelinePriority,
} from "@cortex/shared";

// ⚠️ 方法名是 on/off，不是 subscribe/unsubscribe
const handler: PipelineHandler = (event: ObservableEvent) => {
  console.log(event.type, event.payload);
};

observer.on(PipelinePriority.CRITICAL, handler);
observer.on(PipelinePriority.HIGH, handler);
observer.on(PipelinePriority.NORMAL, handler);

// 取消
observer.off(PipelinePriority.CRITICAL, handler);
```

### ObservableEvent 结构

```typescript
interface ObservableEvent {
  type: PipelineEventType | string;
  payload?: unknown;
  requestId?: string;
  timestamp?: number;
  priority?: PipelinePriority;
}
```

> ⚠️ `PipelineEventType` 是枚举，每个事件类型有独立值。不可将自定义字符串当作 `PipelineEventType` 使用，但可以用 `as string` 做兼容处理。

---

## 模块模板（完整骨架）

```typescript
// ============================================================
// @cortex/engine/core/<module-name> —— <一句话职责>
//
// @since v3.x.x
// @layer 引擎层 — <层级>
//
// 职责：
//   1. ...
//   2. ...
//
// 设计原则：
//   1. ...
//   2. ...
// ============================================================

import type { IPipelineObserver } from "@cortex/shared";
import { recordTelemetry } from "@cortex/telemetry";

/** 配置选项 */
export interface MyModuleOptions {
  /** ... */
  readonly someOption: string;
}

/**
 * MyModule —— <中文描述>。
 *
 * @example
 * ```typescript
 * const mod = new MyModule(options);
 * await mod.start();
 * ```
 */
export class MyModule {
  constructor(private readonly options: MyModuleOptions) {}

  async start(): Promise<void> {
    recordTelemetry("myModule.started", 0, [
      { key: "option", value: this.options.someOption },
    ]);
  }
}
```
