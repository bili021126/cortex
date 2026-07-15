// ============================================================
// @cortex/engine/bootstrap/init-memory —— 记忆存储与一致性层初始化
// ============================================================
 

import { MemoryStore, defaultEmbeddingService } from "@cortex/memory-store";
import { InMemoryMemoryStore } from "@cortex/memory";
import { ConsistencyLayer } from "@cortex/governance";
import { MemoryManager, MemoryStoreManager } from "@cortex/memory";
import { initRAG, ragAddMemory, ragSearchMemoryEntries } from "@cortex/memory";
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
        process.stderr.write(
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

// ─── 初始化 Cyrene 记忆层（L0/L1/L2 画像记忆扩展） ───────

/** CyreneMemoryInitResult——Cyrene 记忆层初始化产物 */
export interface CyreneMemoryInitResult {
  manager: MemoryManager;
  store: MemoryStoreManager;
}

/**
 * 初始化 Cyrene-Agent 记忆层（L0/L1/L2 三层画像记忆）。
 *
 * 作为 MemoryStore 的扩展——Cyrene 管理更细粒度的用户画像、
 * 短期偏好和长期事件记忆，包含冲突检测和自动衰减。
 *
 * @param filePath Cyrene 记忆持久化文件路径，默认 ".cortex/cyrene-memory.json"
 */
export async function initCyreneMemory(
  filePath?: string,
): Promise<CyreneMemoryInitResult> {
  const store = new MemoryStoreManager(
    filePath ?? ".cortex/cyrene-memory.json",
  );
  // 初始化加载（触发迁移/新建）
  await store.load();

  // 初始化 RAG 向量存储（嵌入模型 + 检索器），失败时优雅降级
  let ragReady = false;
  try {
    await initRAG("auto", undefined, undefined, undefined, "none");
    ragReady = true;
  } catch (e) {
    process.stderr.write(`[init-memory] RAG init failed (embeddings unavailable): ${e instanceof Error ? e.message : String(e).slice(0, 150)}\n`);
  }

  // MemoryManager 接入 RAG 桥接
  const manager = new MemoryManager({
    addMemory: ragReady ? ragAddMemory : async (text: string, source: string, _metadata?: Record<string, unknown>) => {
      const id = `cyrene_rag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      return id;
    },
    searchMemoryEntries: ragReady ? ragSearchMemoryEntries : async (_query: string, _source?: string, _topK?: number, _options?: { recordRecall?: boolean }) => {
      return [];
    },
  });

  return { manager, store };
}
