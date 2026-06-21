import { type Agent, type SafeErrorReporter, type MemoryEntry, type ReadMode } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "@cortex/platform";
import type { MemoryStore } from "@cortex/memory-store";
import type { AgentPool } from "@cortex/scheduler";
import { type BrowserActionDef } from "./browser-actions.js";
/**
 * 创建 BrowserAgent——Playwright UI 验证专家。
 * 返回符合 Agent 接口的对象，附加 setWorkspaceRoot + browser_do 支持。
 */
export declare function createBrowserAgent(llm: LlmAdapter, toolkit: Toolkit, memory?: MemoryStore, systemPrompt?: string, filterRead?: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[], actions?: BrowserActionDef[]): Agent & {
    setPool(pool: AgentPool, instanceId: string): void;
    setSafeReporter(reporter: SafeErrorReporter): void;
    setWorkspaceRoot(root: string): void;
    wakeup(): Promise<void>;
    shutdown(): Promise<void>;
};
//# sourceMappingURL=browser-agent.d.ts.map