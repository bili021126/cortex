import type { Agent, IFileSystemAdapter, IMemoryStore, IPipelineObserver, MemoryEntry, ReadMode } from "@cortex/shared";
import type { Scheduler } from "../core/scheduler.js";
import type { AgentPool } from "@cortex/scheduler";
import type { Toolkit } from "@cortex/platform";
import type { BootstrapResult } from "./factory/index.js";
import type { LlmAdapter } from "@cortex/llm";
import type { EngineConfig } from "@cortex/config";
export declare function registerAgents(config: BootstrapResult, options: {
    llms: Map<string, LlmAdapter>;
    toolkit: Toolkit;
    scheduler: Scheduler;
    pool: AgentPool;
    memory: IMemoryStore | undefined;
    codingStandards: string;
    workspaceRoot?: string;
    filterRead?: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[];
    engineConfig?: EngineConfig;
    fs?: IFileSystemAdapter;
    observer?: IPipelineObserver;
}): Promise<Map<string, Agent>>;
//# sourceMappingURL=register-agents.d.ts.map