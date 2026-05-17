/**
 * commands/config.ts — `cortex config` 配置管理命令
 *
 * 管理系统配置——环境变量、配置文件、运行参数。
 * 直接对接 ConfigManager 服务。
 *
 * @see CLI 设计文档 §4.7
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import { ConfigManager } from "../services/config-manager.js";
import * as path from "node:path";
import * as os from "node:os";

export function createConfigHandler(configManager: ConfigManager): CommandHandler {
  return async (args, options, context): Promise<CommandResult> => {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      return {
        success: true,
        output: [
          "用法: cortex config <子命令> [选项]",
          "",
          "子命令:",
          "  list                 列出配置项",
          "  get <key>            获取配置值",
          "  set <key> <val>      设置配置值",
          "  init                 初始化配置文件",
          "  validate             校验配置正确性",
          "",
          "选项:",
          "  --prefix <p>         按前缀过滤（如 engine., llm.）",
          "  --format <fmt>       输出格式",
          "  --global             写入全局配置",
          "  --local              写入本地配置",
          "  --force, -f          覆盖已有配置",
          "  --strict             严格模式",
        ].join("\n"),
        exitCode: 0,
      };
    }

    const subcommand = args[0];

    switch (subcommand) {
      case "list":
        return handleConfigList(configManager, options, context);
      case "get":
        return handleConfigGet(configManager, args[1], context);
      case "set":
        return handleConfigSet(configManager, args[1], args.slice(2).join(" "), options, context);
      case "init":
        return handleConfigInit(options, context);
      case "validate":
        return handleConfigValidate(configManager, options, context);
      default:
        return {
          success: false,
          error: `未知子命令: "${subcommand}"。可用子命令: list, get, set, init, validate`,
          exitCode: 1,
        };
    }
  };
}

function handleConfigList(
  config: ConfigManager,
  options: Record<string, unknown>,
  context: CommandContext,
): CommandResult {
  const prefix = options["prefix"] as string | undefined;
  const all = config.getAll();

  // 扁平化配置
  const flatten = (obj: unknown, prefix = ""): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          Object.assign(result, flatten(value, fullKey));
        } else {
          result[fullKey] = value;
        }
      }
    }
    return result;
  };

  const flat = flatten(all);
  let entries = Object.entries(flat);

  if (prefix) {
    entries = entries.filter(([k]) => k.startsWith(prefix));
  }

  return {
    success: true,
    data: Object.fromEntries(entries),
    output: entries.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join("\n"),
    exitCode: 0,
  };
}

function handleConfigGet(
  config: ConfigManager,
  key: string | undefined,
  context: CommandContext,
): CommandResult {
  if (!key) {
    return { success: false, error: "请指定配置键。用法: cortex config get <key>", exitCode: 1 };
  }

  const value = config.getNested(key);
  if (value === undefined) {
    return { success: false, error: `配置项不存在: ${key}`, exitCode: 1 };
  }

  return {
    success: true,
    data: { [key]: value },
    output: `${key} = ${JSON.stringify(value)}`,
    exitCode: 0,
  };
}

function handleConfigSet(
  config: ConfigManager,
  key: string | undefined,
  value: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): CommandResult {
  if (!key || value === undefined) {
    return { success: false, error: "请指定 key 和 value。用法: cortex config set <key> <val>", exitCode: 1 };
  }

  // 尝试 JSON 解析
  let parsedValue: unknown = value;
  try { parsedValue = JSON.parse(value); } catch { /* 保持字符串 */ }

  config.set(key, parsedValue);

  return {
    success: true,
    output: `✓ ${key} = ${JSON.stringify(parsedValue)}`,
    data: { [key]: parsedValue },
    exitCode: 0,
  };
}

function handleConfigInit(
  options: Record<string, unknown>,
  context: CommandContext,
): CommandResult {
  const global_ = options["global"] as boolean;
  const force = options["force"] || options["f"];

  const configPath = global_
    ? path.join(os.homedir(), ".cortex", "config")
    : path.join(process.cwd(), ".cortex", "config");

  // 使用 ConfigManager 初始化
  const mgr = new ConfigManager();
  const created = mgr.initConfig(configPath, !!force);

  if (created) {
    return { success: true, output: `✓ 配置文件已创建: ${configPath}`, exitCode: 0 };
  }
  return {
    success: true,
    output: `⚠️ 配置文件已存在: ${configPath}（使用 --force 覆盖）`,
    exitCode: 0,
  };
}

function handleConfigValidate(
  config: ConfigManager,
  options: Record<string, unknown>,
  context: CommandContext,
): CommandResult {
  const strict = options["strict"] as boolean;
  const errors = config.validate(strict);

  if (errors.length === 0) {
    return { success: true, output: "✓ 配置校验通过", exitCode: 0 };
  }

  return {
    success: false,
    output: `配置校验失败 (${errors.length} 项):\n${errors.map((e) => `  ✗ ${e}`).join("\n")}`,
    data: { errors },
    exitCode: 3,
  };
}
