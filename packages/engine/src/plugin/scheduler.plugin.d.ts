import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import type { Agent } from "@cortex/shared";
import { Scheduler } from "../core/scheduler.js";
import { ButlerAgent } from "../agents/butler-agent.js";
export declare class SchedulerPlugin implements EnginePlugin {
    readonly name = "scheduler";
    readonly dependencies: string[];
    private instance;
    private _agents;
    private _butler?;
    init(ctx: PluginContext): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    health(): PluginHealth;
    getInstance(): Scheduler;
    getAgents(): Map<string, Agent>;
    getButler(): ButlerAgent | undefined;
    /**
     * 注册全部 Agent——由 PluginLoader 在全部插件 init 后调用。
     * 等同于原 bootstrap 中的 registerAgents() 逻辑。
     */
    registerAllAgents(ctx: PluginContext): Promise<Map<string, Agent>>;
}
//# sourceMappingURL=scheduler.plugin.d.ts.map