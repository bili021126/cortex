// ============================================================
// @cortex/telemetry —— Batcher 策略接口与实现
//
// 提供 Batcher 策略接口及两种内置批处理策略：
// - SizeBatcher：按数据点数量上限批量
// - TimeBatcher：按时间窗口批量
// ============================================================

import type { Batcher, TelemetryData, TelemetryBatch } from "./types.js";
import { randomUUID } from "crypto";

// ─── SizeBatcher ───────────────────────────────────

/**
 * 按大小批量批处理器。
 *
 * 当收集的数据点数量达到 maxSize 时，自动返回完整批次。
 * 适用于需要控制每批处理量的场景（如文件写入、网络请求）。
 *
 * @example
 * ```typescript
 * const batcher = new SizeBatcher(100);
 * const batch = batcher.add(data);
 * // if batch is not undefined -> send/write batch
 * ```
 */
export class SizeBatcher implements Batcher {
  readonly name: string;
  private readonly _maxSize: number;
  private _buffer: TelemetryData[] = [];

  /**
   * @param maxSize - 每批最大数据点数量（必须 >= 1）
   * @param name - 批处理器名称（默认 "size"）
   * @throws 如果 maxSize < 1
   */
  constructor(maxSize: number, name = "size") {
    if (maxSize < 1) {
      throw new Error(`SizeBatcher: maxSize must be >= 1, got ${maxSize}`);
    }

    this._maxSize = maxSize;
    this.name = name;
  }

  /**
   * 向批处理器添加一条数据点。
   * 如果缓冲区达到 maxSize，返回一个完整批次。
   *
   * @param data - 遥测数据点
   * @returns 完整批次或 undefined
   */
  add(data: TelemetryData): TelemetryBatch | undefined {
    this._buffer.push(data);

    if (this._buffer.length >= this._maxSize) {
      return this._createBatch();
    }

    return undefined;
  }

  /**
   * 强制刷新所有待处理数据点为完整批次。
   * @returns 包含所有待处理数据的批次，或 undefined
   */
  flush(): TelemetryBatch | undefined {
    if (this._buffer.length === 0) {
      return undefined;
    }

    return this._createBatch();
  }

  /**
   * 当前待处理的数据点数量。
   */
  get pendingCount(): number {
    return this._buffer.length;
  }

  /**
   * 重置批处理器状态。
   */
  reset(): void {
    this._buffer = [];
  }

  /**
   * 创建批次并清空缓冲区。
   * @returns 创建的批次
   */
  private _createBatch(): TelemetryBatch {
    const batch: TelemetryBatch = {
      id: randomUUID(),
      entries: [...this._buffer],
      createdAt: Date.now(),
      size: this._buffer.length,
    };

    this._buffer = [];
    return batch;
  }
}

// ─── TimeBatcher ───────────────────────────────────

/**
 * 按时间窗口批量批处理器。
 *
 * 在指定时间窗口内收集数据点，窗口到期时返回完整批次。
 * 适用于需要定时导出/上报的场景（如每 60 秒上报一次指标）。
 *
 * 时间窗口从第一次 add() 调用开始计时，到期后自动创建批次。
 *
 * @example
 * ```typescript
 * const batcher = new TimeBatcher(60_000);
 *
 * // Check periodically for complete batches
 * setInterval(() => {
 *   const batch = batcher.flush();
 *   // if batch is not undefined -> send/write batch
 * }, 60_000);
 * ```
 */
export class TimeBatcher implements Batcher {
  readonly name: string;
  private readonly _windowMs: number;
  private _buffer: TelemetryData[] = [];
  private _windowStart: number = 0;

  /**
   * @param windowMs - 时间窗口大小（毫秒，必须 >= 1）
   * @param name - 批处理器名称（默认 "time"）
   * @throws 如果 windowMs < 1
   */
  constructor(windowMs: number, name = "time") {
    if (windowMs < 1) {
      throw new Error(`TimeBatcher: windowMs must be >= 1, got ${windowMs}`);
    }

    this._windowMs = windowMs;
    this.name = name;
  }

  /**
   * 向批处理器添加一条数据点。
   * 如果是第一个数据点，启动时间窗口。
   * 如果时间窗口已到期，返回完整批次并开始新的窗口。
   *
   * @param data - 遥测数据点
   * @returns 完整批次或 undefined
   */
  add(data: TelemetryData): TelemetryBatch | undefined {
    // 如果是第一个数据点，启动窗口
    if (this._buffer.length === 0) {
      this._windowStart = Date.now();
    }

    this._buffer.push(data);

    // 检查时间窗口是否到期
    if (Date.now() - this._windowStart >= this._windowMs) {
      return this._createBatch();
    }

    return undefined;
  }

  /**
   * 强制刷新所有待处理数据点为完整批次。
   * @returns 包含所有待处理数据的批次，或 undefined
   */
  flush(): TelemetryBatch | undefined {
    if (this._buffer.length === 0) {
      return undefined;
    }

    return this._createBatch();
  }

  /**
   * 当前待处理的数据点数量。
   */
  get pendingCount(): number {
    return this._buffer.length;
  }

  /**
   * 重置批处理器状态（清空待处理队列和窗口计时）。
   */
  reset(): void {
    this._buffer = [];
    this._windowStart = 0;
  }

  /**
   * 创建批次并清空缓冲区，重置窗口计时。
   * @returns 创建的批次
   */
  private _createBatch(): TelemetryBatch {
    const batch: TelemetryBatch = {
      id: randomUUID(),
      entries: [...this._buffer],
      createdAt: Date.now(),
      size: this._buffer.length,
    };

    this._buffer = [];
    this._windowStart = 0;
    return batch;
  }
}
