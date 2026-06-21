import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import { MemoryStore } from "@cortex/memory-store";
export declare class MemoryStorePlugin implements EnginePlugin {
    readonly name = "memoryStore";
    readonly dependencies: string[];
    private instance;
    init(ctx: PluginContext): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    health(): PluginHealth;
    getInstance(): MemoryStore;
}
//# sourceMappingURL=memory-store.plugin.d.ts.map