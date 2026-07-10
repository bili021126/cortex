// @ci: unit
// @cortex/memory-store — 并发写入压力测试
//
// 验证 MemoryStore 在 100 条并发写入下不丢数据。
// 使用 mock embedder 避免 ONNX 模型加载依赖。

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore } from "@cortex/memory-store";
import type { IEmbeddingService } from "@cortex/memory-store";
import { InMemoryMemoryStore } from "@cortex/memory";

// mock embedder — 始终抛异常，MemoryStore 静默降级跳过嵌入和向量去重
const mockEmbedder: IEmbeddingService = {
  async embedText(_text: string): Promise<number[]> {
    throw new Error("mock: skip embedding");
  },
  async embedBatch(_texts: string[]): Promise<number[][]> {
    throw new Error("mock: skip embedding");
  },
};

describe("memory并发压力", () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore(new InMemoryMemoryStore(), undefined, mockEmbedder);
    await store.init(":memory:");
  });

  it("单条写入后读回", async () => {
    // 验证基础的 write() + read() 流程
    const id = await store.write({
      summary: "debug-single",
      content_blob: { seq: 1 },
      source: { agentType: "code", taskId: "debug" },
      kind: "TaskLog",
      semantic_gist: "debug single",
    });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    const all = await store.read({ kind: "TaskLog", limit: 10 });
    expect(all.length).toBe(1);
    expect(all[0]!.summary).toBe("debug-single");
  });

  it("100条并发写入不丢数据", async () => {
    // 不传embedding，让MemoryStore调用embedder（抛异常 → 静默降级跳过嵌入和向量去重）
    const writes = Array.from({ length: 100 }, (_, i) =>
      store.write({
        summary: `concurrent-${i}`,
        content_blob: { i },
        source: { agentType: "code", taskId: "stress" },
        kind: "TaskLog",
        semantic_gist: `test ${i}`,
      }),
    );

    const ids = await Promise.all(writes);
    // write() 返回记忆 ID（非空字符串），确认无异常
    expect(ids.length).toBe(100);
    for (const id of ids) {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    }

    // 验证总数一致
    const all = await store.read({ kind: "TaskLog", limit: 200 });
    expect(all.length).toBe(100);
  });
});
