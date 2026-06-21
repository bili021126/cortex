import type { Agent, SafeErrorReporter, MemoryEntry, ReadMode } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "@cortex/platform";
import type { MemoryStore } from "@cortex/memory-store";
import type { AgentPool } from "@cortex/scheduler";
import type { EngineConfig } from "@cortex/config";
/**
 * 创建 InspectorAgent——编译事实前置采集的侦察骑士。
 * 返回符合 Agent 接口的对象，附加 setWorkspaceRoot 扩展方法。
 */
export declare function createInspectorAgent(llm: LlmAdapter, toolkit: Toolkit, memory?: MemoryStore, engineConfig?: EngineConfig, systemPrompt?: string, filterRead?: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[]): Agent & {
    setPool(pool: AgentPool, instanceId: string): void;
    setSafeReporter(reporter: SafeErrorReporter): void;
    setWorkspaceRoot(root: string): void;
};
//# sourceMappingURL=inspector-agent.d.ts.map