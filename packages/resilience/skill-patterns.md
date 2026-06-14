# 🧩 Resilience 包建造模式 / 技能提炼

> **目标**: 从 `@cortex/resilience` 包的完整建造过程（设计→实现→测试→文档）中，提炼可跨包复用的设计模式、编码技能和工程规范。
>
> **适用范围**: 全仓任意新包 / 重构 / 模式提取
>
> **提炼依据**: DESIGN.md（设计文档）+ Registry.ts（编排核心）+ 6 个策略实现 + 包配置

---

## 目录

1. [三层抽象设计模式](#1-三层抽象设计模式)
2. [Registry 模式（注册中心 + 组合执行）](#2-registry-模式注册中心--组合执行)
3. [Null Object 模式（空策略）](#3-null-object-模式空策略)
4. [Strategy 模式（策略接口 + 多实现）](#4-strategy-模式策略接口--多实现)
5. [有限状态机模式（CircuitBreaker 三态）](#5-有限状态机模式circuitbreaker-三态)
6. [工厂方法模式](#6-工厂方法模式)
7. [观察者模式（事件驱动）](#7-观察者模式事件驱动)
8. [上下文传递模式（AsyncLocalStorage）](#8-上下文传递模式asynclocalstorage)
9. [兼容性降级模式](#9-兼容性降级模式)
10. [错误分类与包装模式](#10-错误分类与包装模式)
11. [参数校验模式](#11-参数校验模式)
12. [可测试性设计模式](#12-可测试性设计模式)
13. [测试规范提炼](#13-测试规范提炼)
14. [文档规范](#14-文档规范)
15. [包结构规范](#15-包结构规范)
16. [跨包协作契约](#16-跨包协作契约)

---

## 1. 三层抽象设计模式

### 1.1 模式定义

将系统按**接口契约 → 具体实现 → 编排组合**三个层次分离，层间通过接口依赖，实现层可替换、编排层可组合。

### 1.2 本包应用

```
┌─────────────────────────────────────────────┐
│  接口层 (Interfaces)                          │
│  IRetryPolicy / ICircuitBreaker /            │
│  ITimeoutPolicy / IResilienceRegistry        │
│  ResilienceContext                           │
├─────────────────────────────────────────────┤
│  实现层 (Implementations)                     │
│  ExponentialBackoff / FixedRetry             │
│  SimpleCircuitBreaker / StateMachineCB       │
│  FixedTimeout / AdaptiveTimeout              │
│  NoRetry / NoBreaker / NoTimeout             │
├─────────────────────────────────────────────┤
│  编排层 (Registry)                            │
│  Registry.register / execute / snapshot      │
│  ResilienceContextManager                    │
└─────────────────────────────────────────────┘
```

### 1.3 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 接口放在哪 | 独立的 `registry/Registry.ts` 中集中定义 | 减少文件碎片，接口与核心编排同目录便于认知 |
| 实现是否与接口同文件 | 分离到 `src/retry/`, `src/circuit-breaker/`, `src/timeout/` | 每个实现独立文件，便于测试和树摇 |
| 编排层依赖方向 | 编排层依赖接口层，实现层依赖接口层 | 依赖反转，实现可插拔 |

### 1.4 可复用模板

```typescript
// === 接口层 ===
export interface IFooPolicy {
  readonly name: string;
  doSomething(): Promise<FooResult>;
  reset(): void;
}

// === 实现层 ===
export class ConcreteFoo implements IFooPolicy {
  readonly name = 'concrete-foo';
  async doSomething(): Promise<FooResult> { /* ... */ }
  reset(): void { /* ... */ }
}

// === 编排层 ===
export class FooRegistry {
  private readonly _store = new Map<string, IFooPolicy>();

  register(name: string, policy: IFooPolicy): void {
    this._store.set(name, policy);
  }

  execute(name: string): Promise<FooResult> {
    const policy = this._store.get(name);
    if (!policy) throw new Error(`No policy for "${name}"`);
    return policy.doSomething();
  }
}
```

### 1.5 适用场景

- 同一行为有多种算法/策略（重试算法、熔断策略、超时策略）
- 需要运行时切换实现（动态注册）
- 实现需要独立测试和替换
- 编排逻辑与业务逻辑分离

---

## 2. Registry 模式（注册中心 + 组合执行）

### 2.1 模式定义

一个中心化的注册表，管理多类策略的注册、查询、组合执行，对外提供统一的 `execute()` 入口。

### 2.2 本包应用

```typescript
// 注册
registry.register('llm-api', {
  retry: new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000 }),
  circuitBreaker: new SimpleCircuitBreaker({ name: 'llm-api', threshold: 5 }),
  timeout: new FixedTimeout({ durationMs: 30000 }),
});

// 组合执行（自动嵌套：timeout → circuitBreaker → retry → fn）
const result = await registry.execute('llm-api', () => llm.chat(prompt));

// 临时覆盖
const quick = await registry.execute('llm-api', () => llm.chat(prompt), {
  timeout: new FixedTimeout({ durationMs: 5000 }),
});
```

### 2.3 关键模式特征

| 特征 | 本包实现 | 说明 |
|------|---------|------|
| 命名注册 | `register(name, policies)` | 按名称索引，运行时查找 |
| 组合执行 | `execute(name, fn, overrides?)` | 自动嵌套多层策略 |
| 覆盖机制 | `overrides` 参数 | 临时替换不影响注册表 |
| 快照 | `snapshot()` | 返回所有策略的状态快照 |
| 事件 | `onEvent(handler)` | 全局事件监听 |
| 重置 | `reset()` | 批量重置所有策略 |
| 默认策略 | `Registry.create(defaults)` | 创建时设置默认值 |

### 2.4 组合嵌套顺序（关键设计）

```
ResilienceRegistry.execute(fn)
  └── ResilienceContextManager.run()    ← 上下文注入
      └── retry.execute()               ← 最内层：重试保护
          └── cb.call()                 ← 中间层：熔断保护
              └── timeout.execute()     ← 最外层：超时保护
                  └── fn()              ← 实际业务调用
```

**设计理由**:
- **超时在最外层**：墙钟时间一刀切，防止断路器半开期无限等待
- **断路器在中间层**：阻止重试耗尽后继续发送请求到已熔断下游
- **重试在最内层**：断路器闭合时正常重试，断路器断开时快速失败

### 2.5 可复用模板

```typescript
export class Registry<TKey, TPolicy> {
  private readonly _store = new Map<TKey, TPolicy>();

  register(key: TKey, policy: TPolicy): void {
    this._store.set(key, policy);
  }

  get(key: TKey): TPolicy | undefined {
    return this._store.get(key);
  }

  execute<R>(key: TKey, fn: () => Promise<R>): Promise<R> {
    const policy = this._store.get(key);
    if (!policy) throw new Error(`No policy for "${key}"`);
    // 执行逻辑
  }

  snapshot(): Array<{ key: TKey; policy: string }> {
    return Array.from(this._store.entries()).map(([key, policy]) => ({
      key,
      policy: (policy as any).name ?? 'unknown',
    }));
  }

  reset(): void {
    for (const policy of this._store.values()) {
      (policy as any).reset?.();
    }
  }
}
```

---

## 3. Null Object 模式（空策略）

### 3.1 模式定义

为每个策略接口提供一个"什么都不做"的实现，消除调用方的判空逻辑。

### 3.2 本包应用

| 接口 | Null Object | 行为 |
|------|-----------|------|
| `IRetryPolicy` | `NoRetry` | `maxAttempts=1`, `shouldRetry=false` |
| `ICircuitBreaker` | `NoBreaker` | `call()` 直接执行 fn，不熔断 |
| `ITimeoutPolicy` | `NoTimeout` | `timeoutMs=Infinity`, 永不过期 |

### 3.3 收益

```typescript
// ❌ 判空模式
const retry = registry.getRetry('my-service');
if (retry) {
  // 使用 retry
}

// ✅ Null Object 模式 —— 无需判空
const retry = registry.getRetry('my-service') ?? new NoRetry();
retry.shouldRetry(attempt, error); // 安全调用
```

### 3.4 实现规范

```typescript
/** 不重试策略 —— 始终返回"不重试" */
class NoRetry implements IRetryPolicy {
  readonly name = 'no-retry';
  readonly maxAttempts = 1;
  nextDelay(): number { return 0; }
  shouldRetry(): boolean { return false; }
  reset(): void { /* 无操作 */ }
}
```

### 3.5 适用场景

- 策略模式中需要默认/占位实现
- 避免 `null` / `undefined` 检查散布在业务代码中
- 配置项可选时的安全降级

---

## 4. Strategy 模式（策略接口 + 多实现）

### 4.1 模式定义

定义一族算法（策略），使它们可以互相替换，让算法的变化独立于使用算法的客户。

### 4.2 本包应用

| 接口 | 实现 A | 实现 B | 实现 C |
|------|--------|--------|--------|
| `IRetryPolicy` | `ExponentialBackoff` | `FixedRetry` | `NoRetry` |
| `ICircuitBreaker` | `SimpleCircuitBreaker` | `StateMachineCircuitBreaker` | `NoBreaker` |
| `ITimeoutPolicy` | `FixedTimeout` | `AdaptiveTimeout` | `NoTimeout` |

### 4.3 实现要点（从本包提炼）

```typescript
// ① 接口定义要精简，只包含调用方关心的操作
export interface IRetryPolicy {
  readonly name: string;
  readonly maxAttempts: number;
  nextDelay(attempt: number, error?: unknown): number;
  shouldRetry(attempt: number, error?: unknown): boolean;
  reset(): void;
}

// ② 每个实现独立文件，文件顶部用 JSDoc 标明适用场景
// ③ 构造参数使用 options 对象（具名参数），便于扩展
export class ExponentialBackoff implements IRetryPolicy {
  constructor(options: RetryOptions & { jitterFactor?: number }) { /* ... */ }
}

// ④ 参数校验在构造时完成，失败抛 RangeError
// ⑤ 无状态策略的 reset() 为空操作，但保留以实现接口契约
```

### 4.4 策略的"无状态"约定

- **纯计算策略**（如 `ExponentialBackoff`、`FixedRetry`、`FixedTimeout`）：不维护调用历史，`reset()` 为空操作，可安全复用
- **有状态策略**（如 `SimpleCircuitBreaker`、`AdaptiveTimeout`）：维护内部状态，`reset()` 必须恢复到构造后的初始状态

### 4.5 适用场景

- 同一行为有多种变体（不同退避算法、不同熔断策略）
- 需要运行时选择算法
- 算法需要独立测试

---

## 5. 有限状态机模式（CircuitBreaker 三态）

### 5.1 模式定义

将对象的行为建模为有限个状态及状态间的转换规则，每个状态封装其下的行为逻辑。

### 5.2 本包应用

**断路器三态**: `CLOSED`（正常）→ `OPEN`（熔断）→ `HALF_OPEN`（试探）

### 5.3 两种实现对比

| 实现 | 方式 | 复杂度 | 适用场景 |
|------|------|--------|---------|
| `SimpleCircuitBreaker` | if-else 状态分支 | ⭐⭐ | 简单熔断，连续失败计数 |
| `StateMachineCircuitBreaker` | 独立 FsmState 对象 | ⭐⭐⭐ | 复杂熔断，多种判定策略 |

### 5.4 StateMachineCircuitBreaker 的核心模式

```typescript
// ① 状态接口 —— 每个状态封装自己的转换规则
interface FsmState {
  readonly state: CircuitState;
  onRecordSuccess(breaker: StateMachineCircuitBreaker): CircuitState;
  onRecordFailure(breaker: StateMachineCircuitBreaker): CircuitState;
  onEnter(breaker: StateMachineCircuitBreaker): void;
}

// ② 三个具体状态对象（单例）
const CLOSED_STATE: FsmState = { /* ... */ };
const OPEN_STATE: FsmState = { /* ... */ };
const HALF_OPEN_STATE: FsmState = { /* ... */ };

// ③ 状态转换通过切换 handler 对象实现
private _transitionTo(newState: CircuitState): void {
  const previous = this._handler.state;
  // 查找新状态对应的 handler
  let newHandler: FsmState;
  switch (newState) {
    case 'CLOSED': newHandler = CLOSED_STATE; break;
    case 'OPEN': newHandler = OPEN_STATE; break;
    case 'HALF_OPEN': newHandler = HALF_OPEN_STATE; break;
  }
  this._handler = newHandler;
  newHandler.onEnter(this);
  // 通知监听器
}
```

### 5.5 状态机 vs if-else 选择标准

| 场景 | 推荐方式 |
|------|---------|
| 状态少（2-3 个），转换规则简单 | if-else（如 `SimpleCircuitBreaker`） |
| 状态多，转换规则复杂，未来可能新增状态 | 独立状态对象（如 `StateMachineCircuitBreaker`） |
| 每个状态的行为差异大 | 独立状态对象 |
| 性能敏感（每次调用都做虚函数派发） | if-else |

### 5.6 适用场景

- 断路器 / 熔断器
- 工作流引擎
- Agent 状态管理（如 Awake / Active / Sleeping / Destroyed）
- 连接池状态管理

---

## 6. 工厂方法模式

### 6.1 模式定义

提供创建对象的接口，让子类或静态方法决定实例化哪个类。

### 6.2 本包应用

```typescript
// ① 静态工厂方法
const registry = Registry.create({
  timeout: new FixedTimeout({ durationMs: 15000 }),
});

// ② 便捷工厂函数（设计文档中规划）
const registry = createResilience({
  defaults: { timeout: { durationMs: 15000 } },
  policies: {
    'llm-api': {
      retry: { maxAttempts: 3, baseDelayMs: 1000 },
      circuitBreaker: { name: 'llm-api', threshold: 5, type: 'consecutive' },
      timeout: { durationMs: 30000, adaptive: true },
    },
  },
});
```

### 6.3 工厂方法命名规范

| 模式 | 命名 | 示例 |
|------|------|------|
| 静态工厂 | `Class.create(...)` | `Registry.create(defaults)` |
| 工厂函数 | `createXxx(...)` | `createResilience(options)` |
| 构建器 | `Class.builder()` | （未来可扩展） |

### 6.4 适用场景

- 创建过程复杂（如带默认值、参数合并）
- 需要返回不同子类实例
- 构造后需要执行额外初始化

---

## 7. 观察者模式（事件驱动）

### 7.1 模式定义

定义一对多依赖关系，当主题对象状态变化时，所有依赖者自动收到通知。

### 7.2 本包应用

```typescript
// ① 事件类型定义（联合类型，精确描述每个事件）
export type ResilienceEvent =
  | { type: 'RETRY_ATTEMPT'; name: string; attempt: number; delayMs: number }
  | { type: 'CIRCUIT_STATE_CHANGE'; name: string; from: CircuitState; to: CircuitState }
  | { type: 'TIMEOUT_OCCURRED'; name: string; timeoutMs: number; elapsedMs: number }
  | { type: 'EXECUTION_ERROR'; name: string; error: Error }
  // ...

// ② 注册 / 发射机制
class Registry implements IResilienceRegistry {
  private readonly _eventHandlers: Array<(event: ResilienceEvent) => void> = [];

  onEvent(handler: (event: ResilienceEvent) => void): void {
    this._eventHandlers.push(handler);
  }

  private _emit(event: ResilienceEvent): void {
    for (const handler of this._eventHandlers) {
      try {
        handler(event);
      } catch {
        /* 异常隔离 —— 单个处理器异常不影响其他处理器 */
      }
    }
  }
}

// ③ 使用示例
registry.onEvent(event => {
  if (event.type === 'CIRCUIT_OPEN') {
    console.warn(`⚠️ 断路器 ${event.name} 已熔断`);
  }
});
```

### 7.3 事件设计规范

| 规范 | 说明 |
|------|------|
| 联合类型 | 每个事件类型是联合的一个成员，type 字段区分 |
| 精确字段 | 每个事件携带该场景需要的全部上下文 |
| 异常隔离 | 单个处理器异常不影响其他处理器 |
| 同步发射 | 事件在当前同步上下文中发射，不异步调度 |

### 7.4 适用场景

- 状态变更通知
- 监控 / 日志 / 遥测
- 插件系统事件钩子

---

## 8. 上下文传递模式（AsyncLocalStorage）

### 8.1 模式定义

利用 Node.js `AsyncLocalStorage` 在异步链路中隐式传递上下文，避免显式传参。

### 8.2 本包应用

```typescript
export class ResilienceContextManager {
  private static readonly _storage =
    typeof (globalThis as any).AsyncLocalStorage !== 'undefined'
      ? new (globalThis as any).AsyncLocalStorage()
      : null;

  static async run<T>(
    policyName: string,
    fn: (ctx: ResilienceContext) => Promise<T>,
  ): Promise<T> {
    const context: ResilienceContext = {
      executionId: this._generateId(),
      policyName,
      policyChain: [policyName],
      startedAt: Date.now(),
      attempt: 0,
      metadata: new Map(),
    };

    if (this._storage) {
      return this._storage.run(context, () => fn(context));
    }
    // 降级：无 AsyncLocalStorage 时直接执行
    return fn(context);
  }

  static current(): ResilienceContext | undefined {
    return this._storage?.getStore();
  }
}
```

### 8.3 使用场景

```typescript
// 在任意深度获取当前上下文，无需逐层传递
function logResilienceEvent(event: string): void {
  const ctx = ResilienceContextManager.current();
  if (ctx) {
    logger.info(`[${ctx.executionId}] ${event}`);
  }
}
```

### 8.4 兼容性降级

| 环境 | 支持 | 行为 |
|------|------|------|
| Node.js 16+ | ✅ | 使用 AsyncLocalStorage |
| 浏览器 | ❌ | 降级为直接调用，不丢失功能 |
| 测试环境 | ✅ | 可 mock 替换 |

### 8.5 适用场景

- 请求链路追踪（trace ID）
- 日志上下文注入
- 事务管理
- 跨异步边界的上下文传递

---

## 9. 兼容性降级模式

### 9.1 模式定义

针对不同运行环境（Node.js 版本、浏览器 API 支持）提供渐进降级方案，核心功能在所有环境下可用，高级特性在支持环境下使用。

### 9.2 本包应用

```typescript
// ① AbortSignal.timeout() 降级
let timeoutSignal: AbortSignal;
if (typeof AbortSignal.timeout === 'function') {
  timeoutSignal = AbortSignal.timeout(this.timeoutMs);
} else {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), this.timeoutMs);
  timeoutSignal = controller.signal;
}

// ② AbortSignal.any() 降级
if (typeof AbortSignal.any === 'function') {
  return AbortSignal.any([external, timeout]);
}
// 降级：手动合并
const controller = new AbortController();
external.addEventListener('abort', () => controller.abort());
timeout.addEventListener('abort', () => controller.abort());
return controller.signal;

// ③ AsyncLocalStorage 降级（见上下文传递模式）
```

### 9.3 降级策略矩阵

| API | 首选 | 降级 | 兜底 |
|-----|------|------|------|
| `AbortSignal.timeout()` | Node.js 18+ | `AbortController` + `setTimeout` | `Promise.race` |
| `AbortSignal.any()` | Node.js 20+ | 手动监听两个信号 | - |
| `AsyncLocalStorage` | Node.js 16+ | 直接执行 | - |

### 9.4 设计原则

- **功能无损**：降级后功能不变，只是可能使用不同的底层机制
- **本地优先**：先检查 API 是否可用，再决定使用哪种方案
- **透明**：调用方无需感知降级逻辑

---

## 10. 错误分类与包装模式

### 10.1 模式定义

将原始异常分类、转换为语义明确的领域错误类型，使调用方能以类型安全的方式处理不同错误。

### 10.2 本包应用

```typescript
// ① 领域错误类型（继承 Error）
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

// ② 错误分类逻辑（在 execute 中）
private _classifyError<T>(err: unknown, elapsedMs: number): TimeoutResult<T> {
  const errAny = err as { name?: string };

  if (errAny?.name === 'TimeoutError') {
    return { success: false, error: new TimeoutError(this.timeoutMs, elapsedMs), elapsedMs };
  }
  if (errAny?.name === 'AbortError' && elapsedMs >= this.timeoutMs - 5) {
    return { success: false, error: new TimeoutError(this.timeoutMs, elapsedMs), elapsedMs };
  }
  if (errAny?.name === 'AbortError') {
    return { success: false, error: err as Error, elapsedMs };
  }
  // 业务异常
  return { success: false, error: err as Error, elapsedMs };
}

// ③ 结构化返回（TimeoutResult）vs 异常抛出
// - 超时策略：返回 TimeoutResult（success: boolean），不抛异常
// - 断路器：call() 抛 CircuitBreakerOpenError（熔断是异常情况）
// - 重试策略：重试耗尽后抛出最后一个错误
```

### 10.3 错误设计规范

| 规范 | 说明 |
|------|------|
| 继承 `Error` | 所有领域错误继承自 `Error` |
| 设置 `name` | 构造函数中显式设置 `this.name` |
| 携带上下文 | 错误类携带相关字段（如 `timeoutMs`, `circuitName`） |
| 统一导出 | 从 `registry/errors.ts` 或接口文件统一导出 |
| 结构化 vs 异常 | 高频期望的失败用结构化返回，低频异常情况用异常抛出 |

### 10.4 适用场景

- 超时错误
- 熔断错误
- 重试耗尽错误
- 任何需要调用方区分处理的失败场景

---

## 11. 参数校验模式

### 11.1 模式定义

在构造函数或方法入口处校验参数合法性，失败时抛出带有清晰错误信息的 `RangeError` / `TypeError`。

### 11.2 本包应用

```typescript
export class ExponentialBackoff implements IRetryPolicy {
  constructor(options: RetryOptions & { jitterFactor?: number }) {
    if (options.maxAttempts < 1) {
      throw new RangeError(
        `ExponentialBackoff: maxAttempts must be >= 1, got ${options.maxAttempts}`,
      );
    }
    if (options.baseDelayMs < 0) {
      throw new RangeError(
        `ExponentialBackoff: baseDelayMs must be >= 0, got ${options.baseDelayMs}`,
      );
    }
    const jitter = options.jitterFactor ?? 0.1;
    if (jitter < 0 || jitter > 0.5) {
      throw new RangeError(
        `ExponentialBackoff: jitterFactor must be in [0, 0.5], got ${jitter}`,
      );
    }
    // ...
  }
}
```

### 11.3 校验规范

| 规范 | 说明 |
|------|------|
| 构造函数校验 | 所有构造参数在构造函数中校验，尽早失败 |
| 错误类型 | 范围错误用 `RangeError`，类型错误用 `TypeError` |
| 错误信息 | 包含：类名 + 参数名 + 期望值 + 实际值 |
| 边界值 | 明确校验边界值（如 `>= 0` 而非 `> 0`） |
| 默认值 | 使用 `??` 运算符提供默认值，在校验前解析 |

### 11.4 适用场景

- 策略类构造函数
- 配置对象校验
- 所有对外公开 API 的入口

---

## 12. 可测试性设计模式

### 12.1 模式定义

从设计阶段就考虑可测试性，使策略可独立测试、可 mock、可虚拟时间控制。

### 12.2 本包应用

#### 12.2.1 纯函数策略（无状态）

`ExponentialBackoff`, `FixedRetry`, `FixedTimeout` 是无状态的，输入决定输出：

```typescript
// 测试指数退避的延迟计算
test('nextDelay returns exponential values', () => {
  const retry = new ExponentialBackoff({ maxAttempts: 5, baseDelayMs: 1000, jitterFactor: 0 });
  expect(retry.nextDelay(1)).toBe(1000);   // 2^0 * 1000
  expect(retry.nextDelay(2)).toBe(2000);   // 2^1 * 1000
  expect(retry.nextDelay(3)).toBe(4000);   // 2^2 * 1000
  expect(retry.nextDelay(4)).toBe(8000);   // 2^3 * 1000
  expect(retry.nextDelay(5)).toBe(16000);  // 2^4 * 1000
});
```

#### 12.2.2 状态可观测

`SimpleCircuitBreaker` 暴露内部状态用于断言：

```typescript
test('circuit opens after threshold failures', () => {
  const breaker = new SimpleCircuitBreaker({ name: 'test', threshold: 3, halfOpenAfterMs: 10000 });

  expect(breaker.state).toBe('CLOSED');

  breaker.recordFailure(); // 1
  expect(breaker.state).toBe('CLOSED');
  expect(breaker.consecutiveFailures).toBe(1);

  breaker.recordFailure(); // 2
  expect(breaker.state).toBe('CLOSED');

  breaker.recordFailure(); // 3 — threshold
  expect(breaker.state).toBe('OPEN');
});
```

#### 12.2.3 强制状态转换

`forceState()` 用于测试特定状态下的行为：

```typescript
test('open state rejects calls', async () => {
  const breaker = new SimpleCircuitBreaker({ name: 'test', threshold: 1, halfOpenAfterMs: 100000 });
  breaker.forceState('OPEN');

  await expect(
    breaker.call(() => Promise.resolve('ok'))
  ).rejects.toThrow(CircuitBreakerOpenError);
});
```

#### 12.2.4 虚拟时间支持（设计文档规划）

```typescript
// 依赖注入 TimeProvider，替换全局时间
export interface TimeProvider {
  now(): number;
  setTimeout(handler: () => void, ms: number): void;
}

export class VirtualTimeProvider implements TimeProvider {
  private currentTime = 0;
  private timers: Array<{ fireAt: number; handler: () => void }> = [];

  now(): number { return this.currentTime; }

  setTimeout(handler: () => void, ms: number): void {
    this.timers.push({ fireAt: this.currentTime + ms, handler });
    this.timers.sort((a, b) => a.fireAt - b.fireAt);
  }

  tick(ms: number): void {
    this.currentTime += ms;
    while (this.timers.length > 0 && this.timers[0].fireAt <= this.currentTime) {
      this.timers.shift()!.handler();
    }
  }
}
```

### 12.3 测试策略矩阵

| 策略类型 | 测试重点 | 测试方式 |
|---------|---------|---------|
| 无状态策略 | 输入/输出映射 | 直接调用方法，断言返回值 |
| 有状态策略 | 状态转换 | 操作 + 断言内部状态 |
| 时间相关策略 | 延迟/超时 | 虚拟时间 / 快速 timeout |
| 组合策略 | 嵌套顺序 | mock 中间层，验证调用顺序 |
| 边界条件 | 异常参数/边界值 | 构造非法参数，断言错误 |

---

## 13. 测试规范提炼

### 13.1 测试文件组织

```
src/__tests__/                    # 与 src 同级，统一测试目录
├── retry/
│   ├── exponential-backoff.test.ts
│   ├── fixed-retry.test.ts
│   └── no-retry.test.ts
├── circuit-breaker/
│   ├── simple-circuit-breaker.test.ts
│   └── state-machine-circuit-breaker.test.ts
├── timeout/
│   ├── fixed-timeout.test.ts
│   └── adaptive-timeout.test.ts
├── registry/
│   └── registry.test.ts
├── integration.test.ts           # 组合执行集成测试
└── compat.test.ts                # 兼容性测试
```

### 13.2 单元测试规范

#### 13.2.1 测试结构（AAA 模式）

```typescript
describe('SimpleCircuitBreaker', () => {
  describe('state transitions', () => {
    it('从 CLOSED 转为 OPEN 当连续失败达到阈值', () => {
      // Arrange
      const breaker = new SimpleCircuitBreaker({ name: 'test', threshold: 3, halfOpenAfterMs: 10000 });

      // Act
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      // Assert
      expect(breaker.state).toBe('OPEN');
    });
  });
});
```

#### 13.2.2 每条测试的粒度

- **一条测试只测一个行为**
- **测试描述使用中文**（团队约定）或英文，保持一致
- **使用 `it('should ...')` 或 `it('当...时, 会...')` 格式**

#### 13.2.3 边界条件测试清单

| 类别 | 示例 |
|------|------|
| 零值 | `maxAttempts=0`, `baseDelayMs=0` |
| 负值 | `halfOpenAfterMs=-1`, `delayMs=-100` |
| 最小值 | `maxAttempts=1`, `threshold=1` |
| 最大值 | `maxDelayMs=Infinity` |
| 非法类型 | `NaN`, `null`, `undefined` |
| 空集合 | `retryableErrors=[]` |
| 状态序列 | CLOSED→OPEN→HALF_OPEN→CLOSED 完整循环 |

### 13.3 集成测试规范

```typescript
describe('Registry integration', () => {
  it('执行顺序: timeout → circuitBreaker → retry → fn', async () => {
    const registry = Registry.create();
    const callOrder: string[] = [];

    registry.register('test', {
      retry: { /* mock 记录调用顺序 */ },
      circuitBreaker: { /* mock 记录调用顺序 */ },
      timeout: { /* mock 记录调用顺序 */ },
    });

    await registry.execute('test', async () => { callOrder.push('fn'); });

    expect(callOrder).toEqual(['timeout', 'circuitBreaker', 'retry', 'fn']);
  });
});
```

### 13.4 兼容性测试规范

```typescript
describe('compat', () => {
  it('AbortSignal.timeout 不可用时降级为 AbortController', () => {
    const originalTimeout = AbortSignal.timeout;
    (AbortSignal as any).timeout = undefined;  // 模拟不支持

    try {
      const timeout = new FixedTimeout({ durationMs: 100 });
      // 执行测试...
    } finally {
      (AbortSignal as any).timeout = originalTimeout;  // 恢复
    }
  });
});
```

### 13.5 测试覆盖率目标

| 层级 | 覆盖率目标 | 说明 |
|------|-----------|------|
| 策略类 | 100% 分支覆盖 | 所有 if-else 分支、边界条件 |
| Registry | 100% 方法覆盖 | 注册/查询/执行/快照/重置/事件 |
| 集成测试 | 核心链路 | 组合执行顺序、事件发射链 |
| 兼容性 | 每个降级路径 | AbortSignal / AsyncLocalStorage 降级 |

---

## 14. 文档规范

### 14.1 文件头规范

每个源文件以标准文件头开始：

```typescript
// ============================================================
// @cortex/resilience — [文件名] [简短描述]
//
// @file-overview
// [2-4 句描述文件职责、核心逻辑和适用场景]
//
// @design 详见 DESIGN.md §[章节号]「[章节名]」
// ============================================================
```

### 14.2 接口/类 JSDoc 规范

```typescript
/**
 * ExponentialBackoff —— 指数退避重试策略。
 *
 * [2-4 句详细描述，包括算法、特性和使用场景]
 *
 * @example
 * ```typescript
 * const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000 });
 * ```
 *
 * @see [相关接口/类]
 * @design [设计文档引用]
 */
```

### 14.3 方法 JSDoc 规范

```typescript
/**
 * 获取下一次重试前的等待时间。
 *
 * 退避公式：
 *   delay = baseDelayMs × 2^(attempt - 1)
 *   delay = clamp(delay, 0, maxDelayMs)
 *   delay += jitter × random(-1, 1)
 *
 * @param attempt - 当前重试次数（1-based）
 * @param _error - 触发重试的异常（当前未使用）
 * @returns 等待毫秒数，始终 ≥ 0
 *
 * @throws {RangeError} 参数不合法时
 */
nextDelay(attempt: number, _error?: unknown): number;
```

### 14.4 文档组成

| 文档 | 位置 | 职责 |
|------|------|------|
| `DESIGN.md` | 包根目录 | 设计动机、架构总览、关键决策 |
| `API_REFERENCE.md` | `docs/` | 完整 API 文档（待补充） |
| `MIGRATION_GUIDE.md` | `docs/` | 迁移指南（待补充） |
| 源码 JSDoc | `src/` | 逐类/方法的技术文档 |

---

## 15. 包结构规范

### 15.1 推荐目录结构

```
packages/<name>/
├── package.json                  # 包信息、依赖、脚本
├── tsconfig.json                 # 引用 tsconfig.src.json + tsconfig.test.json
├── tsconfig.src.json             # 编译配置
├── tsconfig.test.json            # 测试配置
├── vitest.config.ts              # 测试运行器配置（可选）
├── DESIGN.md                     # 设计文档
│
├── src/
│   ├── index.ts                  # 桶导出（barrel）
│   ├── interfaces/               # 接口层（可选，按需拆分）
│   ├── implementations/          # 实现层（可选，按需拆分）
│   ├── <feature>/                # 按功能组织（推荐）
│   │   ├── my-feature.ts
│   │   └── my-feature.test.ts    # 测试紧邻源码（或集中 __tests__）
│   └── __tests__/                # 集中测试目录（可选）
│
├── docs/                         # 文档
│   ├── API_REFERENCE.md
│   └── MIGRATION_GUIDE.md
│
└── examples/                     # 示例代码（可选）
```

### 15.2 包配置规范

```json
{
  "name": "@cortex/<name>",
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
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### 15.3 桶导出（index.ts）规范

```typescript
// ============================================================
// @cortex/<name> —— [一句话描述]
// ============================================================

// ── 接口层 ──
export type { IFoo } from "./foo.js";

// ── 实现层 ──
export { FooImpl } from "./foo-impl.js";

// ── 编排层 ──
export { FooRegistry } from "./foo-registry.js";

// ── 错误类型 ──
export { FooError } from "./errors.js";
```

### 15.4 运行时依赖原则

- **核心库零运行时依赖**（纯 TypeScript）
- 依赖仅限 `@cortex/*` 同仓包
- 使用标准 Web API（`AbortSignal` / `AbortController`）实现跨平台兼容

---

## 16. 跨包协作契约

### 16.1 本包的协作关系

```
包 A（消费者）                             包 B（消费者）
    │                                          │
    ├─ registry.execute('llm-api', fn)          ├─ new ExponentialBackoff(...)
    │                                          │
    ▼                                          ▼
┌──────────────────────────────────────────────────┐
│              @cortex/resilience                    │
│  Registry + IRetryPolicy + ICircuitBreaker + ...  │
└──────────────────────────────────────────────────┘
```

### 16.2 契约规则

| 规则 | 说明 |
|------|------|
| 面向接口编程 | 消费者依赖接口类型，不依赖具体实现类 |
| 通过 Registry 使用 | 推荐通过 `registry.execute()` 使用，而非直接 new 策略 |
| 策略可独立使用 | 也允许直接 `new ExponentialBackoff({...})` 在简单场景 |
| 错误类型可捕获 | 消费者可 `catch` 领域错误类型做针对性处理 |
| 可观测性 | 通过 `onEvent` 监听运行时事件，不侵入策略内部 |

### 16.3 消费者代码示例

```typescript
import { Registry, ExponentialBackoff, FixedTimeout } from '@cortex/resilience';

// 初始化
const registry = Registry.create({
  timeout: new FixedTimeout({ durationMs: 15000 }),
});

// 注册
registry.register('my-api', {
  retry: new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000 }),
});

// 执行
try {
  const result = await registry.execute('my-api', () => fetch(url));
} catch (err) {
  if (err instanceof TimeoutError) {
    // 超时处理
  }
  throw err;
}
```

---

## 附录：模式速查表

| 模式 | 本包体现 | 可复用指数 | 难度 |
|------|---------|-----------|------|
| 三层抽象 | 接口 / 实现 / 编排 | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| Registry 模式 | 注册中心 + 组合执行 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Null Object | NoRetry / NoBreaker / NoTimeout | ⭐⭐⭐⭐ | ⭐ |
| Strategy | 多退避算法 / 多熔断策略 | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| 有限状态机 | CircuitBreaker 三态 | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 工厂方法 | Registry.create / createResilience | ⭐⭐⭐⭐ | ⭐ |
| 观察者模式 | onEvent / onStateChange | ⭐⭐⭐⭐ | ⭐⭐ |
| 上下文传递 | ResilienceContextManager | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| 兼容性降级 | AbortSignal / AsyncLocalStorage 降级 | ⭐⭐⭐⭐ | ⭐⭐ |
| 错误分类 | TimeoutError / CircuitBreakerOpenError | ⭐⭐⭐⭐ | ⭐ |
| 参数校验 | 构造函数 RangeError 校验 | ⭐⭐⭐⭐⭐ | ⭐ |
| 虚拟时间 | TimeProvider + VirtualTimeProvider | ⭐⭐⭐⭐ | ⭐⭐⭐ |

---

> **文档版本**: v1.0  
> **提炼来源**: `@cortex/resilience` 包（DESIGN.md + Registry.ts + 6 个策略实现）  
> **维护者**: Cortex 韧性团队  
> **更新日期**: 2026-07-25
