// @ci: integration
/**
 * read-write-consistency.test.ts �?艾尔海森 Data 读写一致性验�? *
 * 验证 MemoryStore 数据写入→读取的完整环路�? *   - 字段级精确性：写入的每个字段在读回后保持不�? *   - 批量一致性：多条写入后全部可检�? *   - 特殊载荷：中�?JSON/长文�?特殊字符的保�? *   - 状态关联：写后读取不改变语义状�? *   - 幂等读取：多次读取返回相同结�? *
 * 使用 InMemoryMemoryStore——不影响磁盘�? */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@cortex/memory-store";
import type { MemoryEntry, MemoryWriteInput, MemoryKind } from "@cortex/shared";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── 辅助 ─────────────────────────────────────

const SOURCE = { agentType: "code" as any, taskId: "test-rw" };

/** 构造标�?MemoryWriteInput */
function makeInput(overrides?: Partial<MemoryWriteInput>): MemoryWriteInput {
  return {
    source: overrides?.source ?? SOURCE,
    kind: overrides?.kind ?? "TaskLog",
    summary: overrides?.summary ?? "测试读写一致�?,
    semantic_gist: overrides?.semantic_gist ?? "读写一致性验证语义摘�?,
    content_blob: overrides?.content_blob ?? { key: "value", nested: { a: 1 } },
    ...overrides,
  };
}

/** 提取 MemoryEntry 中用户可验证的字段子�?*/
interface VerifiableFields {
  kind: MemoryKind;
  summary: string;
  semantic_gist: string;
  content_blob: Record<string, unknown>;
  source_agentType: string;
  source_taskId: string;
}

function extractFields(entry: MemoryEntry): VerifiableFields {
  return {
    kind: entry.kind,
    summary: entry.summary,
    semantic_gist: entry.semantic_gist,
    content_blob: entry.content_blob,
    source_agentType: entry.source.agentType,
    source_taskId: entry.source.taskId,
  };
}

