/**
 * index.ts — @cortex/cli 公开 API
 *
 * 导出 Cortex CLI 的统一前端 API。
 * 保留向后兼容的文档转换功能。
 */

// ── 文档转换（向后兼容） ────────────────────────────
export { convert, convertToDocument } from "@cortex/parser";

// ── CLI 入口 ───────────────────────────────────────
export { main as runCli } from "./main.js";
export type { CommandContext, CommandResult, OutputFormat } from "./types.js";

// ── 命令注册 ───────────────────────────────────────
export { CommandRegistry } from "./commands/index.js";
export type { CommandDefinition, CommandHandler } from "./types.js";

// ── 服务 ───────────────────────────────────────────
export { ConfigManager } from "./services/config-manager.js";
export type { CliConfig } from "./services/config-manager.js";
export { EngineBridge } from "./services/engine-bridge.js";

// ── 格式器 ─────────────────────────────────────────
export { getFormatter, detectDefaultFormat } from "./formatters/index.js";
export type { Formatter } from "./formatters/index.js";

// ── Platform ───────────────────────────────────────
export { getPlatformBridge, closePlatformBridge } from "./platform.js";
