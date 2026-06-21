import { ConsistencyLayer } from "@cortex/consistency";
import type { PipelineObserver } from "@cortex/scheduler";
import type { IFileSystemAdapter, IMemoryStore, MemoryEntry, ReadMode } from "@cortex/shared";
/** ConsistencyLayer 初始化结果——含 filterRead 回传 */
export interface ConsistencyLayerResult {
    layer: ConsistencyLayer;
    /** IntentFactWall 过滤回调，需注入到 options.filterRead */
    filterRead: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[];
}
export declare function initMemoryStore(observer: PipelineObserver, memory?: IMemoryStore, dbPath?: string): Promise<IMemoryStore | undefined>;
export declare function initConsistencyLayer(memory: IMemoryStore | undefined, projectRoot: string, fs?: IFileSystemAdapter, existingFilterRead?: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[]): Promise<ConsistencyLayerResult | undefined>;
//# sourceMappingURL=init-memory.d.ts.map