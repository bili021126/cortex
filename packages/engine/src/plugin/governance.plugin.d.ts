import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
export declare class GovernancePlugin implements EnginePlugin {
    readonly name = "governance";
    readonly dependencies: string[];
    init(_ctx: PluginContext): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    health(): PluginHealth;
    /** 运行修宪治理循环 */
    runGovernanceCycle(projectRoot: string): void;
}
//# sourceMappingURL=governance.plugin.d.ts.map