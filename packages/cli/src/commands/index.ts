/**
 * commands/index.ts — 命令注册表与路由
 *
 * 维护所有顶级命令及其子命令的注册映射。
 * 支持短别名解析和模糊匹配。
 *
 * @see CLI 设计文档 §3（命令体系总览）
 */

import type { CommandDefinition, CommandContext, CommandResult } from "../types.js";
import type { ICommandDispatcher, ICommandContext, ICommandResult } from "@cortex/shared";

export class CommandRegistry implements ICommandDispatcher {
  private commands = new Map<string, CommandDefinition>();
  private aliases = new Map<string, string>();

  /** 注册一个顶级命令 */
  register(cmd: CommandDefinition): void {
    this.commands.set(cmd.name, cmd);
    if (cmd.alias) {
      this.aliases.set(cmd.alias, cmd.name);
    }
  }

  /** 批量注册命令 */
  registerAll(cmds: CommandDefinition[]): void {
    for (const cmd of cmds) {
      this.register(cmd);
    }
  }

  /** 根据命令名查找定义（支持别名解析） */
  find(name: string): CommandDefinition | undefined {
    const resolvedName = this.aliases.get(name) ?? name;
    return this.commands.get(resolvedName);
  }

  /** 获取所有注册的命令名 */
  getCommandNames(): string[] {
    return Array.from(this.commands.keys());
  }

  /** 获取所有别名映射 */
  getAliases(): Map<string, string> {
    return new Map(this.aliases);
  }

  /**
   * 解析并执行命令（实现 ICommandDispatcher）。
   * 输入格式：["agent", "list", "--status", "awake"]
   * 返回执行结果。
   */
  async dispatch(
    args: string[],
    context?: ICommandContext,
  ): Promise<ICommandResult> {
    if (args.length === 0) {
      return { code: 1, output: "未指定命令。输入 'cortex help' 查看可用命令。" };
    }

     
    const cmdName = args[0]!;
    const cmd = this.find(cmdName);

    if (!cmd) {
      return { code: 1, output: `未知命令: "${cmdName}"。输入 'cortex help' 查看可用命令。` };
    }

    // 解析子命令
    const subArgs = args.slice(1);
    if (cmd.subcommands && subArgs.length > 0) {
       
      const subName = subArgs[0]!;
      const sub = cmd.subcommands[subName];
      if (sub) {
        // 解析剩余参数和选项
        const { options, remaining } = this._parseOptions(subArgs.slice(1));
        const r = await sub.handler(remaining, options, context as unknown as CommandContext);
        return { code: r.exitCode, output: r.output ?? r.error ?? "" };
      }
    }

    // 解析选项并调用顶级处理器
    const { options: _parsedOptions, remaining: _parsedRemaining } = this._parseOptions(subArgs);
    const r = await cmd.handler(_parsedRemaining, _parsedOptions, context as unknown as CommandContext);
    return { code: r.exitCode, output: r.output ?? r.error ?? "" };
  }

  /** 简单选项解析器 */
  private _parseOptions(args: string[]): { options: Record<string, unknown>; remaining: string[] } {
    const options: Record<string, unknown> = {};
    const remaining: string[] = [];

    for (let i = 0; i < args.length; i++) {
       
      const arg = args[i]!;

      if (arg.startsWith("--")) {
        const eqIdx = arg.indexOf("=");
        if (eqIdx !== -1) {
          // --key=value
          options[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
        } else {
          const key = arg.slice(2);
          if (i + 1 < args.length && !args[i + 1]?.startsWith("-")) {
            options[key] = args[++i];
          } else {
            options[key] = true;
          }
        }
      } else if (arg.startsWith("-") && arg.length === 2) {
        // 短选项 -k
        const key = arg.slice(1);
        if (i + 1 < args.length && !args[i + 1]?.startsWith("-")) {
          options[key] = args[++i];
        } else {
          options[key] = true;
        }
      } else {
        remaining.push(arg);
      }
    }

    return { options, remaining };
  }
}
