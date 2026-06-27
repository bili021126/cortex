// @ci: unit
/**
 * ingest-pipeline.test.ts — IngestPipeline 测试
 *
 * 覆盖：
 *   - 文本分块正确（块大小、overlap）
 *   - 写入 MemoryStore 正确（domain、元数据）
 *   - 空文本不崩溃
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { IngestPipeline, type IngestOptions } from "../src/ingest-pipeline.js";
import { MemoryStore } from "../src/memory-store.js";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

// ── mock embedder（避免 ONNX 下载） ────────────────

function mockEmbedder() {
  const dim = 384;
  return {
    embed: async (_text: string) => new Array(dim).fill(0.1),
    embedBatch: async (_texts: string[]) => _texts.map(() => new Array(dim).fill(0.1)),
    isLoaded: true,
    preload: async () => {},
  };
}

describe("IngestPipeline", () => {
  let pipeline: IngestPipeline;
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-ingest-"));
    store = new MemoryStore(undefined, undefined, mockEmbedder() as any);
    await store.init(path.join(tmpDir, "test.db"));
    pipeline = new IngestPipeline(store);
  });

  afterAll(async () => {
    await store.dispose();
    if (tmpDir) try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ok */ }
  });

  // ── 分块测试 ──────────────────────────────────────

  it("空文本返回 0 chunk", async () => {
    const count = await pipeline.ingestText("", { source: "test" });
    expect(count).toBe(0);
  });

  it("空白文本返回 0 chunk", async () => {
    const count = await pipeline.ingestText("   ", { source: "test" });
    expect(count).toBe(0);
  });

  it("短文本不分块——整个写入", async () => {
    const text = "Hello world";
    const count = await pipeline.ingestText(text, {
      source: "test.txt",
      chunkSize: 500,
      overlap: 50,
    });
    expect(count).toBe(1);
  });

  it("长文本正确分块", async () => {
    // 1000 字符文本，chunkSize=300, overlap=50
    const text = "A".repeat(1000);
    const count = await pipeline.ingestText(text, {
      source: "test.txt",
      chunkSize: 300,
      overlap: 50,
    });
    // 预期：1000 / (300 - 50) ≈ 4 块
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(5);
  });

  it("overlap 大于 chunkSize 时自动修正为 size/2", async () => {
    const text = "A".repeat(500);
    const count = await pipeline.ingestText(text, {
      source: "test.txt",
      chunkSize: 100,
      overlap: 200, // overflow!
    });
    expect(count).toBeGreaterThan(0);
  });

  // ── 写入验证 ──────────────────────────────────────

  it("写入后可通过 MemoryStore 读取", async () => {
    const text = "Test chunk content";
    await pipeline.ingestText(text, {
      source: "test.txt",
      domain: "engineering",
    });

    const results = await store.read({ keywords: ["Test"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.domain).toBe("engineering");
    expect(results[0]!.content_blob.source).toBe("test.txt");
  });

  it("分块写入携带正确元数据", async () => {
    const text = "A".repeat(1000);
    await pipeline.ingestText(text, {
      source: "test.txt",
      chunkSize: 300,
      overlap: 50,
    });

    const results = await store.read({ keywords: ["A"], limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(3);

    // 验证 chunkIndex 连续
    const indices = results.map((r) => r.content_blob.chunkIndex).sort((a, b) => a - b);
    expect(indices[0]).toBe(0);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBe(indices[i - 1] + 1);
    }
  });

  // ── 文件摄入 ──────────────────────────────────────

  it("ingestFile 读取并写入文本文件", async () => {
    const tmpDir = path.join(os.tmpdir(), "cortex-ingest-test");
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, "test.md");
    fs.writeFileSync(filePath, "# Hello\nThis is a test file.", "utf-8");

    const count = await pipeline.ingestFile(filePath, { source: "test.md" });
    expect(count).toBe(1);

    // 清理
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ok */ }
  });
});
