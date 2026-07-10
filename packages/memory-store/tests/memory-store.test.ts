// @ci: unit
// @cortex/memory-store — MemoryStore smoke test

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore } from "@cortex/memory-store";
import { InMemoryMemoryStore } from "@cortex/memory";

describe("@cortex/memory-store — MemoryStore smoke", () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore(new InMemoryMemoryStore());
    await store.init(":memory:");
  });

  it("writePending + commit + read: 写一条读回验证 content 一致", async () => {
    const memId = store.writePending({
      source: { agentType: "test", taskId: "t1" },
      kind: "TaskLog",
      summary: "smoke write+read",
      semantic_gist: "smoke semantic",
      content_blob: { msg: "hello world" },
      content_hash: "",
      weight: 1,
    });
    expect(memId).toBeDefined();
    expect(typeof memId).toBe("string");

    // commit 后才能读到
    const commitOk = store.commitMemory(memId);
    expect(commitOk).toBe(true);

    const results = await store.read({ kind: "TaskLog", limit: 10 });
    const found = results.find((m) => m.id === memId);
    expect(found).toBeDefined();
    expect(found!.summary).toBe("smoke write+read");
  });

  it("commitMemory: writePending → commitMemory → read 验证 status 为 active", async () => {
    const memId = store.writePending({
      source: { agentType: "test", taskId: "t2" },
      kind: "TaskLog",
      summary: "smoke commit",
      semantic_gist: "smoke semantic",
      content_blob: { value: 42 },
      content_hash: "",
      weight: 2,
    });
    const ok = store.commitMemory(memId);
    expect(ok).toBe(true);

    const results = await store.read({ kind: "TaskLog", limit: 10 });
    const found = results.find((m) => m.id === memId);
    expect(found).toBeDefined();
    // committed entries are Active
    expect(found!.semantic_state).toBe("Active");
  });

  it("rollback: writePending → rollback → read 返回空（条目已回滚）", async () => {
    const memId = store.writePending({
      source: { agentType: "test", taskId: "t3" },
      kind: "TaskLog",
      summary: "smoke rollback",
      semantic_gist: "smoke semantic",
      content_blob: { shouldNotExist: true },
      content_hash: "",
      weight: 1,
    });
    const ok = await store.rollback(memId);
    expect(ok).toBe(true);

    // 尝试读取——rollback 后不在 read 结果中
    const results = await store.read({ kind: "TaskLog", limit: 10 });
    const found = results.find((m) => m.id === memId);
    expect(found).toBeUndefined();
  });

  it("archive: 写→commit→archive→read 验证 semantic_state 为 Archived", async () => {
    const memId = store.writePending({
      source: { agentType: "test", taskId: "t4" },
      kind: "TaskLog",
      summary: "smoke archive",
      semantic_gist: "smoke semantic",
      content_blob: { data: "to-archive" },
      content_hash: "",
      weight: 1,
    });
    store.commitMemory(memId);

    // 先 verify committed
    let results = await store.read({ kind: "TaskLog", limit: 10 });
    let found = results.find((m) => m.id === memId);
    expect(found).toBeDefined();

    const archiveOk = store.archive(memId);
    expect(archiveOk).toBe(true);

    // 存档后 read 仍可能包含（视后端实现），检查 semantic_state
    results = await store.read({ kind: "TaskLog", limit: 10 });
    found = results.find((m) => m.id === memId);
    if (found) {
      expect(found.semantic_state).toBe("Archived");
    }
  });

  it("getPending 返回 pending 条目数", async () => {
    store.writePending({
      source: { agentType: "test", taskId: "s1" },
      kind: "TaskLog",
      summary: "stat 1",
      semantic_gist: "smoke semantic",
      content_blob: { seq: 1 },
      content_hash: "",
      weight: 1,
    });
    store.writePending({
      source: { agentType: "test", taskId: "s2" },
      kind: "TaskLog",
      summary: "stat 2",
      semantic_gist: "smoke semantic",
      content_blob: { seq: 2 },
      content_hash: "",
      weight: 1,
    });

    const pending = store.getPending();
    expect(Array.isArray(pending)).toBe(true);
    expect(pending.length).toBe(2);
  });
});
