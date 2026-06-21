import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import { ConfirmGate } from "@cortex/scheduler";
import { CLIAdapter } from "@cortex/platform";
export declare class ConfirmGatePlugin implements EnginePlugin {
    readonly name = "confirmGate";
    readonly dependencies: string[];
    private instance;
    private cliAdapter;
    init(ctx: PluginContext): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    health(): PluginHealth;
    getInstance(): ConfirmGate;
    getCliAdapter(): CLIAdapter;
}
//# sourceMappingURL=confirm-gate.plugin.d.ts.map