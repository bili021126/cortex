// ============================================================
// @cortex/telemetry —— FileCollector
//
// 将遥测数据点写入 JSON Lines 文件的 Collector 实现。
// 每条数据点一行 JSON，便于日志收集工具（Filebeat、Logstash 等）消费。
// ============================================================

import { writeFile, appendFile, mkdir } from "fs/promises";
import { dirname } from "path";

import type { ITelemetryCollector, TelemetryData, CollectResult } from "./types.js";

// ─── FileCollector ─────────────────────────────────

/**
 * FileCollector 配置选项。
 */
export interface FileCollectorOptions {
  /** 写入模式（默认 "append"） */
  readonly mode?: "append" | "overwrite";
  /** 每条数据点是否追加换行（默认 true） */
  readonly trailingNewline?: boolean;
}

/**
 * 文件遥测采集器。
 *
 * 接收 TelemetryData 并将其以 JSON Lines 格式写入指定文件。
 * 支持追加模式（默认，每次 flush 追加到文件末尾）和覆盖模式（每次 flush 从头写入）。
 *
 * 如果输出文件的父目录不存在，会自动创建。
 *
 * @example
 * ```typescript
 * const collector = new FileCollector("./telemetry/metrics.jsonl");
 * await collector.collect({
 *   id: "evt-001",
 *   name: "tool.execute.count",
 *   value: 1,
 *   tags: [{ key: "tool", value: "read_file" }],
 *   timestamp: Date.now(),
 * });
 * await collector.flush();
 * await collector.shutdown();
 * ```
 */
export class FileCollector implements ITelemetryCollector {
  readonly name: string;
  private readonly _filePath: string;
  private readonly _mode: "append" | "overwrite";
  private readonly _trailingNewline: boolean;
  private _shutdown = false;
  private _buffer: TelemetryData[] = [];

  /**
   * @param filePath - 输出文件路径
   * @param name - 采集器名称（默认 "file"）
   * @param options - 配置选项
   */
  constructor(
    filePath: string,
    name = "file",
    options?: FileCollectorOptions,
  ) {
    this._filePath = filePath;
    this.name = name;
    this._mode = options?.mode ?? "append";
    this._trailingNewline = options?.trailingNewline ?? true;
  }

  /**
   * 采集一条遥测数据点。
   * 数据先写入内部缓冲区，由 flush() 统一写入文件。
   *
   * @param data - 遥测数据点
   * @returns 采集结果
   */
  async collect(data: TelemetryData): Promise<CollectResult> {
    if (this._shutdown) {
      return { accepted: false, reason: "FileCollector is shut down" };
    }

    this._buffer.push(data);
    return { accepted: true };
  }

  /**
   * 刷新缓冲区，将缓冲区内所有数据点写入文件。
   * 使用 "overwrite" 模式时每次从头写入；
   * 使用 "append" 模式时追加到文件末尾。
   */
  async flush(): Promise<void> {
    if (this._buffer.length === 0) {
      return;
    }

    const entries = this._serializeBatch(this._buffer);

    // 确保父目录存在
    await mkdir(dirname(this._filePath), { recursive: true });

    // @fix P1-2 — 仅在写入成功后清空缓冲区，防止 flush 失败时数据丢失或重复
    try {
      if (this._mode === "overwrite") {
        await writeFile(this._filePath, entries, { encoding: "utf-8" });
      } else {
        await appendFile(this._filePath, entries, { encoding: "utf-8" });
      }
      this._buffer = [];
    } catch (e) {
      // 写入失败时保留缓冲区数据，上层可选择重试或丢弃
      throw e;
    }
  }

  /**
   * 关闭采集器。先执行最后一次 flush，然后标记已关闭。
   */
  async shutdown(): Promise<void> {
    await this.flush();
    this._shutdown = true;
  }

  /**
   * 将缓冲区内数据点序列化为 JSON Lines 字符串。
   * @param buffer - 缓冲区数据
   * @returns JSON Lines 字符串
   */
  private _serializeBatch(buffer: TelemetryData[]): string {
    const lines = buffer
      .map((data) => JSON.stringify(data));

    return this._trailingNewline
      ? lines.join("\n") + "\n"
      : lines.join("\n");
  }
}
