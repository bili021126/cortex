import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import { TrustModel } from "@cortex/scheduler";
export declare class TrustModelPlugin implements EnginePlugin {
    readonly name = "trustModel";
    readonly dependencies: string[];
    private instance;
    init(_ctx: PluginContext): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    health(): PluginHealth;
    getInstance(): TrustModel;
}
//# sourceMappingURL=trust-model.plugin.d.ts.map