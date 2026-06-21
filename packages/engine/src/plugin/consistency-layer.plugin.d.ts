import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import type { MemoryEntry, ReadMode } from "@cortex/shared";
import { ConsistencyLayer } from "@cortex/consistency";
export declare class ConsistencyLayerPlugin implements EnginePlugin {
    readonly name = "consistencyLayer";
    readonly dependencies: string[];
    private instance;
    private _filterRead;
    init(ctx: PluginContext): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    health(): PluginHealth;
    getInstance(): ConsistencyLayer;
    getFilterRead(): (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[];
}
//# sourceMappingURL=consistency-layer.plugin.d.ts.map