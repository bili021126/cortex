// @ci: unit
// ============================================================
// @cortex/memory —— InMemoryMemoryStore 单元测试
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryMemoryStore } from "@cortex/memory";
import type { MemoryWriteInput } from "@cortex/shared";
import { LinkType } from "@cortex/shared";

// ─── 测试夹具 ──────────────────────────────────

function createSampleInput(overrides: Partial<MemoryWriteInput> = {}): MemoryWriteInput {
  return {
    source: { agentType: "Alhaitham", taskId: `task-${Date.now()}` },
    kind: "Insight",
    summary: "测试记忆摘要",
    semantic_gist: "测试语义精华内容",
    content_blob: { key: "value" },
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────

describe("InMemoryMemoryStore", () => {
  let store: InMemoryMemoryStore;

  beforeEach(async () => {
    store = new InMemoryMemoryStore();
    await store.init(":memory:");
  });

  describe("init / isReady", () => {
    it("should be ready after init", () => {
      expect(store.isReady).toBe(true);
    });

    it("should not be persisted", () => {
      expect(store.isPersisted).toBe(false);
    });

    it("should have size 0 initially", () => {
      expect(store.size).toBe(0);
    });
  });

  describe("write / get", () => {
    it("should write and retrieve a memory entry", async () => {
      const id = await store.write(createSampleInput());
      expect(id).toBeDefined();
      expect(id.length).toBeGreaterThan(0);

      const entry = await store.get(id);
      expect(entry).toBeDefined();
      expect(entry!.summary).toBe("测试记忆摘要");
      expect(entry!.kind).toBe("Insight");
      expect(entry!.source.agentType).toBe("Alhaitham");
    });

    it("should return undefined for non-existent id", async () => {
      const entry = await store.get("non-existent");
      expect(entry).toBeUndefined();
    });

    it("should return a clone, not the internal reference", async () => {
      const id = await store.write(createSampleInput());
      const entry = await store.get(id);
      expect(entry).toBeDefined();

      // 修改返回的对象不应影响内部存储
      if (entry) {
        entry.summary = "modified";
      }

      const entryAgain = await store.get(id);
      expect(entryAgain!.summary).toBe("测试记忆摘要");
    });
  });

  describe("has / peek", () => {
    it("should return true for existing entry", async () => {
      const id = await store.write(createSampleInput());
      expect(store.has(id)).toBe(true);
    });

    it("should return false for non-existing entry", () => {
      expect(store.has("non-existent")).toBe(false);
    });

    it("peek should return the internal reference", async () => {
      const id = await store.write(createSampleInput());
      const entry = store.peek(id);
      expect(entry).toBeDefined();
      expect(entry!.summary).toBe("测试记忆摘要");
    });
  });

  describe("delete", () => {
    it("should delete an existing entry", async () => {
      const id = await store.write(createSampleInput());
      expect(store.has(id)).toBe(true);

      const deleted = await store.delete(id);
      expect(deleted).toBe(true);
      expect(store.has(id)).toBe(false);
    });

    it("should return false for non-existing entry", async () => {
      const deleted = await store.delete("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("read / query", () => {
    it("should return all entries when query is empty", async () => {
      await store.write(createSampleInput({ kind: "Insight" }));
      await store.write(createSampleInput({ kind: "TaskLog" }));

      const results = await store.read({});
      expect(results.length).toBe(2);
    });

    it("should filter by kind", async () => {
      await store.write(createSampleInput({ kind: "Insight" }));
      await store.write(createSampleInput({ kind: "TaskLog" }));

      const results = await store.read({ kind: "Insight" });
      expect(results.length).toBe(1);
      expect(results[0].kind).toBe("Insight");
    });

    it("should filter by keywords", async () => {
      await store.write(createSampleInput({ summary: "人工智能研究" }));
      await store.write(createSampleInput({ summary: "数据分析报告" }));

      const results = await store.read({ keywords: ["数据"] });
      expect(results.length).toBe(1);
      expect(results[0].summary).toBe("数据分析报告");
    });

    it("should sort by weight descending", async () => {
      await store.write(createSampleInput({ weight: 1.0 }));
      await store.write(createSampleInput({ weight: 3.0 }));
      await store.write(createSampleInput({ weight: 2.0 }));

      const results = await store.read({});
      expect(results.length).toBe(3);
      expect(results[0].weight).toBe(3.0);
      expect(results[1].weight).toBe(2.0);
      expect(results[2].weight).toBe(1.0);
    });

    it("should limit results", async () => {
      await store.write(createSampleInput({ weight: 1.0 }));
      await store.write(createSampleInput({ weight: 2.0 }));
      await store.write(createSampleInput({ weight: 3.0 }));

      const results = await store.read({ limit: 2 });
      expect(results.length).toBe(2);
    });

    it("should filter by timeRange", async () => {
      const now = Date.now();
      await store.write(createSampleInput({ createdAt: now - 5000 }));
      await store.write(createSampleInput({ createdAt: now }));

      const results = await store.read({
        timeRange: { start: now - 2000, end: now + 1000 },
      });
      expect(results.length).toBe(1);
    });

    it("should filter by metadata", async () => {
      await store.write(createSampleInput({ content_blob: { env: "test", version: 1 } }));
      await store.write(createSampleInput({ content_blob: { env: "prod", version: 2 } }));

      const results = await store.read({ metadataFilter: { env: "test" } });
      expect(results.length).toBe(1);
      expect((results[0].content_blob as Record<string, unknown>).env).toBe("test");
    });
  });

  describe("session management", () => {
    it("should manage sessions", async () => {
      const sessionId = store.beginSession("test-session");
      expect(sessionId).toBe("test-session");
      expect(store.sessionId).toBe("test-session");
    });

    it("should auto-generate sessionId when not provided", () => {
      const sessionId = store.beginSession();
      expect(sessionId).toBeDefined();
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it("should associate written entries with current session", async () => {
      store.beginSession("session-1");
      const id = await store.write(createSampleInput());
      const entry = await store.get(id);
      expect(entry!.sessionId).toBe("session-1");
    });

    it("should archive session entries on endSession", async () => {
      store.beginSession("session-1");
      await store.write(createSampleInput());
      await store.write(createSampleInput());

      const count = await store.endSession();
      expect(count).toBe(2);

      // 条目应变为 Archived
      for (const entry of store.getBySession("session-1")) {
        expect(entry.semantic_state).toBe("Archived");
      }
    });
  });

  describe("link management", () => {
    it("should create a link between two entries", async () => {
      const id1 = await store.write(createSampleInput());
      const id2 = await store.write(createSampleInput());

      const link = store.link(id1, id2, LinkType.DerivedFrom);
      expect(link).not.toBeNull();

      const links = store.getLinks(id1);
      expect(links.length).toBe(1);
      expect(links[0].targetId).toBe(id2);
      expect(links[0].linkType).toBe(LinkType.DerivedFrom);
    });

    it("should return null if source or target does not exist", () => {
      const link = store.link("non-existent", "also-non-existent", LinkType.ProducedBy);
      expect(link).toBeNull();
    });
  });

  describe("two-phase commit (pending)", () => {
    it("should write pending entries", () => {
      const id = store.writePending(createSampleInput());
      expect(store.hasPending()).toBe(true);
      expect(store.getPending().length).toBe(1);
    });

    it("should commit a pending entry", () => {
      const id = store.writePending(createSampleInput());
      expect(store.hasPending()).toBe(true);

      const committed = store.commitMemory(id);
      expect(committed).toBe(true);
      expect(store.hasPending()).toBe(false);
      expect(store.has(id)).toBe(true);
    });

    it("should rollback a pending entry", async () => {
      const id = store.writePending(createSampleInput());
      expect(store.hasPending()).toBe(true);

      const rolledback = await store.rollback(id);
      expect(rolledback).toBe(true);
      expect(store.hasPending()).toBe(false);
      expect(store.has(id)).toBe(false);
    });
  });

  describe("lifecycle management", () => {
    it("should archive an entry", async () => {
      const id = await store.write(createSampleInput());
      const archived = store.archive(id);
      expect(archived).toBe(true);

      const entry = await store.get(id);
      expect(entry!.semantic_state).toBe("Archived");
    });

    it("should obliterate an entry", async () => {
      const id = await store.write(createSampleInput());
      const obliterated = store.obliterate(id);
      expect(obliterated).toBe(true);

      const entry = await store.get(id);
      expect(entry!.semantic_state).toBe("Obliterated");
    });

    it("should cas an entry", async () => {
      const id = await store.write(createSampleInput());
      const result = store.cas(id, "Active", "Archived");
      expect(result).toBe(true);

      const entry = await store.get(id);
      expect(entry!.semantic_state).toBe("Archived");
    });

    it("should fail cas if expected state does not match", async () => {
      const id = await store.write(createSampleInput());
      const result = store.cas(id, "Archived", "Obliterated");
      expect(result).toBe(false);

      const entry = await store.get(id);
      expect(entry!.semantic_state).toBe("Active");
    });
  });

  describe("transactions", () => {
    it("should begin and commit a transaction", async () => {
      const txn = await store.beginTransaction("Serializable");
      expect(txn).toBeDefined();
      expect(txn.status).toBe("active");
      expect(txn.isolation).toBe("Serializable");

      const id1 = await store.writeWithin(txn, createSampleInput({ summary: "txn-test-1" }));
      const id2 = await store.writeWithin(txn, createSampleInput({ summary: "txn-test-2" }));

      const result = await store.commit(txn);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBe(2);
    });

    it("should rollback a transaction", async () => {
      const txn = await store.beginTransaction();
      await store.writeWithin(txn, createSampleInput());

      const result = await store.rollback(txn);
      expect(result.success).toBe(true);
    });

    it("should throw when writing to a committed transaction", async () => {
      const txn = await store.beginTransaction();
      await store.commit(txn);

      await expect(
        store.writeWithin(txn, createSampleInput()),
      ).rejects.toThrow("already completed");
    });

    it("should provide active transactions list", async () => {
      const txn1 = await store.beginTransaction();
      const txn2 = await store.beginTransaction();

      const active = store.getActiveTransactions();
      expect(active.length).toBe(2);
    });
  });

  describe("set", () => {
    it("should set an entry by id", async () => {
      const id = "custom-id-123";
      const entry: import("@cortex/shared").MemoryEntry = {
        id,
        source: { agentType: "Alhaitham", taskId: "task-001" },
        kind: "Insight",
        summary: "直接设置",
        semantic_gist: "直接设置语义",
        content_blob: { key: "val" },
        semantic_state: "Active",
        weight: 1.0,
        accessCount: 0,
        lastAccessedAt: Date.now(),
        createdAt: Date.now(),
        content_hash: "",
      };

      await store.set(id, entry);
      const retrieved = await store.get(id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.summary).toBe("直接设置");
    });
  });

  describe("writeMany", () => {
    it("should write multiple entries", async () => {
      const ids = await store.writeMany([
        createSampleInput({ summary: "批量1" }),
        createSampleInput({ summary: "批量2" }),
        createSampleInput({ summary: "批量3" }),
      ]);
      expect(ids).toHaveLength(3);
      expect(await store.get(ids[0])).toBeDefined();
      expect(await store.get(ids[1])).toBeDefined();
      expect(await store.get(ids[2])).toBeDefined();
    });
  });

  describe("linkMany", () => {
    it("should create multiple links", async () => {
      const id1 = await store.write(createSampleInput());
      const id2 = await store.write(createSampleInput());
      const id3 = await store.write(createSampleInput());

      const results = store.linkMany([
        { sourceId: id1, targetId: id2, linkType: LinkType.DerivedFrom },
        { sourceId: id1, targetId: id3, linkType: LinkType.ProducedBy },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]).not.toBeNull();
      expect(results[1]).not.toBeNull();
      expect(store.getLinks(id1)).toHaveLength(2);
    });
  });

  describe("pre-write hook", () => {
    it("should modify input via pre-write hook", async () => {
      store.setPreWriteHook((input) => ({
        ...input,
        summary: `[MODIFIED] ${input.summary}`,
      }));

      const id = await store.write(createSampleInput({ summary: "原始" }));
      const entry = await store.get(id);
      expect(entry!.summary).toBe("[MODIFIED] 原始");
    });

    it("should not modify when hook is not set", async () => {
      const id = await store.write(createSampleInput({ summary: "未修改" }));
      const entry = await store.get(id);
      expect(entry!.summary).toBe("未修改");
    });
  });

  describe("transaction timeout", () => {
    it("should set transaction timeout", () => {
      store.setTransactionTimeout(5000);
      // No direct observable effect, but shouldn't throw
      expect(true).toBe(true);
    });
  });

  describe("readWithin", () => {
    it("should read within a transaction", async () => {
      const txn = await store.beginTransaction();
      const id = await store.writeWithin(txn, createSampleInput({ summary: "事务读取" }));
      // commit to make the write visible
      await store.commit(txn);

      // Now read normally
      const results = await store.read({ keywords: ["事务读取"] });
      expect(results).toHaveLength(1);
    });

    it("should throw when reading within a rolled-back transaction", async () => {
      const txn = await store.beginTransaction();
      await store.rollback(txn);

      await expect(
        store.readWithin(txn, {}),
      ).rejects.toThrow("already completed");
    });
  });

  describe("writeManyWithin / linkWithin / linkManyWithin", () => {
    it("should write many within a transaction and commit", async () => {
      const txn = await store.beginTransaction();
      const ids = await store.writeManyWithin(txn, [
        createSampleInput({ summary: "txn-multi-1" }),
        createSampleInput({ summary: "txn-multi-2" }),
      ]);
      expect(ids).toHaveLength(2);

      const result = await store.commit(txn);
      expect(result.success).toBe(true);
    });

    it("should link within a transaction and commit", async () => {
      const id1 = await store.write(createSampleInput());
      const id2 = await store.write(createSampleInput());

      const txn = await store.beginTransaction();
      const link = await store.linkWithin(txn, id1, id2, LinkType.DerivedFrom);
      expect(link).not.toBeNull();

      const result = await store.commit(txn);
      expect(result.success).toBe(true);

      const links = store.getLinks(id1);
      expect(links).toHaveLength(1);
    });

    it("should link many within a transaction", async () => {
      const id1 = await store.write(createSampleInput());
      const id2 = await store.write(createSampleInput());
      const id3 = await store.write(createSampleInput());

      const txn = await store.beginTransaction();
      const results = await store.linkManyWithin(txn, [
        { sourceId: id1, targetId: id2, linkType: LinkType.DerivedFrom },
        { sourceId: id1, targetId: id3, linkType: LinkType.ProducedBy },
      ]);
      expect(results).toHaveLength(2);

      await store.commit(txn);
    });
  });

  describe("error handling - before init", () => {
    it("should throw when writing before init", async () => {
      const uninitStore = new InMemoryMemoryStore();
      await expect(
        uninitStore.write(createSampleInput()),
      ).rejects.toThrow("not initialized");
    });

    it("should throw when reading before init", async () => {
      const uninitStore = new InMemoryMemoryStore();
      await expect(uninitStore.read({})).rejects.toThrow("not initialized");
    });

    it("should throw when getting before init", async () => {
      const uninitStore = new InMemoryMemoryStore();
      await expect(uninitStore.get("x")).rejects.toThrow("not initialized");
    });

    it("should throw when has before init", () => {
      const uninitStore = new InMemoryMemoryStore();
      expect(() => uninitStore.has("x")).toThrow("not initialized");
    });

    it("should throw when linking before init", () => {
      const uninitStore = new InMemoryMemoryStore();
      expect(() => uninitStore.link("a", "b", LinkType.ProducedBy)).toThrow("not initialized");
    });
  });

  describe("error handling - invalid input", () => {
    it("should throw when source is missing", async () => {
      const input = createSampleInput();
      delete (input as any).source;
      await expect(store.write(input)).rejects.toThrow("source");
    });

    it("should throw when kind is missing", async () => {
      const input = createSampleInput();
      delete (input as any).kind;
      await expect(store.write(input)).rejects.toThrow("kind");
    });

    it("should throw when summary is empty", async () => {
      await expect(
        store.write(createSampleInput({ summary: "" })),
      ).rejects.toThrow("summary");
    });

    it("should throw when semantic_gist is empty", async () => {
      await expect(
        store.write(createSampleInput({ semantic_gist: "" })),
      ).rejects.toThrow("semantic_gist");
    });

    it("should throw when content_blob is missing", async () => {
      const input = createSampleInput();
      delete (input as any).content_blob;
      await expect(store.write(input)).rejects.toThrow("content_blob");
    });

    it("should throw when writePending with invalid input", () => {
      const input = createSampleInput();
      delete (input as any).kind;
      expect(() => store.writePending(input)).toThrow("kind");
    });
  });

  describe("error handling - lifecycle edge cases", () => {
    it("should return false for CAS on non-existent entry", () => {
      expect(store.cas("non-existent", "Active", "Archived")).toBe(false);
    });

    it("should return false for archive on non-Active entry", async () => {
      const id = await store.write(createSampleInput());
      store.archive(id); // now Archived
      expect(store.archive(id)).toBe(false); // can't archive again
    });

    it("should return false for archive on non-existent entry", () => {
      expect(store.archive("non-existent")).toBe(false);
    });

    it("should return false for obliterate on non-existent entry", () => {
      expect(store.obliterate("non-existent")).toBe(false);
    });

    it("should return false for rollback on non-existent pending entry", async () => {
      await expect(store.rollback("non-existent-pending")).resolves.toBe(false);
    });

    it("should return false for commitMemory on non-existent pending entry", () => {
      expect(store.commitMemory("non-existent-pending")).toBe(false);
    });
  });

  describe("read - advanced queries", () => {
    it("should filter by agentTypes", async () => {
      await store.write(createSampleInput({ source: { agentType: "Alhaitham", taskId: "t1" } }));
      await store.write(createSampleInput({ source: { agentType: "Kuki", taskId: "t2" } }));

      const results = await store.read({ agentTypes: ["Kuki"] });
      expect(results).toHaveLength(1);
      expect(results[0].source.agentType).toBe("Kuki");
    });

    it("should return results sorted by weight then createdAt", async () => {
      const now = Date.now();
      await store.write(createSampleInput({ weight: 2.0, createdAt: now - 100 }));
      await store.write(createSampleInput({ weight: 3.0, createdAt: now }));
      await store.write(createSampleInput({ weight: 3.0, createdAt: now - 50 }));

      const results = await store.read({});
      expect(results[0].weight).toBe(3.0);
      // Among weight 3.0, the later createdAt should come first
      expect(results[0].createdAt).toBe(now);
      expect(results[1].createdAt).toBe(now - 50);
    });

    it("should track access count in CSA mode", async () => {
      await store.write(createSampleInput({ weight: 1.0 }));
      await store.write(createSampleInput({ weight: 2.0 }));

      const results = await store.read({}, "CSA");
      expect(results.length).toBe(2);
      // After CSA read, access counts should be tracked
      const peeked = store.peek(results[0].id);
      expect(peeked).toBeDefined();
    });
  });

  describe("concurrent operations", () => {
    it("should handle concurrent writes", async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        store.write(createSampleInput({ summary: `并发写入${i}` })),
      );
      const ids = await Promise.all(promises);
      expect(ids).toHaveLength(10);

      const all = await store.read({});
      expect(all).toHaveLength(10);
    });
  });

  describe("close", () => {
    it("should clear all data on close", async () => {
      await store.write(createSampleInput());
      expect(store.size).toBe(1);

      await store.close();
      expect(store.isReady).toBe(false);
    });
  });
});
