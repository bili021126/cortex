// ============================================================
// @cortex/telemetry —— ConsoleCollector
//
// 将遥测数据点输出到控制台（stdout）的 Collector 实现。
// 支持 JSON 和可读文本两种格式。
// 主要用于开发调试场景，生产环境建议使用 FileCollector。
// ============================================================

import type { ITelemetryCollector, TelemetryData, CollectResult } from "./types.js";

// ─── ConsoleCollector ───────────────────────────────

/**
 * ConsoleCollector 配置选项。
 */
export interface ConsoleCollectorOptions {
  /** 输出格式（默认 "pretty"） */
  readonly format?: "json" | "pretty";
  /** 是否在每条输出后追加换行（默认 true） */
  readonly trailingNewline?: boolean;
}

/**
 * 控制台遥测采集器。
 *
 * 接收 TelemetryData 并通过 console.log 输出到 stdout。
 * 支持 JSON 序列化输出（便于管道处理）和可读文本输出（便于人眼查看）。
 *
 * @example
 * ```typescript
 * const collector = new ConsoleCollector({ format: "json" });
 * await collector.collect({
 *   id: "evt-001",
 *   name: "llm.chat.duration_ms",
 *   value: 1234,
 *   tags: [{ key: "model", value: "deepseek-v4-flash" }],
 *   timestamp: Date.now(),
 * });
 * ```
 */
export class ConsoleCollector implements ITelemetryCollector {
  readonly name: string;
  private readonly _format: "json" | "pretty";
  private readonly _trailingNewline: boolean;
  private _shutdown = false;

  /**
   * @param name - 采集器名称（默认 "console"）
   * @param options - 配置选项
   */
  constructor(name = "console", options?: ConsoleCollectorOptions) {
    this.name = name;
    this._format = options?.format ?? "pretty";
    this._trailingNewline = options?.trailingNewline ?? true;
  }

  /**
   * 采集一条遥测数据点并输出到控制台。
   * @param data - 遥测数据点
   * @returns 采集结果
   */
  async collect(data: TelemetryData): Promise<CollectResult> {
    if (this._shutdown) {
      return { accepted: false, reason: "ConsoleCollector is shut down" };
    }

    const output = this._format === "json"
      ? JSON.stringify(data)
      : this._formatPretty(data);

    if (this._trailingNewline) {
      // eslint-disable-next-line no-console
      console.log(output);
    } else {
       
      process.stdout.write(output);
    }

    return { accepted: true };
  }

  /**
   * 刷新缓冲区（ConsoleCollector 为同步输出，空操作）。
   */
  async flush(): Promise<void> {
    // ConsoleCollector 是同步的，无需刷新
  }

  /**
   * 关闭采集器。
   */
  async shutdown(): Promise<void> {
    this._shutdown = true;
  }

  /**
   * 格式化遥测数据点为可读文本。
   * @param data - 遥测数据点
   * @returns 格式化后的文本
   */
  private _formatPretty(data: TelemetryData): string {
    const tagsStr = data.tags
      .map((tag) => `${tag.key}=${tag.value}`)
      .join(", ");

    const metadataStr = data.metadata
      ? ` | meta: ${JSON.stringify(data.metadata)}`
      : "";

    return `[telemetry] ${data.name} = ${data.value} (${tagsStr})${metadataStr}`;
  }
}
