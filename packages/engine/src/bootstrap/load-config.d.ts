import { type AgentDefinition, type BootstrapResult } from "./factory/index.js";
import { type MemoryQuery, type TaskNode } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
export declare function resolveCodingStandards(projectRoot: string): string;
export declare function injectStandards(systemPrompt: string | undefined, standards: string): string;
export declare function resolveLlm(llms: Map<string, LlmAdapter>, key?: string): LlmAdapter;
type MemoryQueryFn = (node: TaskNode) => MemoryQuery;
export declare const MEMORY_QUERY_REGISTRY: Map<string, MemoryQueryFn>;
export declare function injectRegistryFromConfig(definitions: AgentDefinition[]): void;
export declare function loadConfig(projectRoot: string): BootstrapResult;
export {};
//# sourceMappingURL=load-config.d.ts.map