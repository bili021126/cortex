// ============================================================
// @cortex/telemetry —— 核心类型定义
//
// 定义 ITelemetryCollector 接口、TelemetryData 数据格式、
// Sampler 策略接口、Batcher 策略接口及其相关类型。
// ============================================================

// ─── 标签 ───────────────────────────────────────────

/**
 * 遥测数据点的标签键值对。
 * 用于过滤、分组和路由遥测数据。
 */
export interface TelemetryTag {
  readonly key: string;
  readonly value: string;
}

// ─── 数据点 ─────────────────────────────────────────

/**
 * 遥测数据点——流过采集管线的单个数据单元。
 *
 * 每条遥测数据包含名称、数值、标签集合、时间戳及可选元数据。
 * 数据点一旦创建即为不可变快照，Collector 负责消费而非修改。
 */
export interface TelemetryData {
  /** 全局唯一标识 */
  readonly id: string;
  /** 指标/事件名称（如 "llm.chat.duration_ms"） */
  readonly name: string;
  /** 数值 */
  readonly value: number;
  /** 标签集合 */
  readonly tags: readonly TelemetryTag[];
  /** 时间戳（Unix 毫秒） */
  readonly timestamp: number;
  /** 可选元数据负载 */
  readonly metadata?: Record<string, unknown>;
}

// ─── 采集结果 ───────────────────────────────────────

/**
 * Collector 处理单条 TelemetryData 后返回的结果。
 * accepted 表示该数据点是否被 Collector 接受并处理。
 */
export interface CollectResult {
  readonly accepted: boolean;
  /** 拒绝或警告原因（仅在 accepted === false 时必填） */
  readonly reason?: string;
}

// ─── ITelemetryCollector ────────────────────────────

/**
 * 遥测采集器核心接口。
 *
 * 所有 Collector 实现（ConsoleCollector、FileCollector、以及未来的
 * HttpCollector、PrometheusCollector 等）必须实现此接口。
 *
 * 职责：
 * - collect(data)：接收并处理单条遥测数据点
 * - flush()：刷新缓冲区（同步 Collector 可为空操作）
 * - shutdown()：释放资源（关闭文件句柄、网络连接等）
 *
 * @remarks 符合宪法 §十三 接口隔离原则——每个 Collector 只做"采集"一件事。
 */
export interface ITelemetryCollector {
  /** 采集器唯一名称 */
  readonly name: string;

  /**
   * 采集一条遥测数据点。
   * @param data - 遥测数据点
   * @returns 采集结果（是否被接受）
   */
  collect(data: TelemetryData): Promise<CollectResult>;

  /**
   * 刷新缓冲区，确保所有已 collect 的数据被写入底层存储。
   * 对于同步 Collector（如 ConsoleCollector），此方法可为空操作。
   */
  flush(): Promise<void>;

  /**
   * 关闭采集器，释放所有资源（文件句柄、网络连接等）。
   * 关闭后调用 collect() 应返回 { accepted: false, reason: "shutdown" }。
   */
  shutdown(): Promise<void>;
}

// ─── CollectorFactory ───────────────────────────────

/**
 * Collector 工厂函数签名。
 * CollectorRegistry 使用此签名按需创建 Collector 实例。
 */
export type CollectorFactory = () => ITelemetryCollector;

// ─── 采样 ─────────────────────────────────────────

/**
 * 采样决策——表示一条遥测数据点是否应被采集。
 */
export interface SamplerDecision {
  /** 是否接受（采集）此数据点 */
  readonly accept: boolean;
  /** 决策原因描述 */
  readonly reason: string;
}

/**
 * 采样策略接口。
 *
 * 决定遥测数据点是否被采集。采样器运行在 Collector 之前，
 * 被拒绝的数据点不会传递给任何 Collector。
 *
 * @remarks 符合宪法 §十四 Strategy 模式约定。
 */
export interface Sampler {
  /** 采样器名称 */
  readonly name: string;

