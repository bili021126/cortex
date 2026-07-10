// @ci: unit
// ============================================================
// @cortex/memory —— AbstractMemoryStore 单元测试
// 使用 InMemoryMemoryStore（继承 AbstractMemoryStore）
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryMemoryStore } from "@cortex/memory";
import { LinkType } from "@cortex/shared";
import type { MemoryWriteInput } from "@cortex/shared";

// ─── 测试夹具 ──────────────────────────────────

function sampleInput(overrides: Partial<MemoryWriteInput> = {}): MemoryWriteInput {
  return {
    source: { agentType: "Alhaitham", taskId: "task-test" },
    kind: "Insight",
    summary: "测试记忆",
    semantic_gist: "测试语义",
    content_blob: { key: "value" },
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────

describe("AbstractMemoryStore", () => {
  let store: InMemoryMemoryStore;

  beforeEach(async () => {
    store = new InMemoryMemoryStore();
    await store.init(":memory:");
  });

  it("write→read 往返", async () => {
    const id = await store.write(sampleInput());
    expect(id).toBeDefined();
    expect(typeof id).toBe("string");

    const entry = await store.get(id);
    expect(entry).toBeDefined();
    expect(entry!.id).toBe(id);
    expect(entry!.summary).toBe("测试记忆");
    expect(entry!.kind).toBe("Insight");
    expect(entry!.semantic_state).toBe("Active");
  });

  it("write→read 内容一致", async () => {
    const input = sampleInput({
      summary: "往返测试",
      content_blob: { hello: "world", num: 42 },
    });
    const id = await store.write(input);

    const entry = await store.get(id);
    expect(entry!.summary).toBe("往返测试");
    expect((entry!.content_blob as any).hello).toBe("world");
    expect((entry!.content_blob as any).num).toBe(42);
  });

  it("write 自动设 sessionId", async () => {
    store.beginSession("test-session");
    const id = await store.write(sampleInput());
    const entry = await store.get(id);
    expect(entry!.sessionId).toBe("test-session");
  });

  it("link 建立关联", async () => {
    const id1 = await store.write(sampleInput({ summary: "源" }));
    const id2 = await store.write(sampleInput({ summary: "目标" }));

    const link = store.link(id1, id2, LinkType.Reference, 0.8);
    expect(link).not.toBeNull();
    expect(link!.sourceId).toBe(id1);
    expect(link!.targetId).toBe(id2);
    expect(link!.linkType).toBe(LinkType.Reference);
    expect(link!.weight).toBe(0.8);
  });

  it("link 双向关联可查询", async () => {
    const id1 = await store.write(sampleInput({ summary: "A" }));
    const id2 = await store.write(sampleInput({ summary: "B" }));

    store.link(id1, id2, LinkType.Reference);
    store.link(id2, id1, LinkType.Reference);

    const links1 = store.getLinks(id1);
    expect(links1).toHaveLength(1);
    expect(links1[0]!.targetId).toBe(id2);

    const links2 = store.getLinks(id2);
    expect(links2).toHaveLength(1);
    expect(links2[0]!.targetId).toBe(id1);
  });

  it("link 不存在条目返回 null", () => {
    const link = store.link("nonexistent", "also-nonexistent", LinkType.Reference);
    expect(link).toBeNull();
  });

  it("cas 合法转换 Active→Archived", () => {
    // 先 write 一个条目，write 默认 semantic_state = "Active"
    // 但 writePending 返回 pending ID
    // 我们需要一个实际的对象来做 CAS
    // 用 set 方法手动注入
    // 但更简单：write 后直接 cas
    // 问题：write 是 async，我们在 async 测试中
  });

  it("cas 合法转换 Active→Archived（通过 write）", async () => {
    const id = await store.write(sampleInput());
    const entry = await store.get(id);
    expect(entry!.semantic_state).toBe("Active");

    const result = store.cas(id, "Active" as any, "Archived" as any);
    expect(result).toBe(true);

    const updated = await store.get(id);
    expect(updated!.semantic_state).toBe("Archived");
  });

  it("cas 合法转换 Active→Archived（archive 别名）", async () => {
    const id = await store.write(sampleInput());

    const result = store.archive(id);
    expect(result).toBe(true);

    const entry = await store.get(id);
    expect(entry!.semantic_state).toBe("Archived");
  });

  it("cas 非法转换 Pending→Archived 拒绝", async () => {
    const id = await store.write(sampleInput());
    // 条目当前是 Active，尝试 Pending → Archived 应失败（状态不匹配）
    const result = store.cas(id, "Pending" as any, "Archived" as any);
    expect(result).toBe(false);
  });

  it("cas 不存在的条目返回 false", () => {
    const result = store.cas("non-existent", "Active" as any, "Archived" as any);
    expect(result).toBe(false);
  });

  it("has 检查存在性", async () => {
    const id = await store.write(sampleInput());
    expect(store.has(id)).toBe(true);
    expect(store.has("nonexistent")).toBe(false);
  });

  it("delete 移除条目", async () => {
    const id = await store.write(sampleInput());
    expect(store.has(id)).toBe(true);

    const deleted = await store.delete(id);
    expect(deleted).toBe(true);
    expect(store.has(id)).toBe(false);
  });

  it("getPending 初始为空", () => {
    const pending = store.getPending();
    expect(pending).toHaveLength(0);
  });

  it("writePending→commitMemory 往返", () => {
    const pendingId = store.writePending(sampleInput({ summary: "pending-test" }));
    expect(pendingId).toBeDefined();

    // Pending 条目在 commit 前不可见
    expect(store.has(pendingId)).toBe(false);

    const committed = store.commitMemory(pendingId);
    expect(committed).toBe(true);

    // commit 后可见
    expect(store.has(pendingId)).toBe(true);
  });

  it("writePending→rollback 撤销", async () => {
    const pendingId = store.writePending(sampleInput({ summary: "rollback-test" }));

    const rolledBack = await store.rollback(pendingId);
    expect(rolledBack).toBe(true);

    // 撤销后 commit 不应成功
    const committed = store.commitMemory(pendingId);
    expect(committed).toBe(false);
  });

  it("linkMany 批量建链", async () => {
    const ids = await Promise.all([
      store.write(sampleInput({ summary: "X" })),
      store.write(sampleInput({ summary: "Y" })),
      store.write(sampleInput({ summary: "Z" })),
    ]);

    const results = store.linkMany([
      { sourceId: ids[0]!, targetId: ids[1]!, linkType: LinkType.Reference },
      { sourceId: ids[0]!, targetId: ids[2]!, linkType: LinkType.DerivedFrom },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).not.toBeNull();
    expect(results[1]).not.toBeNull();

    const links = store.getLinks(ids[0]!);
    expect(links).toHaveLength(2);
  });

  it("getBySession 按会话查询", async () => {
    store.beginSession("session-A");
    const idA = await store.write(sampleInput({ summary: "S-A-1" }));
    await store.write(sampleInput({ summary: "S-A-2" }));

    store.beginSession("session-B");
    const idB = await store.write(sampleInput({ summary: "S-B-1" }));

    const sessionA = store.getBySession("session-A");
    expect(sessionA).toHaveLength(2);

    const sessionB = store.getBySession("session-B");
    expect(sessionB).toHaveLength(1);
  });

  it("obliterate 湮灭条目", async () => {
    const id = await store.write(sampleInput());

    const result = store.obliterate(id);
    expect(result).toBe(true);
    expect(store.has(id)).toBe(false);
  });

  it("close 清空所有状态", async () => {
    await store.write(sampleInput({ summary: "temp" }));
    expect(store.size).toBeGreaterThan(0);

    await store.close();
    expect(store.isReady).toBe(false);
    expect(store.size).toBe(0);
  });
});
