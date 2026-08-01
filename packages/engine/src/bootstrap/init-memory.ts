// @layer 记忆层
// ============================================================
// @cortex/engine/bootstrap/init-memory —— 记忆存储与一致性层初始化
// ============================================================
 

import { MemoryStore, defaultEmbeddingService } from "@cortex/memory-store";
import { SqliteMemoryStore } from "@cortex/memory";
import { ConsistencyLayer } from "@cortex/governance";
import { MemoryManager, MemoryStoreManager } from "@cortex/memory";
import { initRAG, ragAddMemory, ragSearchMemoryEntries } from "@cortex/memory";
import { recordTelemetry } from "@cortex/telemetry";
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
    const backend = new SqliteMemoryStore();
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
 * RagBridge——MemoryManager 的 RAG 依赖对（add/search）。
 *
 * ragReady=false 时两个函数均抛显式错误（S2-3）：
 * 绝不返回假 id/空数组让调用方误以为检索成功。
 */
export interface RagBridge {
  addMemory: (text: string, source: string, metadata?: Record<string, unknown>) => Promise<string>;
  searchMemoryEntries: (query: string, source?: string, topK?: number, options?: { recordRecall?: boolean }) => Promise<Array<{ id: string; text: string; createdAt: number; score: number; metadata?: Record<string, unknown> }>>;
}

/**
 * 构造 RAG 桥接（S2-3 显式降级）。
 *
 * @param ragReady - RAG 初始化是否成功。false 时降级函数抛显式错误并记录 telemetry
 */
export function createRagBridge(ragReady: boolean): RagBridge {
  if (ragReady) {
    return { addMemory: ragAddMemory, searchMemoryEntries: ragSearchMemoryEntries };
  }
  return {
    addMemory: async (_text: string, _source: string, _metadata?: Record<string, unknown>) => {
      await recordTelemetry("memory.rag.degraded", 1, [{ key: "operation", value: "add" }]);
      throw new Error(
        "[init-memory] RAG 不可用（embeddings 初始化失败）——addMemory 拒绝降级假 id，" +
        "请检查嵌入模型配置后重启",
      );
    },
    searchMemoryEntries: async (_query: string, _source?: string, _topK?: number, _options?: { recordRecall?: boolean }) => {
      await recordTelemetry("memory.rag.degraded", 1, [{ key: "operation", value: "search" }]);
      throw new Error(
        "[init-memory] RAG 不可用（embeddings 初始化失败）——searchMemoryEntries 拒绝返回空数组，" +
        "请检查嵌入模型配置后重启",
      );
    },
  };
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

  // 初始化 RAG 向量存储（嵌入模型 + 检索器），失败时显式降级（S2-3）
  // ——降级后 addMemory/searchMemoryEntries 抛显式错误而非返回假 id/空数组，
  //   降级状态记录入 telemetry，调用方可见可查。
  let ragReady = false;
  try {
    await initRAG("auto", undefined, undefined, undefined, "none");
    ragReady = true;
  } catch (e) {
    process.stderr.write(`[init-memory] RAG init failed (embeddings unavailable): ${e instanceof Error ? e.message : String(e).slice(0, 150)}\n`);
    await recordTelemetry(
      "memory.rag.degraded",
      1,
      [{ key: "operation", value: "init" }],
      { reason: e instanceof Error ? e.message : String(e).slice(0, 300) },
    );
  }

  // MemoryManager 接入 RAG 桥接（S2-3：降级时拒绝假 id/空数组，抛显式错误）
  const manager = new MemoryManager(createRagBridge(ragReady));

  return { manager, store };
}
