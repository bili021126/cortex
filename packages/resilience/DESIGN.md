# @cortex/resilience — 韧性策略统一抽象层

> **版本**: v1.0 (草案)  
> **状态**: 设计中  
> **前置探索**: [韧性模式探索报告](../exploration-report.md)  
> **范围**: 定义 Cortex 生态中重试 (Retry)、断路器 (CircuitBreaker)、超时 (Timeout) 三大韧性模式的统一接口、内置实现与注册编排

---

## 目录

1. [包定位](#1-包定位)
2. [设计动机：为什么需要统一抽象](#2-设计动机为什么需要统一抽象)
3. [三层抽象总览](#3-三层抽象总览)
4. [接口层：策略契约](#4-接口层策略契约)
5. [实现层：内置策略](#5-实现层内置策略)
6. [编排层：注册与组合](#6-编排层注册与组合)
7. [数据流与生命周期](#7-数据流与生命周期)
8. [文件组织方案](#8-文件组织方案)
9. [与现有韧性代码的迁移路径](#9-与现有韧性代码的迁移路径)
10. [扩展指南](#10-扩展指南)
11. [附录：关键设计决策日志](#11-附录关键设计决策日志)

---

## 1. 包定位

### 1.1 一句话定位

**@cortex/resilience** 是 Cortex 生态中的**韧性策略统一抽象层** —— 提供重试（Retry）、断路器（CircuitBreaker）、超时（Timeout）三大韧性模式的接口定义、内置实现和注册管理，消除全仓 19+ 包中分散的韧性代码重复。

### 1.2 包名

```json
{
  "name": "@cortex/resilience",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

### 1.3 解决的问题

| 痛点 | 当前状态 | 本包解决方式 |
|------|---------|-------------|
| **韧性代码重复** | 重试逻辑在 llm-adapter / search-backend 等 4+ 处重复实现，退避算法各写各的 | 统一 `IRetryPolicy` 接口 + 内置实现，一处定义处处复用 |
| **断路器缺失** | CircuitBreaker 仅有测试用例，无生产实现（Core-2 计划） | 提供 `ICircuitBreaker` 接口 + 滑动窗口/连续失败两种实现 |
| **超时策略不可替换** | 11 处超时各写各的，`AbortSignal.timeout` / `Promise.race` / `setTimeout` 混用 | 统一 `ITimeoutPolicy` 接口，调用方与超时机制解耦 |
| **无法编排组合** | retry → circuitBreaker → timeout 的嵌套组合需手动编码 | `ResilienceRegistry` 提供声明式组合编排 |
| **测试困难** | 测试韧性需 mock 网络/时间，各包重复造轮 | 策略可 mock + 时间虚拟化支持 |

### 1.4 不做的事

- ❌ 不包含业务级限流（Rate Limiting）— 由 `@cortex/llm` 的 `RateLimiter` + `ManifoldGate` 负责
- ❌ 不包含降级（Degradation）— 由 `SafeErrorReporter` / 业务回退逻辑负责
- ❌ 不包含优雅关闭（Graceful Shutdown）— 由 `ShutdownWarden` / `LifecycleManager` 负责
- ❌ 不包含错误隔离（Error Isolation）— 由 `PluginRunner` / `PipelineObserver` 负责
- ❌ 不包含健康检查 API — 由 `@cortex/telemetry` 计划补充
- ❌ 不包含缓存（Cache）— 由 `LlmAdapter` LRU 缓存负责

### 1.5 与 Core-2 路线图的关系

```
Core-1 已落地:  Retry(分散) + Timeout(分散) + 类断路器(ReplanManager上限)
                    │
                    ▼
Core-1.5 本包:  RetryPolicy统一 + CircuitBreaker独立 + TimeoutPolicy统一 + Registry编排
                    │
                    ▼
Core-2 规划:    IncidentEscalator + ContractEnforcer + Health Check API
```

---

## 2. 设计动机：为什么需要统一抽象

### 2.1 现状问题矩阵

```
场景                    当前做法                                     问题
──────────────────────  ──────────────────────────────────────────  ──────────────────────────
LLM API 重试            llm-adapter.ts 内联 _fetchWithRetry          与 llm 包耦合，无法复用
搜索后端重试             search-backend.ts 内联线性退避                与 platform 包耦合
插件执行超时             _withTimeout() Promise.race                  每包各写各的
MCP 调用超时             AbortSignal.timeout(15000)                   硬编码，不可配置
流式 API 重试            chatStream 无重试                             已知缺口，无保护
断路器                   不存在（仅有测试用例）                          核心-2 能力尚未落地
```

### 2.2 统一后的收益

```
┌────────────────────────────────────────────────────────┐
│                    业务代码                              │
│  const result = await registry.execute(fn, {            │
│    retry: { maxAttempts: 3, backoff: 'exponential' },   │
│    circuitBreaker: { threshold: 5, windowMs: 60000 },   │
│    timeout: { durationMs: 30000 }                       │
│  });                                                    │
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────┐
│              @cortex/resilience                         │
│  ┌────────────┐  ┌──────────────┐  ┌───────────────┐   │
│  │ RetryPolicy │  │CircuitBreaker│  │ TimeoutPolicy  │   │
│  │ 指数退避    │  │ 滑动窗口      │  │ 固定超时      │   │
│  │ 线性退避    │  │ 连续失败      │  │ 自适应超时    │   │
│  │ 抖动退避    │  │              │  │               │   │
│  └────────────┘  └──────────────┘  └───────────────┘   │
│                      ResilienceRegistry                 │
└────────────────────────────────────────────────────────┘
```

---

## 3. 三层抽象总览

```
                        ┌──────────────────────────────┐
                        │     接口层 (Interfaces)        │
                        │  IRetryPolicy                 │
                        │  ICircuitBreaker              │
                        │  ITimeoutPolicy               │
                        │  IResilienceRegistry          │
                        └──────────┬───────────────────┘
                                   │ implements
                                   ▼
┌─────────────────────────────────────────────────────────────┐
│                   实现层 (Implementations)                    │
│                                                              │
│  IRetryPolicy ────────────┬──────────────────┐              │
│    ├─ ExponentialBackoff   ├─ Consecutive     │              │
│    ├─ LinearBackoff        │  FailureBreaker  │              │
│    ├─ JitterBackoff        └──────────────────┘              │
│    └─ NoRetry                                              │
│                                                              │
│  ITimeoutPolicy ──────────┬──────────────────┐              │
│    ├─ FixedTimeout         ├─ StatThreshold   │              │
│    ├─ AdaptiveTimeout      │  Breaker         │              │
│    └─ NoTimeout            └──────────────────┘              │
└──────────────────────────┬──────────────────────────────────┘
                           │ uses
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 编排层 (Registry)                             │
│  ResilienceRegistry                                          │
│    ├─ register / unregister / get                             │
│    ├─ execute (组合编排)                                     │
│    ├─ onStateChange (事件监听)                                │
│    └─ snapshot / reset                                       │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 策略组合模型

```
ResilienceRegistry.execute(fn, options)
    │
    ├── ITimeoutPolicy.wrap(fn)       ← 最外层超时保护
    │   │
    │   └── ICircuitBreaker.call(fn)  ← 中间层熔断保护
    │       │
    │       └── IRetryPolicy.execute(fn)  ← 内层重试
    │           │
    │           └── 实际业务调用
    │
    └── 异常传递: 重试耗尽 → 断路器熔断 → 超时抛出 → 调用方捕获
```

**嵌套顺序设计决策**：超时在最外层（墙钟时间），断路器在中间层（防止重试给熔断下游加压），重试在最内层（快速失败重试）。此顺序确保：
- 超时切断总执行时长，防止断路器半开期长时间等待
- 断路器在重试耗尽后跳闸，阻止后续请求
- 重试在断路器闭合时正常工作，断路器断开时快速失败

---

## 4. 接口层：策略契约

### 4.1 IRetryPolicy — 重试策略

```typescript
/**
 * IRetryPolicy —— 重试策略接口。
 *
 * 负责决定「是否重试」「等待多久」「何时放弃」。
 * 不关心具体业务逻辑，只关心退避算法和终止条件。
 *
 * 实现应保持无状态（或状态仅用于统计），以便复用。
 */
export interface IRetryPolicy {
  /** 策略名称，用于日志和监控 */
  readonly name: string;

  /**
   * 获取下一次重试前的等待时间。
   * @param attempt 当前重试次数（1-based，第1次表示首次失败后的重试）
   * @param error 触发重试的异常（可为 undefined 表示超时等场景）
   * @returns 等待毫秒数，返回 ≤0 表示不应重试
   */
  nextDelay(attempt: number, error?: unknown): number;

  /**
   * 判断是否应继续重试。
   * @param attempt 已执行的尝试次数
   * @param error 最近一次异常
   * @returns true 表示应继续重试
   */
  shouldRetry(attempt: number, error?: unknown): boolean;

  /**
   * 获取最大重试次数。
   */
  readonly maxAttempts: number;

  /**
   * 重置策略状态（用于支持可重用的策略实例）。
   */
  reset(): void;
}

/**
 * RetryOptions —— 重试策略的通用配置。
 */
export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  /**
   * 可重试的异常类/类型列表。
   * 空数组 = 所有异常均可重试。
   */
  retryableErrors?: Array<{ new (...args: any[]): Error }>;
  /**
   * 自定义 shouldRetry 钩子。
   */
  shouldRetry?: (attempt: number, error: unknown) => boolean;
}
```

**一致性约束**:
- `nextDelay()` 返回 `≤0` 时等效于 `shouldRetry()` 返回 `false`
- `maxAttempts` 包含首次调用——`maxAttempts=3` 表示首次 + 2 次重试
- `reset()` 必须将策略恢复到初始状态，不保留任何重试历史

### 4.2 ICircuitBreaker — 断路器

```typescript
/**
 * CircuitState —— 断路器三态。
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * ICircuitBreaker —— 断路器接口。
 *
 * 保护下游依赖不被频繁调用失败的请求压垮。
 * 三态转换：CLOSED（正常）→ OPEN（熔断）→ HALF_OPEN（试探）→ CLOSED 或 OPEN。
 *
 * 实现必须保证线程安全（所有公开方法可并发调用）。
 */
export interface ICircuitBreaker {
  /** 断路器名称，用于日志和监控 */
  readonly name: string;

  /** 当前状态 */
  readonly state: CircuitState;

  /**
   * 在断路器保护下执行异步调用。
   * - CLOSED: 放行，记录成功/失败
   * - OPEN: 快速失败，抛出 CircuitBreakerOpenError
   * - HALF_OPEN: 放行试探请求，根据结果决定转换方向
   *
   * @param fn 被保护的异步函数
   * @param fallback 可选降级函数，熔断时调用
   */
  call<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T>;

  /**
   * 手动记录一次成功（用于非 call 包装的场景）。
   */
  recordSuccess(): void;

  /**
   * 手动记录一次失败（同上）。
   */
  recordFailure(): void;

  /**
   * 重置断路器到 CLOSED 状态。
   */
  reset(): void;

  /**
   * 强制转换到指定状态（测试/运维用）。
   */
  forceState(state: CircuitState): void;

  /**
   * 订阅状态变更事件。
   */
  onStateChange(handler: (state: CircuitState, previous: CircuitState) => void): void;
}

/**
 * CircuitBreakerOptions —— 断路器的通用配置。
 */
export interface CircuitBreakerOptions {
  /** 熔断触发阈值（失败次数/比率） */
  readonly threshold: number;
  /** 滑动窗口大小（毫秒） */
  readonly windowMs: number;
  /** 断开后重试间隔（毫秒） */
  readonly halfOpenAfterMs: number;
  /** 最大半开试探请求数 */
  readonly maxHalfOpenRequests?: number;
  /** 最小调用次数（低于此不触发熔断） */
  readonly minimumCalls?: number;
}

/**
 * CircuitBreakerOpenError —— 断路器熔断时抛出的错误。
 */
export class CircuitBreakerOpenError extends Error {
  readonly circuitName: string;
  readonly state: CircuitState;
  constructor(circuitName: string) {
    super(`Circuit breaker "${circuitName}" is OPEN`);
    this.name = 'CircuitBreakerOpenError';
    this.circuitName = circuitName;
    this.state = 'OPEN';
  }
}
```

**状态机转换规则**:

```
                  ┌───────────────────┐
     ┌───────────│      CLOSED       │◄────────────┐
     │           └────────┬──────────┘              │
     │                    │                         │
     │          threshold exceeded                  │
     │                    │                         │
     │                    ▼                         │
     │           ┌───────────────────┐              │
     │   ┌───────│       OPEN        │──────────────┘
     │   │       └────────┬──────────┘   halfOpenAfterMs 超时
     │   │                │
     │   │     进入半开试探
     │   │                │
     │   │                ▼
     │   │       ┌───────────────────┐
     │   │       │    HALF_OPEN      │
     │   │       └────────┬──────────┘
     │   │                │
     │   │    ┌───────────┴───────────┐
     │   │    │                       │
     │   │  成功 (≥ 阈值)         失败 (1次)
     │   │    │                       │
     │   │    ▼                       ▼
     │   │ ┌───────┐           ┌───────────┐
     │   └─│CLOSED │           │   OPEN    │
     │     └───────┘           └───────────┘
     │
     └───────────────── 手动 reset()
```

**设计要点**:
- `CLOSED → OPEN`：失败率/次数超过 `threshold` 时触发（由实现定义具体判定逻辑）
- `OPEN → HALF_OPEN`：经过 `halfOpenAfterMs` 后自动进入
- `HALF_OPEN → CLOSED`：试探请求成功且达到指定成功次数
- `HALF_OPEN → OPEN`：试探请求失败
- `minimumCalls` 防止冷启动时过早熔断（默认 10）

### 4.3 ITimeoutPolicy — 超时策略

```typescript
/**
 * TimeoutResult —— 超时执行的结果。
 */
export interface TimeoutResult<T> {
  success: true;
  value: T;
  elapsedMs: number;
} | {
  success: false;
  error: TimeoutError | Error;
  elapsedMs: number;
};

/**
 * ITimeoutPolicy —— 超时策略接口。
 *
 * 为异步操作提供统一超时控制。
 * 实现可使用 AbortSignal.timeout / Promise.race / AbortController 等不同机制。
 */
export interface ITimeoutPolicy {
  /** 策略名称 */
  readonly name: string;

  /** 当前超时值（毫秒），可能随自适应算法变化 */
  readonly timeoutMs: number;

  /**
   * 在超时保护下执行异步函数。
   * 超时时抛出 TimeoutError。
   *
   * @param fn 要执行的异步函数，接收 AbortSignal 作为可选参数
   * @param signal 外部取消信号（可选）
   */
  execute<T>(fn: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<TimeoutResult<T>>;

  /**
   * 创建一个 AbortSignal，在超时时自动中止。
   * 用于非 execute 包装但需要超时信号的场景。
   */
  createSignal(signal?: AbortSignal): AbortSignal;

  /**
   * 重置超时策略（主要用于自适应超时）。
   */
  reset(): void;
}

/**
 * TimeoutError —— 超时错误。
 */
export class TimeoutError extends Error {
  readonly timeoutMs: number;
  readonly elapsedMs: number;
  constructor(timeoutMs: number, elapsedMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    this.elapsedMs = elapsedMs;
  }
}

/**
 * TimeoutOptions —— 超时策略通用配置。
 */
export interface TimeoutOptions {
  /** 超时值（毫秒） */
  readonly durationMs: number;
  /** 是否取消 pending 操作（超时后取消，默认 true） */
  readonly cancelOnTimeout?: boolean;
}
```

### 4.4 执行上下文 (Execution Context)

```typescript
/**
 * ResilienceContext —— 执行韧性策略时的共享上下文。
 *
 * 记录执行链路信息，供日志、监控、事件溯源使用。
 */
export interface ResilienceContext {
  /** 全局唯一执行 ID */
  readonly executionId: string;
  /** 策略名称链 */
  readonly policyChain: string[];
  /** 起始时间戳 */
  readonly startedAt: number;
  /** 重试计数器 */
  attempt: number;
  /** 自定义属性 */
  metadata: Map<string, unknown>;
}

/**
 * ResilienceContextManager —— 上下文管理器（基于 AsyncLocalStorage）。
 * 确保同一链路共享同一上下文，无需显式传递。
 */
export class ResilienceContextManager {
  static run<T>(fn: () => Promise<T>): Promise<T>;
  static current(): ResilienceContext | undefined;
  static generateId(): string;
}
```

---

## 5. 实现层：内置策略

### 5.1 RetryPolicy 实现

#### 5.1.1 ExponentialBackoffRetry — 指数退避重试

```typescript
/**
 * ExponentialBackoffRetry —— 指数退避重试策略。
 *
 * 退避公式：delay = baseDelayMs * (2 ^ (attempt - 1)) + jitter
 * 最大延迟受 maxDelayMs 限制。
 *
 * 适用场景：网络请求 / LLM API 调用 / 临时性服务不可用
 */
export class ExponentialBackoffRetry implements IRetryPolicy {
  readonly name = 'exponential-backoff';
  readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterFactor: number;  // 0 ~ 0.5
  private readonly retryableErrors: Array<{ new (...args: any[]): Error }>;
  private readonly shouldRetryHook?: (attempt: number, error: unknown) => boolean;

  constructor(options: RetryOptions & {
    jitterFactor?: number;  // 默认 0.1（±10% 抖动）
  }) { /* ... */ }

  nextDelay(attempt: number, error?: unknown): number {
    const exponential = this.baseDelayMs * Math.pow(2, attempt - 1);
    const clamped = Math.min(exponential, this.maxDelayMs);
    const jitter = clamped * this.jitterFactor * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(clamped + jitter));
  }

  shouldRetry(attempt: number, error?: unknown): boolean {
    if (attempt >= this.maxAttempts) return false;
    if (this.shouldRetryHook) return this.shouldRetryHook(attempt, error);
    if (this.retryableErrors.length === 0) return true;
    return this.retryableErrors.some(Err => error instanceof Err);
  }

  reset(): void { /* 纯函数，无状态重置 */ }
}
```

**默认参数**:
| 参数 | 默认值 | 说明 |
|------|--------|------|
| `maxAttempts` | 3 | 最大尝试次数（含首次） |
| `baseDelayMs` | 1000 | 基础延迟 1s |
| `maxDelayMs` | 30000 | 最大延迟 30s |
| `jitterFactor` | 0.1 | ±10% 抖动 |

**退避序列示例** (`baseDelayMs=1000, jitterFactor=0`):
```
attempt 1: 1000ms  (实际首次无需等待，此为失败后重试等待)
attempt 2: 2000ms
attempt 3: 4000ms
attempt 4: 8000ms
attempt 5: 16000ms
attempt 6+: 30000ms (受 maxDelayMs 限制)
```

#### 5.1.2 LinearBackoffRetry — 线性退避重试

```typescript
/**
 * LinearBackoffRetry —— 线性退避重试策略。
 *
 * 退避公式：delay = baseDelayMs * attempt
 * 最大延迟受 maxDelayMs 限制。
 *
 * 适用场景：定时轮询 / 已知间隔的速率限制 / 资源等待
 */
export class LinearBackoffRetry implements IRetryPolicy {
  readonly name = 'linear-backoff';
  readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly retryableErrors: Array<{ new (...args: any[]): Error }>;

  constructor(options: RetryOptions) { /* ... */ }

  nextDelay(attempt: number, error?: unknown): number {
    const linear = this.baseDelayMs * attempt;
    return Math.min(linear, this.maxDelayMs);
  }

  shouldRetry(attempt: number, error?: unknown): boolean {
    if (attempt >= this.maxAttempts) return false;
    if (this.retryableErrors.length === 0) return true;
    return this.retryableErrors.some(Err => error instanceof Err);
  }

  reset(): void { /* 无状态 */ }
}
```

#### 5.1.3 JitterBackoffRetry — 全抖动退避重试

```typescript
/**
 * JitterBackoffRetry —— 全抖动退避（Full Jitter）重试策略。
 *
 * 退避公式：delay = random(0, min(maxDelayMs, baseDelayMs * 2^attempt))
 * 相比 ExponentialBackoffRetry 的 ±10% 抖动，全抖动在 0~cap 之间均匀分布，
 * 有效避免惊群效应（Thundering Herd）。
 *
 * 适用场景：分布式系统中的重试 / 高并发下的速率限制恢复
 *
 * 参考：AWS Exponential Backoff and Jitter
 * https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
export class JitterBackoffRetry implements IRetryPolicy {
  readonly name = 'jitter-backoff';
  readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly retryableErrors: Array<{ new (...args: any[]): Error }>;

  constructor(options: RetryOptions) { /* ... */ }

  nextDelay(attempt: number, error?: unknown): number {
    const cap = Math.min(this.maxDelayMs, this.baseDelayMs * Math.pow(2, attempt - 1));
    return Math.floor(Math.random() * cap);
  }

  shouldRetry(attempt: number, error?: unknown): boolean {
    if (attempt >= this.maxAttempts) return false;
    if (this.retryableErrors.length === 0) return true;
    return this.retryableErrors.some(Err => error instanceof Err);
  }

  reset(): void { /* 无状态 */ }
}
```

#### 5.1.4 NoRetry — 空重试（占位策略）

```typescript
/**
 * NoRetry —— 不重试策略。
 * 用于显式关闭重试，或作为默认初始值。
 */
export class NoRetry implements IRetryPolicy {
  readonly name = 'no-retry';
  readonly maxAttempts = 1;
  nextDelay(_attempt: number, _error?: unknown): number { return 0; }
  shouldRetry(_attempt: number, _error?: unknown): boolean { return false; }
  reset(): void { /* 无状态 */ }
}
```

### 5.2 CircuitBreaker 实现

#### 5.2.1 SlidingWindowBreaker — 滑动窗口断路器

```typescript
/**
 * SlidingWindowBreaker —— 基于滑动窗口失败率的断路器。
 *
 * 在固定时间窗口内统计失败次数/总调用数，当失败率超过 threshold 时熔断。
 * 窗口以毫秒精度滑动，过期记录自动淘汰。
 *
 * 适用场景：API 调用保护 / 下游服务健康监测 / 数据库连接保护
 */
export class SlidingWindowBreaker implements ICircuitBreaker {
  readonly name: string;
  private state: CircuitState = 'CLOSED';
  private readonly options: Required<CircuitBreakerOptions>;
  private readonly calls: Array<{ timestamp: number; success: boolean }> = [];
  private halfOpenSuccesses = 0;
  private openSince: number = 0;
  private stateChangeHandlers: Array<(state: CircuitState, previous: CircuitState) => void> = [];

  constructor(name: string, options: CircuitBreakerOptions) { /* ... */ }

  get state(): CircuitState { return this.state; }

  async call<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    this.evictExpiredEntries();

    if (this.state === 'OPEN') {
      if (Date.now() - this.openSince >= this.options.halfOpenAfterMs) {
        this.transitionTo('HALF_OPEN');
      } else {
        if (fallback) return fallback();
        throw new CircuitBreakerOpenError(this.name);
      }
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenSuccesses >= (this.options.maxHalfOpenRequests ?? 1)) {
      this.transitionTo('CLOSED');
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      if (fallback) return fallback();
      throw err;
    }
  }

  recordSuccess(): void {
    this.calls.push({ timestamp: Date.now(), success: true });
    if (this.state === 'HALF_OPEN') {
      this.halfOpenSuccesses++;
    }
  }

  recordFailure(): void {
    this.calls.push({ timestamp: Date.now(), success: false });
    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
      return;
    }
    this.checkThreshold();
  }

  reset(): void {
    this.calls.length = 0;
    this.halfOpenSuccesses = 0;
    this.transitionTo('CLOSED');
  }

  forceState(state: CircuitState): void {
    this.transitionTo(state);
    if (state === 'CLOSED' || state === 'OPEN') {
      this.calls.length = 0;
      this.halfOpenSuccesses = 0;
    }
    if (state === 'OPEN') {
      this.openSince = Date.now();
    }
  }

  onStateChange(handler: (state: CircuitState, previous: CircuitState) => void): void {
    this.stateChangeHandlers.push(handler);
  }

  private transitionTo(newState: CircuitState): void {
    const previous = this.state;
    this.state = newState;
    if (newState === 'OPEN') this.openSince = Date.now();
    if (newState === 'CLOSED') { this.halfOpenSuccesses = 0; this.calls.length = 0; }
    if (newState === 'HALF_OPEN') this.halfOpenSuccesses = 0;
    for (const handler of this.stateChangeHandlers) {
      try { handler(newState, previous); } catch { /* 隔离 */ }
    }
  }

  private evictExpiredEntries(): void {
    const cutoff = Date.now() - this.options.windowMs;
    while (this.calls.length > 0 && this.calls[0].timestamp < cutoff) {
      this.calls.shift();
    }
  }

  private checkThreshold(): void {
    const total = this.calls.length;
    const failed = this.calls.filter(c => !c.success).length;
    if (total < (this.options.minimumCalls ?? 10)) return;
    const failureRate = failed / total;
    if (failureRate >= this.options.threshold) {
      this.transitionTo('OPEN');
    }
  }
}
```

**配置示例**:
```typescript
new SlidingWindowBreaker('llm-api', {
  threshold: 0.5,        // 50% 失败率触发熔断
  windowMs: 60000,       // 60 秒滑动窗口
  halfOpenAfterMs: 30000, // 30 秒后尝试恢复
  maxHalfOpenRequests: 3, // 半开期最多放行 3 个试探请求
  minimumCalls: 10,       // 至少 10 次调用才触发熔断判断
});
```

#### 5.2.2 ConsecutiveFailureBreaker — 连续失败断路器

```typescript
/**
 * ConsecutiveFailureBreaker —— 基于连续失败次数的断路器。
 *
 * 当连续失败次数达到 threshold 时熔断。
 * 相比滑动窗口断路器，实现更轻量，适合对短暂故障敏感的场景。
 *
 * 适用场景：快速失败保护 / 本地资源健康检测 / 简单熔断需求
 */
export class ConsecutiveFailureBreaker implements ICircuitBreaker {
  readonly name: string;
  private state: CircuitState = 'CLOSED';
  private readonly options: Required<CircuitBreakerOptions>;
  private consecutiveFailures = 0;
  private openSince: number = 0;
  private stateChangeHandlers: Array<(state: CircuitState, previous: CircuitState) => void> = [];

  constructor(name: string, options: CircuitBreakerOptions) { /* ... */ }

  get state(): CircuitState { return this.state; }

  async call<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.openSince >= this.options.halfOpenAfterMs) {
        this.state = 'HALF_OPEN';
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
      this.recordFailure();
      if (fallback) return fallback();
      throw err;
    }
  }

  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.transitionTo('CLOSED');
    }
    this.consecutiveFailures = 0;
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
      return;
    }
    if (this.consecutiveFailures >= this.options.threshold) {
      this.transitionTo('OPEN');
    }
  }

  reset(): void {
    this.consecutiveFailures = 0;
    this.transitionTo('CLOSED');
  }

  forceState(state: CircuitState): void {
    this.transitionTo(state);
    if (state === 'CLOSED') {
      this.consecutiveFailures = 0;
    }
    if (state === 'OPEN') {
      this.openSince = Date.now();
    }
  }

  onStateChange(handler: (state: CircuitState, previous: CircuitState) => void): void {
    this.stateChangeHandlers.push(handler);
  }

  private transitionTo(newState: CircuitState): void {
    const previous = this.state;
    this.state = newState;
    if (newState === 'OPEN') this.openSince = Date.now();
    if (newState === 'CLOSED') this.consecutiveFailures = 0;
    for (const handler of this.stateChangeHandlers) {
      try { handler(newState, previous); } catch { /* 隔离 */ }
    }
  }
}
```

**配置示例**:
```typescript
new ConsecutiveFailureBreaker('disk-write', {
  threshold: 3,          // 连续 3 次失败触发熔断
  windowMs: 0,           // 不适用（连续计数无窗口）
  halfOpenAfterMs: 10000, // 10 秒后尝试恢复
  maxHalfOpenRequests: 1,
  minimumCalls: 1,       // 连续模式不需要最小调用数
});
```

#### 5.2.3 NoBreaker — 空断路器（占位）

```typescript
/**
 * NoBreaker —— 不熔断策略。
 * 用于显式关闭断路器保护。
 */
export class NoBreaker implements ICircuitBreaker {
  readonly name = 'no-breaker';
  readonly state: CircuitState = 'CLOSED';
  async call<T>(fn: () => Promise<T>, _fallback?: () => Promise<T>): Promise<T> { return fn(); }
  recordSuccess(): void { /* 无操作 */ }
  recordFailure(): void { /* 无操作 */ }
  reset(): void { /* 无操作 */ }
  forceState(_state: CircuitState): void { /* 无操作 */ }
  onStateChange(_handler: (state: CircuitState, previous: CircuitState) => void): void { /* 无操作 */ }
}
```

### 5.3 TimeoutPolicy 实现

#### 5.3.1 FixedTimeoutPolicy — 固定超时

```typescript
/**
 * FixedTimeoutPolicy —— 固定超时策略。
 *
 * 使用 AbortSignal.timeout 实现超时控制。
 * 当 AbortSignal.timeout 不可用时（如 Windows Node.js 部分版本），
 * 自动降级为 Promise.race 方案。
 *
 * 适用场景：常规 API 调用超时 / 插件执行超时 / MCP 调用超时
 */
export class FixedTimeoutPolicy implements ITimeoutPolicy {
  readonly name = 'fixed-timeout';
  readonly timeoutMs: number;
  private readonly cancelOnTimeout: boolean;

  constructor(options: TimeoutOptions) { /* ... */ }

  async execute<T>(fn: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<TimeoutResult<T>> {
    const startedAt = Date.now();
    const controller = new AbortController();

    // 合并外部 signal
    const combinedSignal = signal
      ? AbortSignal.any?.([signal, AbortSignal.timeout(this.timeoutMs)])
        ?? this._legacyMerge(signal, controller)
      : AbortSignal.timeout(this.timeoutMs);

    try {
      const value = await fn(combinedSignal);
      return { success: true, value, elapsedMs: Date.now() - startedAt };
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      if (err instanceof DOMException && err.name === 'TimeoutError' ||
          (err as any)?.name === 'AbortError' && elapsedMs >= this.timeoutMs) {
        throw new TimeoutError(this.timeoutMs, elapsedMs);
      }
      // 如果取消时抛出 AbortError，且我们不想传播它
      if ((err as any)?.name === 'AbortError' && this.cancelOnTimeout) {
        throw new TimeoutError(this.timeoutMs, elapsedMs);
      }
      return { success: false, error: err as Error, elapsedMs };
    } finally {
      if (!this.cancelOnTimeout) controller.abort();
    }
  }

  createSignal(signal?: AbortSignal): AbortSignal {
    return signal
      ? AbortSignal.any?.([signal, AbortSignal.timeout(this.timeoutMs)])
        ?? this._legacyMerge(signal, new AbortController())
      : AbortSignal.timeout(this.timeoutMs);
  }

  reset(): void { /* 无状态 */ }

  private _legacyMerge(signal: AbortSignal, controller: AbortController): AbortSignal {
    // 兼容方案：监听外部 signal 同步中止
    signal.addEventListener('abort', () => controller.abort());
    setTimeout(() => controller.abort(), this.timeoutMs);
    return controller.signal;
  }
}
```

**兼容性层**：
- Node.js 18+: `AbortSignal.timeout()` 原生支持
- Node.js 16: 使用 `AbortController` + `setTimeout` 降级
- Windows Node.js 特定问题：通过 `Promise.race` 硬兜底补偿（延续 `@cortex/llm` 的双重超时设计）

#### 5.3.2 AdaptiveTimeoutPolicy — 自适应超时

```typescript
/**
 * AdaptiveTimeoutPolicy —— 自适应超时策略。
 *
 * 基于历史执行时间动态调整超时值。
 * 使用 EMA（指数移动平均）平滑历史延迟，超时 = EMA × multiplier。
 *
 * 适用场景：LLM API 调用（延迟波动大）/ 外部服务调用 / 需要动态调整的场景
 *
 * 算法：
 *   ema = α × lastDuration + (1 - α) × ema         (α = 0.3)
 *   timeout = clamp(ema × multiplier, minTimeout, maxTimeout)
 */
export class AdaptiveTimeoutPolicy implements ITimeoutPolicy {
  readonly name = 'adaptive-timeout';
  private readonly minTimeoutMs: number;
  private readonly maxTimeoutMs: number;
  private readonly multiplier: number;
  private readonly alpha: number;           // EMA 平滑系数（默认 0.3）
  private ema: number;                      // 指数移动平均
  private currentTimeoutMs: number;

  constructor(options: TimeoutOptions & {
    minTimeoutMs?: number;    // 最小超时（默认 5000）
    maxTimeoutMs?: number;    // 最大超时（默认 60000）
    multiplier?: number;      // 超时倍数（默认 3）
    alpha?: number;           // EMA 平滑系数（默认 0.3）
    initialEma?: number;      // 初始 EMA 值（默认 5000）
  }) { /* ... */ }

  get timeoutMs(): number { return this.currentTimeoutMs; }

  async execute<T>(fn: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<TimeoutResult<T>> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const combinedSignal = this._mergeSignal(signal, controller);

    try {
      const value = await fn(combinedSignal);
      const elapsedMs = Date.now() - startedAt;
      this._updateEma(elapsedMs);
      return { success: true, value, elapsedMs };
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      if ((err as any)?.name === 'TimeoutError' || elapsedMs >= this.currentTimeoutMs) {
        // 超时不更新 EMA（防止超时拉长超时）
        return { success: false, error: new TimeoutError(this.currentTimeoutMs, elapsedMs), elapsedMs };
      }
      // 非超时失败：更新 EMA
      this._updateEma(elapsedMs);
      return { success: false, error: err as Error, elapsedMs };
    } finally {
      clearTimeout(this._timeoutId);
    }
  }

  createSignal(signal?: AbortSignal): AbortSignal {
    return this._mergeSignal(signal, new AbortController());
  }

  reset(): void {
    this.ema = 5000;
    this.currentTimeoutMs = 15000;
  }

  private _updateEma(lastDuration: number): void {
    this.ema = this.alpha * lastDuration + (1 - this.alpha) * this.ema;
    this.currentTimeoutMs = Math.min(
      this.maxTimeoutMs,
      Math.max(this.minTimeoutMs, Math.round(this.ema * this.multiplier))
    );
  }

  private _mergeSignal(signal: AbortSignal | undefined, controller: AbortController): AbortSignal {
    const timeoutId = setTimeout(() => controller.abort(), this.currentTimeoutMs);
    this._timeoutId = timeoutId;
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        controller.abort();
      });
    }
    return controller.signal;
  }

  private _timeoutId?: ReturnType<typeof setTimeout>;
}
```

**自适应示例**:
```
第 1 次: 实际耗时 2000ms → ema = 0.3×2000 + 0.7×5000 = 4100 → timeout = 12300ms
第 2 次: 实际耗时 8000ms → ema = 0.3×8000 + 0.7×4100 = 5270 → timeout = 15810ms
第 3 次: 实际耗时 1500ms → ema = 0.3×1500 + 0.7×5270 = 4139 → timeout = 12417ms
...
```

#### 5.3.3 NoTimeout — 空超时（占位策略）

```typescript
/**
 * NoTimeout —— 不超时策略。
 * 用于显式关闭超时保护。
 */
export class NoTimeout implements ITimeoutPolicy {
  readonly name = 'no-timeout';
  readonly timeoutMs = Infinity;
  async execute<T>(fn: (signal?: AbortSignal) => Promise<T>, _signal?: AbortSignal): Promise<TimeoutResult<T>> {
    const startedAt = Date.now();
    try {
      const value = await fn();
      return { success: true, value, elapsedMs: Date.now() - startedAt };
    } catch (err) {
      return { success: false, error: err as Error, elapsedMs: Date.now() - startedAt };
    }
  }
  createSignal(signal?: AbortSignal): AbortSignal {
    return signal ?? new AbortController().signal;
  }
  reset(): void { /* 无状态 */ }
}
```

### 5.4 实现矩阵总览

| 策略 | 实现 | 状态 | 适用场景 | 复杂度 |
|------|------|------|---------|--------|
| **IRetryPolicy** | `ExponentialBackoffRetry` | ✅ 设计完成 | LLM API / 网络请求 | ⭐⭐ |
| | `LinearBackoffRetry` | ✅ 设计完成 | 轮询 / 速率限制等待 | ⭐ |
| | `JitterBackoffRetry` | ✅ 设计完成 | 分布式重试 / 惊群避免 | ⭐⭐ |
| | `NoRetry` | ✅ 设计完成 | 占位 / 关闭重试 | ⭐ |
| **ICircuitBreaker** | `SlidingWindowBreaker` | ✅ 设计完成 | API 保护 / 下游健康 | ⭐⭐⭐ |
| | `ConsecutiveFailureBreaker` | ✅ 设计完成 | 快速失败 / 简单熔断 | ⭐⭐ |
| | `NoBreaker` | ✅ 设计完成 | 占位 / 关闭熔断 | ⭐ |
| **ITimeoutPolicy** | `FixedTimeoutPolicy` | ✅ 设计完成 | 通用超时控制 | ⭐⭐ |
| | `AdaptiveTimeoutPolicy` | ✅ 设计完成 | LLM API / 延迟波动大 | ⭐⭐⭐ |
| | `NoTimeout` | ✅ 设计完成 | 占位 / 关闭超时 | ⭐ |

---

## 6. 编排层：注册与组合

### 6.1 ResilienceRegistry — 策略注册中心

```typescript
/**
 * ResilienceRegistry —— 韧性策略注册中心。
 *
 * 职责：
 * 1. 注册/查询/卸载策略实例
 * 2. 组合执行（retry → circuitBreaker → timeout 嵌套）
 * 3. 状态快照与监控
 * 4. 全局事件通知
 *
 * 使用方式（推荐）：
 *   const registry = ResilienceRegistry.create();
 *   registry.register('llm-api', {
 *     retry: new ExponentialBackoffRetry({ maxAttempts: 3, baseDelayMs: 1000 }),
 *     circuitBreaker: new SlidingWindowBreaker('llm-api', { threshold: 0.5, windowMs: 60000, halfOpenAfterMs: 30000 }),
 *     timeout: new AdaptiveTimeoutPolicy({ durationMs: 30000 }),
 *   });
 *
 *   // 组合执行
 *   const result = await registry.execute('llm-api', () => llm.call(prompt));
 *
 *   // 或选取特定策略
 *   const retry = registry.getRetry('llm-api');
 */
export interface IResilienceRegistry {
  /**
   * 注册一组策略到指定名称。
   * 同名注册会覆盖已有条目（emit 警告事件）。
   */
  register(name: string,
    policies: {
      retry?: IRetryPolicy;
      circuitBreaker?: ICircuitBreaker;
      timeout?: ITimeoutPolicy;
    }): void;

  /** 卸载指定名称的所有策略 */
  unregister(name: string): void;

  /** 获取指定名称的重试策略 */
  getRetry(name: string): IRetryPolicy | undefined;

  /** 获取指定名称的断路器 */
  getCircuitBreaker(name: string): ICircuitBreaker | undefined;

  /** 获取指定名称的超时策略 */
  getTimeout(name: string): ITimeoutPolicy | undefined;

  /**
   * 在指定策略保护下执行函数。
   * 执行顺序：timeout → circuitBreaker → retry → fn
   *
   * @param name 注册的策略组名称
   * @param fn 要执行的函数
   * @param overrides 可选覆盖配置（临时替换已注册策略）
   */
  execute<T>(name: string, fn: () => Promise<T>,
    overrides?: {
      retry?: IRetryPolicy;
      circuitBreaker?: ICircuitBreaker;
      timeout?: ITimeoutPolicy;
    }): Promise<T>;

  /**
   * 获取所有已注册策略的快照。
   * 用于监控面板/健康检查。
   */
  snapshot(): Array<{
    name: string;
    retry: string | null;
    circuitBreaker: { name: string; state: CircuitState } | null;
    timeout: string | null;
  }>;

  /** 全局重置所有策略（测试/恢复用） */
  reset(): void;

  /** 注册全局状态变更监听器 */
  onEvent(handler: (event: ResilienceEvent) => void): void;
}

/**
 * ResilienceEvent —— 韧性事件。
 */
export type ResilienceEvent =
  | { type: 'RETRY_ATTEMPT'; name: string; attempt: number; delayMs: number }
  | { type: 'RETRY_EXHAUSTED'; name: string; attempt: number }
  | { type: 'CIRCUIT_STATE_CHANGE'; name: string; from: CircuitState; to: CircuitState }
  | { type: 'CIRCUIT_OPEN'; name: string }
  | { type: 'CIRCUIT_HALF_OPEN'; name: string }
  | { type: 'CIRCUIT_CLOSED'; name: string }
  | { type: 'TIMEOUT_OCCURRED'; name: string; timeoutMs: number; elapsedMs: number }
  | { type: 'ADAPTIVE_TIMEOUT_UPDATE'; name: string; newTimeoutMs: number }
  | { type: 'REGISTRY_OVERWRITE'; name: string }
  | { type: 'EXECUTION_ERROR'; name: string; error: Error };
```

### 6.2 ResilienceRegistry 默认实现

```typescript
export class ResilienceRegistry implements IResilienceRegistry {
  private readonly store = new Map<string, {
    retry: IRetryPolicy;
    circuitBreaker: ICircuitBreaker;
    timeout: ITimeoutPolicy;
  }>();
  private readonly eventHandlers: Array<(event: ResilienceEvent) => void> = [];

  static create(
    defaults?: { retry?: IRetryPolicy; circuitBreaker?: ICircuitBreaker; timeout?: ITimeoutPolicy }
  ): ResilienceRegistry {
    const registry = new ResilienceRegistry();
    if (defaults) {
      registry.store.set('default', {
        retry: defaults.retry ?? new NoRetry(),
        circuitBreaker: defaults.circuitBreaker ?? new NoBreaker(),
        timeout: defaults.timeout ?? new NoTimeout(),
      });
    }
    return registry;
  }

  register(name: string,
    policies: {
      retry?: IRetryPolicy;
      circuitBreaker?: ICircuitBreaker;
      timeout?: ITimeoutPolicy;
    }): void
  {
    if (this.store.has(name)) {
      this._emit({ type: 'REGISTRY_OVERWRITE', name });
    }

    const existing = this.store.get(name);
    this.store.set(name, {
      retry: policies.retry ?? existing?.retry ?? new NoRetry(),
      circuitBreaker: policies.circuitBreaker ?? existing?.circuitBreaker ?? new NoBreaker(),
      timeout: policies.timeout ?? existing?.timeout ?? new NoTimeout(),
    });
  }

  unregister(name: string): void {
    this.store.delete(name);
  }

  getRetry(name: string): IRetryPolicy | undefined {
    return this.store.get(name)?.retry;
  }

  getCircuitBreaker(name: string): ICircuitBreaker | undefined {
    return this.store.get(name)?.circuitBreaker;
  }

  getTimeout(name: string): ITimeoutPolicy | undefined {
    return this.store.get(name)?.timeout;
  }

  async execute<T>(name: string, fn: () => Promise<T>,
    overrides?: {
      retry?: IRetryPolicy;
      circuitBreaker?: ICircuitBreaker;
      timeout?: ITimeoutPolicy;
    }): Promise<T>
  {
    const policies = this.store.get(name);
    if (!policies) throw new Error(`No resilience policies registered for "${name}"`);

    const retry = overrides?.retry ?? policies.retry;
    const cb = overrides?.circuitBreaker ?? policies.circuitBreaker;
    const timeout = overrides?.timeout ?? policies.timeout;

    // timeout → circuitBreaker → retry → fn
    const wrapped = () =>
      retry.execute(
        () => cb.call(
          () => timeout.execute(fn).then(r => {
            if (!r.success) throw r.error;
            return r.value;
          }),
          // 熔断降级：尝试超时执行（可能失败），或返回降级值
          () => timeout.execute(fn).then(r => {
            if (!r.success) throw r.error;
            return r.value;
          }),
        ),
        // 重试只重试可重试的错误
        undefined,
        {
          onRetry: (attempt, delayMs) => this._emit({ type: 'RETRY_ATTEMPT', name, attempt, delayMs }),
          onExhausted: (attempt) => this._emit({ type: 'RETRY_EXHAUSTED', name, attempt }),
        }
      );

    return this._executeWithContext(name, wrapped);
  }

  snapshot(): Array<{ ... }> { /* ... */ }

  reset(): void {
    for (const [, policies] of this.store) {
      policies.retry.reset();
      policies.circuitBreaker.reset();
      policies.timeout.reset();
    }
  }

  onEvent(handler: (event: ResilienceEvent) => void): void {
    this.eventHandlers.push(handler);
  }

  private _emit(event: ResilienceEvent): void {
    for (const handler of this.eventHandlers) {
      try { handler(event); } catch { /* 隔离 */ }
    }
  }

  private async _executeWithContext<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return ResilienceContextManager.run(async () => {
      const ctx = ResilienceContextManager.current()!;
      ctx.metadata.set('policyName', name);
      try {
        return await fn();
      } catch (err) {
        this._emit({ type: 'EXECUTION_ERROR', name, error: err as Error });
        throw err;
      }
    });
  }
}
```

### 6.3 Registry 使用示例

```typescript
// ── 初始化 ──
const registry = ResilienceRegistry.create({
  timeout: new FixedTimeoutPolicy({ durationMs: 15000 }),
});

// ── 注册 LLM API 策略组 ──
registry.register('llm-api', {
  retry: new ExponentialBackoffRetry({
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    retryableErrors: [RateLimitError, NetworkError],
  }),
  circuitBreaker: new SlidingWindowBreaker('llm-api', {
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

// ── 注册搜索后端策略组 ──
registry.register('search-backend', {
  retry: new LinearBackoffRetry({
    maxAttempts: 2,
    baseDelayMs: 1000,
  }),
  circuitBreaker: new ConsecutiveFailureBreaker('search', {
    threshold: 3,
    halfOpenAfterMs: 10000,
  }),
  timeout: new FixedTimeoutPolicy({ durationMs: 15000 }),
});

// ── 组合执行 ──
const result = await registry.execute('llm-api', () => llm.chat(prompt));

// ── 临时覆盖 ──
const quickResult = await registry.execute('llm-api', () => llm.chat(prompt), {
  timeout: new FixedTimeoutPolicy({ durationMs: 5000 }), // 本次用 5s 超时
});

// ── 监控事件 ──
registry.onEvent(event => {
  if (event.type === 'CIRCUIT_OPEN') {
    console.warn(`⚠️ Circuit ${event.name} opened!`);
  }
  if (event.type === 'RETRY_ATTEMPT') {
    logger.debug(`Retry ${event.attempt} for ${event.name}, waiting ${event.delayMs}ms`);
  }
});

// ── 健康检查快照 ──
const snapshot = registry.snapshot();
// [
//   { name: 'llm-api', retry: 'exponential-backoff', circuitBreaker: { name: 'sliding-window', state: 'CLOSED' }, timeout: 'adaptive-timeout' },
//   { name: 'search-backend', retry: 'linear-backoff', circuitBreaker: { name: 'consecutive-failure', state: 'CLOSED' }, timeout: 'fixed-timeout' },
// ]
```

### 6.4 便捷工厂函数

```typescript
/**
 * createResilience —— 一键创建带默认策略的注册中心。
 * 为常见场景提供开箱即用的配置。
 */
export function createResilience(options?: {
  defaults?: {
    retry?: RetryOptions;
    circuitBreaker?: CircuitBreakerOptions & { name?: string; type?: 'sliding' | 'consecutive' };
    timeout?: TimeoutOptions & { adaptive?: boolean };
  };
  policies?: Record<string, {
    retry?: RetryOptions | 'none';
    circuitBreaker?: (CircuitBreakerOptions & { name: string; type?: 'sliding' | 'consecutive' }) | 'none';
    timeout?: (TimeoutOptions & { adaptive?: boolean }) | 'none';
  }>;
}): IResilienceRegistry;
```

---

## 7. 数据流与生命周期

### 7.1 完整执行链路

```
调用方
  │
  ├─ registry.execute('llm-api', fn)
  │   │
  │   │  ResilienceContextManager.run()
  │   │     ├─ 生成 executionId
  │   │     └─ 注入 ResilienceContext
  │   │
  │   ├─ [TimeoutPolicy] 超时保护
  │   │   ├─ FixedTimeout: AbortSignal.timeout(30000)
  │   │   └─ AdaptiveTimeout: EMA 动态计算超时值
  │   │       └─ 超时 → 抛出 TimeoutError
  │   │
  │   ├─ [CircuitBreaker] 熔断保护
  │   │   ├─ CLOSED: 放行调用
  │   │   ├─ OPEN: 检查 halfOpenAfterMs → 抛出 CircuitBreakerOpenError / 执行 fallback
  │   │   └─ HALF_OPEN: 放行试探 → 成功转 CLOSED / 失败转 OPEN
  │   │       └─ 记录成功/失败到滑动窗口
  │   │
  │   ├─ [RetryPolicy] 重试保护
  │   │   ├─ 第 1 次失败 → recordFailure() + nextDelay(1)
  │   │   ├─ 第 2 次失败 → recordFailure() + nextDelay(2)
  │   │   └─ 第 3 次失败 → shouldRetry=false → 抛出最后一次错误
  │   │
  │   └─ fn() 实际业务调用
  │
  └─ 结果 / 错误
       ├─ 正常结果 → 返回
       ├─ TimeoutError → 调用方处理 / 触发降级
       ├─ CircuitBreakerOpenError → 调用方处理 / fallback
       └─ 重试耗尽 → 抛出最终错误
```

### 7.2 策略生命周期

```
策略创建
  │
  ├─ registry.register(name, policies)
  │
  ├─ 运行时
  │   ├─ retry: 每次 execute() 更新尝试次数（内部状态）
  │   ├─ circuitBreaker: 每次 call() 更新调用记录 → 可能触发状态转换
  │   └─ timeout: 每次 execute() 更新 EMA（自适应模式）
  │
  ├─ registry.snapshot()  → 查询当前状态
  │
  ├─ registry.reset()     → 所有策略恢复到初始状态
  │
  └─ registry.unregister(name) → 清理策略实例
       └─ 实例不再使用 → GC
```

### 7.3 事件流

```
ResilienceRegistry.onEvent(handler)
    │
    ├── RETRY_ATTEMPT          → 重试前发射
    ├── RETRY_EXHAUSTED        → 重试耗尽后发射
    ├── CIRCUIT_STATE_CHANGE   → 断路器状态变化时发射
    ├── CIRCUIT_OPEN           → 断路器首次熔断时发射
    ├── CIRCUIT_HALF_OPEN      → 断路器进入半开时发射
    ├── CIRCUIT_CLOSED         → 断路器闭合时发射
    ├── TIMEOUT_OCCURRED       → 超时发生时发射
    ├── ADAPTIVE_TIMEOUT_UPDATE → 自适应超时值更新时发射
    ├── REGISTRY_OVERWRITE     → 同名策略被覆盖时发射
    └── EXECUTION_ERROR        → 执行过程中捕获的异常
```

---

## 8. 文件组织方案

### 8.1 目录结构

```
packages/resilience/
├── package.json
├── tsconfig.json                  # 引用 tsconfig.src.json + tsconfig.test.json
├── tsconfig.src.json              # 编译配置 (extends ../../tsconfig.base.json)
├── tsconfig.test.json             # 测试配置
├── vitest.config.ts               # Vitest 配置
│
├── src/
│   ├── index.ts                   # 桶导出 (barrel)
│   │
│   ├── interfaces/                # 接口层
│   │   ├── retry-policy.ts        # IRetryPolicy + RetryOptions
│   │   ├── circuit-breaker.ts     # ICircuitBreaker + CircuitBreakerOptions + CircuitState
│   │   ├── timeout-policy.ts      # ITimeoutPolicy + TimeoutOptions + TimeoutResult
│   │   ├── registry.ts            # IResilienceRegistry + ResilienceEvent
│   │   └── context.ts             # ResilienceContext + ResilienceContextManager
│   │
│   ├── implementations/           # 实现层
│   │   ├── retry/
│   │   │   ├── exponential-backoff.ts  # ExponentialBackoffRetry
│   │   │   ├── linear-backoff.ts       # LinearBackoffRetry
│   │   │   ├── jitter-backoff.ts       # JitterBackoffRetry
│   │   │   └── no-retry.ts             # NoRetry
│   │   ├── circuit-breaker/
│   │   │   ├── sliding-window.ts       # SlidingWindowBreaker
│   │   │   ├── consecutive-failure.ts  # ConsecutiveFailureBreaker
│   │   │   └── no-breaker.ts           # NoBreaker
│   │   └── timeout/
│   │       ├── fixed-timeout.ts        # FixedTimeoutPolicy
│   │       ├── adaptive-timeout.ts     # AdaptiveTimeoutPolicy
│   │       └── no-timeout.ts           # NoTimeout
│   │
│   ├── registry/                  # 编排层
│   │   ├── resilience-registry.ts # ResilienceRegistry (implements IResilienceRegistry)
│   │   ├── factory.ts             # createResilience 便捷工厂
│   │   └── errors.ts              # CircuitBreakerOpenError + TimeoutError
│   │
│   └── __tests__/                 # 测试目录
│       ├── retry/
│       │   ├── exponential-backoff.test.ts
│       │   ├── linear-backoff.test.ts
│       │   └── jitter-backoff.test.ts
│       ├── circuit-breaker/
│       │   ├── sliding-window.test.ts
│       │   └── consecutive-failure.test.ts
│       ├── timeout/
│       │   ├── fixed-timeout.test.ts
│       │   └── adaptive-timeout.test.ts
│       ├── registry/
│       │   └── resilience-registry.test.ts
│       ├── integration.test.ts        # 组合执行集成测试
│       └── compat.test.ts             # 兼容性测试 (Node 16/18/20)
│
└── docs/                          # 文档
    ├── API_REFERENCE.md
    └── MIGRATION_GUIDE.md         # 从现有分散韧性代码迁移的指南
```

### 8.2 桶导出 (src/index.ts)

```typescript
// ============================================================
// @cortex/resilience —— 韧性策略统一抽象层
// ============================================================

// ── 接口层 ──
export type { IRetryPolicy } from "./interfaces/retry-policy.js";
export type { RetryOptions } from "./interfaces/retry-policy.js";

export type { ICircuitBreaker } from "./interfaces/circuit-breaker.js";
export type { CircuitBreakerOptions, CircuitState } from "./interfaces/circuit-breaker.js";

export type { ITimeoutPolicy } from "./interfaces/timeout-policy.js";
export type { TimeoutOptions, TimeoutResult } from "./interfaces/timeout-policy.js";

export type { IResilienceRegistry, ResilienceEvent } from "./interfaces/registry.js";
export type { ResilienceContext } from "./interfaces/context.js";

// ── 实现层：重试 ──
export { ExponentialBackoffRetry } from "./implementations/retry/exponential-backoff.js";
export { LinearBackoffRetry } from "./implementations/retry/linear-backoff.js";
export { JitterBackoffRetry } from "./implementations/retry/jitter-backoff.js";
export { NoRetry } from "./implementations/retry/no-retry.js";

// ── 实现层：断路器 ──
export { SlidingWindowBreaker } from "./implementations/circuit-breaker/sliding-window.js";
export { ConsecutiveFailureBreaker } from "./implementations/circuit-breaker/consecutive-failure.js";
export { NoBreaker } from "./implementations/circuit-breaker/no-breaker.js";

// ── 实现层：超时 ──
export { FixedTimeoutPolicy } from "./implementations/timeout/fixed-timeout.js";
export { AdaptiveTimeoutPolicy } from "./implementations/timeout/adaptive-timeout.js";
export { NoTimeout } from "./implementations/timeout/no-timeout.js";

// ── 编排层 ──
export { ResilienceRegistry } from "./registry/resilience-registry.js";
export { createResilience } from "./registry/factory.js";

// ── 错误类型 ──
export { CircuitBreakerOpenError } from "./registry/errors.js";
export { TimeoutError } from "./registry/errors.js";

// ── 上下文 ──
export { ResilienceContextManager } from "./interfaces/context.js";
```

### 8.3 包依赖

```
@cortex/resilience
  ├── devDependencies
  │   ├── typescript           — 编译
  │   ├── vitest               — 测试
  │   ├── eslint               — 代码检查
  │   └── @types/node          — Node.js 类型
  │
  └── 运行时零依赖 (纯 TypeScript 类型系统)
```

**设计决策**: `@cortex/resilience` **无运行时依赖**。所有代码使用标准 Web API（`AbortSignal` / `AbortController`）和 Node.js 内置模块。这使得 resilience 可被任意项目（包括浏览器端工具）引入而不会产生运行时包袱。

---

## 9. 与现有韧性代码的迁移路径

### 9.1 迁移总策略

```
Phase 1: 创建包骨架（本设计完成即 Phase 1 产出）
  └── 实现全部接口和内置实现
  └── 通过单元测试

Phase 2: 逐步替换分散实现
  └── 每个替换步骤遵循「保留旧实现 → 新增 @cortex/resilience 依赖 → 切换 → 删除旧代码」
  └── 按风险从低到高：search-backend → mcp-client → llm-adapter → plugin-runner → ...

Phase 3: 为 chatStream 添加重试保护
  └── 利用 ExponentialBackoffRetry 填补已知缺口
  └── 流式重试需要考虑部分已接收内容的处理语义
```

### 9.2 具体迁移步骤

#### Step 1: search-backend (线性退避 → LinearBackoffRetry)

```typescript
// 当前 (packages/platform/src/search-backend.ts)
private async _delay(attempt: number): Promise<void> {
  await new Promise(r => setTimeout(r, 1000 * attempt));
}

// 迁移后
import { LinearBackoffRetry } from "@cortex/resilience";
const retry = new LinearBackoffRetry({ maxAttempts: 2, baseDelayMs: 1000 });
// 在需要重试处:
const delay = retry.nextDelay(attempt);
await new Promise(r => setTimeout(r, delay));
```

#### Step 2: llm-adapter._fetchWithRetry (指数退避 → ExponentialBackoffRetry)

```typescript
// 当前 (packages/llm/src/llm-adapter.ts)
private async _fetchWithRetry(url: string, options: RequestInit, attempt = 1): Promise<Response> {
  const delay = Math.max(RETRY_BASE_MS * Math.pow(2, attempt - 1), serverDelay);
  // ...
}

// 迁移后
import { ExponentialBackoffRetry, FixedTimeoutPolicy } from "@cortex/resilience";
const retry = new ExponentialBackoffRetry({
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableErrors: [RateLimitError],
});
```

#### Step 3: 断路器从测试用例 → 生产代码

```typescript
// 当前: 仅有测试用例测试 CircuitBreaker 行为
// 迁移后: 在关键路径注册断路器

registry.register('llm-api', {
  circuitBreaker: new SlidingWindowBreaker('llm-api', {
    threshold: 0.5,
    windowMs: 60000,
    halfOpenAfterMs: 30000,
  }),
  // ...
});

// 在 llm-adapter 中使用 registry.execute
const result = await registry.execute('llm-api', () => this._doFetch(url, options));
```

#### Step 4: 统一超时

```typescript
// 当前: 各处独立超时
// 迁移后: 使用 FixedTimeoutPolicy / AdaptiveTimeoutPolicy

const timeout = new FixedTimeoutPolicy({ durationMs: 15000 });
const result = await timeout.execute(fn);
```

### 9.3 弃用旧接口计划

| 旧代码位置 | 替换方式 | 计划版本 |
|-----------|---------|---------|
| `llm-adapter._fetchWithRetry` | `ExponentialBackoffRetry` + `SlidingWindowBreaker` | v0.2.0 |
| `search-backend._delay` | `LinearBackoffRetry` | v0.2.0 |
| `mcp-client` 超时 | `FixedTimeoutPolicy` | v0.2.0 |
| `plugin-runner._withTimeout` | `FixedTimeoutPolicy` | v0.3.0 |
| `lifecycle-manager` 超时 | `FixedTimeoutPolicy` | v0.3.0 |
| `confirm-gate` 超时 | `FixedTimeoutPolicy` | v0.3.0 |
| `chatStream` 重试缺口 | `ExponentialBackoffRetry` + 流式语义处理 | v0.3.0 |

---

## 10. 扩展指南

### 10.1 自定义 RetryPolicy

```typescript
/**
 * 实现自定义重试策略只需实现 IRetryPolicy 接口。
 *
 * 示例：基于 HTTP 状态码的重试策略
 */
class HttpStatusRetry implements IRetryPolicy {
  readonly name = 'http-status-retry';
  readonly maxAttempts = 5;
  private readonly retryableStatuses: Set<number>;

  constructor(retryableStatuses: number[]) {
    this.retryableStatuses = new Set(retryableStatuses);
  }

  nextDelay(attempt: number, error?: unknown): number {
    // 带抖动的退避
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
registry.register('custom-api', {
  retry: new HttpStatusRetry([429, 502, 503, 504]),
});
```

### 10.2 自定义 CircuitBreaker

```typescript
/**
 * 实现自定义断路器只需实现 ICircuitBreaker 接口。
 *
 * 示例：基于错误类型的断路器（某些错误类型不计入熔断计数）
 */
class ErrorClassBreaker implements ICircuitBreaker {
  // 实现略，与 SlidingWindowBreaker 类似但 recordFailure 可过滤特定错误
}

// 使用
registry.register('database', {
  circuitBreaker: new ErrorClassBreaker('database', {
    threshold: 5,
    windowMs: 60000,
    halfOpenAfterMs: 30000,
    ignoredErrors: [ReadOnlyError],  // 只读错误不触发熔断
  }),
});
```

### 10.3 自定义 TimeoutPolicy

```typescript
/**
 * 实现自定义超时策略只需实现 ITimeoutPolicy 接口。
 *
 * 示例：基于业务优先级的超时策略
 */
class PriorityAwareTimeout implements ITimeoutPolicy {
  readonly name = 'priority-timeout';
  readonly timeoutMs: number;
  private readonly priorityTimeouts: Map<string, number>;

  constructor(defaultTimeout: number, priorityTimeouts: Record<string, number>) {
    this.timeoutMs = defaultTimeout;
    this.priorityTimeouts = new Map(Object.entries(priorityTimeouts));
  }

  async execute<T>(fn: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<TimeoutResult<T>> {
    const ctx = ResilienceContextManager.current();
    const priority = ctx?.metadata.get('priority') as string ?? 'normal';
    const timeout = this.priorityTimeouts.get(priority) ?? this.timeoutMs;
    // ... 使用 timeout 值执行
  }
}
```

### 10.4 虚拟时间测试支持

```typescript
/**
 * 测试用虚拟时间提供者。
 * 替换全局时间依赖，使测试不需要真实等待。
 */
export interface TimeProvider {
  now(): number;
  setTimeout(handler: () => void, ms: number): void;
}

/**
 * 测试用虚拟时间。
 */
export class VirtualTimeProvider implements TimeProvider {
  private currentTime = 0;
  private readonly timers: Array<{ fireAt: number; handler: () => void }> = [];

  now(): number { return this.currentTime; }

  setTimeout(handler: () => void, ms: number): void {
    this.timers.push({ fireAt: this.currentTime + ms, handler });
    this.timers.sort((a, b) => a.fireAt - b.fireAt);
  }

  /** 快进时间 */
  tick(ms: number): void {
    this.currentTime += ms;
    while (this.timers.length > 0 && this.timers[0].fireAt <= this.currentTime) {
      const timer = this.timers.shift()!;
      timer.handler();
    }
  }
}
```

---

## 11. 附录：关键设计决策日志

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 策略组合顺序 | timeout→breaker→retry / breaker→timeout→retry / 其他 | timeout→breaker→retry | 超时在最外层切断总时长，断路器在中间防止重试冲击下游，重试在最内层快速失败 |
| Registry 是否全局单例 | 静态单例 / 实例化 | 实例化（`ResilienceRegistry.create()`） | 支持多实例场景（测试隔离、多租户），用户可自行管理生命周期 |
| 空策略（NoRetry/NoBreaker/NoTimeout） | 使用 null/undefined / 使用策略对象 | 使用策略对象（Null Object 模式） | 避免调用方判空，统一策略接口调用方式 |
| 自适应超时算法 | EMA / 百分位数 / 固定窗口 | EMA（指数移动平均） | 计算轻量，对延迟变化敏感，适合 LLM API 场景 |
| 断路器滑动窗口实现 | 内存数组 / 环形缓冲区 / 数据库 | 内存数组 + 惰性淘汰 | 轻量低延迟，滑动窗口大小有限（默认 60s），内存数组足够 |
| 是否支持浏览器环境 | 仅 Node.js / 跨平台 | 跨平台（使用标准 Web API） | `AbortSignal` / `AbortController` 已标准化，浏览器和 Node.js 均支持 |
| 重试是否包含首次调用 | `maxAttempts` 包含首次 / 不包含 | 包含首次（`maxAttempts=3` 表示首次+2次重试） | 与现有 `_fetchWithRetry` 语义一致，减少迁移困惑 |
| 异常类型过滤方式 | 类引用数组 / 字符串名称 / 谓词函数 | 类引用数组 + 谓词函数 | 类型安全且灵活 |
| 时间虚拟化 | 全局替换 Date.now / 依赖注入 | 依赖注入（`TimeProvider`） | 测试可控，不影响生产代码路径 |
| 是否依赖 @cortex/config | 依赖 / 不依赖 | 不依赖 | 保持零运行时依赖，配置由调用方传入 |
| 错误类型导出 | 从 errors.ts 导出 / 内联在接口文件 | 从 `registry/errors.ts` 统一导出 | 减少循环依赖，集中管理错误类型 |

---

## 附录 A: 与现有模式的关系矩阵

```
韧性模式           @cortex/resilience 角色      现有代码                                 迁移策略
────────────────  ────────────────────────  ───────────────────────  ──────────────────────────
重试 (Retry)      IRetryPolicy + 3 种实现    llm-adapter, search-backend  逐步替换为策略实例
断路器 (CB)       ICircuitBreaker + 2 种实现 仅测试用例 (R5)               迁移测试为生产实现
超时 (Timeout)    ITimeoutPolicy + 2 种实现   11 处分散实现                  逐步替换为策略实例
限流 (RateLimit)  ❌ 不覆盖                   RateLimiter + ManifoldGate    保持现状
降级 (Degradation) ❌ 不覆盖                  SafeErrorReporter             保持现状
错误隔离          ❌ 不覆盖                   PluginRunner, PipelineObserver 保持现状
优雅关闭          ❌ 不覆盖                   ShutdownWarden                保持现状
健康检查          ❌ 不覆盖                   缺口 (telemetry 计划)          不涉及
重规划 (Replan)   ❌ 不覆盖                   ReplanManager                 保持现状
回退 (Fallback)   ❌ 不覆盖                   业务层实现                    保持现状
```

## 附录 B: 与 @cortex/scheduler 的关系

`@cortex/resilience` 和 `@cortex/scheduler` 是正交的独立包：

```
@cortex/resilience: 通用韧性策略抽象（重试/熔断/超时）
@cortex/scheduler:  任务调度执行引擎（DAG → 分发 → 执行）

交叉点:
  - scheduler 可使用 resilience 的 RetryPolicy 保护调度步骤执行
  - scheduler 的 ReplanManager 类断路器行为可替换为真实的 CircuitBreaker
  - scheduler 的各处超时可替换为 ITimeoutPolicy

当前关系: 各自独立，@cortex/scheduler 可可选依赖 @cortex/resilience
未来可能: scheduler 引入 @cortex/resilience 统一调度步骤的韧性保护
```

---

> **文档约定**:
> - 所有接口以 `I` 开头（TypeScript 命名惯例）
> - 实现类使用具体名称（`ExponentialBackoffRetry` 而非 `RetryImpl`）
> - Null Object 模式用于空策略（`NoRetry` / `NoBreaker` / `NoTimeout`）
> - 错误类型以 `Error` 结尾，放在 `registry/errors.ts` 统一导出
> - 配置接口使用 `XxxOptions` 命名
> - 上下文类型使用 `XxxContext` 后缀
