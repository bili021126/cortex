import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import { AgentPool } from "@cortex/scheduler";
export declare class AgentPoolPlugin implements EnginePlugin {
    readonly name = "agentPool";
    readonly dependencies: string[];
    private instance;
    init(ctx: PluginContext): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    health(): PluginHealth;
    getInstance(): AgentPool;
}
//# sourceMappingURL=agent-pool.plugin.d.ts.map