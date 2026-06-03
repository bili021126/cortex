// @ci: unit
/**
 * MemoryStore 关闭保护测试 —— 修复 D3：read() 关闭保护
 *
 * 验证点：
 * 1. close() 后 read() 抛出 Error
 * 2. close() 后 write() 抛出 Error（已有保护，验证一致性）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@cortex/engine";
import { MemoryType } from "@cortex/shared";

describe("D3: MemoryStore read() 关闭保护", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it("正常状态下 read() 正常工作", async () => {
    const id = await store.write({
      memoryType: MemoryType.Episodic,
      content: { test: true },
      summary: "test memory",
      agentType: "code" as any,
      creatorId: "test",
    });

    const results = await store.read({ keywords: ["test"], memoryTypes: [MemoryType.Episodic], limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(id);
  });

  it("close() 后 read() 抛出 Error", async () => {
    await store.write({
      memoryType: MemoryType.Episodic,
      content: { test: true },
      summary: "test memory",
      agentType: "code" as any,
      creatorId: "test",
    });

    await store.close();

    await expect(store.read({ keywords: ["test"], memoryTypes: [MemoryType.Episodic], limit: 10 })).rejects.toThrow(/已关闭/);
  });

  it("close() 后 write() 抛出 Error（与现有行为一致）", async () => {
    await store.close();

    await expect(store.write({
      memoryType: MemoryType.Episodic,
      content: { test: true },
      summary: "test",
      agentType: "code" as any,
      creatorId: "test",
    })).rejects.toThrow(/已关闭/);
  });
});
