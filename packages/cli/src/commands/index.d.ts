/**
 * commands/index.ts — 命令注册表与路由
 *
 * 维护所有顶级命令及其子命令的注册映射。
 * 支持短别名解析和模糊匹配。
 *
 * @see CLI 设计文档 §3（命令体系总览）
 */
import type { CommandDefinition, CommandContext, CommandResult } from "../types.js";
export declare class CommandRegistry {
    private commands;
    private aliases;
    /** 注册一个顶级命令 */
    register(cmd: CommandDefinition): void;
    /** 批量注册命令 */
    registerAll(cmds: CommandDefinition[]): void;
    /** 根据命令名查找定义（支持别名解析） */
    find(name: string): CommandDefinition | undefined;
    /** 获取所有注册的命令名 */
    getCommandNames(): string[];
    /** 获取所有别名映射 */
    getAliases(): Map<string, string>;
    /**
     * 解析并执行命令。
     * 输入格式：["agent", "list", "--status", "awake"]
     * 返回执行结果。
     */
    dispatch(args: string[], context: CommandContext): Promise<CommandResult>;
    /** 简单选项解析器 */
    private _parseOptions;
}
//# sourceMappingURL=index.d.ts.map