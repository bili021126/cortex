/**
 * json-formatter.ts — JSON 输出格式器
 *
 * 设计原则：严格 JSON 格式，包含 status / data / meta 三层结构。
 * 适合 jq 管道消费。
 *
 * @see CLI 设计文档 §6.3
 */

import type { Formatter } from "./index.js";
import type { CommandResult } from "../types.js";

export class JsonFormatter implements Formatter {
  private _buildMeta(): Record<string, unknown> {
    return {
      version: "0.2.0",
      timestamp: new Date().toISOString(),
      duration_ms: 0,
    };
  }

  formatSuccess(result: CommandResult): string {
    const output = {
      status: "ok",
      data: result.data ?? result.output ?? null,
      meta: this._buildMeta(),
    };
    return JSON.stringify(output, null, 2);
  }

  formatError(result: CommandResult): string {
    const output = {
      status: "error",
      error: {
        code: result.exitCode === 1 ? "ERR_GENERAL"
          : result.exitCode === 2 ? "ERR_EXECUTION"
          : result.exitCode === 3 ? "ERR_CONFIG"
          : result.exitCode === 4 ? "ERR_TIMEOUT"
          : "ERR_UNKNOWN",
        message: result.error ?? "未知错误",
        details: result.data ?? undefined,
      },
      meta: this._buildMeta(),
    };
    return JSON.stringify(output, null, 2);
  }

  formatInfo(message: string): string {
    return JSON.stringify({ status: "info", message, meta: this._buildMeta() });
  }

  formatTable(headers: string[], rows: string[][]): string {
    const data = rows.map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = r[i] ?? ""; });
      return obj;
    });
    return JSON.stringify({ status: "ok", data, meta: this._buildMeta() }, null, 2);
  }

  formatHeading(text: string): string {
    return JSON.stringify({ status: "heading", text, meta: this._buildMeta() });
  }
}
