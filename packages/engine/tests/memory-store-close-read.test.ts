/**
 * MemoryStore 关闭保护测试 —— 修复 D3：read() 关闭保护
 *
 * 验证点：
 * 1. close() 后 read() 抛出 Error
 * 2. close() 后 write() 抛出 Error（已有保护，验证一致性）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../src/memory/memory-store.js";
import { MemoryType } from "@cortex/shared";

describe("D3: MemoryStore read() 关闭保护", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it("正常状态下 read() 正常工作", () => {
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: { test: true },
      summary: "test memory",
      agentType: "code" as any,
      creatorId: "test",
    });

    const results = store.read({ keywords: ["test"], memoryTypes: [MemoryType.Episodic], limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(id);
  });

  it("close() 后 read() 抛出 Error", async () => {
    store.write({
      memoryType: MemoryType.Episodic,
      content: { test: true },
      summary: "test memory",
      agentType: "code" as any,
      creatorId: "test",
    });

    await store.close();

    expect(() => {
      store.read({ keywords: ["test"], memoryTypes: [MemoryType.Episodic], limit: 10 });
    }).toThrow(/已关闭/);
  });

  it("close() 后 write() 抛出 Error（与现有行为一致）", async () => {
    await store.close();

    expect(() => {
      store.write({
        memoryType: MemoryType.Episodic,
        content: { test: true },
        summary: "test",
        agentType: "code" as any,
        creatorId: "test",
      });
    }).toThrow(/已关闭/);
  });
});
