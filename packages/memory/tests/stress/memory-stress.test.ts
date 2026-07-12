// @ci: stress
/**
 * memory-stress.test.ts — Memory 系统压力测试
 *
 * 场景:
 *   1. 1000条连续写入 → 查询性能 < 50ms
 *   2. 并发 writePending(5任务) → commit(5任务) → 无脏数据
 *   3. rollback 连续10次 → 状态一致性
 *
 * 所有测试使用 InMemoryMemoryStore（纯内存，无 I/O 噪声）。
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryMemoryStore } from "@cortex/memory";
import type { MemoryWriteInput } from "@cortex/shared";
import { LinkType } from "@cortex/shared";

// ─── 测试夹具 ──────────────────────────────────

function createSampleInput(overrides: Partial<MemoryWriteInput> = {}): MemoryWriteInput {
  return {
    source: { agentType: "Alhaitham", taskId: `stress-${Date.now()}` },
    kind: "Insight",
    summary: "压力测试记忆",
    semantic_gist: "stress test content",
    content_blob: { key: "value" },
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════
// 场景 1: 1000条连续写入 → 查询性能 < 50ms
// ══════════════════════════════════════════════════════════════

describe("场景1: 1000条连续写入 → 查询性能 < 50ms", () => {
  let store: InMemoryMemoryStore;

  beforeEach(async () => {
    store = new InMemoryMemoryStore();
    await store.init(":memory:");
  });

  it("1000条连续写入应全部成功", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const id = await store.write(createSampleInput({ summary: `entry-${i}` }));
      ids.push(id);
    }

    expect(ids.length).toBe(1000);
    expect(store.size).toBe(1000);

    // 随机验证几条
    const entry0 = await store.get(ids[0]!);
    expect(entry0!.summary).toBe("entry-0");

    const entry999 = await store.get(ids[999]!);
    expect(entry999!.summary).toBe("entry-999");

    const entry500 = await store.get(ids[500]!);
    expect(entry500!.summary).toBe("entry-500");
  });

  it("1000条后全量 read 应在 50ms 内完成", async () => {
    // 写入 1000 条
    for (let i = 0; i < 1000; i++) {
      await store.write(createSampleInput({ summary: `perf-${i}` }));
    }

    const start = performance.now();
    const results = await store.read({});
    const elapsed = performance.now() - start;

    expect(results.length).toBe(1000);
    expect(elapsed).toBeLessThan(50);
  });

  it("1000条后关键词查询应在 50ms 内完成", async () => {
    for (let i = 0; i < 1000; i++) {
      await store.write(createSampleInput({ summary: `target-${i % 10}` }));
    }

    const start = performance.now();
    const results = await store.read({ keywords: ["target-5"] });
    const elapsed = performance.now() - start;

    // 1000/10 = 100 条匹配
    expect(results.length).toBe(100);
    expect(elapsed).toBeLessThan(50);
  });

  it("1000条后 kind 过滤查询应在 50ms 内完成", async () => {
    for (let i = 0; i < 1000; i++) {
      await store.write(createSampleInput({
        kind: i % 2 === 0 ? "Insight" : "TaskLog",
        summary: `kind-${i}`,
      }));
    }

    const start = performance.now();
    const results = await store.read({ kind: "TaskLog" });
    const elapsed = performance.now() - start;

    expect(results.length).toBe(500);
    expect(elapsed).toBeLessThan(50);
  });

  it("1000条后 size 应保持正确", async () => {
    for (let i = 0; i < 1000; i++) {
      await store.write(createSampleInput());
    }

    expect(store.size).toBe(1000);
  });

  it("1000条后 has/peek 应正确工作", async () => {
    const firstId = await store.write(createSampleInput({ summary: "first" }));
    for (let i = 0; i < 998; i++) {
      await store.write(createSampleInput());
    }
    const lastId = await store.write(createSampleInput({ summary: "last" }));

    expect(store.has(firstId)).toBe(true);
    expect(store.has(lastId)).toBe(true);
    expect(store.has("non-existent")).toBe(false);

    const peeked = store.peek(firstId);
    expect(peeked!.summary).toBe("first");
  });
});

// ══════════════════════════════════════════════════════════════
// 场景 2: 并发 writePending(5任务) → commit(5任务) → 无脏数据
// ══════════════════════════════════════════════════════════════

describe("场景2: 并发 writePending → commit → 无脏数据", () => {
  let store: InMemoryMemoryStore;

  beforeEach(async () => {
    store = new InMemoryMemoryStore();
    await store.init(":memory:");
  });

  it("5个 writePending 各自 commit 后 read 应包含全部", async () => {
    const p1 = store.writePending(createSampleInput({ summary: "pending-1" }));
    const p2 = store.writePending(createSampleInput({ summary: "pending-2" }));
    const p3 = store.writePending(createSampleInput({ summary: "pending-3" }));
    const p4 = store.writePending(createSampleInput({ summary: "pending-4" }));
    const p5 = store.writePending(createSampleInput({ summary: "pending-5" }));

    // 并发 commit
    store.commitMemory(p1);
    store.commitMemory(p2);
    store.commitMemory(p3);
    store.commitMemory(p4);
    store.commitMemory(p5);

    const results = await store.read({});
    expect(results.length).toBe(5);
    const summaries = results.map(r => r.summary).sort();
    expect(summaries).toEqual([
      "pending-1", "pending-2", "pending-3", "pending-4", "pending-5",
    ]);
  });

  it("并发 write 应全部写入无竞争", async () => {
    const promises: Promise<string>[] = [];
    for (let i = 0; i < 5; i++) {
      promises.push(store.write(createSampleInput({ summary: `concurrent-${i}` })));
    }
    const ids = await Promise.all(promises);

    expect(ids.length).toBe(5);
    expect(store.size).toBe(5);

    const results = await store.read({});
    expect(results.length).toBe(5);
  });

  it("writePending 未 commit 时不应出现在 read 中", async () => {
    const id1 = store.writePending(createSampleInput({ summary: "still-pending" }));
    const id2 = await store.write(createSampleInput({ summary: "already-committed" }));

    // 未 commit 的 pending 不应出现在 read 中
    const results = await store.read({});
    expect(results.length).toBe(1);
    expect(results[0]!.summary).toBe("already-committed");

    // commit 后出现
    store.commitMemory(id1);
    const results2 = await store.read({});
    expect(results2.length).toBe(2);
  });

  it("writePending 一半 commit 一半 rollback 应只有 commit 的可见", () => {
    const id1 = store.writePending(createSampleInput({ summary: "commit-me" }));
    const id2 = store.writePending(createSampleInput({ summary: "rollback-me" }));
    const id3 = store.writePending(createSampleInput({ summary: "commit-me-too" }));

    store.commitMemory(id1);
    store.rollback(id2);
    store.commitMemory(id3);

    const results = store.read({});
    // 注意 read 是异步的，但 InMemoryMemoryStore 的 pending 处理是同步的
    // 这里我们用 has() 来检查
    expect(store.has(id1)).toBe(true);  // committed
    expect(store.has(id2)).toBe(false); // rolled back
    expect(store.has(id3)).toBe(true);  // committed
  });
});

// ══════════════════════════════════════════════════════════════
// 场景 3: rollback 连续10次 → 状态一致性
// ══════════════════════════════════════════════════════════════

describe("场景3: rollback 连续10次 → 状态一致性", () => {
  let store: InMemoryMemoryStore;

  beforeEach(async () => {
    store = new InMemoryMemoryStore();
    await store.init(":memory:");
  });

  it("连续 10 次 writePending → rollback → size 保持 0", async () => {
    for (let i = 0; i < 10; i++) {
      const id = store.writePending(createSampleInput({ summary: `rb-${i}` }));
      store.rollback(id);
    }

    expect(store.size).toBe(0);
    // InMemory 的 read 不返回 pending 条目
    const results = await store.read({});
    expect(results).toHaveLength(0);
  });

  it("连续 5 次 rollback 后继续正常 commit 应工作", async () => {
    // 前 5 个 rollback
    for (let i = 0; i < 5; i++) {
      const id = store.writePending(createSampleInput({ summary: `cancel-${i}` }));
      store.rollback(id);
    }

    // 后 5 个正常 commit
    for (let i = 0; i < 5; i++) {
      const id = store.writePending(createSampleInput({ summary: `keep-${i}` }));
      store.commitMemory(id);
    }

    expect(store.size).toBe(5);
    const check = await store.read({});
    expect(check).toHaveLength(5);
  });

  it("rollback 已 rollback 的条目应返回 false（幂等）", async () => {
    const id = store.writePending(createSampleInput({ summary: "double-rb" }));
    const first = await store.rollback(id);
    expect(first).toBe(true);

    const second = await store.rollback(id);
    expect(second).toBe(false); // 已不存在，返回 false
  });

  it("rollback 不存在的条目应返回 false", async () => {
    const result = await store.rollback("ghost-id");
    expect(result).toBe(false);
  });

  it("混合 writePending / commit / rollback 后索引一致性", async () => {
    // 写入一些正常条目
    const safeIds = await Promise.all([
      store.write(createSampleInput({ summary: "safe-1" })),
      store.write(createSampleInput({ summary: "safe-2" })),
    ]);

    // 创建并回滚一些 pending 条目
    const rbId1 = store.writePending(createSampleInput({ summary: "rb-1" }));
    const rbId2 = store.writePending(createSampleInput({ summary: "rb-2" }));
    store.rollback(rbId1);
    store.rollback(rbId2);

    // 创建并提交一些 pending 条目
    const cmId1 = store.writePending(createSampleInput({ summary: "cm-1" }));
    const cmId2 = store.writePending(createSampleInput({ summary: "cm-2" }));
    store.commitMemory(cmId1);
    store.commitMemory(cmId2);

    // 最终应有 4 条可见
    const results = await store.read({});
    expect(results.length).toBe(4);
  });
});
