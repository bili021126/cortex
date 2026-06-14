# @cortex/resilience — 使用示例

> 本文档提供 `@cortex/resilience` 的完整使用示例，从基础到高级。
> 所有示例代码使用 TypeScript，假设项目已配置好 `tsconfig.json`（target >= ES2022）。

---

## 目录

1. [基础示例](#1-基础示例)
2. [重试策略详解](#2-重试策略详解)
3. [断路器策略详解](#3-断路器策略详解)
4. [超时策略详解](#4-超时策略详解)
5. [注册中心编排](#5-注册中心编排)
6. [事件监控](#6-事件监控)
7. [自定义策略](#7-自定义策略)
8. [测试技巧](#8-测试技巧)
9. [常见模式](#9-常见模式)

---

## 1. 基础示例

### 1.1 最简单的重试

```typescript
import { ExponentialBackoffRetry } from "@cortex/resilience";

const retry = new ExponentialBackoffRetry({
  maxAttempts: 3,
  baseDelayMs: 1000,
});

async function fetchWithRetry(url: string): Promise<Response> {
  let attempt = 1;

  while (true) {
    try {
      return await fetch(url);
    } catch (err) {
      if (!retry.shouldRetry(attempt, err)) throw err;

      const delay = retry.nextDelay(attempt, err);
      console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}

// 使用
const response = await fetchWithRetry("https://api.example.com/data");
```

### 1.2 最简单的超时

```typescript
import { FixedTimeoutPolicy } from "@cortex/resilience";

const timeout = new FixedTimeoutPolicy({ durationMs: 5000 });

async function fetchWithTimeout(url: string): Promise<Response> {
  const result = await timeout.execute(async (signal) => {
    const response = await fetch(url, { signal });
    return response.json();
  });

  if (!result.success) {
    console.error(`Request failed after ${result.elapsedMs}ms:`, result.error);
    throw result.error;
  }

  return result.value;
}
```

### 1.3 最简单的断路器

```typescript
import { SlidingWindowBreaker } from "@cortex/resilience";

const breaker = new SlidingWindowBreaker("my-api", {
  threshold: 0.5,        // 50% 失败率触发熔断
  windowMs: 60000,       // 60 秒窗口
  halfOpenAfterMs: 30000, // 30 秒后试探
  minimumCalls: 10,       // 至少 10 次调用才评估
});

async function callWithProtection(url: string): Promise<unknown> {
  return breaker.call(async () => {
    const response = await fetch(url);
    return response.json();
  }, async () => {
    // 降级：返回缓存或默认值
    return { cached: true, data: [] };
  });
}
```

---

## 2. 重试策略详解

### 2.1 ExponentialBackoffRetry — 指数退避重试

```typescript
import { ExponentialBackoffRetry } from "@cortex/resilience";

const retry = new ExponentialBackoffRetry({
  maxAttempts: 5,           // 首次 + 4 次重试
  baseDelayMs: 1000,         // 基础延迟 1 秒
  maxDelayMs: 30000,         // 最大延迟 30 秒
  jitterFactor: 0.1,         // ±10% 抖动（默认 0.1）
  retryableErrors: [],       // 空数组 = 所有错误都重试
});

// 退避序列示例（无抖动）:
// attempt 1: 1000ms
// attempt 2: 2000ms
// attempt 3: 4000ms
// attempt 4: 8000ms
// attempt 5: 16000ms
// attempt 6+: 30000ms (被 maxDelayMs 限制)

// 使用 shouldRetryHook 自定义重试决策
const smartRetry = new ExponentialBackoffRetry({
  maxAttempts: 3,
  baseDelayMs: 1000,
  shouldRetry: (attempt, error) => {
    // 只重试 5xx 错误
    if (error instanceof HttpError && error.status >= 500) return true;
    // 不重试 4xx 错误（客户端错误无意义）
    return false;
  },
});
```

### 2.2 LinearBackoffRetry — 线性退避重试

```typescript
import { LinearBackoffRetry } from "@cortex/resilience";

const retry = new LinearBackoffRetry({
  maxAttempts: 5,
  baseDelayMs: 2000,         // 每次增加 2 秒
  maxDelayMs: 10000,         // 上限 10 秒
});

// 退避序列:
// attempt 1: 2000ms
// attempt 2: 4000ms
// attempt 3: 6000ms
// attempt 4: 8000ms
// attempt 5: 10000ms

// 适用场景：定时轮询、已知间隔的速率限制等待
```

### 2.3 JitterBackoffRetry — 全抖动退避重试

```typescript
import { JitterBackoffRetry } from "@cortex/resilience";

const retry = new JitterBackoffRetry({
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
});

// 退避公式: delay = random(0, min(maxDelayMs, baseDelayMs * 2^attempt))
// attempt 1: random(0, 2000)
// attempt 2: random(0, 4000)
// attempt 3: random(0, 8000)
// attempt 4: random(0, 16000)
// attempt 5: random(0, 30000)

// 适用场景：高并发分布式系统，避免惊群效应（Thundering Herd）
// 参考：AWS Exponential Backoff and Jitter
```

### 2.4 重试与错误类型过滤

```typescript
import { ExponentialBackoffRetry } from "@cortex/resilience";

class RateLimitError extends Error {
  constructor(public readonly retryAfter: number) {
    super("Rate limited");
  }
}

class NetworkError extends Error {}
class AuthError extends Error {}

const retry = new ExponentialBackoffRetry({
  maxAttempts: 3,
  baseDelayMs: 1000,
  // 只重试 RateLimitError 和 NetworkError
  shouldRetry: (attempt, error) => {
    if (attempt >= 3) return false;
    if (error instanceof RateLimitError || error instanceof NetworkError) return true;
    return false; // AuthError 等不重试
  },
});
```

---

## 3. 断路器策略详解

### 3.1 SlidingWindowBreaker — 滑动窗口断路器

```typescript
import { SlidingWindowBreaker } from "@cortex/resilience";

const breaker = new SlidingWindowBreaker("llm-api", {
  threshold: 0.5,             // 50% 失败率触发熔断
  windowMs: 60000,            // 60 秒滑动窗口
  halfOpenAfterMs: 30000,     // 熔断 30 秒后进入半开状态
  maxHalfOpenRequests: 3,     // 半开期最多放行 3 个试探请求
  minimumCalls: 10,           // 至少 10 次调用才评估
});

// 状态变化监听
breaker.onStateChange((state, previous) => {
  console.log(`Breaker: ${previous} → ${state}`);
});

// 使用
async function callAPI() {
  try {
    const result = await breaker.call(async () => {
      const res = await fetch("https://api.example.com/chat");
      return res.json();
    }, async () => {
      // 熔断降级
      return { fallback: true, message: "Service temporarily unavailable" };
    });
    return result;
  } catch (err) {
    if (err.name === "CircuitBreakerOpenError") {
      console.error("Circuit is OPEN, request blocked");
      // 走其他降级路径
    }
    throw err;
  }
}
```

### 3.2 ConsecutiveFailureBreaker — 连续失败断路器

```typescript
import { ConsecutiveFailureBreaker } from "@cortex/resilience";

const breaker = new ConsecutiveFailureBreaker("disk-io", {
  threshold: 3,               // 连续 3 次失败触发熔断
  windowMs: 0,                // 不适用（连续计数无窗口）
  halfOpenAfterMs: 10000,     // 10 秒后试探恢复
  maxHalfOpenRequests: 1,     // 半开期只放行 1 个试探请求
  minimumCalls: 1,            // 连续模式不需要最小基数
});

// 适用场景：本地资源健康检测、简单熔断需求、快速失败保护
// 相比滑动窗口断路器更轻量，对短暂故障更敏感
```

### 3.3 断路器状态机可视化

```
CLOSED (正常)
  │
  │  失败率超过 threshold / 连续失败达到阈值
  ▼
OPEN (熔断)
  │
  │  halfOpenAfterMs 超时
  ▼
HALF_OPEN (试探)
  │
  ├── 试探成功 → CLOSED
  │
  └── 试探失败 → OPEN (重新计时)
```

### 3.4 断路器最佳实践

```typescript
// 1. 为每个下游服务创建独立断路器
const llmBreaker = new SlidingWindowBreaker("llm", { /* ... */ });
const searchBreaker = new SlidingWindowBreaker("search", { /* ... */ });
const dbBreaker = new SlidingWindowBreaker("database", { /* ... */ });

// 2. 根据服务特性调整参数
const aggressiveBreaker = new SlidingWindowBreaker("fast-fail", {
  threshold: 0.3,          // 低阈值，敏感
  windowMs: 10000,         // 短窗口，快速恢复
  halfOpenAfterMs: 5000,   // 快速试探
  minimumCalls: 5,         // 快速评估
});

const conservativeBreaker = new SlidingWindowBreaker("stable-svc", {
  threshold: 0.8,          // 高阈值，容忍
  windowMs: 120000,        // 长窗口，稳定评估
  halfOpenAfterMs: 60000,  // 长时间等待恢复
  minimumCalls: 50,        // 大量样本
});
```

---

## 4. 超时策略详解

### 4.1 FixedTimeoutPolicy — 固定超时

```typescript
import { FixedTimeoutPolicy, TimeoutError } from "@cortex/resilience";

const timeout = new FixedTimeoutPolicy({
  durationMs: 10000,          // 10 秒超时
  cancelOnTimeout: true,      // 超时后取消 pending 操作（默认 true）
});

// 基础用法
async function basicTimeout() {
  const result = await timeout.execute(async (signal) => {
    const response = await fetch("https://api.example.com/data", { signal });
    return response.json();
  });

  if (result.success) {
    console.log(`Completed in ${result.elapsedMs}ms:`, result.value);
  } else {
    if (result.error instanceof TimeoutError) {
      console.error(`Timed out after ${result.elapsedMs}ms (limit: ${result.error.timeoutMs}ms)`);
    }
    throw result.error;
  }
}

// 与外部 AbortSignal 组合
async function withExternalSignal() {
  const controller = new AbortController();

  // 5 秒后手动取消
  setTimeout(() => controller.abort(), 5000);

  const result = await timeout.execute(
    (signal) => fetch("https://api.example.com/data", { signal }),
    controller.signal // 外部信号
  );

  // 超时时间(10s) 和外部信号(5s) 取较早者
}
```

### 4.2 AdaptiveTimeoutPolicy — 自适应超时

```typescript
import { AdaptiveTimeoutPolicy } from "@cortex/resilience";

const timeout = new AdaptiveTimeoutPolicy({
  durationMs: 30000,           // 初始超时值
  minTimeoutMs: 5000,          // 最小超时（不低于 5 秒）
  maxTimeoutMs: 60000,         // 最大超时（不超过 60 秒）
  multiplier: 3,               // 超时 = EMA × 3
  alpha: 0.3,                  // EMA 平滑系数
  initialEma: 5000,            // 初始 EMA 值
});

// 算法示意：
// ema = 0.3 × lastDuration + 0.7 × ema
// timeout = clamp(ema × 3, 5000, 60000)

// 自适应示例:
// 第 1 次: 实际耗时 2000ms → ema=0.3×2000+0.7×5000=4100 → timeout=12300ms
// 第 2 次: 实际耗时 8000ms → ema=0.3×8000+0.7×4100=5270 → timeout=15810ms
// 第 3 次: 实际耗时 1500ms → ema=0.3×1500+0.7×5270=4139 → timeout=12417ms
// 第 4 次: 超时! → 不更新 EMA，抛出 TimeoutError

// 适用场景：LLM API 调用（延迟波动大），无需手动配置超时值
```

### 4.3 超时兼容性说明

```typescript
// Node.js 版本兼容:
// - Node.js 18+: AbortSignal.timeout() 原生支持 ✅
// - Node.js 16: 自动降级为 AbortController + setTimeout ✅
// - Windows Node.js: 通过 Promise.race 硬兜底补偿 ✅

// 跨平台（浏览器）:
// - 所有现代浏览器支持 AbortSignal ✅
// - 使用标准 Web API，无 Node.js 特有依赖
```

---

## 5. 注册中心编排

### 5.1 完整配置示例

```typescript
import {
  ResilienceRegistry,
  ExponentialBackoffRetry,
  SlidingWindowBreaker,
  AdaptiveTimeoutPolicy,
  FixedTimeoutPolicy,
  JitterBackoffRetry,
  ConsecutiveFailureBreaker,
} from "@cortex/resilience";

// 创建注册中心，设置全局默认超时
const registry = ResilienceRegistry.create({
  timeout: new FixedTimeoutPolicy({ durationMs: 15000 }),
});

// 注册 LLM API 策略组（最复杂的配置）
registry.register("llm-api", {
  retry: new ExponentialBackoffRetry({
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  }),
  circuitBreaker: new SlidingWindowBreaker("llm-api", {
    threshold: 0.5,
    windowMs: 60000,
    halfOpenAfterMs: 30000,
    maxHalfOpenRequests: 3,
    minimumCalls: 10,
  }),
  timeout: new AdaptiveTimeoutPolicy({
    durationMs: 30000,
    minTimeoutMs: 5000,
    maxTimeoutMs: 60000,
  }),
});

// 注册搜索后端策略组（轻量配置）
registry.register("search-backend", {
  retry: new JitterBackoffRetry({
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 10000,
  }),
  circuitBreaker: new ConsecutiveFailureBreaker("search", {
    threshold: 5,
    halfOpenAfterMs: 10000,
  }),
  timeout: new FixedTimeoutPolicy({ durationMs: 10000 }),
});

// 注册数据库策略组（无断路器）
registry.register("database", {
  retry: new ExponentialBackoffRetry({
    maxAttempts: 2,
    baseDelayMs: 500,
  }),
  // 不使用断路器
  timeout: new FixedTimeoutPolicy({ durationMs: 5000 }),
});

// 注册纯超时保护（无重试、无断路器）
registry.register("simple-http", {
  timeout: new FixedTimeoutPolicy({ durationMs: 5000 }),
  // retry 和 circuitBreaker 使用 NoRetry / NoBreaker（默认）
});
```

### 5.2 组合执行

```typescript
// 1. 完整保护执行
const result1 = await registry.execute("llm-api", async () => {
  const response = await fetch("https://api.deepseek.com/chat", {
    method: "POST",
    body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
  });
  return response.json();
});

// 2. 临时覆盖超时（本次用 5 秒超时）
const result2 = await registry.execute(
  "llm-api",
  async () => {
    const response = await fetch("https://api.deepseek.com/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "Quick!" }] }),
    });
    return response.json();
  },
  {
    timeout: new FixedTimeoutPolicy({ durationMs: 5000 }),
  }
);

// 3. 临时关闭断路器（调试时使用）
const result3 = await registry.execute(
  "llm-api",
  async () => fetch("https://api.example.com/test").then((r) => r.json()),
  {
    circuitBreaker: undefined as any, // 跳过断路器（仅调试用）
  }
);
```

### 5.3 多策略组切换

```typescript
// 为不同优先级配置不同策略
registry.register("critical-path", {
  retry: new ExponentialBackoffRetry({
    maxAttempts: 5,
    baseDelayMs: 500,
  }),
  circuitBreaker: new SlidingWindowBreaker("critical", {
    threshold: 0.8,
    windowMs: 120000,
    halfOpenAfterMs: 10000,
  }),
  timeout: new FixedTimeoutPolicy({ durationMs: 60000 }),
});

registry.register("best-effort", {
  retry: new ExponentialBackoffRetry({
    maxAttempts: 2,
    baseDelayMs: 1000,
  }),
  circuitBreaker: new SlidingWindowBreaker("best-effort", {
    threshold: 0.3,
    windowMs: 30000,
    halfOpenAfterMs: 60000,
  }),
  timeout: new FixedTimeoutPolicy({ durationMs: 5000 }),
});

async function executeWithPriority(prompt: string, priority: "critical" | "normal") {
  const policyName = priority === "critical" ? "critical-path" : "best-effort";
  return registry.execute(policyName, () => llmCall(prompt));
}
```

### 5.4 使用便捷工厂

```typescript
import { createResilience } from "@cortex/resilience";

// 一键创建带默认配置的注册中心
const registry = createResilience({
  defaults: {
    retry: {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
    },
    circuitBreaker: {
      name: "default",
      type: "sliding",
      threshold: 0.5,
      windowMs: 60000,
      halfOpenAfterMs: 30000,
      minimumCalls: 10,
    },
    timeout: {
      durationMs: 30000,
      adaptive: true,
    },
  },
  policies: {
    "search-api": {
      retry: { maxAttempts: 2, baseDelayMs: 500 },
      circuitBreaker: {
        name: "search",
        type: "consecutive",
        threshold: 3,
        halfOpenAfterMs: 10000,
      },
      timeout: { durationMs: 15000, adaptive: false },
    },
    "llm-api": {
      retry: "none", // 使用字符串 'none' 关闭重试
      circuitBreaker: "none",
      timeout: { durationMs: 60000, adaptive: true },
    },
  },
});

// 使用
const result = await registry.execute("search-api", () => search("cortex"));
```

---

## 6. 事件监控

### 6.1 事件类型总览

```typescript
import type { ResilienceEvent } from "@cortex/resilience";

// 注册中心支持 11 种事件类型
registry.onEvent((event: ResilienceEvent) => {
  switch (event.type) {
    case "RETRY_ATTEMPT":
      // { type: 'RETRY_ATTEMPT', name: string, attempt: number, delayMs: number }
      console.log(`[${event.name}] Retry #${event.attempt}, delay ${event.delayMs}ms`);
      break;

    case "RETRY_EXHAUSTED":
      // { type: 'RETRY_EXHAUSTED', name: string, attempt: number }
      console.warn(`[${event.name}] Retries exhausted after ${event.attempt} attempts`);
      break;

    case "CIRCUIT_OPEN":
      console.error(`[${event.name}] Circuit OPENED!`);
      break;

    case "CIRCUIT_CLOSED":
      console.log(`[${event.name}] Circuit CLOSED (recovered)`);
      break;

    case "CIRCUIT_HALF_OPEN":
      console.log(`[${event.name}] Circuit HALF_OPEN (probing)`);
      break;

    case "CIRCUIT_STATE_CHANGE":
      console.log(`[${event.name}] ${event.from} → ${event.to}`);
      break;

    case "TIMEOUT_OCCURRED":
      console.warn(`[${event.name}] Timeout after ${event.elapsedMs}ms (limit: ${event.timeoutMs}ms)`);
      break;

    case "ADAPTIVE_TIMEOUT_UPDATE":
      console.debug(`[${event.name}] Timeout adjusted: ${event.newTimeoutMs}ms`);
      break;

    case "REGISTRY_OVERWRITE":
      console.warn(`[${event.name}] Policy overwritten!`);
      break;

    case "EXECUTION_ERROR":
      console.error(`[${event.name}] Execution error:`, event.error.message);
      break;
  }
});
```

### 6.2 集成到监控系统

```typescript
// 采集指标
const metrics = {
  circuitOpenCount: 0,
  retryCount: 0,
  timeoutCount: 0,
};

registry.onEvent((event) => {
  switch (event.type) {
    case "CIRCUIT_OPEN":
      metrics.circuitOpenCount++;
      break;
    case "RETRY_ATTEMPT":
      metrics.retryCount++;
      break;
    case "TIMEOUT_OCCURRED":
      metrics.timeoutCount++;
      break;
  }
});

// 定期输出快照
setInterval(() => {
  console.table(metrics);
  console.table(registry.snapshot());
}, 60000);
```

### 6.3 监控仪表盘数据

```typescript
// registry.snapshot() 输出示例
const snapshot = registry.snapshot();
// [
//   {
//     name: 'llm-api',
//     retry: 'exponential-backoff',
//     circuitBreaker: { name: 'sliding-window', state: 'CLOSED' },
//     timeout: 'adaptive-timeout'
//   },
//   {
//     name: 'search-backend',
//     retry: 'jitter-backoff',
//     circuitBreaker: { name: 'consecutive-failure', state: 'CLOSED' },
//     timeout: 'fixed-timeout'
//   }
// ]
```

---

## 7. 自定义策略

### 7.1 自定义 RetryPolicy

```typescript
import type { IRetryPolicy } from "@cortex/resilience";

/**
 * 基于 HTTP 状态码的重试策略。
 */
class HttpStatusRetry implements IRetryPolicy {
  readonly name = "http-status-retry";
  readonly maxAttempts: number;
  private readonly retryableStatuses: Set<number>;

  constructor(options: {
    maxAttempts: number;
    retryableStatuses: number[];
  }) {
    this.maxAttempts = options.maxAttempts;
    this.retryableStatuses = new Set(options.retryableStatuses);
  }

  nextDelay(attempt: number, error?: unknown): number {
    // 如果服务返回了 Retry-After 头，使用它
    if (error instanceof HttpError && error.retryAfter) {
      return error.retryAfter * 1000;
    }
    // 否则使用带抖动的指数退避
    return Math.min(1000 * Math.pow(2, attempt - 1), 30000) + Math.random() * 500;
  }

  shouldRetry(attempt: number, error?: unknown): boolean {
    if (attempt >= this.maxAttempts) return false;
    if (error instanceof HttpError && this.retryableStatuses.has(error.status)) {
      return true;
    }
    return false;
  }

  reset(): void {}
}

// 使用
import { ResilienceRegistry } from "@cortex/resilience";

const registry = ResilienceRegistry.create();
registry.register("custom-api", {
  retry: new HttpStatusRetry({
    maxAttempts: 5,
    retryableStatuses: [429, 500, 502, 503, 504],
  }),
});

// 注册到注册中心后，可与其他策略组合使用
```

### 7.2 自定义 CircuitBreaker

```typescript
import {
  type ICircuitBreaker,
  type CircuitState,
  CircuitBreakerOpenError,
} from "@cortex/resilience";

/**
 * 基于错误类型的断路器 —— 某些错误不计入熔断计数。
 */
class SelectiveBreaker implements ICircuitBreaker {
  readonly name: string;
  private _state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private readonly threshold: number;
  private readonly halfOpenAfterMs: number;
  private openSince = 0;
  private readonly ignoredErrors: Array<{ new (...args: any[]): Error }>;
  private readonly handlers: Array<(state: CircuitState, previous: CircuitState) => void> = [];

  constructor(
    name: string,
    options: {
      threshold: number;
      halfOpenAfterMs: number;
      ignoredErrors?: Array<{ new (...args: any[]): Error }>;
    }
  ) {
    this.name = name;
    this.threshold = options.threshold;
    this.halfOpenAfterMs = options.halfOpenAfterMs;
    this.ignoredErrors = options.ignoredErrors ?? [];
  }

  get state(): CircuitState {
    return this._state;
  }

  async call<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (this._state === "OPEN") {
      if (Date.now() - this.openSince >= this.halfOpenAfterMs) {
        this.transitionTo("HALF_OPEN");
      } else {
        if (fallback) return fallback();
        throw new CircuitBreakerOpenError(this.name);
      }
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure(err);
      if (fallback) return fallback();
      throw err;
    }
  }

  recordSuccess(): void {
    if (this._state === "HALF_OPEN") {
      this.transitionTo("CLOSED");
    }
    this.consecutiveFailures = 0;
  }

  recordFailure(err?: unknown): void {
    // 忽略特定错误
    if (err && this.ignoredErrors.some((Err) => err instanceof Err)) {
      return; // 不计入熔断计数
    }

    this.consecutiveFailures++;
    if (this._state === "HALF_OPEN") {
      this.transitionTo("OPEN");
      return;
    }
    if (this.consecutiveFailures >= this.threshold) {
      this.transitionTo("OPEN");
    }
  }

  reset(): void {
    this.consecutiveFailures = 0;
    this.transitionTo("CLOSED");
  }

  forceState(state: CircuitState): void {
    this.transitionTo(state);
    if (state === "CLOSED") this.consecutiveFailures = 0;
    if (state === "OPEN") this.openSince = Date.now();
  }

  onStateChange(handler: (state: CircuitState, previous: CircuitState) => void): void {
    this.handlers.push(handler);
  }

  private transitionTo(newState: CircuitState): void {
    const previous = this._state;
    this._state = newState;
    if (newState === "OPEN") this.openSince = Date.now();
    if (newState === "CLOSED") this.consecutiveFailures = 0;
    for (const handler of this.handlers) {
      try {
        handler(newState, previous);
      } catch {
        /* 隔离 */
      }
    }
  }
}

// 使用
const registry = ResilienceRegistry.create();
registry.register("db-service", {
  circuitBreaker: new SelectiveBreaker("db-service", {
    threshold: 5,
    halfOpenAfterMs: 30000,
    ignoredErrors: [ReadOnlyError], // 只读错误不触发熔断
  }),
});
```

### 7.3 自定义 TimeoutPolicy

```typescript
import { type ITimeoutPolicy, type TimeoutResult, ResilienceContextManager } from "@cortex/resilience";

/**
 * 基于业务优先级的超时策略。
 */
class PriorityAwareTimeout implements ITimeoutPolicy {
  readonly name = "priority-timeout";
  readonly timeoutMs: number;
  private readonly priorityTimeouts: Map<string, number>;

  constructor(defaultTimeout: number, priorityTimeouts: Record<string, number>) {
    this.timeoutMs = defaultTimeout;
    this.priorityTimeouts = new Map(Object.entries(priorityTimeouts));
  }

  async execute<T>(
    fn: (signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal
  ): Promise<TimeoutResult<T>> {
    const ctx = ResilienceContextManager.current();
    const priority = (ctx?.metadata.get("priority") as string) ?? "normal";
    const timeout = this.priorityTimeouts.get(priority) ?? this.timeoutMs;

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // 合并外部 signal
    const combinedSignal = signal
      ? this.mergeSignals(signal, controller.signal)
      : controller.signal;

    try {
      const value = await fn(combinedSignal);
      return { success: true, value, elapsedMs: Date.now() - startedAt };
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      return { success: false, error: err as Error, elapsedMs };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  createSignal(signal?: AbortSignal): AbortSignal {
    return signal ?? new AbortController().signal;
  }

  reset(): void {}

  private mergeSignals(...signals: AbortSignal[]): AbortSignal {
    // 简化的信号合并
    const controller = new AbortController();
    for (const sig of signals) {
      if (sig.aborted) {
        controller.abort();
        return controller.signal;
      }
      sig.addEventListener("abort", () => controller.abort());
    }
    return controller.signal;
  }
}

// 使用
const registry = ResilienceRegistry.create();
registry.register("priority-api", {
  timeout: new PriorityAwareTimeout(30000, {
    high: 60000,
    normal: 30000,
    low: 10000,
  }),
});

// 在执行时设置优先级
await ResilienceContextManager.run(async () => {
  const ctx = ResilienceContextManager.current()!;
  ctx.metadata.set("priority", "high");

  return registry.execute("priority-api", () =>
    fetch("https://api.example.com/slow").then((r) => r.json())
  );
});
```

---

## 8. 测试技巧

### 8.1 使用虚拟时间测试重试

```typescript
import { ExponentialBackoffRetry } from "@cortex/resilience";

// 在测试中，我们可以直接测试退避算法而不需要真实等待
describe("ExponentialBackoffRetry", () => {
  it("should calculate exponential delays", () => {
    const retry = new ExponentialBackoffRetry({
      maxAttempts: 5,
      baseDelayMs: 1000,
      jitterFactor: 0, // 关闭抖动，使测试可预测
    });

    expect(retry.shouldRetry(1)).toBe(true);
    expect(retry.nextDelay(1)).toBe(1000);  // 1000 × 2^0
    expect(retry.nextDelay(2)).toBe(2000);  // 1000 × 2^1
    expect(retry.nextDelay(3)).toBe(4000);  // 1000 × 2^2
    expect(retry.nextDelay(4)).toBe(8000);  // 1000 × 2^3
  });

  it("should stop retrying after maxAttempts", () => {
    const retry = new ExponentialBackoffRetry({
      maxAttempts: 3,
      baseDelayMs: 1000,
    });

    expect(retry.shouldRetry(1)).toBe(true);
    expect(retry.shouldRetry(2)).toBe(true);
    expect(retry.shouldRetry(3)).toBe(false); // 第 3 次已达上限（首次+2次重试）
  });

  it("should respect maxDelayMs", () => {
    const retry = new ExponentialBackoffRetry({
      maxAttempts: 10,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      jitterFactor: 0,
    });

    // 指数增长会被 maxDelayMs 限制
    expect(retry.nextDelay(6)).toBe(5000);
    expect(retry.nextDelay(10)).toBe(5000);
  });
});
```

### 8.2 测试断路器

```typescript
import { ConsecutiveFailureBreaker } from "@cortex/resilience";

describe("ConsecutiveFailureBreaker", () => {
  it("should open after consecutive failures", () => {
    const breaker = new ConsecutiveFailureBreaker("test", {
      threshold: 3,
      halfOpenAfterMs: 60000,
    });

    expect(breaker.state).toBe("CLOSED");

    breaker.recordFailure();
    expect(breaker.state).toBe("CLOSED"); // 未达到阈值

    breaker.recordFailure();
    expect(breaker.state).toBe("CLOSED"); // 未达到阈值

    breaker.recordFailure();
    expect(breaker.state).toBe("OPEN"); // 达到阈值！

    // 成功应重置计数
    breaker.forceState("CLOSED");
    breaker.recordSuccess();
    expect(breaker.state).toBe("CLOSED");
  });

  it("should reject calls when open", async () => {
    const breaker = new ConsecutiveFailureBreaker("test", {
      threshold: 1,
      halfOpenAfterMs: 60000,
    });

    breaker.forceState("OPEN");
    await expect(
      breaker.call(async () => "success")
    ).rejects.toThrow("Circuit breaker");
  });

  it("should call fallback when open", async () => {
    const breaker = new ConsecutiveFailureBreaker("test", {
      threshold: 1,
      halfOpenAfterMs: 60000,
    });

    breaker.forceState("OPEN");
    const result = await breaker.call(
      async () => "real",
      async () => "fallback"
    );
    expect(result).toBe("fallback");
  });
});
```

### 8.3 测试超时

```typescript
import { FixedTimeoutPolicy, TimeoutError } from "@cortex/resilience";

describe("FixedTimeoutPolicy", () => {
  it("should resolve within timeout", async () => {
    const policy = new FixedTimeoutPolicy({ durationMs: 5000 });

    const result = await policy.execute(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return "done";
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("done");
      expect(result.elapsedMs).toBeGreaterThanOrEqual(10);
    }
  });

  it("should throw TimeoutError on timeout", async () => {
    const policy = new FixedTimeoutPolicy({ durationMs: 50 });

    const result = await policy.execute(async () => {
      await new Promise((r) => setTimeout(r, 10000));
      return "never";
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(TimeoutError);
    }
  }, 1000); // 测试本身超时时间
});
```

### 8.4 集成测试注册中心

```typescript
import { ResilienceRegistry, NoRetry, NoBreaker, NoTimeout } from "@cortex/resilience";

describe("ResilienceRegistry", () => {
  it("should execute a function with registered policies", async () => {
    const registry = ResilienceRegistry.create();
    registry.register("test", {
      retry: new NoRetry(),
      circuitBreaker: new NoBreaker(),
      timeout: new NoTimeout(),
    });

    const result = await registry.execute("test", async () => "hello");
    expect(result).toBe("hello");
  });

  it("should throw for unregistered name", async () => {
    const registry = ResilienceRegistry.create();
    await expect(
      registry.execute("unknown", async () => "hello")
    ).rejects.toThrow('No resilience policies registered for "unknown"');
  });

  it("should support temporary overrides", async () => {
    const registry = ResilienceRegistry.create();
    registry.register("test", {
      timeout: new NoTimeout(),
    });

    // 使用临时超时覆盖
    const result = await registry.execute(
      "test",
      async () => "fast",
      { timeout: new NoTimeout() }
    );
    expect(result).toBe("fast");
  });
});
```

---

## 9. 常见模式

### 9.1 工厂函数模式

```typescript
import { ResilienceRegistry, ExponentialBackoffRetry, SlidingWindowBreaker, FixedTimeoutPolicy } from "@cortex/resilience";

// 封装为工厂函数，方便复用
function createLLMResilience() {
  const registry = ResilienceRegistry.create();

  registry.register("llm-chat", {
    retry: new ExponentialBackoffRetry({
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
    }),
    circuitBreaker: new SlidingWindowBreaker("llm-chat", {
      threshold: 0.5,
      windowMs: 60000,
      halfOpenAfterMs: 30000,
      minimumCalls: 10,
    }),
    timeout: new FixedTimeoutPolicy({ durationMs: 60000 }),
  });

  registry.register("llm-stream", {
    retry: new ExponentialBackoffRetry({
      maxAttempts: 2,
      baseDelayMs: 500,
    }),
    timeout: new FixedTimeoutPolicy({ durationMs: 120000 }),
    // 流式 API 不使用断路器
  });

  return registry;
}

export const llmResilience = createLLMResilience();
```

### 9.2 装饰器模式（高阶函数）

```typescript
import { ResilienceRegistry, ExponentialBackoffRetry, FixedTimeoutPolicy } from "@cortex/resilience";

// 创建高阶函数包装器
function withResilience<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    timeoutMs?: number;
  } = {}
): () => Promise<T> {
  const registry = ResilienceRegistry.create();
  const name = `wrapped-${Date.now()}`;

  registry.register(name, {
    retry: new ExponentialBackoffRetry({
      maxAttempts: options.maxAttempts ?? 3,
      baseDelayMs: 1000,
    }),
    timeout: new FixedTimeoutPolicy({
      durationMs: options.timeoutMs ?? 30000,
    }),
  });

  return () => registry.execute(name, fn);
}

// 使用
const safeFetch = withResilience(
  () => fetch("https://api.example.com/data").then((r) => r.json()),
  { maxAttempts: 3, timeoutMs: 10000 }
);

const data = await safeFetch();
```

### 9.3 健康检查集成

```typescript
import { ResilienceRegistry } from "@cortex/resilience";

class HealthChecker {
  constructor(private registry: ResilienceRegistry) {}

  getStatus(): {
    healthy: boolean;
    circuits: Array<{ name: string; state: string; healthy: boolean }>;
  } {
    const snapshot = this.registry.snapshot();
    const circuits = snapshot
      .filter((s) => s.circuitBreaker !== null)
      .map((s) => ({
        name: s.name,
        state: s.circuitBreaker!.state,
        healthy: s.circuitBreaker!.state === "CLOSED",
      }));

    return {
      healthy: circuits.every((c) => c.healthy),
      circuits,
    };
  }
}

// 使用
const health = new HealthChecker(registry);
const status = health.getStatus();
console.log(status);
// { healthy: true, circuits: [{ name: 'llm-api', state: 'CLOSED', healthy: true }] }
```

### 9.4 优雅降级模式

```typescript
async function fetchWithGracefulDegradation<T>(
  registry: ResilienceRegistry,
  name: string,
  primary: () => Promise<T>,
  fallback: () => Promise<T>
): Promise<{ value: T; source: "primary" | "fallback" }> {
  try {
    const value = await registry.execute(name, primary);
    return { value, source: "primary" };
  } catch (err) {
    // 主路径失败，尝试降级
    console.warn(`Primary failed, using fallback:`, err);
    const value = await fallback();
    return { value, source: "fallback" };
  }
}

// 使用
const result = await fetchWithGracefulDegradation(
  registry,
  "llm-api",
  () => callLLM(prompt),
  () => simpleResponse(prompt) // 使用简单模型或缓存
);
```

---

> **更多资源**:
> - [DESIGN.md](../DESIGN.md) — 完整设计文档（接口定义、算法说明、决策日志）
> - [README.md](../README.md) — 包说明、安装、API 速览
> - [PACKAGE_POSITIONING.md](../PACKAGE_POSITIONING.md) — 包定位文档
