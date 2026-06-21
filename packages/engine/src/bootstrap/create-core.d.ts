import { CLIAdapter, type Toolkit } from "@cortex/platform";
import { Scheduler } from "../core/scheduler.js";
import { TaskBoard, AgentPool, PipelineObserver, ConfirmGate } from "@cortex/scheduler";
import { MetaAgent } from "../core/meta-agent.js";
import { StrategistAgent } from "../agents/strategist-agent.js";
import type { LlmAdapter } from "@cortex/llm";
import type { BootstrapResult } from "./factory/index.js";
import type { EngineConfig } from "@cortex/config";
export interface EngineCoreComponents {
    observer: PipelineObserver;
    pool: AgentPool;
    gate: ConfirmGate;
    cliAdapter: CLIAdapter;
    board: TaskBoard;
}
export interface SpecialAgents {
    metaAgent: MetaAgent;
    strategists: Map<string, StrategistAgent>;
}
export declare function createEngineCore(toolkit: Toolkit): EngineCoreComponents;
export declare function createSpecialAgents(config: BootstrapResult, llms: Map<string, LlmAdapter>, codingStandards: string, observer?: PipelineObserver, workspaceRoot?: string): Promise<SpecialAgents>;
export declare function configAndInject(config: BootstrapResult, toolkit: Toolkit): void;
export declare function createScheduler(board: TaskBoard, pool: AgentPool, observer: PipelineObserver, metaAgent: MetaAgent, engineConfig?: EngineConfig): Scheduler;
//# sourceMappingURL=create-core.d.ts.map