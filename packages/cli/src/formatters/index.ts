/**
 * formatters/index.ts — 输出格式器注册表
 *
 * 提供三种输出格式的统一接口：纯文本（text）、JSON（json）、彩色（color）。
 * 按 CLI 设计文档 §6 输出格式实现。
 */

import type { OutputFormat, CommandResult } from "../types.js";
import { TextFormatter } from "./text-formatter.js";
import { JsonFormatter } from "./json-formatter.js";
import { ColorFormatter } from "./color-formatter.js";

export interface Formatter {
  /** 格式化成功输出 */
  formatSuccess(result: CommandResult): string;
  /** 格式化错误输出 */
  formatError(result: CommandResult): string;
  /** 格式化信息输出（notify/status） */
  formatInfo(message: string): string;
  /** 格式化表格输出 */
  formatTable(headers: string[], rows: string[][]): string;
  /** 格式化标题 */
  formatHeading(text: string): string;
}

const formatters: Record<OutputFormat, Formatter> = {
  text: new TextFormatter(),
  json: new JsonFormatter(),
  color: new ColorFormatter(),
};

export function getFormatter(format: OutputFormat): Formatter {
  return formatters[format];
}

export function detectDefaultFormat(): OutputFormat {
  // 自动检测：TTY 终端用彩色，否则纯文本（管道友好）
  if (process.stdout.isTTY) {
    return "color";
  }
  return "text";
}
