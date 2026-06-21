import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import { TaskBoard } from "@cortex/scheduler";
export declare class TaskBoardPlugin implements EnginePlugin {
    readonly name = "taskBoard";
    readonly dependencies: string[];
    private instance;
    init(ctx: PluginContext): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    health(): PluginHealth;
    getInstance(): TaskBoard;
}
//# sourceMappingURL=task-board.plugin.d.ts.map