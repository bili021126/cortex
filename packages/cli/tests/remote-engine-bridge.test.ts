// @ci: unit
/**
 * remote-engine-bridge.test.ts — RemoteEngineBridge 远程记忆桥接测试
 *
 * 覆盖 readTalkMemory 的 MemoryQuery→HTTP query string 转换逻辑，
 * 确保 keywords 数组被正确 join 后传给 searchMemory（P0-3 回归）。
 */
import { describe, it, expect, vi } from "vitest";
import { RemoteEngineBridge } from "../src/services/remote-engine-bridge.js";
import type { MemoryQuery } from "@cortex/shared";

describe("RemoteEngineBridge.readTalkMemory", () => {
  it("should join MemoryQuery.keywords into a non-empty query string", async () => {
    const bridge = new RemoteEngineBridge({ port: 9999 });
    const mockSearch = vi.fn().mockResolvedValue([]);
    (bridge.conn.http as any).searchMemory = mockSearch;

    const query: MemoryQuery = { keywords: ["昔涟", "记忆", "检索"] };
    await bridge.readTalkMemory(query);

    expect(mockSearch).toHaveBeenCalledWith("昔涟 记忆 检索", {
      kind: undefined,
      limit: undefined,
    });
  });

  it("should pass kind and limit when provided", async () => {
    const bridge = new RemoteEngineBridge({ port: 9999 });
    const mockSearch = vi.fn().mockResolvedValue([]);
    (bridge.conn.http as any).searchMemory = mockSearch;

    const query: MemoryQuery = {
      keywords: ["test"],
      kind: "Insight" as any,
      limit: 10,
    };
    await bridge.readTalkMemory(query);

    expect(mockSearch).toHaveBeenCalledWith("test", {
      kind: "Insight",
      limit: 10,
    });
  });

  it("should emit empty string when keywords is undefined", async () => {
    const bridge = new RemoteEngineBridge({ port: 9999 });
    const mockSearch = vi.fn().mockResolvedValue([]);
    (bridge.conn.http as any).searchMemory = mockSearch;

    const query: MemoryQuery = { kind: "Insight" as any };
    await bridge.readTalkMemory(query);

    // 无 keywords → 空串 → daemon 侧 split(\s+) → undefined → 返回全部/默认
    expect(mockSearch).toHaveBeenCalledWith("", {
      kind: "Insight",
      limit: undefined,
    });
  });

  it("should handle empty keywords array", async () => {
    const bridge = new RemoteEngineBridge({ port: 9999 });
    const mockSearch = vi.fn().mockResolvedValue([]);
    (bridge.conn.http as any).searchMemory = mockSearch;

    const query: MemoryQuery = { keywords: [] };
    await bridge.readTalkMemory(query);

    // 空数组 join → ""，语义同 undefined
    expect(mockSearch).toHaveBeenCalledWith("", {
      kind: undefined,
      limit: undefined,
    });
  });

  it("should return empty array on searchMemory failure", async () => {
    const bridge = new RemoteEngineBridge({ port: 9999 });
    const mockSearch = vi.fn().mockRejectedValue(new Error("network error"));
    (bridge.conn.http as any).searchMemory = mockSearch;

    const query: MemoryQuery = { keywords: ["test"] };
    const result = await bridge.readTalkMemory(query);

    expect(result).toEqual([]);
  });
});
