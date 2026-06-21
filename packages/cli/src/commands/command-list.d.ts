/**
 * commands/command-list.ts — CLI 命令注册表定义
 *
 * 从 main.ts 抽离的命令列表与注册逻辑。
 * 所有命令的 name/alias/description 在此集中定义。
 *
 * @module commands/command-list
 */
import type { CommandRegistry } from "./index.js";
import type { EngineBridge } from "../services/engine-bridge.js";
import type { ConfigManager } from "../services/config-manager.js";
import type { DocRegistry } from "@cortex/governance";
/** 命令定义（不含 handler——由工厂延迟创建避免循环依赖） */
interface CommandDef {
    name: string;
    alias: string;
    description: string;
}
/** 全部 CLI 命令的定义列表 */
export declare const COMMAND_DEFS: readonly CommandDef[];
/** registerCommands 的聚合服务对象 */
interface RegisterCtx {
    engineBridge: EngineBridge;
    configManager: ConfigManager;
    docRegistry: DocRegistry;
}
/**
 * 注册所有命令到 CommandRegistry。
 *
 * 命令描述来自 COMMAND_DEFS，handler 通过工厂延迟创建。
 */
export declare function registerCommands(registry: CommandRegistry, ctx: RegisterCtx): void;
export {};
//# sourceMappingURL=command-list.d.ts.map