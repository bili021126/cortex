import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import { PipelineObserver } from "@cortex/scheduler";
export declare class PipelineObserverPlugin implements EnginePlugin {
    readonly name = "pipelineObserver";
    readonly dependencies: string[];
    private instance;
    init(_ctx: PluginContext): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    health(): PluginHealth;
    /** 获取 PipelineObserver 实例（供其他插件通过 ctx.get() 使用） */
    getInstance(): PipelineObserver;
}
//# sourceMappingURL=pipeline-observer.plugin.d.ts.map