/**
 * utils.ts — CLI 工具函数
 *
 * 从 main.ts 抽离的参数解析、格式检测等纯函数。
 *
 * @module utils
 */

import fs from "node:fs";
import path from "node:path";

import { detectDefaultFormat, getFormatter } from "./formatters/index.js";
import type { OutputFormat, CommandContext, CommandResult } from "./types.js";
import { convert, convertToDocument } from "@cortex/parser";

/** 解析全局 --format / -f 选项 */
export function parseGlobalFormat(argv: string[]): OutputFormat {
  for (const arg of argv) {
    if (arg.startsWith("--format=")) {
      const fmt = arg.slice(9) as OutputFormat;
      if (fmt === "text" || fmt === "json" || fmt === "color") return fmt;
    }
  }
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--format" || argv[i] === "-f") && i + 1 < argv.length) {
      const fmt = argv[i + 1] as OutputFormat;
      if (fmt === "text" || fmt === "json" || fmt === "color") return fmt;
    }
  }
  return detectDefaultFormat();
}

/** 创建默认 CommandContext */
export function createDefaultContext(projectRoot: string): CommandContext {
  return {
    format: detectDefaultFormat(),
    quiet: false,
    verbose: false,
    rawOptions: {},
    projectRoot,
  };
}

/** 输出 CommandResult */
export function outputResult(result: CommandResult, format: OutputFormat): void {
  const fmt = getFormatter(format);
  if (result.success) {
    console.error(fmt.formatSuccess(result));
  } else {
    console.error(fmt.formatError(result));
  }
}

/**
 * 从 argv 中剥离全局选项（--quiet/-q, --verbose/-v, --format/-f, --dir/-d），
 * 返回纯命令参数数组。
 */
export function stripGlobalOptions(argv: string[]): string[] {
  const cleanArgs: string[] = [];
  let skipNext = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (skipNext) { skipNext = false; continue; }
    if (["--quiet", "-q", "--verbose", "-v", "--no-color"].includes(a)) continue;
    if (a.startsWith("--format=") || a === "--format" || a === "-f") {
      if (a === "--format" || a === "-f") skipNext = true;
      continue;
    }
    if (a.startsWith("--dir=")) continue;
    if (a === "--dir" || a === "-d") { skipNext = true; continue; }
    cleanArgs.push(a);
  }
  return cleanArgs;
}

/** 检查当前进程是否为直接运行（非 import） */
export function isDirectRun(): boolean {
  return (process.argv[1]?.replaceAll("\\", "/").endsWith("/src/main.ts")
    || process.argv[1]?.replaceAll("\\", "/").endsWith("/src/main.js")
    || process.argv[1]?.replaceAll("\\", "/").endsWith("/dist/main.js")) ?? false;
}

/** 统一帮助请求检测：空参 或 --help/-h */
export function isHelpRequest(args: string[]): boolean {
  return args.length === 0 || args[0] === "--help" || args[0] === "-h";
}

/** Markdown→HTML 统一转换——消除 run/doc 双写 */
export function convertMarkdown(opts: {
  content: string;
  title?: string;
  documentMode?: boolean;
  outputPath?: string;
}): CommandResult {
  const html = opts.documentMode
    ? convertToDocument(opts.content, opts.title)
    : convert(opts.content);

  if (opts.outputPath) {
    const outPath = path.resolve(opts.outputPath);
    fs.writeFileSync(outPath, html, "utf-8");
    return { success: true, output: `✓ 转换完成: ${path.basename(outPath)}`, data: { outputPath: opts.outputPath, size: html.length }, exitCode: 0 };
  }
  return { success: true, output: html, data: { html, size: html.length }, exitCode: 0 };
}