  /**
   * 判断是否应采集给定的数据点。
   * @param data - 待判断的遥测数据点
   * @returns 采样决策
   */
  decide(data: TelemetryData): SamplerDecision;
}

// ─── 批处理 ─────────────────────────────────────────

/**
 * 遥测数据批次——一组准备导出/写入的数据点。
 */
export interface TelemetryBatch {
  /** 批次唯一标识 */
  readonly id: string;
  /** 批次包含的数据点 */
  readonly entries: readonly TelemetryData[];
  /** 批次创建时间（Unix 毫秒） */
  readonly createdAt: number;
  /** 批次大小（数据点数量） */
  readonly size: number;
}

/**
 * 批处理策略接口。
 *
 * 决定如何将个体数据点分组为批次。运行在 Collector 内部，
 * collect() 方法将数据点交给 Batcher，Batcher 在满足条件时
 * 返回一个完整批次供 Collector 处理。
 *
 * @remarks 符合宪法 §十四 Strategy 模式约定。
 */
export interface Batcher {
  /** 批处理器名称 */
  readonly name: string;

  /**
   * 向批处理器添加一条数据点。
   * 如果满足批处理条件（达到大小上限、时间窗口到期等），
   * 返回一个完整批次；否则返回 undefined。
   *
   * @param data - 遥测数据点
   * @returns 完整批次或 undefined
   */
  add(data: TelemetryData): TelemetryBatch | undefined;

  /**
   * 强制刷新所有待处理数据点为完整批次。
   * 如果没有待处理数据，返回 undefined。
   *
   * @returns 包含所有待处理数据的批次，或 undefined
   */
  flush(): TelemetryBatch | undefined;

  /** 当前待处理的数据点数量 */
  get pendingCount(): number;

  /** 重置批处理器状态（清空待处理队列） */
  reset(): void;
}

// ─── Collector 注册表 ──────────────────────────────

/**
 * Collector 注册项——使用 discriminated union 按 initialized 字段窄化类型。
 * initialized=true 时 collector 为 ITelemetryCollector 实例，
 * initialized=false 时 collector 为 CollectorFactory 工厂函数。
 */
export type CollectorRegistration =
  | { readonly name: string; readonly collector: ITelemetryCollector; readonly initialized: true }
  | { readonly name: string; readonly collector: CollectorFactory; readonly initialized: false };

/**
 * Collector 注册表接口。
 *
 * 管理 Collector 的注册、查找和生命周期。
 * Collector 可通过名称注册，支持惰性初始化（工厂模式）。
 *
 * @remarks 符合宪法 §十四 Factory 模式约定——集中管理 Collector 创建。
 */
export interface ICollectorRegistry {
  /**
   * 注册一个 Collector 实例。
   * @param collector - 已初始化的 Collector 实例
   */
  register(collector: ITelemetryCollector): void;

  /**
   * 注册一个 Collector 工厂（惰性初始化）。
   * @param name - 采集器名称
   * @param factory - 工厂函数，首次获取时调用
   */
  registerFactory(name: string, factory: CollectorFactory): void;

  /**
   * 按名称查找 Collector。
   * 如果是工厂注册且尚未初始化，自动调用工厂创建实例。
   * @param name - 采集器名称
   * @returns Collector 实例，或 undefined（未注册）
   */
  get(name: string): ITelemetryCollector | undefined;

  /**
   * 注销 Collector。
   * 如果 Collector 已初始化，调用其 shutdown() 后再移除。
   * @param name - 采集器名称
   */
  unregister(name: string): Promise<void>;

  /**
   * 获取所有已注册的 Collector 名称。
   * @returns 名称列表
   */
  getNames(): readonly string[];

  /**
   * 刷新所有已初始化的 Collector。
   */
  flushAll(): Promise<void>;

  /**
   * 关闭并注销所有已初始化的 Collector。
   */
  shutdownAll(): Promise<void>;
}