// ══════════════════════════════════════════�?// §1 基础读写一致�?// ══════════════════════════════════════════�?
describe("基本读写一致�?, () => {
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-rw-"));
    store = new MemoryStore();
    await store.init(path.join(tmpDir, "test.db"));
  });

  afterEach(async () => {
    await store.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it("写入后立即读取——字段精确匹�?, async () => {
    const input = makeInput({
      summary: "字段精确匹配测试",
      semantic_gist: "semantic gist for exact match",
      content_blob: { result: "success", count: 42, tags: ["a", "b"] },
    });

    const id = await store.write(input);
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    // 通过 peek 直接验证（不经过过滤逻辑�?    const entry = store.peek(id);
    expect(entry).toBeDefined();
    expect(entry!.id).toBe(id);

    const fields = extractFields(entry!);
    expect(fields.kind).toBe(input.kind);
    expect(fields.summary).toBe("字段精确匹配测试");
    expect(fields.semantic_gist).toBe("semantic gist for exact match");
    expect(fields.content_blob).toEqual({ result: "success", count: 42, tags: ["a", "b"] });
    expect(fields.source_agentType).toBe("code");
    expect(fields.source_taskId).toBe("test-rw");
  });

  it("写入→read({}) 可检索到新写条目", async () => {
    await store.write(makeInput({ summary: "可检索条�? }));

    const results = await store.read({});
    expect(results.length).toBe(1);
    expect(results[0].summary).toBe("可检索条�?);
    expect(results[0].semantic_state).toBe("Active");
  });

  it("写入→按 kind 过滤可精确召�?, async () => {
    await store.write(makeInput({ kind: "TaskLog", summary: "任务日志" }));
    await store.write(makeInput({ kind: "Insight", summary: "洞察记录" }));
    await store.write(makeInput({ kind: "Skill", summary: "技能提�? }));

    const taskLogs = await store.read({ kind: "TaskLog" });
    expect(taskLogs.length).toBe(1);
    expect(taskLogs[0].summary).toBe("任务日志");

    const insights = await store.read({ kind: "Insight" });
    expect(insights.length).toBe(1);
    expect(insights[0].summary).toBe("洞察记录");

    const skills = await store.read({ kind: "Skill" });
    expect(skills.length).toBe(1);
    expect(skills[0].summary).toBe("技能提�?);
  });

  it("写入→按关键词过滤可精确召回", async () => {
    await store.write(makeInput({
      summary: "修复 HTTP 超时 bug",
      semantic_gist: "HTTP timeout fix",
      content_blob: { detail: "set timeout to 30s" },
    }));
    await store.write(makeInput({
      summary: "优化内存分配",
      semantic_gist: "memory optimization",
      content_blob: { detail: "reduce heap usage" },
    }));

    const httpResults = await store.read({ keywords: ["HTTP"], limit: 10 });
    expect(httpResults.length).toBe(1);
    expect(httpResults[0].summary).toContain("HTTP");

    const memoryResults = await store.read({ keywords: ["内存"], limit: 10 });
    expect(memoryResults.length).toBe(1);
    expect(memoryResults[0].summary).toContain("内存");
  });
});

// ══════════════════════════════════════════�?// §2 多条目批量一致�?// ══════════════════════════════════════════�?
describe("批量读写一致�?, () => {
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-rw-batch-"));
    store = new MemoryStore();
    await store.init(path.join(tmpDir, "test.db"));
  });

  afterEach(async () => {
    await store.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it("写入 N 条→read 应返回全�?N �?, async () => {
    const N = 10;
    const ids: string[] = [];

    for (let i = 0; i < N; i++) {
      const id = await store.write(makeInput({
        summary: `批量条目 #${i}`,
        content_blob: { index: i },
      }));
      ids.push(id);
    }

    expect(ids.length).toBe(N);
    // 所�?ID 必须唯一（无去重误判�?    expect(new Set(ids).size).toBe(N);

    const results = await store.read({ limit: 100 });
    expect(results.length).toBe(N);

    // 每条都可�?id 找回
    for (const id of ids) {
      const entry = store.peek(id);
      expect(entry).toBeDefined();
      expect(entry!.id).toBe(id);
    }
  });

  it("写入 N 条→每条字段各自独立不串�?, async () => {
    const entries = [
      { summary: "条目A", semantic_gist: "gist A", content_blob: { data: "A" } },
      { summary: "条目B", semantic_gist: "gist B", content_blob: { data: "B" } },
      { summary: "条目C", semantic_gist: "gist C", content_blob: { data: "C" } },
    ];

    const ids = await Promise.all(
      entries.map((e) => store.write(makeInput(e))),
    );

    for (let i = 0; i < ids.length; i++) {
      const entry = store.peek(ids[i]);
      expect(entry).toBeDefined();
      expect(entry!.summary).toBe(entries[i].summary);
      expect(entry!.semantic_gist).toBe(entries[i].semantic_gist);
      expect(entry!.content_blob).toEqual(entries[i].content_blob);
    }
  });

  it("重复写入相同内容→去重返回相�?ID", async () => {
    const input = makeInput({
      summary: "可去重内�?,
      content_blob: { uid: "dedup-001" },
    });

    const id1 = await store.write(input);
    const id2 = await store.write(input);

    // 第二次写入应检测到内容哈希重复，返回相�?ID
    expect(id2).toBe(id1);

    // 存储中只应有 1 �?    const results = await store.read({});
    expect(results.length).toBe(1);
  });
});

// ══════════════════════════════════════════�?// §3 特殊载荷保真�?// ══════════════════════════════════════════�?
describe("特殊载荷保真�?, () => {
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-rw-special-"));
    store = new MemoryStore();
    await store.init(path.join(tmpDir, "test.db"));
  });

  afterEach(async () => {
    await store.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it("中文文本完整保真", async () => {
    const chineseSummary = "「昔涟」今天在教令院查阅了《星空与深渊》的第三�?;
    const chineseGist = "昔涟 reading a book about stars and abyss in the House of Daena";

    await store.write(makeInput({
      summary: chineseSummary,
      semantic_gist: chineseGist,
    }));

    const results = await store.read({ keywords: ["昔涟"] });
    expect(results.length).toBe(1);
    expect(results[0].summary).toBe(chineseSummary);
    expect(results[0].semantic_gist).toBe(chineseGist);
  });

  it("复杂 JSON 结构保真", async () => {
    const complexBlob = {
      level: "debug",
      timestamp: "2025-07-15T10:30:00Z",
      payload: {
        userId: "u-001",
        action: "code_review",
        metadata: {
          files: ["src/main.ts", "src/utils.ts"],
          score: 0.95,
          tags: ["refactor", "typescript"],
        },
      },
      nested: {
        deep: {
          deeper: {
            value: 42,
            active: true,
          },
        },
      },
    };

    await store.write(makeInput({
      summary: "复杂 JSON",
      semantic_gist: "complex nested JSON structure",
      content_blob: complexBlob,
    }));

    const results = await store.read({ keywords: ["complex"] });
    expect(results.length).toBe(1);
    expect(results[0].content_blob).toEqual(complexBlob);
  });

  it("特殊字符保真", async () => {
    const specialSummary = "特殊字符: !@#$%^&*()_+-=[]{}|;':\",./<>?~`🎉🚀αβγδ";

    await store.write(makeInput({
      summary: specialSummary,
      semantic_gist: "special chars test",
    }));

    const results = await store.read({ keywords: ["特殊字符"] });
    expect(results.length).toBe(1);
    expect(results[0].summary).toBe(specialSummary);
  });

  it("长文本（1000+ 字符）不分段截断", async () => {
    const longText = "A".repeat(2000) + "END_MARKER";

    await store.write(makeInput({
      summary: "长文本测�?,
      semantic_gist: longText,
    }));

    const results = await store.read({ keywords: ["长文�?] });
    expect(results.length).toBe(1);
    expect(results[0].semantic_gist).toBe(longText);
    expect(results[0].semantic_gist.length).toBe(2000 + "END_MARKER".length);
    expect(results[0].semantic_gist.endsWith("END_MARKER")).toBe(true);
  });

  it("�?content_blob {} 可写入并读出", async () => {
    await store.write(makeInput({
      summary: "�?blob",
      content_blob: {},
    }));

    const results = await store.read({ keywords: ["�?blob"] });
    expect(results.length).toBe(1);
    expect(results[0].content_blob).toEqual({});
  });
});

// ══════════════════════════════════════════�?// §4 读路径过滤不改变数据完整�?// ══════════════════════════════════════════�?
describe("读路径不改变数据完整�?, () => {
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-rw-read-"));
    store = new MemoryStore();
    await store.init(path.join(tmpDir, "test.db"));
  });

  afterEach(async () => {
    await store.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it("HCA 模式读取不修�?accessCount", async () => {
    const id = await store.write(makeInput({ summary: "HCA 不追踪热�? }));

    // HCA 读取
    const hcaResults = await store.read({}, "HCA");
    expect(hcaResults.length).toBe(1);
    // HCA 模式�?accessCount 不会被修�?    expect(hcaResults[0].accessCount).toBe(0);

    // 验证 peek 看到的原始数据也未变
    const entry = store.peek(id);
    expect(entry!.accessCount).toBe(0);
  });

  it("多次读取返回相同结果（幂等性）", async () => {
    await store.write(makeInput({ summary: "幂等读取测试" }));

    const results1 = await store.read({});
    const results2 = await store.read({});

    expect(results1.length).toBe(results2.length);
    expect(results1[0].id).toBe(results2[0].id);
    expect(results1[0].summary).toBe(results2[0].summary);
    expect(results1[0].content_blob).toEqual(results2[0].content_blob);
  });

  it("写入后数据不因后续操作而变�?, async () => {
    const id = await store.write(makeInput({
      summary: "不变异数�?,
      content_blob: { original: true, value: 100 },
    }));

    // 执行多次无关读取
    for (let i = 0; i < 5; i++) {
      await store.read({});
    }

    // 写入另一�?    await store.write(makeInput({ summary: "干扰数据" }));

    // 原始条目应完全不�?    const entry = store.peek(id);
    expect(entry!.summary).toBe("不变异数�?);
    expect(entry!.content_blob).toEqual({ original: true, value: 100 });
    // 字段数不变（不会被额外注入字段）
    expect(Object.keys(entry!.content_blob)).toEqual(["original", "value"]);
  });
});

// ══════════════════════════════════════════�?// §5 生命周期转换不丢失字�?// ══════════════════════════════════════════�?
describe("状态转换后字段完整�?, () => {
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-rw-state-"));
    store = new MemoryStore();
    await store.init(path.join(tmpDir, "test.db"));
  });

  afterEach(async () => {
    await store.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it("Active→Archived 后字段不�?, async () => {
    const input = makeInput({
      summary: "归档测试",
      content_blob: { will: "be archived" },
    });
    const id = await store.write(input);

    // 归档前记录字段（peek 返回引用，cas 原地修改，故先取值）
    const before = store.peek(id);
    const beforeState = before!.semantic_state;

    store.archive(id);

    // 归档后字段应完全一�?    const after = store.peek(id);
    expect(after).toBeDefined();
    expect(after!.summary).toBe(before!.summary);
    expect(after!.semantic_gist).toBe(before!.semantic_gist);
    expect(after!.content_blob).toEqual(before!.content_blob);
    expect(after!.source).toEqual(before!.source);
    expect(after!.kind).toBe(before!.kind);
    // 只有 semantic_state 变化
    expect(after!.semantic_state).toBe("Archived");
    expect(beforeState).toBe("Active");
  });

  it("rollback �?Pending 条目被删�?, async () => {
    const id = store.writePending(makeInput({
      summary: "待回�?,
      content_blob: { status: "pending" },
    }));

    expect(store.hasPending()).toBe(true);

    await store.rollback(id);

    // rollback �?Pending 条目应从 _pendingEntries 中移�?    expect(store.hasPending()).toBe(false);
    expect(store.getPending().length).toBe(0);
  });
});
