# @cortex/resilience — 韧性策略统一抽象层

> **包名**: `@cortex/resilience` · **版本**: 0.1.0 · **私有**: true  
> **分层**: Layer 1（引擎/调度层）· **运行时依赖**: 零  
> **状态**: 设计中 · **治理关联**: 宪法 §五（补足声明）、§十五·四（包职责边界）

---

## 目录

- [概述](#概述)
- [安装](#安装)
- [核心概念](#核心概念)
- [快速开始](#快速开始)
- [API 速览](#api-速览)
- [使用场景](#使用场景)
- [扩展指南](#扩展指南)
- [迁移路径](#迁移路径)
- [与相关包的关系](#与相关包的关系)
- [设计文档](#设计文档)

---

## 概述

**@cortex/resilience** 是 Cortex 生态中**韧性策略的统一抽象层**，提供重试（Retry）、断路器（CircuitBreaker）、超时（Timeout）三大韧性模式的接口定义、内置实现和注册编排管理。

### 解决的问题

| 痛点 | 当前状态 | 本包解决方式 |
|------|---------|-------------|
| **韧性代码重复** | 重试逻辑在 llm-adapter/search-backend 等 4+ 处重复实现 | 统一 `IRetryPolicy` 接口 + 内置实现 |
| **断路器缺失** | CircuitBreaker 仅有测试用例，无生产实现 | `ICircuitBreaker` 接口 + 滑动窗口/连续失败实现 |
| **超时策略不可替换** | 11 处超时各写各的，`AbortSignal.timeout` / `Promise.race` / `setTimeout` 混用 | 统一 `ITimeoutPolicy` 接口 |
| **无法编排组合** | retry → circuitBreaker → timeout 嵌套需手动编码 | `ResilienceRegistry` 声明式组合编排 |
| **测试困难** | 测试韧性需 mock 网络/时间 | 策略可 mock + 时间虚拟化支持 |

### 三层抽象

```
┌──────────────────────────────────────────────┐
│              接口层 (Interfaces)               │
│  IRetryPolicy · ICircuitBreaker · ITimeoutPolicy │
└──────────────────┬───────────────────────────┘
                   │ implements
                   ▼
┌──────────────────────────────────────────────┐
│              实现层 (Implementations)          │
│  Retry:    Exponential / Linear / Jitter / NoRetry      │
│  Breaker:  SlidingWindow / ConsecutiveFailure / NoBreaker │
│  Timeout:  Fixed / Adaptive / NoTimeout                 │
└──────────────────┬───────────────────────────┘
                   │ uses
                   ▼
┌──────────────────────────────────────────────┐
│              编排层 (Registry)                 │
│  ResilienceRegistry · createResilience        │
│  组合执行: timeout → circuitBreaker → retry → fn │
└──────────────────────────────────────────────┘
```

### 策略组合顺序

```
ResilienceRegistry.execute(fn, options)
    │
    ├── ITimeoutPolicy.wrap(fn)       ← 最外层超时保护（墙钟时间）
    │   │
    │   └── ICircuitBreaker.call(fn)  ← 中间层熔断保护（防止重试冲击下游）
    │       │
    │       └── IRetryPolicy.execute(fn)  ← 内层重试（快速失败重试）
    │           │
    │           └── 实际业务调用
    │
    └── 异常传递: 重试耗尽 → 断路熔断 → 超时抛出 → 调用方捕获
```

---

## 安装

```bash
# 工作空间内
pnpm add @cortex/resilience --workspace

# 或者添加到 package.json
{
  "dependencies": {
    "@cortex/resilience": "workspace:*"
  }
}
```

### 前置要求

- Node.js >= 18（`AbortSignal.timeout` 原生支持）
- TypeScript >= 5.0（`AbortSignal.any` 类型支持）
- `tsconfig.json` 中需配置 `"target": "ES2022"` 或更高

---

## 核心概念

### 1. 重试策略 (IRetryPolicy)

控制「是否重试」「等待多久」「何时放弃」——不关心业务逻辑，只关注退避算法和终止条件。

| 实现 | 退避公式 | 适用场景 |
|------|---------|---------|
| `ExponentialBackoffRetry` | `baseDelay × 2^(attempt-1) + jitter` | LLM API / 网络请求 |
| `LinearBackoffRetry` | `baseDelay × attempt` | 轮询 / 速率限制等待 |
| `JitterBackoffRetry` | `random(0, cap)` | 分布式重试 / 惊群避免 |
| `NoRetry` | — | 占位 / 关闭重试 |

### 2. 断路器 (ICircuitBreaker)

保护下游依赖不被频繁失败的请求压垮。三态转换：

```
CLOSED ──(threshold exceeded)──→ OPEN ──(halfOpenAfterMs)──→ HALF_OPEN
  ↑                                                              │
  └─────────────────(success)────────────────────────────────────┘
  └────────────────────(failure)─────────────────────────────────→ OPEN
```

| 实现 | 判定依据 | 适用场景 |
|------|---------|---------|
| `SlidingWindowBreaker` | 时间窗口内失败率 | API 保护 / 下游健康监测 |
| `ConsecutiveFailureBreaker` | 连续失败次数 | 快速失败 / 简单熔断 |
| `NoBreaker` | — | 占位 / 关闭熔断 |

### 3. 超时策略 (ITimeoutPolicy)

为异步操作提供统一超时控制。支持 `AbortSignal.timeout` 自动降级。

| 实现 | 机制 | 适用场景 |
|------|------|---------|
| `FixedTimeoutPolicy` | 固定超时值 | 常规 API / 插件执行 |
| `AdaptiveTimeoutPolicy` | EMA 动态调整 | LLM API / 延迟波动大 |
| `NoTimeout` | — | 占位 / 关闭超时 |

### 4. 注册中心 (ResilienceRegistry)

管理策略实例的注册、查询、组合执行和事件监控。

---

## 快速开始

### 基本用法

```typescript
import { ResilienceRegistry, ExponentialBackoffRetry, FixedTimeoutPolicy } from "@cortex/resilience";

// 1. 创建注册中心
const registry = ResilienceRegistry.create();

// 2. 注册策略组
registry.register("llm-api", {
  retry: new ExponentialBackoffRetry({
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  }),
  timeout: new FixedTimeoutPolicy({ durationMs: 30000 }),
});

// 3. 在策略保护下执行
const result = await registry.execute("llm-api", async () => {
  const response = await fetch("https://api.example.com/chat", {
    method: "POST",
    body: JSON.stringify({ prompt: "Hello" }),
  });
  return response.json();
});
```

### 完整配置示例

```typescript
import {
  ResilienceRegistry,
  ExponentialBackoffRetry,
  SlidingWindowBreaker,
  AdaptiveTimeoutPolicy,
} from "@cortex/resilience";

const registry = ResilienceRegistry.create({
  timeout: new FixedTimeoutPolicy({ durationMs: 15000 }),
});

registry.register("llm-api", {
  retry: new ExponentialBackoffRetry({
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  }),
  circuitBreaker: new SlidingWindowBreaker("llm-api", {
    threshold: 0.5,        // 50% 失败率触发熔断
    windowMs: 60000,       // 60 秒滑动窗口
    halfOpenAfterMs: 30000, // 30 秒后尝试恢复
    maxHalfOpenRequests: 3,
    minimumCalls: 10,       // 至少 10 次调用才评估
  }),
  timeout: new AdaptiveTimeoutPolicy({
    durationMs: 30000,
    minTimeoutMs: 5000,
    maxTimeoutMs: 60000,
  }),
});

// 事件监听
registry.onEvent((event) => {
  if (event.type === "CIRCUIT_OPEN") {
    console.warn(`⚠️ Circuit ${event.name} opened!`);
  }
  if (event.type === "RETRY_ATTEMPT") {
    console.debug(`Retry ${event.attempt} for ${event.name}, waiting ${event.delayMs}ms`);
  }
});

// 健康检查快照
const snapshot = registry.snapshot();
// [{ name: 'llm-api', retry: 'exponential-backoff', circuitBreaker: {...}, timeout: 'adaptive-timeout' }]
```

---

## API 速览

### 创建与注册

| API | 说明 |
|-----|------|
| `ResilienceRegistry.create(defaults?)` | 创建注册中心实例 |
| `registry.register(name, policies)` | 注册策略组 |
| `registry.unregister(name)` | 卸载策略组 |
| `createResilience(options?)` | 一键创建带默认配置的注册中心 |

### 策略获取

| API | 说明 |
|-----|------|
| `registry.getRetry(name)` | 获取重试策略 |
| `registry.getCircuitBreaker(name)` | 获取断路器 |
| `registry.getTimeout(name)` | 获取超时策略 |

### 执行与监控

| API | 说明 |
|-----|------|
| `registry.execute(name, fn, overrides?)` | 组合执行 |
| `registry.snapshot()` | 策略快照 |
| `registry.reset()` | 全局重置 |
| `registry.onEvent(handler)` | 事件订阅 |

### 策略构造

| 类 | 构造参数 |
|----|---------|
| `ExponentialBackoffRetry(options)` | `RetryOptions & { jitterFactor? }` |
| `LinearBackoffRetry(options)` | `RetryOptions` |
| `JitterBackoffRetry(options)` | `RetryOptions` |
| `SlidingWindowBreaker(name, options)` | `string, CircuitBreakerOptions` |
| `ConsecutiveFailureBreaker(name, options)` | `string, CircuitBreakerOptions` |
| `FixedTimeoutPolicy(options)` | `TimeoutOptions` |
| `AdaptiveTimeoutPolicy(options)` | `TimeoutOptions & { minTimeoutMs?, maxTimeoutMs?, multiplier?, alpha? }` |

### 错误类型

| 错误 | 说明 |
|------|------|
| `CircuitBreakerOpenError` | 断路器熔断时抛出 |
| `TimeoutError` | 超时时抛出 |

---

## 使用场景

### 场景 1：LLM API 调用保护

```typescript
registry.register("llm-api", {
  retry: new ExponentialBackoffRetry({
    maxAttempts: 3,
    baseDelayMs: 1000,
    retryableErrors: [RateLimitError, NetworkError],
  }),
  circuitBreaker: new SlidingWindowBreaker("llm-api", {
    threshold: 0.5,
    windowMs: 60000,
    halfOpenAfterMs: 30000,
    minimumCalls: 10,
  }),
  timeout: new AdaptiveTimeoutPolicy({
    durationMs: 30000,
    minTimeoutMs: 5000,
    maxTimeoutMs: 60000,
  }),
});
```

### 场景 2：搜索后端调用

```typescript
registry.register("search-backend", {
  retry: new LinearBackoffRetry({
    maxAttempts: 2,
    baseDelayMs: 1000,
  }),
  circuitBreaker: new ConsecutiveFailureBreaker("search", {
    threshold: 3,
    halfOpenAfterMs: 10000,
  }),
  timeout: new FixedTimeoutPolicy({ durationMs: 15000 }),
});
```

### 场景 3：临时覆盖超时

```typescript
// 本次调用使用更短的超时
const result = await registry.execute("llm-api", () => llm.chat(prompt), {
  timeout: new FixedTimeoutPolicy({ durationMs: 5000 }),
});
```

### 场景 4：独立策略使用

```typescript
import { ExponentialBackoffRetry } from "@cortex/resilience";

const retry = new ExponentialBackoffRetry({
  maxAttempts: 3,
  baseDelayMs: 1000,
});

// 手动使用
async function fetchWithRetry(url: string): Promise<Response> {
  let attempt = 1;
  while (true) {
    try {
      return await fetch(url);
    } catch (err) {
      const delay = retry.nextDelay(attempt, err);
      if (delay <= 0 || !retry.shouldRetry(attempt, err)) throw err;
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}
```

---

## 扩展指南

### 自定义重试策略

```typescript
import type { IRetryPolicy } from "@cortex/resilience";

class HttpStatusRetry implements IRetryPolicy {
  readonly name = "http-status-retry";
  readonly maxAttempts = 5;
  private readonly retryableStatuses: Set<number>;

  constructor(retryableStatuses: number[]) {
    this.retryableStatuses = new Set(retryableStatuses);
  }

  nextDelay(attempt: number, error?: unknown): number {
    return Math.min(1000 * Math.pow(2, attempt - 1), 30000) + Math.random() * 500;
  }

  shouldRetry(attempt: number, error?: unknown): boolean {
    if (attempt >= this.maxAttempts) return false;
    if (error instanceof HttpError && this.retryableStatuses.has(error.status)) return true;
    return false;
  }

  reset(): void {}
}
```

### 自定义断路器

实现 `ICircuitBreaker` 接口即可，需保证线程安全（`call`/`recordSuccess`/`recordFailure` 可并发调用）。

### 自定义超时策略

实现 `ITimeoutPolicy` 接口即可，推荐使用 `AbortSignal` / `AbortController` 实现取消语义。

---

## 迁移路径

| 旧代码位置 | 替换方式 | 建议版本 |
|-----------|---------|---------|
| `llm-adapter._fetchWithRetry` | `ExponentialBackoffRetry` + `SlidingWindowBreaker` | v0.2.0 |
| `search-backend._delay` | `LinearBackoffRetry` | v0.2.0 |
| `mcp-client` 超时 | `FixedTimeoutPolicy` | v0.2.0 |
| `plugin-runner._withTimeout` | `FixedTimeoutPolicy` | v0.3.0 |
| 各包 `AbortSignal.timeout(xxx)` | `FixedTimeoutPolicy` / `AdaptiveTimeoutPolicy` | v0.3.0 |

迁移策略：保留旧实现 → 新增 `@cortex/resilience` 依赖 → 切换 → 删除旧代码。

---

## 与相关包的关系

| 包 | 关系 | 说明 |
|----|------|------|
| **@cortex/engine** | 消费方 | engine 可使用 registry 保护关键执行路径 |
| **@cortex/scheduler** | 消费方 | scheduler 可使用 RetryPolicy 保护调度步骤，用 CircuitBreaker 替换 ReplanManager 的类断路器行为 |
| **@cortex/llm** | 消费方 | llm-adapter 是最大的韧性代码重复源，优先迁移 |
| **@cortex/config** | 声明依赖 | 实际运行时零依赖，配置由调用方传入 |
| **@cortex/shared** | 声明依赖 | 共享类型可被消费，但 resilience 核心不依赖 shared |

### 不做的事

- ❌ 不包含业务级限流（Rate Limiting）—— 由 `@cortex/llm` 的 `RateLimiter` + `ManifoldGate` 负责
- ❌ 不包含降级（Degradation）—— 由 `SafeErrorReporter` / 业务回退逻辑负责
- ❌ 不包含优雅关闭（Graceful Shutdown）—— 由 `ShutdownWarden` / `LifecycleManager` 负责
- ❌ 不包含错误隔离（Error Isolation）—— 由 `PluginRunner` / `PipelineObserver` 负责
- ❌ 不包含缓存（Cache）—— 由 `LlmAdapter` LRU 缓存负责

---

## 设计文档

详细的设计文档见 [DESIGN.md](./DESIGN.md)，包含：

- 三层抽象的设计动机和完整接口定义
- 所有内置实现的算法说明和默认参数
- 策略组合模型和生命周期
- 与 Core-2 路线图的演进关系
- 关键设计决策日志

---

> **许可证**: MIT  
> **治理**: 本包受 Cortex 宪法约束，职责边界由 PACKAGE_POSITIONING.md 定义
