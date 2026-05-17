/**
 * commands/help.ts — `cortex help` 帮助信息命令
 *
 * 显示命令总览或特定命令的详细帮助。
 *
 * @see CLI 设计文档 §4.16
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import type { CommandRegistry } from "./index.js";

export function createHelpHandler(registry: CommandRegistry): CommandHandler {
  return async (args, options, context): Promise<CommandResult> => {
    // 如果指定了命令名，显示该命令的帮助
    const cmdName = args[0];
    if (cmdName) {
      const cmd = registry.find(cmdName);
      if (cmd) {
        // 委托给命令自身的 handler（通过 --help 选项）
        const helpResult = await cmd.handler(["--help"], {}, { ...context });
        return helpResult;
      }
      return {
        success: false,
        error: `没有 "${cmdName}" 的帮助信息。输入 'cortex help' 查看全部命令。`,
        exitCode: 1,
      };
    }

    // 总览
    const commands = registry.getCommandNames().sort();
    const aliases = registry.getAliases();

    const cmdList = commands.map((name) => {
      const alias = [...aliases.entries()].find(([, v]) => v === name)?.[0];
      const aliasStr = alias ? ` (别名: ${alias})` : "";
      return `  ${name.padEnd(14)}${aliasStr}`;
    });

    return {
      success: true,
      output: [
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
      ].join("\n"),
      exitCode: 0,
    };
  };
}
