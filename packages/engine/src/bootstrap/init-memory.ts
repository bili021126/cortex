// ============================================================
// @cortex/engine/bootstrap/init-memory —— 记忆存储与一致性层初始化
// ============================================================
/* eslint-disable no-console */

import { MemoryStore, defaultEmbeddingService } from "@cortex/memory-store";
import { InMemoryMemoryStore } from "@cortex/memory";
import { ConsistencyLayer } from "@cortex/consistency";
import type { PipelineObserver } from "@cortex/scheduler";
import type { IFileSystemAdapter, IMemoryStore, MemoryEntry, MemoryWriteInput, ReadMode } from "@cortex/shared";

/** ConsistencyLayer 初始化结果——含 filterRead 回传 */
export interface ConsistencyLayerResult {
  layer: ConsistencyLayer;
  /** IntentFactWall 过滤回调，需注入到 options.filterRead */
  filterRead: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[];
}

// ─── 初始化 MemoryStore ──────────────────────────────

export async function initMemoryStore(
  observer: PipelineObserver,
  memory?: IMemoryStore,
  dbPath?: string,
): Promise<IMemoryStore | undefined> {
  let store = memory;
  if (!store && dbPath) {
    const backend = new InMemoryMemoryStore();
    store = new MemoryStore(backend, observer, defaultEmbeddingService);
    await store.init(dbPath);
  }
  return store;
}

// ─── 初始化 ConsistencyLayer ─────────────────────────

export async function initConsistencyLayer(
  memory: IMemoryStore | undefined,
  projectRoot: string,
  fs?: IFileSystemAdapter,
  existingFilterRead?: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[],
): Promise<ConsistencyLayerResult | undefined> {
  if (!memory) return undefined;

  // ConsistencyLayer 需要 MemoryStore 具体实例（内部依赖其私有API）
  // IMemoryStore 实现者即 MemoryStore，此转型安全
  const consistencyLayer = new ConsistencyLayer(memory as MemoryStore, {
    projectRoot,
    enableInitVerifier: fs !== undefined,
    fs,
  });

  // 读路径：IntentFactWall 过滤回调（优先使用外部注入，否则用默认）
  const filterRead = existingFilterRead ?? consistencyLayer.filterRead.bind(consistencyLayer);

  // 写路径：preWriteCheck 注入到 MemoryStore
  memory.setPreWriteHook((input: MemoryWriteInput) => consistencyLayer.preWriteCheck(input));

  // 启动校验：InitVerifier 扫描记忆-文件一致性
  if (consistencyLayer.hasInitVerifier) {
    try {
      const report = await consistencyLayer.verify();
      if (report) {
        const missingRatio = report.checkedMemories > 0
          ? report.summary.missing / report.checkedMemories
          : 0;
        console.log(
          `[ConsistencyLayer] 启动校验完成——总数 ${report.totalMemories}，` +
          `缺失 ${report.summary.missing}（${(missingRatio * 100).toFixed(1)}%），` +
          `致命: ${report.fatal ? "是" : "否"}`,
        );
      }
    } catch (e) {
      console.warn("[ConsistencyLayer] 启动校验异常（非致命）:", e);
    }
  }

  return { layer: consistencyLayer, filterRead };
}
