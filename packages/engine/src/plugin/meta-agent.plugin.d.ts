import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import { MetaAgent } from "../core/meta-agent.js";
export declare class MetaAgentPlugin implements EnginePlugin {
    readonly name = "metaAgent";
    readonly dependencies: string[];
    private instance;
    init(ctx: PluginContext): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    health(): PluginHealth;
    getInstance(): MetaAgent;
}
//# sourceMappingURL=meta-agent.plugin.d.ts.map