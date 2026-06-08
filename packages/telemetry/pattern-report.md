# @cortex/telemetry 架构模式分析报告

> **提取日期**: 2026-05-31  
> **分析对象**: `packages/telemetry/src/`  
> **分析目的**: 提取可复用的架构设计模式，编写 SkillTemplate 指导新包应用这些模式

---

## 目录

1. [模式总览](#1-模式总览)
2. [模式一：策略模式（Strategy）](#2-模式一策略模式strategy)
3. [模式二：适配器模式（Adapter）](#3-模式二适配器模式adapter)
4. [模式三：工厂+注册表模式（Factory + Registry）](#4-模式三工厂注册表模式factory--registry)
5. [模式四：组件式组合（Component Composition）](#5-模式四组件式组合component-composition)
6. [模式五：依赖倒置（Dependency Inversion）](#6-模式五依赖倒置dependency-inversion)
7. [模式六：不可变数据契约（Immutable Data Contract）](#7-模式六不可变数据契约immutable-data-contract)
8. [SkillTemplate：策略注册管线](#8-skilltemplate策略注册管线)
9. [SkillTemplate：组件式可插拔采集器](#9-skilltemplate组件式可插拔采集器)
10. [宪法映射表](#10-宪法映射表)

---

## 1. 模式总览

| # | 模式 | 包内体现 | 复用价值 |
|---|------|---------|---------|
| 1 | **Strategy 策略模式** | `Sampler`（RateSampler / ThresholdSampler），`Batcher`（SizeBatcher / TimeBatcher） | 运行时切换算法/行为 |
| 2 | **Adapter 适配器模式** | `ConsoleCollector` / `FileCollector` 实现同一 `ITelemetryCollector` 接口 | 统一接口接入不同后端 |
| 3 | **Factory + Registry 工厂+注册表** | `CollectorRegistry.registerFactory()` 惰性初始化 | 集中管理可插拔组件生命周期 |
| 4 | **Component Composition 组件式组合** | Sampler → Batcher → Collector → Registry 管线化组装 | 独立单元可测试，自由组合 |
| 5 | **Dependency Inversion 依赖倒置** | 高层模块依赖 `ITelemetryCollector` / `Sampler` / `Batcher` 接口 | 解耦实现与策略 |
| 6 | **Immutable Data Contract 不可变数据契约** | `TelemetryData` / `TelemetryBatch` / `CollectResult` 全 `readonly` | 线程安全、可预测、可缓存 |

---

## 2. 模式一：策略模式（Strategy）

### 2.1 定义

> 定义一族算法，将它们封装起来，使它们可以相互替换。算法的变化独立于使用它的客户端。

### 2.2 包内实现

**策略接口**（`src/types.ts`）：

```typescript
// ── Sampler 策略接口 ──
export interface Sampler {
  readonly name: string;
  decide(data: TelemetryData): SamplerDecision;
}

// ── Batcher 策略接口 ──
export interface Batcher {
  readonly name: string;
  add(data: TelemetryData): TelemetryBatch | undefined;
  flush(): TelemetryBatch | undefined;
  get pendingCount(): number;
  reset(): void;
}
```

**具体策略**（`src/sampler.ts`）：

```typescript
// 策略 A：按比例采样
export class RateSampler implements Sampler {
  constructor(rate: number, name = "rate") { /* ... */ }
  decide(data: TelemetryData): SamplerDecision { /* 确定性哈希 */ }
}

// 策略 B：按阈值采样
export class ThresholdSampler implements Sampler {
  constructor(threshold: number, mode: "gt" | "lt", name = "threshold") { /* ... */ }
  decide(data: TelemetryData): SamplerDecision { /* 数值比较 */ }
}
```

### 2.3 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 接口 vs 抽象类 | 纯 `interface` | 宪法 §十三 接口隔离，无共享状态 |
| 策略标识 | `name: string` 属性 | 便于日志、注册表查找、调试 |
| 策略组合 | 外部组合（非链式） | 保持每个策略职责单一、测试简单 |
| 构造函数校验 | 前置条件检查 | 快速失败（fail-fast），避免无效策略实例 |

### 2.4 适用场景

- 需要运行时切换算法（采样率、批处理策略）
- 算法有多个变体且可能持续增加
- 希望隔离算法实现与业务逻辑

---

## 3. 模式二：适配器模式（Adapter）

### 3.1 定义

> 将一个类的接口转换成客户期望的另一个接口。让原本不兼容的类可以协同工作。

### 3.2 包内实现

**目标接口**（`src/types.ts`）：

```typescript
export interface ITelemetryCollector {
  readonly name: string;
  collect(data: TelemetryData): Promise<CollectResult>;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}
```

**适配器实现**：

| 适配器 | 适配目标 | 关键差异 |
|--------|---------|---------|
| `ConsoleCollector` | `console.log` / `process.stdout.write` | 同步输出，无需 flush |
| `FileCollector` | `fs/promises.appendFile` / `writeFile` | 异步写入，需 flush 保证持久化 |

### 3.3 适配器核心样板

```typescript
export class ConsoleCollector implements ITelemetryCollector {
  readonly name: string;
  private _shutdown = false;

  constructor(name = "console", options?: ConsoleCollectorOptions) {
    this.name = name;
    // ... 初始化配置
  }

  async collect(data: TelemetryData): Promise<CollectResult> {
    if (this._shutdown) return { accepted: false, reason: "shutdown" };
    // 适配逻辑：将 TelemetryData 转为 console.log 输出
    console.log(this._format(data));
    return { accepted: true };
  }

  async flush(): Promise<void> {
    // 同步输出，空操作
  }

  async shutdown(): Promise<void> {
    this._shutdown = true;
  }
}
```

### 3.4 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 适配器状态 | 内部 `_shutdown` 标记 | 防止 shutdown 后误调用，幂等安全 |
| 构造参数 | `name` 为首参 + `options` 对象 | §十一 方法签名三原则：必选在前，options 避免 boolean trap |
| 异步接口 | `collect()` / `flush()` / `shutdown()` 全 async | 统一异步契约，适配器可选择同步实现 |

---

## 4. 模式三：工厂+注册表模式（Factory + Registry）

### 4.1 定义

> 工厂模式：将对象的创建委托给工厂方法，客户端不直接实例化。
> 注册表模式：提供一个中心化的容器来注册、查找和管理对象实例。

### 4.2 包内实现

**工厂类型**（`src/types.ts`）：

```typescript
export type CollectorFactory = () => ITelemetryCollector;
```

**注册表实现**（`src/collector-registry.ts`）：

```typescript
export class CollectorRegistry implements ICollectorRegistry {
  private readonly _registrations: Map<string, CollectorRegistration> = new Map();

  // 方式一：直接注册实例
  register(collector: ITelemetryCollector): void { /* ... */ }

  // 方式二：注册工厂（惰性初始化）
  registerFactory(name: string, factory: CollectorFactory): void { /* ... */ }

  // 查找：工厂注册的 collector 在首次 get() 时自动创建
  get(name: string): ITelemetryCollector | undefined {
    const registration = this._registrations.get(name);
    if (!registration) return undefined;
    if (registration.initialized) return registration.collector as ITelemetryCollector;

    // 惰性初始化
    const instance = factory();
    this._registrations.set(name, { name, collector: instance, initialized: true });
    return instance;
  }

  // 批量生命周期管理
  async flushAll(): Promise<void> { /* 遍历全部已初始化实例 */ }
  async shutdownAll(): Promise<void> { /* 遍历全部已初始化实例 */ }
}
```

### 4.3 惰性初始化时序图

```
registerFactory("file", () => new FileCollector("./metrics.jsonl"))
  │
  │  _registrations.set("file", { name: "file", collector: factory, initialized: false })
  │
  ▼
get("file")
  │
  ├─ initialized === false → 调用 factory()
  ├─ 创建 FileCollector 实例
  ├─ 更新注册项为 { name: "file", collector: instance, initialized: true }
  └─ 返回实例
  │
  ▼
get("file") (再次调用)
  └─ initialized === true → 直接返回缓存实例
```

### 4.4 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 注册冲突策略 | 同名重复注册抛错 | 避免静默覆盖导致难以调试的 bug |
| 生命周期管理 | `flushAll()` / `shutdownAll()` 并行 Promise.all | 优雅关闭，不遗漏任何 Collector |
| 存储结构 | `Map<string, CollectorRegistration>` | O(1) 查找，保持注册顺序 |
| 工厂签名 | `() => ITelemetryCollector` | 零参数，简单可预测 |

---

## 5. 模式四：组件式组合（Component Composition）

### 5.1 定义

> 将系统拆分为多个职责单一的组件，通过组合（而非继承）构建复杂行为。

### 5.2 包内管线架构

```
                  TelemetryData
                       │
                       ▼
              ┌──────────────┐
              │   Sampler    │  ← 策略：决定"采不采"
              │  (过滤/采样) │
              └──────┬───────┘
                     │ accepted
                     ▼
              ┌──────────────┐
              │   Batcher    │  ← 策略：决定"何时批量"
              │  (批量分组)  │
              └──────┬───────┘
                     │ batch (或 undefined)
                     ▼
              ┌──────────────┐
              │  Collector   │  ← 适配器：决定"写到哪"
              │  (输出/存储) │
              └──────┬───────┘
                     │ CollectResult
                     ▼
              ┌──────────────┐
              │   Registry   │  ← 注册表：管理"有哪些"
              │  (生命周期)  │
              └──────────────┘
```

### 5.3 组合代码示例

```typescript
// 各组件独立构造
const sampler = new RateSampler(0.1);
const batcher = new SizeBatcher(100);
const collector = new FileCollector("./metrics.jsonl");
const registry = new CollectorRegistry();

registry.register(collector);

// 使用组合
function ingest(data: TelemetryData): void {
  // Step 1: 采样
  if (!sampler.decide(data).accept) return;

  // Step 2: 批处理
  const batch = batcher.add(data);
  if (!batch) return;  // 未满批

  // Step 3: 分发到所有 Collector
  for (const name of registry.getNames()) {
    const col = registry.get(name);
    if (col) {
      for (const entry of batch.entries) {
        await col.collect(entry);
      }
    }
  }
}
```

### 5.4 组合式 vs 继承式对比

| 维度 | 组合式（本包采用） | 继承式 |
|------|------------------|--------|
| 扩展方式 | 新增组件接入管线 | 继承基类覆写方法 |
| 测试 | 每组件独立测试，mock 上下游 | 需测试整个继承链 |
| 灵活性 | 运行时自由替换任一环节 | 编译时确定 |
| 耦合度 | 低（仅依赖接口） | 高（依赖父类实现） |
| 复用度 | 组件可在不同管线中复用 | 子类通常耦合于特定场景 |

---

## 6. 模式五：依赖倒置（Dependency Inversion）

### 6.1 定义

> 高层模块不应依赖于低层模块，二者都应依赖于抽象。
> 抽象不应依赖于细节，细节应依赖于抽象。

### 6.2 包内实现

```
  高层模块（业务逻辑）
       │
       │ 依赖接口（而非实现）
       ▼
  ┌─────────────────────┐
  │  ITelemetryCollector │  ← 抽象
  │  Sampler             │  ← 抽象
  │  Batcher             │  ← 抽象
  │  ICollectorRegistry  │  ← 抽象
  └─────────────────────┘
       ▲          ▲          ▲
       │          │          │
  ┌────────┐ ┌────────┐ ┌────────┐
  │Console │ │ File   │ │Http    │  ← 具体实现（依赖抽象）
  │Collector│ │Collector│ │Collector│
  └────────┘ └────────┘ └────────┘
```

### 6.3 代码体现

```typescript
// ❌ 反例：高层依赖具体实现
class MetricsService {
  private collector = new FileCollector("./metrics.jsonl"); // 硬编码
}

// ✅ 正例：高层依赖抽象接口
class MetricsService {
  constructor(
    private readonly collector: ITelemetryCollector,  // 接口注入
    private readonly sampler: Sampler,                  // 接口注入
    private readonly batcher: Batcher,                  // 接口注入
  ) {}
}
```

---

## 7. 模式六：不可变数据契约（Immutable Data Contract）

### 7.1 定义

> 跨组件传递的数据结构设计为只读（readonly），数据一旦创建就不应被修改。
> 保证数据在管线中流动时不会被意外篡改。

### 7.2 包内实现

所有跨组件共享数据均为 `readonly`：

```typescript
export interface TelemetryData {
  readonly id: string;
  readonly name: string;
  readonly value: number;
  readonly tags: readonly TelemetryTag[];
  readonly timestamp: number;
  readonly metadata?: Record<string, unknown>;
}

export interface TelemetryBatch {
  readonly id: string;
  readonly entries: readonly TelemetryData[];
  readonly createdAt: number;
  readonly size: number;
}

export interface CollectResult {
  readonly accepted: boolean;
  readonly reason?: string;
}
```

### 7.3 收益

| 收益 | 说明 |
|------|------|
| **线程安全** | 只读数据在 async/await 并发中不会被争用 |
| **可预测** | 组件 A 传递的数据不会被组件 B 修改 |
| **可缓存** | 只读对象可安全地作为 Map key 或缓存值 |
| **可序列化** | 所有字段均为原始类型或嵌套只读，JSON.stringify 无需特殊处理 |
| **调试友好** | 不变性让每个数据点的生命周期可追踪 |

---

## 8. SkillTemplate：策略注册管线

### 8.1 模板元信息

```yaml
skill-name: strategy-registry-pipeline
version: 1.0.0
source-package: "@cortex/telemetry"
patterns-used:
  - Strategy Pattern
  - Registry Pattern
  - Factory Pattern
  - Dependency Inversion
适用场景:
  - 需要支持多种算法/策略且运行时切换
  - 策略需要集中注册和生命周期管理
  - 策略需要惰性初始化（按需创建）
```

### 8.2 模板结构

```
your-package/
├── src/
│   ├── types.ts              ← 策略接口 + 工厂类型定义
│   ├── registry.ts           ← 注册表（管理注册/查找/生命周期）
│   ├── strategy-a.ts         ← 策略 A 实现
│   ├── strategy-b.ts         ← 策略 B 实现
│   ├── index.ts              ← Barrel 导出
│   └── ...
├── tests/
│   ├── strategy-a.test.ts
│   ├── strategy-b.test.ts
│   └── registry.test.ts
└── ...
```

### 8.3 模板代码

#### Step 1: 定义策略接口（`src/types.ts`）

```typescript
// ============================================================
// 策略接口定义
//
// 所有策略实现必须遵守此接口。
// 策略实例应具备 name 属性便于日志和注册表管理。
// ============================================================

/**
 * 策略输入数据类型。
 * 使用 readonly 确保策略不会修改输入数据。
 */
export interface StrategyInput {
  readonly id: string;
  readonly value: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * 策略输出数据类型。
 * 包含决策结果和决策原因（便于调试和审计）。
 */
export interface StrategyResult {
  readonly accept: boolean;
  readonly reason: string;
}

/**
 * 策略接口。
 *
 * @remarks 符合宪法 §十四 Strategy 模式约定。
 * - name：策略唯一标识
 * - execute：执行策略逻辑
 */
export interface IStrategy {
  /** 策略名称 */
  readonly name: string;

  /**
   * 执行策略决策。
   * @param input - 输入数据
   * @returns 决策结果
   */
  execute(input: StrategyInput): StrategyResult;
}

/**
 * 策略工厂函数签名。
 * 注册表使用此签名按需创建策略实例。
 */
export type StrategyFactory = () => IStrategy;

/**
 * 策略注册项。
 */
export interface StrategyRegistration {
  readonly name: string;
  readonly strategy: IStrategy | StrategyFactory;
  readonly initialized: boolean;
}
```

#### Step 2: 实现具体策略（`src/strategy-a.ts`）

```typescript
import type { IStrategy, StrategyInput, StrategyResult } from "./types.js";

/**
 * 策略 A —— 按阈值决策。
 *
 * 当 input.value 超过 threshold 时接受。
 *
 * @example
 * ```typescript
 * const strategy = new ThresholdStrategy(100);
 * const result = strategy.execute({ id: "1", value: 150 });
 * // result.accept === true
 * ```
 */
export class ThresholdStrategy implements IStrategy {
  readonly name: string;
  private readonly _threshold: number;
  private readonly _mode: "gt" | "lt";

  constructor(
    threshold: number,
    mode: "gt" | "lt" = "gt",
    name = "threshold",
  ) {
    if (threshold < 0) {
      throw new Error(`ThresholdStrategy: threshold must be >= 0, got ${threshold}`);
    }

    this._threshold = threshold;
    this._mode = mode;
    this.name = name;
  }

  execute(input: StrategyInput): StrategyResult {
    if (this._mode === "gt") {
      if (input.value > this._threshold) {
        return { accept: true, reason: `value ${input.value} > ${this._threshold}` };
      }
      return { accept: false, reason: `value ${input.value} <= ${this._threshold}` };
    }

    if (input.value < this._threshold) {
      return { accept: true, reason: `value ${input.value} < ${this._threshold}` };
    }
    return { accept: false, reason: `value ${input.value} >= ${this._threshold}` };
  }
}
```

#### Step 3: 实现策略 B（`src/strategy-b.ts`）

```typescript
import type { IStrategy, StrategyInput, StrategyResult } from "./types.js";

/**
 * 策略 B —— 按比例采样。
 *
 * 以 rate 比例随机决定是否接受输入。
 * 使用确定性哈希确保相同 ID 结果一致。
 */
export class RateStrategy implements IStrategy {
  readonly name: string;
  private readonly _rate: number;

  constructor(rate: number, name = "rate") {
    if (rate < 0 || rate > 1) {
      throw new Error(`RateStrategy: rate must be 0-1, got ${rate}`);
    }
    this._rate = rate;
    this.name = name;
  }

  execute(input: StrategyInput): StrategyResult {
    if (this._rate === 0) return { accept: false, reason: "rate=0" };
    if (this._rate === 1) return { accept: true, reason: "rate=1" };

    const hash = this._hash(input.id);
    const normalized = (hash % 10_000) / 10_000;

    return normalized < this._rate
      ? { accept: true, reason: `rate=${this._rate}, hash=${normalized}` }
      : { accept: false, reason: `rate=${this._rate}, hash=${normalized}` };
  }

  private _hash(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}
```

#### Step 4: 实现注册表（`src/registry.ts`）

```typescript
import type { IStrategy, StrategyFactory, StrategyRegistration } from "./types.js";

/**
 * 策略注册表。
 *
 * 集中管理策略的注册、查找和生命周期。
 * 支持两种注册方式：
 * 1. register(strategy) —— 注册已初始化的实例
 * 2. registerFactory(name, factory) —— 注册工厂，get() 时惰性初始化
 *
 * @example
 * ```typescript
 * const registry = new StrategyRegistry();
 * registry.register(new ThresholdStrategy(100));
 * registry.registerFactory("rate", () => new RateStrategy(0.1));
 *
 * const s = registry.get("threshold"); // 返回已注册实例
 * const r = registry.get("rate");      // 自动创建并缓存
 * ```
 */
export class StrategyRegistry {
  private readonly _registrations: Map<string, StrategyRegistration> = new Map();

  /**
   * 注册一个已初始化的策略实例。
   * @param strategy - 策略实例
   * @throws 如果同名但不同实例
   */
  register(strategy: IStrategy): void {
    const existing = this._registrations.get(strategy.name);
    if (existing && existing.strategy !== strategy) {
      throw new Error(
        `Strategy "${strategy.name}" is already registered with a different instance`,
      );
    }
    this._registrations.set(strategy.name, {
      name: strategy.name,
      strategy,
      initialized: true,
    });
  }

  /**
   * 注册一个策略工厂（惰性初始化）。
   * @param name - 策略名称
   * @param factory - 工厂函数
   * @throws 如果名称已被注册
   */
  registerFactory(name: string, factory: StrategyFactory): void {
    if (this._registrations.has(name)) {
      throw new Error(`Strategy factory "${name}" is already registered`);
    }
    this._registrations.set(name, {
      name,
      strategy: factory,
      initialized: false,
    });
  }

  /**
   * 按名称查找策略。
   * 工厂注册且未初始化时自动创建实例。
   * @param name - 策略名称
   * @returns 策略实例，或 undefined
   */
  get(name: string): IStrategy | undefined {
    const registration = this._registrations.get(name);
    if (!registration) return undefined;
    if (registration.initialized) return registration.strategy as IStrategy;

    // 惰性初始化
    const factory = registration.strategy as StrategyFactory;
    const instance = factory();
    this._registrations.set(name, {
      name,
      strategy: instance,
      initialized: true,
    });
    return instance;
  }

  /**
   * 注销策略。
   * @param name - 策略名称
   */
  unregister(name: string): void {
    this._registrations.delete(name);
  }

  /**
   * 获取所有已注册的策略名称。
   */
  getNames(): readonly string[] {
    return Array.from(this._registrations.keys());
  }

  /**
   * 清空注册表。
   */
  clear(): void {
    this._registrations.clear();
  }
}
```

#### Step 5: Barrel 导出（`src/index.ts`）

```typescript
// ============================================================
// Barrel 导出
// ============================================================

export type { StrategyInput, StrategyResult, IStrategy, StrategyFactory } from "./types.js";
export { ThresholdStrategy } from "./strategy-a.js";
export { RateStrategy } from "./strategy-b.js";
export { StrategyRegistry } from "./registry.js";
```

#### Step 6: 使用示例

```typescript
import { ThresholdStrategy, RateStrategy, StrategyRegistry } from "your-package";

// 1. 创建策略实例
const threshold = new ThresholdStrategy(100, "gt", "high-value");
const rate = new RateStrategy(0.1, "sampling");

// 2. 注册
const registry = new StrategyRegistry();
registry.register(threshold);
registry.register(rate);

// 或使用工厂惰性初始化
registry.registerFactory("deferred-rate", () => new RateStrategy(0.5));

// 3. 使用
const input = { id: "evt-001", value: 150 };
for (const name of registry.getNames()) {
  const strategy = registry.get(name);
  if (!strategy) continue;

  const result = strategy.execute(input);
  console.log(`[${strategy.name}] ${result.accept ? "✅" : "❌"} — ${result.reason}`);
}
```

### 8.4 测试模板

```typescript
// tests/registry.test.ts
import { describe, it, expect } from "vitest";
import { StrategyRegistry } from "../src/registry.js";
import { ThresholdStrategy } from "../src/strategy-a.js";

describe("StrategyRegistry", () => {
  it("should register and retrieve a strategy instance", () => {
    const registry = new StrategyRegistry();
    const strategy = new ThresholdStrategy(100);
    registry.register(strategy);
    expect(registry.get("threshold")).toBe(strategy);
  });

  it("should lazy-initialize factory-registered strategies", () => {
    const registry = new StrategyRegistry();
    registry.registerFactory("lazy", () => new ThresholdStrategy(50, "gt", "lazy"));
    expect(registry.getNames()).toContain("lazy");

    const instance = registry.get("lazy");
    expect(instance).toBeDefined();
    expect(instance!.name).toBe("lazy");

    // 第二次 get 返回同一实例
    expect(registry.get("lazy")).toBe(instance);
  });

  it("should throw on duplicate registration", () => {
    const registry = new StrategyRegistry();
    registry.register(new ThresholdStrategy(100, "gt", "dup"));
    expect(() => registry.register(new ThresholdStrategy(200, "gt", "dup"))).toThrow();
  });
});
```

---

## 9. SkillTemplate：组件式可插拔采集器

### 9.1 模板元信息

```yaml
skill-name: pluggable-collector-pipeline
version: 1.0.0
source-package: "@cortex/telemetry"
patterns-used:
  - Adapter Pattern
  - Component Composition
  - Immutable Data Contract
  - Dependency Inversion
适用场景:
  - 需要统一接口接入多种输出后端（文件/控制台/网络/消息队列）
  - 采集管线需要可插拔、可测试
  - 数据在流程中流动时需保证不可变性
```

### 9.2 模板架构

```
                    ┌──────────────────────────┐
                    │    DataPoint（只读）       │
                    │    ─────────────           │
                    │    id: string              │
                    │    type: string            │
                    │    payload: unknown        │
                    │    timestamp: number       │
                    └──────────┬───────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
       ┌────────────┐  ┌────────────┐  ┌────────────┐
       │ Console    │  │ File       │  │ Http       │  ← Adapter 实现
       │ Collector  │  │ Collector  │  │ Collector  │    IDataCollector
       └────────────┘  └────────────┘  └────────────┘
              │                │                │
              └────────────────┼────────────────┘
                               │
                               ▼
                       ┌──────────────┐
                       │  Collector   │
                       │  Pipeline    │  ← 组合管线
                       └──────────────┘
```

### 9.3 核心代码

#### 定义不可变数据契约 + 采集器接口

```typescript
// types.ts
export interface DataPoint {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
  readonly timestamp: number;
  readonly tags: readonly { key: string; value: string }[];
}

export interface CollectResult {
  readonly accepted: boolean;
  readonly reason?: string;
}

export interface IDataCollector {
  readonly name: string;
  readonly type: string;  // "console" | "file" | "http" | ...
  collect(data: DataPoint): Promise<CollectResult>;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}
```

#### 实现采集器适配器

```typescript
// console-collector.ts
export class ConsoleDataCollector implements IDataCollector {
  readonly name: string;
  readonly type = "console";
  private _shutdown = false;

  constructor(name = "console") {
    this.name = name;
  }

  async collect(data: DataPoint): Promise<CollectResult> {
    if (this._shutdown) return { accepted: false, reason: "shutdown" };
    console.log(`[${data.type}]`, JSON.stringify(data));
    return { accepted: true };
  }

  async flush(): Promise<void> { /* no-op */ }
  async shutdown(): Promise<void> { this._shutdown = true; }
}
```

```typescript
// file-collector.ts
import { appendFile, mkdir } from "fs/promises";
import { dirname } from "path";

export class FileDataCollector implements IDataCollector {
  readonly name: string;
  readonly type = "file";
  private readonly _filePath: string;
  private _buffer: DataPoint[] = [];
  private _shutdown = false;

  constructor(filePath: string, name = "file") {
    this._filePath = filePath;
    this.name = name;
  }

  async collect(data: DataPoint): Promise<CollectResult> {
    if (this._shutdown) return { accepted: false, reason: "shutdown" };
    this._buffer.push(data);
    return { accepted: true };
  }

  async flush(): Promise<void> {
    if (this._buffer.length === 0) return;
    await mkdir(dirname(this._filePath), { recursive: true });
    const lines = this._buffer.map(d => JSON.stringify(d)).join("\n") + "\n";
    await appendFile(this._filePath, lines, "utf-8");
    this._buffer = [];
  }

  async shutdown(): Promise<void> {
    await this.flush();
    this._shutdown = true;
  }
}
```

#### 组合管线

```typescript
// pipeline.ts
import type { DataPoint, IDataCollector } from "./types.js";

export interface PipelineOptions {
  /** 采集器列表 */
  collectors: IDataCollector[];
  /** 是否并行分发到所有采集器（默认 true） */
  parallel: boolean;
}

/**
 * 数据采集管线。
 *
 * 组合多个 Collector，将 DataPoint 分发给所有已注册的采集器。
 * 每个 Collector 独立处理数据（适配不同后端）。
 */
export class DataPipeline {
  private readonly _collectors: IDataCollector[];
  private readonly _parallel: boolean;

  constructor(options: PipelineOptions) {
    this._collectors = [...options.collectors];
    this._parallel = options.parallel ?? true;
  }

  /**
   * 采集一条数据点并分发给所有 Collector。
   */
  async collect(data: DataPoint): Promise<CollectResult[]> {
    if (this._parallel) {
      return Promise.all(
        this._collectors.map(c => c.collect(data)),
      );
    }

    const results: CollectResult[] = [];
    for (const collector of this._collectors) {
      results.push(await collector.collect(data));
    }
    return results;
  }

  /**
   * 刷新所有 Collector。
   */
  async flush(): Promise<void> {
    await Promise.all(this._collectors.map(c => c.flush()));
  }

  /**
   * 关闭所有 Collector。
   */
  async shutdown(): Promise<void> {
    await Promise.all(this._collectors.map(c => c.shutdown()));
  }

  /**
   * 获取所有 Collector 名称。
   */
  getCollectorNames(): string[] {
    return this._collectors.map(c => `${c.name} (${c.type})`);
  }
}
```

### 9.4 使用示例

```typescript
import { DataPipeline } from "./pipeline.js";
import { ConsoleDataCollector } from "./console-collector.js";
import { FileDataCollector } from "./file-collector.js";
import type { DataPoint } from "./types.js";

// 1. 创建采集器
const consoleCol = new ConsoleDataCollector("dev-logger");
const fileCol = new FileDataCollector("./data/events.jsonl", "persistent");

// 2. 组装管线
const pipeline = new DataPipeline({
  collectors: [consoleCol, fileCol],
  parallel: true,
});

// 3. 采集数据
const data: DataPoint = {
  id: "evt-001",
  type: "user.action",
  payload: { action: "click", target: "btn-submit" },
  timestamp: Date.now(),
  tags: [{ key: "env", value: "production" }],
};

await pipeline.collect(data);

// 4. 关闭
await pipeline.shutdown();
```

---

## 10. 宪法映射表

将 `@cortex/telemetry` 中验证有效的宪法条款映射为可复用的**模式原则**：

| 宪法条款 | 包内体现 | 模式原则（可复用） |
|---------|---------|-------------------|
| **§十三 接口隔离** | ITelemetryCollector / Sampler / Batcher / ICollectorRegistry 各为独立接口 | **原则①**：每个组件一个接口，角色职责互不重叠 |
| **§十三 readonly 优先** | TelemetryData / TelemetryBatch 全字段 readonly | **原则②**：跨组件数据契约全部 readonly |
| **§十三 Discriminated Union** | `"append" \| "overwrite"` / `"gt" \| "lt"` | **原则③**：用字面量联合替代布尔参数和字符串枚举 |
| **§十四 Strategy** | Sampler / Batcher 策略接口 + 多种实现 | **原则④**：可变的算法用 Strategy，不可变的数据用 interface |
| **§十四 Adapter** | ConsoleCollector / FileCollector 适配同一接口 | **原则⑤**：接入外部系统用 Adapter 包裹，内部永远面向接口 |
| **§十四 Factory** | CollectorRegistry.registerFactory() 惰性初始化 | **原则⑥**：资源密集型对象用 Factory 延迟创建 |
| **§九 内部明细化 + 外部具体化** | 内部实现可替换，外部接口稳定 | **原则⑦**：构造函数 options 收拢配置；公开 API 承诺薄 |
| **§十一 方法签名三原则** | 必选参数在前，options 对象在后，禁止 boolean trap | **原则⑧**：构造参数用 options 对象，布尔值用字面量联合替代 |
| **§七 配置驱动** | 所有行为参数化 | **原则⑨**：可配置的值不要硬编码，构造函数提供默认值 |
| **§十 禁止 any** | 公开 API 使用具体类型 | **原则⑩**：类型定义是活文档，禁止 any 逃逸 |

---

## 附录 A：模式决策检查清单

在新包中应用上述模式时，用以下清单自查：

### Strategy 策略模式

- [ ] 策略接口是否足够小（≤ 3 个方法）？
- [ ] 每个策略实现是否只有一个职责？
- [ ] 策略是否有 `name` 属性便于标识？
- [ ] 策略构造函数是否做前置校验（fail-fast）？
- [ ] 策略结果是否包含 `reason` 说明（便于调试）？

### Adapter 适配器模式

- [ ] 适配器是否完全实现目标接口？
- [ ] 适配器是否处理了 `shutdown` 状态（幂等安全）？
- [ ] 适配器的构造参数是否使用 options 对象？
- [ ] 适配器是否需要 `flush()`（同步操作可空实现）？

### Factory + Registry 工厂+注册表

- [ ] 注册表是否支持直接注册实例和工厂两种方式？
- [ ] 工厂函数签名是否零参数 `() => T`？
- [ ] 同名重复注册是否抛错（而非静默覆盖）？
- [ ] 查找时是否自动执行惰性初始化？
- [ ] 是否有批量生命周期方法（flushAll / shutdownAll）？

### Component Composition 组件式组合

- [ ] 每个组件是否可独立测试？
- [ ] 组件间依赖是否通过接口（而非具体类）？
- [ ] 组合逻辑是否与业务逻辑分离？
- [ ] 管线数据流是否单向（无环）？

### Immutable Data Contract 不可变数据

- [ ] 所有跨组件数据字段是否为 `readonly`？
- [ ] 数组类型是否使用 `readonly T[]`？
- [ ] 数据对象是否为纯数据（无方法）？
- [ ] 是否可安全 JSON.stringify？

---

*本文档基于对 `@cortex/telemetry` 包的完整源码分析产出。所有模式示例均提取自包内真实实现，SkillTemplate 可直接用于新包开发。*
