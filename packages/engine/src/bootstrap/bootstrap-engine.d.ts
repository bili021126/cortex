import { resolveLlm } from "./load-config.js";
import "../plugin/register-all.js";
import type { Toolkit } from "@cortex/platform";
import type { LlmAdapter } from "@cortex/llm";
import { type IFileSystemAdapter, type IMemoryStore, type MemoryEntry, type ReadMode } from "@cortex/shared";
import { type EngineConfig } from "@cortex/config";
import type { BootstrapEngineResult } from "./assemble.js";
export type { BootstrapEngineResult };
export interface BootstrapEngineOptions {
    llms: Map<string, LlmAdapter>;
    toolkit: Toolkit;
    memory?: IMemoryStore;
    dbPath?: string;
    engineConfig?: EngineConfig;
    workspaceRoot?: string;
    filterRead?: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[];
    fs?: IFileSystemAdapter;
}
export { resolveLlm };
/**
 * bootstrapEngine —— 从配置文件到运行时引擎的完整启动流水线（v3.0 插件化）。
 *
 * 不再硬编码装配顺序，而是：
 *   1. 加载工厂配置（Agent 定义等）
 *   2. 注册全部插件到 PluginLoader
 *   3. PluginLoader.load() 按拓扑排序加载 → init → postInit → start
 *   4. 取出各插件实例组装 BootstrapEngineResult
 */
export declare function bootstrapEngine(projectRoot: string, options: BootstrapEngineOptions): Promise<BootstrapEngineResult>;
//# sourceMappingURL=bootstrap-engine.d.ts.map