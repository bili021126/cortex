// ============================================================
// @cortex/telemetry —— Sampler 策略接口与实现
//
// 提供 Sampler 策略接口及两种内置采样策略：
// - RateSampler：按固定比例采样
// - ThresholdSampler：按数值阈值采样
// ============================================================

import type { Sampler, SamplerDecision, TelemetryData } from "./types.js";

// ─── RateSampler ──────────────────────────────────

/**
 * 按比例采样器。
 *
 * 以固定比例（rate）随机决定是否采集数据点。
 * rate = 1.0 表示全量采集，rate = 0.0 表示全部丢弃。
 * rate = 0.1 表示大约 10% 的数据点被采集。
 *
 * 使用确定性哈希代替纯随机，确保相同 ID 的数据点
 * 在不同运行时得到一致的采样决策（便于调试）。
 *
 * @example
 * ```typescript
 * const sampler = new RateSampler(0.1);
 * const decision = sampler.decide(data);
 * // decision.accept === true -> collect
 * ```
 */
export class RateSampler implements Sampler {
  readonly name: string;
  private readonly _rate: number;

  /**
   * @param rate - 采样比例（0.0 ~ 1.0）
   * @param name - 采样器名称（默认 "rate"）
   * @throws 如果 rate 不在 [0, 1] 范围内
   */
  constructor(rate: number, name = "rate") {
    if (rate < 0 || rate > 1) {
      throw new Error(`RateSampler: rate must be between 0 and 1, got ${rate}`);
    }

    this._rate = rate;
    this.name = name;
  }

  /**
   * 判断是否应采集给定的数据点。
   * 使用基于 ID 的确定性哈希，保证相同 ID 结果一致。
   *
   * @param data - 遥测数据点
   * @returns 采样决策
   */
  decide(data: TelemetryData): SamplerDecision {
    if (this._rate === 0) {
      return { accept: false, reason: "RateSampler: rate=0, all data dropped" };
    }

    if (this._rate === 1) {
      return { accept: true, reason: "RateSampler: rate=1, all data accepted" };
    }

    // 确定性哈希采样：用 data.id 的哈希值决定是否采集
    const hash = this._hashString(data.id);
    const normalized = (hash % 10_000) / 10_000;

    if (normalized < this._rate) {
      return { accept: true, reason: `RateSampler: rate=${this._rate}, hash=${normalized}` };
    }

    return { accept: false, reason: `RateSampler: rate=${this._rate}, hash=${normalized}` };
  }

  /**
   * 简单字符串哈希（djb2 算法）。
   * 保证同一字符串始终产生相同哈希值。
   *
   * @param str - 输入字符串
   * @returns 哈希值
   */
  private _hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      // eslint-disable-next-line no-bitwise
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      // eslint-disable-next-line no-bitwise
      hash = hash & hash; // Convert to 32-bit integer
    }
    // eslint-disable-next-line no-bitwise
    return Math.abs(hash);
  }
}

// ─── ThresholdSampler ─────────────────────────────

/**
 * 阈值采样器。
 *
 * 根据数据点的数值是否超过阈值决定是否采集。
 * 支持大于模式（value > threshold 时采集）和小于模式（value < threshold 时采集）。
 *
 * @example
 * ```typescript
 * // 只采集耗时超过 1000ms 的 LLM 调用
 * const sampler = new ThresholdSampler(1000, "gt");
 * const decision = sampler.decide(data);
 * ```
 */
export class ThresholdSampler implements Sampler {
  readonly name: string;
  private readonly _threshold: number;
  private readonly _mode: "gt" | "lt";

  /**
   * @param threshold - 阈值
   * @param mode - 比较模式："gt" = value > threshold 时采集, "lt" = value < threshold 时采集
   * @param name - 采样器名称（默认 "threshold"）
   */
  constructor(threshold: number, mode: "gt" | "lt" = "gt", name = "threshold") {
    this._threshold = threshold;
    this._mode = mode;
    this.name = name;
  }

  /**
   * 判断是否应采集给定的数据点。
   * @param data - 遥测数据点
   * @returns 采样决策
   */
  decide(data: TelemetryData): SamplerDecision {
    if (this._mode === "gt") {
      if (data.value > this._threshold) {
        return {
          accept: true,
          reason: `ThresholdSampler: ${data.value} > ${this._threshold} (mode=${this._mode})`,
        };
      }
      return {
        accept: false,
        reason: `ThresholdSampler: ${data.value} <= ${this._threshold} (mode=${this._mode})`,
      };
    }

    // mode === "lt"
    if (data.value < this._threshold) {
      return {
        accept: true,
        reason: `ThresholdSampler: ${data.value} < ${this._threshold} (mode=${this._mode})`,
      };
    }

    return {
      accept: false,
      reason: `ThresholdSampler: ${data.value} >= ${this._threshold} (mode=${this._mode})`,
    };
  }
}
