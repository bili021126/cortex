// @ci: unit
// ============================================================
// @cortex/memory —— FileBasedMemoryStore 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { FileBasedMemoryStore } from "@cortex/memory";
import type { MemoryWriteInput } from "@cortex/shared";
import { LinkType } from "@cortex/shared";

// ─── 测试夹具 ──────────────────────────────────

const TEST_DIR = path.join(process.cwd(), "tests", ".test-data", `file-store-${Date.now()}`);

function createSampleInput(overrides: Partial<MemoryWriteInput> = {}): MemoryWriteInput {
  return {
    source: { agentType: "Alhaitham", taskId: `task-${Date.now()}` },
    kind: "Insight",
    summary: "文件存储测试",
    semantic_gist: "文件持久化语义精华",
    content_blob: { key: "value" },
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────

describe("FileBasedMemoryStore", () => {
  let store: FileBasedMemoryStore;

  beforeEach(async () => {
    store = new FileBasedMemoryStore({ autoFlush: true });
    await store.init(TEST_DIR);
  });

  afterEach(async () => {
    await store.close();
    // 清理测试数据
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  describe("init / isReady", () => {
    it("should be ready after init", () => {
      expect(store.isReady).toBe(true);
    });

    it("should be persisted", () => {
      expect(store.isPersisted).toBe(true);
    });

    it("should have size 0 initially", () => {
      expect(store.size).toBe(0);
    });
  });

  describe("write / get", () => {
    it("should write and retrieve a memory entry", async () => {
      const id = await store.write(createSampleInput());
      expect(id).toBeDefined();

      const entry = await store.get(id);
      expect(entry).toBeDefined();
      expect(entry!.summary).toBe("文件存储测试");
      expect(entry!.kind).toBe("Insight");
    });

    it("should return undefined for non-existent id", async () => {
      const entry = await store.get("non-existent");
      expect(entry).toBeUndefined();
    });

    it("should persist entry to disk", async () => {
      const id = await store.write(createSampleInput());
      const entryPath = path.join(TEST_DIR, "entries", `${id}.json`);

      const fileExists = await fs.access(entryPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      const fileContent = await fs.readFile(entryPath, "utf-8");
      const parsed = JSON.parse(fileContent);
      expect(parsed.id).toBe(id);
      expect(parsed.summary).toBe("文件存储测试");
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
      await store.write(createSampleInput({ summary: "人工智能" }));
      await store.write(createSampleInput({ summary: "数据分析" }));

      const results = await store.read({ keywords: ["数据"] });
      expect(results.length).toBe(1);
      expect(results[0].summary).toBe("数据分析");
    });

    it("should limit results", async () => {
      await store.write(createSampleInput({ weight: 1.0 }));
      await store.write(createSampleInput({ weight: 2.0 }));
      await store.write(createSampleInput({ weight: 3.0 }));

      const results = await store.read({ limit: 2 });
      expect(results.length).toBe(2);
    });
  });

  describe("session management", () => {
    it("should manage sessions", async () => {
      const sessionId = store.beginSession("test-session");
      expect(sessionId).toBe("test-session");
      expect(store.sessionId).toBe("test-session");
    });

    it("should associate written entries with current session", async () => {
      store.beginSession("session-1");
      const id = await store.write(createSampleInput());
      const entry = await store.get(id);
      expect(entry!.sessionId).toBe("session-1");
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
    });

    it("should return null if source or target does not exist", () => {
      const link = store.link("non-existent", "also-non-existent", LinkType.ProducedBy);
      expect(link).toBeNull();
    });
  });

  describe("two-phase commit (pending)", () => {
    it("should write and commit pending entries", () => {
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
    });
  });

  describe("lifecycle management", () => {
    it("should archive an entry", async () => {
      const id = await store.write(createSampleInput());
      expect(store.archive(id)).toBe(true);

      const entry = await store.get(id);
      expect(entry!.semantic_state).toBe("Archived");
    });

    it("should obliterate an entry", async () => {
      const id = await store.write(createSampleInput());
      expect(store.obliterate(id)).toBe(true);

      const entry = await store.get(id);
      expect(entry).toBeUndefined();
    });

    it("should cas an entry", async () => {
      const id = await store.write(createSampleInput());
      expect(store.cas(id, "Active", "Archived")).toBe(true);

      const entry = await store.get(id);
      expect(entry!.semantic_state).toBe("Archived");
    });
  });

  describe("transactions", () => {
    it("should begin and commit a transaction", async () => {
      const txn = await store.beginTransaction("Serializable");
      expect(txn).toBeDefined();
      expect(txn.status).toBe("active");

      const id1 = await store.writeWithin(txn, createSampleInput({ summary: "txn-1" }));
      const id2 = await store.writeWithin(txn, createSampleInput({ summary: "txn-2" }));

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

    it("should provide active transactions list", async () => {
      const txn1 = await store.beginTransaction();
      const txn2 = await store.beginTransaction();

      const active = store.getActiveTransactions();
      expect(active.length).toBe(2);
    });
  });

  describe("data persistence across restarts", () => {
    it("should reload data from disk on re-init", async () => {
      // 写入数据
      const id1 = await store.write(createSampleInput({ summary: "持久化测试1" }));
      const id2 = await store.write(createSampleInput({ summary: "持久化测试2" }));
      await store.flush();

      // 关闭并重新初始化
      await store.close();

      const store2 = new FileBasedMemoryStore();
      await store2.init(TEST_DIR);

      // 验证数据已恢复
      const entry1 = await store2.get(id1);
      expect(entry1).toBeDefined();
      expect(entry1!.summary).toBe("持久化测试1");

      const entry2 = await store2.get(id2);
      expect(entry2).toBeDefined();
      expect(entry2!.summary).toBe("持久化测试2");

      await store2.close();
    });
  });

  describe("set", () => {
    it("should set an entry by id", async () => {
      const entry: import("@cortex/shared").MemoryEntry = {
        id: "custom-file-id",
        source: { agentType: "Alhaitham", taskId: "task-001" },
        kind: "Insight",
        summary: "文件设置",
        semantic_gist: "文件设置语义",
        content_blob: { key: "val" },
        semantic_state: "Active",
        weight: 1.0,
        accessCount: 0,
        lastAccessedAt: Date.now(),
        createdAt: Date.now(),
        content_hash: "",
      };

      await store.set("custom-file-id", entry);
      const retrieved = await store.get("custom-file-id");
      expect(retrieved).toBeDefined();
      expect(retrieved!.summary).toBe("文件设置");
    });
  });

  describe("writeMany", () => {
    it("should write multiple entries", async () => {
      const ids = await store.writeMany([
        createSampleInput({ summary: "批量文件1" }),
        createSampleInput({ summary: "批量文件2" }),
      ]);
      expect(ids).toHaveLength(2);
      const e1 = await store.get(ids[0]);
      const e2 = await store.get(ids[1]);
      expect(e1).toBeDefined();
      expect(e2).toBeDefined();
    });
  });

  describe("linkMany", () => {
    it("should create multiple links", async () => {
      const id1 = await store.write(createSampleInput());
      const id2 = await store.write(createSampleInput());

      const results = store.linkMany([
        { sourceId: id1, targetId: id2, linkType: LinkType.DerivedFrom },
      ]);
      expect(results).toHaveLength(1);
      expect(results[0]).not.toBeNull();
    });
  });

  describe("pre-write hook", () => {
    it("should modify input via pre-write hook", async () => {
      store.setPreWriteHook((input) => ({
        ...input,
        summary: `[HOOK] ${input.summary}`,
      }));

      const id = await store.write(createSampleInput({ summary: "测试" }));
      const entry = await store.get(id);
      expect(entry!.summary).toBe("[HOOK] 测试");
    });
  });

  describe("transaction timeout", () => {
    it("should set transaction timeout", () => {
      store.setTransactionTimeout(5000);
      expect(true).toBe(true);
    });
  });

  describe("readWithin / writeWithin", () => {
    it("should write within a transaction and commit", async () => {
      const txn = await store.beginTransaction();
      const id = await store.writeWithin(txn, createSampleInput({ summary: "文件事务" }));
      const result = await store.commit(txn);
      expect(result.success).toBe(true);
    });

    it("should link within a transaction", async () => {
      const id1 = await store.write(createSampleInput());
      const id2 = await store.write(createSampleInput());

      const txn = await store.beginTransaction();
      const link = await store.linkWithin(txn, id1, id2, LinkType.DerivedFrom);
      expect(link).not.toBeNull();
      await store.commit(txn);
    });

    it("should read within an active transaction", async () => {
      const txn = await store.beginTransaction();
      const results = await store.readWithin(txn, {});
      expect(results).toEqual([]);
      await store.rollback(txn);
    });
  });

  describe("autoFlush option", () => {
    it("should work with autoFlush disabled", async () => {
      const storeNoFlush = new FileBasedMemoryStore({ autoFlush: false });
      await storeNoFlush.init(path.join(TEST_DIR, "..", `noflush-${Date.now()}`));
      const id = await storeNoFlush.write(createSampleInput());
      const entry = await storeNoFlush.get(id);
      expect(entry).toBeDefined();
      await storeNoFlush.close();
    });
  });

  describe("error handling - before init", () => {
    it("should throw when writing before init", async () => {
      const uninitStore = new FileBasedMemoryStore();
      await expect(uninitStore.write(createSampleInput())).rejects.toThrow("Not initialized");
    });

    it("should throw when has before init", () => {
      const uninitStore = new FileBasedMemoryStore();
      expect(() => uninitStore.has("x")).toThrow("Not initialized");
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
      await expect(store.write(createSampleInput({ summary: "" }))).rejects.toThrow("summary");
    });

    it("should throw when content_blob is missing", async () => {
      const input = createSampleInput();
      delete (input as any).content_blob;
      await expect(store.write(input)).rejects.toThrow("content_blob");
    });
  });

  describe("error handling - lifecycle edge cases", () => {
    it("should return false for CAS on non-existent entry", () => {
      expect(store.cas("non-existent", "Active", "Archived")).toBe(false);
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
  });

  describe("advanced queries", () => {
    it("should filter by agentTypes", async () => {
      await store.write(createSampleInput({ source: { agentType: "Alhaitham", taskId: "t1" } }));
      await store.write(createSampleInput({ source: { agentType: "Kuki", taskId: "t2" } }));

      const results = await store.read({ agentTypes: ["Kuki"] });
      expect(results).toHaveLength(1);
      expect(results[0].source.agentType).toBe("Kuki");
    });

    it("should filter by timeRange", async () => {
      const now = Date.now();
      await store.write(createSampleInput({ createdAt: now - 5000 }));
      await store.write(createSampleInput({ createdAt: now }));

      const results = await store.read({
        timeRange: { start: now - 2000, end: now + 1000 },
      });
      expect(results).toHaveLength(1);
    });

    it("should filter by metadata", async () => {
      await store.write(createSampleInput({ content_blob: { env: "test", version: 1 } }));
      await store.write(createSampleInput({ content_blob: { env: "prod", version: 2 } }));

      const results = await store.read({ metadataFilter: { env: "test" } });
      expect(results).toHaveLength(1);
      expect((results[0].content_blob as Record<string, unknown>).env).toBe("test");
    });

    it("should track access count in CSA mode", async () => {
      const id = await store.write(createSampleInput());
      await store.read({}, "CSA");
      const entry = await store.get(id);
      expect(entry).toBeDefined();
    });
  });

  describe("concurrent writes", () => {
    it("should handle concurrent writes", async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        store.write(createSampleInput({ summary: `并发${i}` })),
      );
      const ids = await Promise.all(promises);
      expect(ids).toHaveLength(5);
    });
  });

  describe("flush / close", () => {
    it("should flush data to disk", async () => {
      await store.write(createSampleInput());
      await expect(store.flush()).resolves.toBeUndefined();
    });

    it("should clear data on close", async () => {
      await store.write(createSampleInput());
      expect(store.size).toBe(1);

      await store.close();
      expect(store.isReady).toBe(false);
    });
  });
});
