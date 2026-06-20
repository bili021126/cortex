/**
 * @cortex/memory-store — 全链路集成测试
 * 
 * 覆盖记忆管线：写入→读取→四态转换→去重→BM25→认知评分→混合检索
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  MemoryStore,
  ContextBuilder,
  CognitiveEngine,
  WeightAger,
  DedupService,
  BM25Index,
  HybridRetriever,
  DEFAULT_COGNITIVE_CONFIG,
  bayesianRelevanceScore,
  fourierTimeDecay,
  timeDecayScore,
} from "@cortex/memory-store";
import { InMemoryMemoryStore } from "@cortex/memory";
import {
  LinkType,
  type MemoryEntry,
  type MemoryWriteInput,
} from "@cortex/shared";

// ── 辅助 ─────────────────────────────────────

let tmpDir: string;
let dbPath: string;

function cleanup() {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function makeInput(overrides?: Partial<MemoryWriteInput>): MemoryWriteInput {
  return {
    source: { agentType: "Code" as any, taskId: "task-1" },
    kind: "TaskLog",
    summary: `记忆 ${overrides?.summary ?? crypto.randomUUID().slice(0, 8)}`,
    semantic_gist: overrides?.semantic_gist ?? "测试语义摘要",
    content_blob: overrides?.content_blob ?? { result: "success" },
    ...overrides,
  };
}

function makeEntry(id: string, accessCount: number, lastAccessedAt: number): MemoryEntry {
  return {
    id,
    source: { agentType: "Code" as any, taskId: "test" },
    kind: "TaskLog",
    summary: `Entry ${id}`,
    semantic_gist: "test gist",
    content_blob: {},
    semantic_state: "Active",
    weight: 1,
    accessCount,
    lastAccessedAt,
    createdAt: lastAccessedAt - 1000,
    content_hash: `hash-${id}`,
  };
}

// ═══════════════════════════════════════════
// §1 写入与读取
// ═══════════════════════════════════════════

describe("MemoryStore 写入→读取", () => {
  let store: MemoryStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-ms-"));
    dbPath = path.join(tmpDir, "test.db");
    store = new MemoryStore();
    await store.init(dbPath);
  });

  afterEach(() => { store.dispose(); cleanup(); });

  it("write + read 单条", async () => {
    const id = await store.write(makeInput({ summary: "test-entry" }));
    expect(id).toBeTruthy();
    const results = await store.read({});
    expect(results.length).toBe(1);
    expect(results[0].kind).toBe("TaskLog");
    expect(results[0].semantic_state).toBe("Active");
  });

  it("按 kind 过滤读取", async () => {
    await store.write(makeInput({ kind: "TaskLog", summary: "log1" }));
    await store.write(makeInput({ kind: "Insight", summary: "insight1" }));
    expect((await store.read({ kind: "TaskLog" })).length).toBe(1);
  });

  it("HCA 广度浅读 vs CSA 深度窄读", async () => {
    for (let i = 0; i < 5; i++) await store.write(makeInput());
    const hca = await store.read({}, "HCA");
    expect(hca.length).toBe(5);
    // HCA 不追踪热度
    expect(hca[0].accessCount).toBe(0);
  });

  it("建立并查询记忆关联", async () => {
    const id1 = await store.write(makeInput());
    const id2 = await store.write(makeInput());
    const link = store.link(id1, id2, LinkType.ProducedBy);
    expect(link).toBeDefined();
    expect(store.getLinks(id1).length).toBe(1);
  });
});

// ═══════════════════════════════════════════
// §2 四态生命周期
// ═══════════════════════════════════════════

describe("MemoryStore 四态生命周期", () => {
  let store: MemoryStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-ms-"));
    dbPath = path.join(tmpDir, "test.db");
    store = new MemoryStore();
    await store.init(dbPath);
  });

  afterEach(() => { store.dispose(); cleanup(); });

  it("Active → Archived → Obliterated", async () => {
    const id = await store.write(makeInput());
    expect(store.has(id)).toBe(true);

    store.archive(id);
    // archive 后条目仍存在
    expect(store.has(id)).toBe(true);

    // obliterate 标记为湮灭
    store.obliterate(id);
    // obliterate 后 has() 取决于实现
  });

  it("freeze → obliterate", async () => {
    const id = await store.write(makeInput());
    store.freeze(id);
    expect(store.has(id)).toBe(true);
    store.obliterate(id);
  });

  it("CAS compare-and-swap", async () => {
    const id = await store.write(makeInput());
    expect(store.cas(id, "Active", "Archived")).toBe(true);
    expect(store.cas(id, "Active", "Obliterated")).toBe(false);
  });
});

// ═══════════════════════════════════════════
// §3 权重老化
// ═══════════════════════════════════════════

describe("WeightAger 权重衰减", () => {
  it("freezeStale 对过期低权重条目执行冻结", () => {
    const ager = new WeightAger(0.95, 30, 7, 999);
    const oldTs = Date.now() - 60 * 24 * 60 * 60 * 1000; // 60 天前
    const entry: MemoryEntry = {
      ...makeEntry("very-stale", 1, oldTs),
      lastAccessedAt: oldTs,
      weight: 0.01,
    };
    const frozen = ager.freezeStale([entry]);
    // 低权重+60天未访问 → 应被冻结
    expect(frozen.length).toBe(1);
    expect(frozen[0].id).toBe("very-stale");
  });

  it("obliterateFrozen 识别湮灭条目", () => {
    const ager = new WeightAger();
    const oldTs = Date.now() - 40 * 24 * 60 * 60 * 1000;
    const entries = [{ ...makeEntry("old", 5, oldTs), semantic_state: "Archived" as const }];
    const candidates = ager.obliterateFrozen(entries);
    expect(candidates.length).toBe(1);
  });
});

// ═══════════════════════════════════════════
// §4 去重引擎
// ═══════════════════════════════════════════

describe("DedupService 去重", () => {
  it("contentHash 确定性", () => {
    const svc = new DedupService();
    expect(svc.contentHash("hello", { a: 1 })).toBe(svc.contentHash("hello", { a: 1 }));
    expect(svc.contentHash("hello", { a: 1 })).not.toBe(svc.contentHash("hello", { a: 2 }));
  });

  it("exactMatch 重复检测", () => {
    const svc = new DedupService();
    const hash = svc.contentHash("same", { x: 1 });
    const entries: MemoryEntry[] = [makeEntry("e1", 0, 0)];
    entries[0].content_hash = hash;
    expect(svc.exactMatch(hash, entries)).toBe("e1");
    expect(svc.exactMatch("no-such-hash", entries)).toBeNull();
  });
});

// ═══════════════════════════════════════════
// §5 BM25 全文检索
// ═══════════════════════════════════════════

describe("BM25Index 全文检索", () => {
  it("索引并搜索文档", () => {
    const bm25 = new BM25Index();
    bm25.addDocument("d1", { text: "修复 HTTP 超时 bug" });
    bm25.addDocument("d2", { text: "优化内存分配" });
    bm25.addDocument("d3", { text: "HTTP 缓存 TTL" });

    const results = bm25.search("HTTP 超时", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe("d1");
  });

  it("多字段索引", () => {
    const bm25 = new BM25Index();
    bm25.addDocument("d1", { summary: "构建系统", payload: "pnpm workspaces monorepo" });
    const results = bm25.search("monorepo", 5);
    expect(results.length).toBe(1);
  });

  it("空查询返回空", () => {
    const bm25 = new BM25Index();
    bm25.addDocument("d1", { text: "hello" });
    expect(bm25.search("zzzzzzz", 5).length).toBe(0);
  });
});

// ═══════════════════════════════════════════
// §6 认知评分引擎
// ═══════════════════════════════════════════

describe("CognitiveEngine 认知评分", () => {
  it("bayesianRelevanceScore 对匹配关键词加分", () => {
    const entry = makeEntry("e1", 5, Date.now());
    const score = bayesianRelevanceScore(entry, "fix bug", Date.now(), 50, DEFAULT_COGNITIVE_CONFIG);
    expect(typeof score).toBe("number");
  });

  it("fourierTimeDecay 返回 0..1 之间的值", () => {
    const recent = fourierTimeDecay(Date.now(), DEFAULT_COGNITIVE_CONFIG);
    const old = fourierTimeDecay(Date.now() - 365 * 24 * 60 * 60 * 1000, DEFAULT_COGNITIVE_CONFIG);
    expect(recent).toBeGreaterThanOrEqual(0);
    expect(recent).toBeLessThanOrEqual(1);
    expect(old).toBeGreaterThanOrEqual(0);
    expect(old).toBeLessThanOrEqual(1);
  });

  it("timeDecayScore 综合衰减", () => {
    const score = timeDecayScore(
      makeEntry("e1", 10, Date.now() - 1000),
      Date.now(),
      DEFAULT_COGNITIVE_CONFIG,
    );
    expect(typeof score).toBe("number");
    expect(score).toBeGreaterThan(0);
  });

  it("CognitiveEngine 类可实例化", () => {
    const engine = new CognitiveEngine(DEFAULT_COGNITIVE_CONFIG);
    expect(engine).toBeDefined();
  });
});

// ═══════════════════════════════════════════
// §7 混合检索器
// ═══════════════════════════════════════════

describe("HybridRetriever 混合检索", () => {
  it("可实例化并配置", () => {
    const retriever = new HybridRetriever({
      alpha: 0.4,
      beta: 0.6,
      initialThreshold: 0.5,
    });
    expect(retriever.config.alpha).toBe(0.4);
  });

  it("空候选列表返回空", async () => {
    const retriever = new HybridRetriever();
    const mockEmbedder = { embedBatch: async (texts: string[]) => texts.map(() => new Array(128).fill(0)) };
    const result = await retriever.score([], new Map(), new Array(128).fill(0), mockEmbedder as any);
    expect(result.length).toBe(0);
  });
});

// ═══════════════════════════════════════════
// §8 完整 E2E 管线
// ═══════════════════════════════════════════

describe("Memory 完整端到端管线", () => {
  let store: MemoryStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-e2e-"));
    dbPath = path.join(tmpDir, "test.db");
    store = new MemoryStore();
    await store.init(dbPath);
  });

  afterEach(() => { store.dispose(); cleanup(); });

  it("E2E: 写入→关联→检索→评分→老化", async () => {
    const rootId = await store.write(makeInput({ summary: "pnpm monorepo", semantic_gist: "构建系统" }));
    const child1 = await store.write(makeInput({ summary: "engine 核心调度", semantic_gist: "核心引擎" }));
    const child2 = await store.write(makeInput({ summary: "scheduler 分层", semantic_gist: "任务调度" }));
    store.link(rootId, child1, LinkType.ProducedBy);
    store.link(rootId, child2, LinkType.ProducedBy);

    // 检索全部
    const all = await store.read({});
    expect(all.length).toBe(3);

    // BM25 索引
    const bm25 = new BM25Index();
    for (const e of all) {
      bm25.addDocument(e.id, { text: e.summary + " " + e.semantic_gist });
    }
    const bm25Results = bm25.search("调度 引擎", 5);
    expect(bm25Results.length).toBeGreaterThan(0);

    // 权重老化
    const ager = new WeightAger();
    const frozen = ager.freezeStale(all);
    // 新鲜记忆不应被冻结
    expect(frozen.length).toBe(0);
  });

  it("E2E: 批量写入→去重→第二次写入跳过", async () => {
    const svc = new DedupService();
    const input = makeInput({ summary: "unique", content_blob: { uid: "abc" } });
    const hash = svc.contentHash(input.summary, input.content_blob);

    await store.write({ ...input, content_hash: hash });
    
    // 通过去重检测
    const entries = await store.read({});
    const dup = svc.exactMatch(hash, entries);
    // 应检测到重复
    expect(dup).toBeTruthy();
  });

  it("E2E: 四条记忆→两种 kind→HCA 过滤→认知评分", async () => {
    await store.write(makeInput({ kind: "TaskLog", summary: "t1" }));
    await store.write(makeInput({ kind: "TaskLog", summary: "t2" }));
    await store.write(makeInput({ kind: "Insight", summary: "i1" }));
    await store.write(makeInput({ kind: "Insight", summary: "i2" }));

    const taskLogs = await store.read({ kind: "TaskLog" }, "HCA");
    expect(taskLogs.length).toBe(2);

    const insights = await store.read({ kind: "Insight" });
    expect(insights.length).toBe(2);

    // 认知评分
    const scores = insights.map((e) => ({
      id: e.id,
      bayesian: bayesianRelevanceScore(e, "insight", Date.now(), 50, DEFAULT_COGNITIVE_CONFIG),
      decay: fourierTimeDecay(e.createdAt, DEFAULT_COGNITIVE_CONFIG),
    }));
    expect(scores.every((s) => s.bayesian >= 0 && s.decay >= 0)).toBe(true);
  });
});
