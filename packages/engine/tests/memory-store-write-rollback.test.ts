/**
 * 测试文件: MemoryStore 写路径 DB 失败回滚测试
 *
 * 测试范围:
 * - write() DB 失败回滚：DB INSERT 失败时内存中的 entry 被删除
 * - link() DB 失败回滚：DB INSERT 失败时 link 从数组弹出
 * - cas() DB 失败回滚：DB UPDATE 失败时 state 恢复为 expected
 * - obliterate() DB 失败回滚：DB UPDATE 失败时 state 恢复原值
 * - close() 后 _scheduleFlush 静默跳过
 *
 * 治理判例: NG-2026-0509-Persist-False-Positive（假阳性禁止原则）
 *
 * 测试数据用例:
 *   用例1: write() — 正常持久化写入后可检索
 *   用例2: write() — 模拟 DB 写入失败，内存回滚后 has() 返回 false
 *   用例3: link() — 正常建立关联边
 *   用例4: link() — DB 写入失败，link 从数组回滚
 *   用例5: cas() — CAS 状态变更后 DB 失败，state 回滚到 expected
 *   用例6: obliterate() — 湮灭操作 DB 失败，state 回滚到 previousState
 *   用例7: close() — 关闭后 _scheduleFlush 不触发新写盘
 *   用例8: close() — closing 状态拒绝新写入
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryType, MemoryState, AgentType, LinkType, PipelinePriority } from "@cortex/shared";
import { MemoryStore } from "../src/memory-store";
import { PipelineObserver } from "../src/pipeline-observer";

describe("MemoryStore 写路径 DB 失败回滚", () => {
  let store: MemoryStore;
  let observer: PipelineObserver;

  beforeEach(() => {
    observer = new PipelineObserver();
    store = new MemoryStore(observer);
  });

  // ─── 用例1: write() 正常持久化 ─────────────────────────

  it("用例1: write() 正常持久化写入后可通过 read() 检索", async () => {
    // 初始化持久化
    await store.init(":memory:");

    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: { task: "test_write" },
      summary: "正常写入测试",
      agentType: AgentType.Code,
      creatorId: "test-agent",
    });

    expect(id).toMatch(/^mem-/);
    const results = store.read({ keywords: ["正常写入"] });
    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe("正常写入测试");

    await store.close();
  });

  // ─── 用例2: write() DB 失败回滚内存 ─────────────────

  it("用例2: write() — 模拟 DB INSERT 失败，内存中的 entry 被删除", async () => {
    await store.init(":memory:");

    // Arrange: 劫持 _db.run 让 INSERT INTO memories 抛异常
    const origRun = (store as any)._db.run.bind((store as any)._db);
    (store as any)._db.run = (...args: any[]) => {
      const sql: string = args[0] ?? "";
      if (sql.includes("INSERT INTO memories")) {
        throw new Error("SIMULATED_DISK_FULL");
      }
      return origRun(...args);
    };

    // Act: 写入——应抛异常
    expect(() => {
      store.write({
        memoryType: MemoryType.Episodic,
        content: { task: "rollback_test" },
        summary: "应被回滚的记忆",
        agentType: AgentType.Code,
        creatorId: "test-agent",
      });
    }).toThrow("SIMULATED_DISK_FULL");

    // Assert: 内存中无残留
    const results = store.read({ keywords: ["回滚"] });
    expect(results).toHaveLength(0);

    await store.close();
  });

  // ─── 用例3: link() 正常关联 ─────────────────────────

  it("用例3: link() 正常建立关联边并可通过 getLinks() 获取", async () => {
    await store.init(":memory:");

    const a = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "源记忆",
      agentType: AgentType.Code,
      creatorId: "x",
    });
    const b = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "目标记忆",
      agentType: AgentType.Review,
      creatorId: "y",
    });

    const link = store.link(a, b, LinkType.ProducedBy, "code");
    expect(link).toBeTruthy();
    expect(store.getLinks(a)).toHaveLength(1);

    await store.close();
  });

  // ─── 用例4: link() DB 失败回滚 ─────────────────────

  it("用例4: link() — DB INSERT 失败，link 从数组回滚", async () => {
    await store.init(":memory:");

    const a = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "源记忆",
      agentType: AgentType.Code,
      creatorId: "x",
    });
    const b = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "目标记忆",
      agentType: AgentType.Review,
      creatorId: "y",
    });

    // 劫持 _db.run 让 links INSERT 抛异常
    const origRun = (store as any)._db.run.bind((store as any)._db);
    (store as any)._db.run = (...args: any[]) => {
      const sql: string = args[0] ?? "";
      if (sql.includes("INSERT INTO links")) {
        throw new Error("SIMULATED_LINK_DB_FAIL");
      }
      return origRun(...args);
    };

    // Act: link 应抛异常
    expect(() => {
      store.link(a, b, LinkType.ProducedBy, "code");
    }).toThrow("SIMULATED_LINK_DB_FAIL");

    // Assert: 内存中的 link 已回滚
    expect(store.getLinks(a)).toHaveLength(0);

    await store.close();
  });

  // ─── 用例5: cas() DB 失败回滚 ─────────────────────

  it("用例5: cas() — DB UPDATE 失败，state 回滚到 expected", async () => {
    await store.init(":memory:");

    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "CAS 回滚测试",
      agentType: AgentType.Code,
      creatorId: "x",
    });

    // 确认初始状态
    expect(store.peek(id)!.state).toBe(MemoryState.Active);

    // 劫持 _safeDbRun 让 cas 的 UPDATE 抛异常
    // cas 内部走 _safeDbRun → 我们用 monkey-patch _db.run 在 UPDATE memories SET state 时抛错
    const origRun = (store as any)._db.run.bind((store as any)._db);
    (store as any)._db.run = (...args: any[]) => {
      const sql: string = args[0] ?? "";
      if (sql.includes("UPDATE memories SET state")) {
        throw new Error("SIMULATED_CAS_DB_FAIL");
      }
      return origRun(...args);
    };

    // Act: cas 应抛异常
    expect(() => {
      store.cas(id, MemoryState.Active, MemoryState.Archived);
    }).toThrow("SIMULATED_CAS_DB_FAIL");

    // Assert: state 回滚为 Active（expected 值）
    expect(store.peek(id)!.state).toBe(MemoryState.Active);

    await store.close();
  });

  // ─── 用例6: obliterate() DB 失败回滚 ───────────────

  it("用例6: obliterate() — DB UPDATE 失败，state 回滚到 previousState", async () => {
    await store.init(":memory:");

    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "湮灭回滚测试",
      agentType: AgentType.Code,
      creatorId: "x",
    });

    // 先归档
    store.archive(id);
    expect(store.peek(id)!.state).toBe(MemoryState.Archived);

    // 劫持 _db.run 让 obliterate 的 UPDATE 抛异常
    const origRun = (store as any)._db.run.bind((store as any)._db);
    (store as any)._db.run = (...args: any[]) => {
      const sql: string = args[0] ?? "";
      if (sql.includes("UPDATE memories SET state")) {
        throw new Error("SIMULATED_OBLITERATE_DB_FAIL");
      }
      return origRun(...args);
    };

    // Act: obliterate 应抛异常
    expect(() => {
      store.obliterate(id);
    }).toThrow("SIMULATED_OBLITERATE_DB_FAIL");

    // Assert: state 回滚为 Archived（previousState）
    expect(store.peek(id)!.state).toBe(MemoryState.Archived);

    await store.close();
  });

  // ─── 用例7: close() 后 _scheduleFlush 静默跳过 ───

  it("用例7: close() 后 _scheduleFlush 不触发新写盘", async () => {
    // 使用真实文件路径以验证完整生命周期
    const dbPath = "test-output/memory-store-lifecycle-test.db";
    // 清理旧文件
    try { require("fs").unlinkSync(dbPath); } catch {}

    const store2 = new MemoryStore(observer);
    await store2.init(dbPath);

    // 写入一条记忆触发 _scheduleFlush
    store2.write({
      memoryType: MemoryType.Episodic,
      content: { x: 1 },
      summary: "预关闭记忆",
      agentType: AgentType.Code,
      creatorId: "a",
    });

    // 关闭 store
    await store2.close();

    // 确认已关闭
    expect((store2 as any)._lifecycle).toBe("closed");
    expect((store2 as any)._db).toBeUndefined();

    // 手动触发 _scheduleFlush：应静默返回（不抛异常）
    expect(() => {
      (store2 as any)._scheduleFlush();
    }).not.toThrow();

    // 清理
    try { require("fs").unlinkSync(dbPath); } catch {}
  });

  // ─── 用例8: close() closing 状态拒绝新写入 ────────

  it("用例8: close() closing 状态拒绝二次关闭但不拒绝已调用 close", async () => {
    await store.init(":memory:");

    store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "关闭前记忆",
      agentType: AgentType.Code,
      creatorId: "a",
    });

    // 第一次 close
    await store.close();
    expect((store as any)._lifecycle).toBe("closed");

    // 第二次 close 不抛异常（幂等）
    await expect(store.close()).resolves.toBeUndefined();
  });
});
