/**
 * commands/help.ts — `cortex help` 帮助信息命令
 *
 * 显示命令总览或特定命令的详细帮助。
 *
 * @see CLI 设计文档 §4.16
 */

import type { CommandHandler, CommandResult } from "../types.js";
import type { CommandRegistry } from "./index.js";

/** 构建命令名列表字符串——将命令名+别名映射为格式化行 */
function _buildCommandList(commands: string[], aliases: Map<string, string>): string[] {
  return commands.map((name) => {
    const alias = [...aliases.entries()].find(([, v]) => v === name)?.[0];
    const aliasStr = alias ? ` (别名: ${alias})` : "";
    return `  ${name.padEnd(14)}${aliasStr}`;
  });
}

/** 帮助页尾部静态行——全局选项、交互模式、示例 */
const HELP_FOOTER = [
  "",
  "全局选项:",
  "  --format, -f  输出格式 (text | json | color)",
  "  --quiet, -q   静默模式",
  "  --verbose, -v 详细模式",
  "  --help, -h    显示帮助",
  "  --config      配置文件路径",
  "  --timeout     命令超时秒数",
  "",
  "交互模式:",
  "  cortex repl             进入 REPL 交互模式",
  "  cortex daemon start     启动守护进程 (Core-2)",
  "",
  "示例:",
  "  cortex run README.md -o README.html",
  "  cortex agent list --status awake",
  "  cortex memory search '重构计划' --limit 5",
  "  cortex doc check README.md --rules links,headings",
  "  cortex version",
];

/** 总览帮助文本模板 */
function _buildOverview(commands: string[], aliases: Map<string, string>): string {
  const cmdList = _buildCommandList(commands, aliases);
  return [
    "Cortex CLI — 统一命令行前端",
    "",
    "版本: 0.2.0 (Core-1)",
    "",
    "用法:",
    "  cortex <命令> [子命令] [选项]",
    "  echo <content> | cortex <命令>",
    "  cortex help <命令>",
    "",
    "顶级命令:",
    ...cmdList,
    ...HELP_FOOTER,
  ].join("\n");
}

/** 构建单个命令的帮助文本 */
function _buildCommandHelp(cmd: { name: string; alias?: string; description: string; subcommands?: Record<string, { description: string; usage?: string }> }): string {
  const lines: string[] = ["", `命令: cortex ${cmd.name}`];
  if (cmd.alias) lines.push(`别名: ${cmd.alias}`);
  lines.push(`描述: ${cmd.description}`);
  if (cmd.subcommands && Object.keys(cmd.subcommands).length > 0) {
    lines.push("", "子命令:");
    for (const [subName, sub] of Object.entries(cmd.subcommands)) {
      lines.push(`  ${subName.padEnd(12)} ${sub.description}`);
      if (sub.usage) lines.push(`    用法: ${sub.usage}`);
    }
  }
  return lines.join("\n");
}

export function createHelpHandler(registry: CommandRegistry): CommandHandler {
  const handler: CommandHandler = async (args, _options, _context): Promise<CommandResult> => {
    const cmdName = args[0];
    if (cmdName) {
      const cmd = registry.find(cmdName);
      if (cmd) return { success: true, output: _buildCommandHelp(cmd), exitCode: 0 };
      return { success: false, error: `没有 "${cmdName}" 的帮助信息。输入 'cortex help' 查看全部命令。`, exitCode: 1 };
    }
    const commands = registry.getCommandNames().sort();
    const aliases = registry.getAliases();
    return { success: true, output: _buildOverview(commands, aliases), exitCode: 0 };
  };
  return handler;
}
