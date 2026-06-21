import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import { type IFileLockManager } from "@cortex/shared";
export declare class FileLockManagerPlugin implements EnginePlugin {
    readonly name = "fileLockManager";
    readonly dependencies: string[];
    private instance;
    init(ctx: PluginContext): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    health(): PluginHealth;
    getInstance(): IFileLockManager;
}
//# sourceMappingURL=file-lock-manager.plugin.d.ts.map