// @ci: unit
// @cortex/memory-store — 边界测试
//
// 验证空 summary / 极大 content_blob 写入不崩溃。

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore } from "@cortex/memory-store";
import type { IEmbeddingService } from "@cortex/memory-store";
import { InMemoryMemoryStore } from "@cortex/memory";

// mock embedder — 抛异常静默降级跳过嵌入
const mockEmbedder: IEmbeddingService = {
  async embedText(_text: string): Promise<number[]> {
    throw new Error("mock: skip embedding");
  },
  async embedBatch(_texts: string[]): Promise<number[][]> {
    throw new Error("mock: skip embedding");
  },
};

describe("memory边界", () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore(new InMemoryMemoryStore(), undefined, mockEmbedder);
    await store.init(":memory:");
  });

  it("极小summary写入不崩", async () => {
    // 后端 _vw 校验要求 summary 和 semantic_gist 非空（!i.summary?.trim()）
    const id = await store.write({
      summary: ".",
      content_blob: {},
      source: { agentType: "code", taskId: "boundary" },
      kind: "TaskLog",
      semantic_gist: ".",
    });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    // 验证可读回
    const results = await store.read({ kind: "TaskLog", limit: 10 });
    const found = results.find((m) => m.id === id);
    expect(found).toBeDefined();
    expect(found!.summary).toBe(".");
  });

  it("极大content_blob不崩", async () => {
    const big = { data: "x".repeat(100_000) };
    const id = await store.write({
      summary: "big",
      content_blob: big,
      source: { agentType: "code", taskId: "boundary" },
      kind: "TaskLog",
      semantic_gist: "big content",
    });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    // 验证可读回
    const results = await store.read({ kind: "TaskLog", limit: 10 });
    const found = results.find((m) => m.id === id);
    expect(found).toBeDefined();
    expect(found!.summary).toBe("big");
    expect(found!.content_blob).toBeDefined();
  });
});
