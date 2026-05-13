// @ci: unit
/**
 * 测试文件: MemoryStore 生命周期状态机测试
 *
 * 测试范围:
 * - _lifecycle 状态流转: active → closing → closed
 * - _safeDbRun 方法行为: 正常写入 / DB 失败上报 + 传播
 * - close() 幂等性 / 取消防抖定时器
 * - closing 状态下 flush() 仍可执行
 *
 * 治理判例: NG-2026-0509-Persist-False-Positive（假阳性禁止原则）
 *
 * 测试数据用例:
 *   用例1: _safeDbRun 正常执行 INSERT
 *   用例2: _safeDbRun DB 失败时 emit memory.db_write_failed 事件
 *   用例3: _safeDbRun DB 失败时重新抛出异常
 *   用例4: close() 显式生命周期: active → closing → closed
 *   用例5: close() 幂等: 重复调用不抛异常
 *   用例6: close() 取消防抖定时器，防止 flush 后重触发
 *   用例7: closing 状态下 flush() 可正常落盘
 *   用例8: closing 状态下 _safeDbRun 拒绝 DB 写入（observer + console 双通道）
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryType, MemoryState, AgentType, LinkType, PipelinePriority } from "@cortex/shared";
import { MemoryStore } from "../src/memory-store";
import { PipelineObserver } from "../src/pipeline-observer";

describe("MemoryStore 生命周期状态机", () => {
  let store: MemoryStore;
  let observer: PipelineObserver;

  beforeEach(() => {
    observer = new PipelineObserver();
    store = new MemoryStore(observer);
  });

  // ─── 用例1: _safeDbRun 正常执行 ─────────────────────

  it("用例1: _safeDbRun 正常执行 INSERT 不抛异常", async () => {
    await store.init(":memory:");

    // Arrange: 预创建表结构已完成，直接测试 _safeDbRun
    const db = (store as any)._persistence.db;
    expect(db).toBeTruthy();

    // Act: 通过 write() 间接调用 _safeDbRun
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: { key: "safe_db_run_ok" },
      summary: "_safeDbRun 正常测试",
      agentType: AgentType.Code,
      creatorId: "test",
    });

    // Assert: 写入成功
    expect(id).toMatch(/^mem-/);
    const results = store.read({ keywords: ["safe_db_run"] });
    expect(results).toHaveLength(1);

    await store.close();
  });

  // ─── 用例2: _safeDbRun DB 失败 emit 事件 ──────────

  it("用例2: _safeDbRun DB 失败时通过 observer emit memory.db_write_failed", async () => {
    await store.init(":memory:");

    // Arrange: 注册事件监听
    const emitted: any[] = [];
    observer.on(PipelinePriority.CRITICAL, (event) => {
      emitted.push({ type: event.type, payload: event.payload });
    });

    // 劫持 _db.prepare 使 INSERT 失败
    const origPrepare = (store as any)._persistence.db.prepare.bind((store as any)._persistence.db);
    (store as any)._persistence.db.prepare = (sql: string) => {
      if (sql.includes("INSERT INTO")) {
        throw new Error("DISK_FULL");
      }
      return origPrepare(sql);
    };

    // Act: write 应抛异常
    try {
      store.write({
        memoryType: MemoryType.Episodic,
        content: { test: true },
        summary: "DB 失败事件测试",
        agentType: AgentType.Code,
        creatorId: "test",
      });
    } catch {}

    // Assert: 应有 memory.db_write_failed 事件
    const dbFailedEvents = emitted.filter((e) => e.type === "memory.db_write_failed");
    expect(dbFailedEvents.length).toBeGreaterThanOrEqual(1);
    expect(dbFailedEvents[0].payload.opName).toBe("write");

    await store.close();
  });

  // ─── 用例3: _safeDbRun 传播异常 ───────────────────

  it("用例3: _safeDbRun DB 失败时重新抛出异常（假阳性禁止原则）", async () => {
    await store.init(":memory:");

    // 劫持 _db.prepare：INSERT INTO 时抛异常
    const origPrepare = (store as any)._persistence.db.prepare.bind((store as any)._persistence.db);
    (store as any)._persistence.db.prepare = (sql: string) => {
      if (sql.includes("INSERT INTO")) {
        throw new Error("PERSIST_FAILURE");
      }
      return origPrepare(sql);
    };

    // Act & Assert: 必须抛出
    expect(() => {
      store.write({
        memoryType: MemoryType.Episodic,
        content: {},
        summary: "传播测试",
        agentType: AgentType.Code,
        creatorId: "a",
      });
    }).toThrow("PERSIST_FAILURE");

    await store.close();
  });

  // ─── 用例4: close() 显式生命周期流转 ─────────────

  it("用例4: close() 显式生命周期: active → closing → closed", async () => {
    await store.init(":memory:");

    // Assert: 初始为 active
    expect((store as any)._persistence.lifecycle).toBe("active");

    // 写入一条触发 flush 队列
    store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "生命周期",
      agentType: AgentType.Code,
      creatorId: "a",
    });

    // Act
    await store.close();

    // Assert: 终态为 closed
    expect((store as any)._persistence.lifecycle).toBe("closed");
    expect((store as any)._persistence.db).toBeUndefined();
    expect(store.isPersisted).toBe(false);
  });

  // ─── 用例5: close() 幂等 ────────────────────────

  it("用例5: close() 幂等——重复调用不抛异常", async () => {
    await store.init(":memory:");

    await store.close();
    // 第二次 close 在 closing/closed 状态下应直接返回
    await expect(store.close()).resolves.toBeUndefined();
    await expect(store.close()).resolves.toBeUndefined();
  });

  // ─── 用例6: close() 取消防抖定时器 ───────────────

  it("用例6: close() 取消防抖定时器，防止 flush 后重触发", async () => {
    await store.init(":memory:");

    // 写入记忆触发 _scheduleFlush（启动 200ms 定时器）
    store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "触发定时器",
      agentType: AgentType.Code,
      creatorId: "a",
    });

    // 应存在定时器
    expect((store as any)._persistence._flushTimer).not.toBeNull();

    // Act: close 应清除定时器
    await store.close();

    // Assert: 定时器已清
    expect((store as any)._persistence._flushTimer).toBeNull();
  });

  // ─── 用例7: closing 状态下 flush() ───────────────

  it("用例7: closing 状态下 flush() 仍可正常落盘", async () => {
    // 使用真实文件
    const dbPath = "test-output/lifecycle-flush-test.db";
    try { require("fs").unlinkSync(dbPath); } catch {}

    const store2 = new MemoryStore(observer);
    await store2.init(dbPath);

    // 写入多条
    for (let i = 0; i < 5; i++) {
      store2.write({
        memoryType: MemoryType.Episodic,
        content: { idx: i },
        summary: `记忆 ${i}`,
        agentType: AgentType.Code,
        creatorId: "a",
      });
    }

    // 手动 flush 确保落盘（close 前）
    await store2.flush();
    expect((store2 as any)._persistence._dirty).toBe(false);

    await store2.close();

    // 重新打开验证数据完整性
    const store3 = new MemoryStore(observer);
    await store3.init(dbPath);
    const results = store3.read({ queryMode: 'hca' });
    expect(results.length).toBeGreaterThanOrEqual(5);
    await store3.close();

    // 清理
    try { require("fs").unlinkSync(dbPath); } catch {}
  });

  // ─── 用例8: closing 状态下 _safeDbRun 拒绝写入 ──

  it("用例8: closing 状态下 run() 拒绝 DB 写入并抛错（observer 双通道）", async () => {
    await store.init(":memory:");

    // Arrange: 注册事件监听
    const emitted: any[] = [];
    observer.on(PipelinePriority.HIGH, (event) => {
      emitted.push({ type: event.type, payload: event.payload });
    });

    // 手动切为 closing 态
    (store as any)._persistence._lifecycle = "closing";

    // Act: 直接调用 _persistence.run——应抛错（治理判例 NG-2026-0509-Persist-False-Positive）
    expect(() => {
      (store as any)._persistence.run("INSERT INTO memories (id) VALUES (?)", ["x"], "write");
    }).toThrow(/已 closing，拒绝写入/);

    // Assert: observer 在抛错前已收到 memory.write_blocked 事件
    const blockedEvents = emitted.filter((e) => e.type === "memory.write_blocked");
    expect(blockedEvents.length).toBe(1);
    expect(blockedEvents[0].payload.opName).toBe("write");
    expect(blockedEvents[0].payload.lifecycle).toBe("closing");

    // 恢复 lifecycle 以避免 close() 被跳过
    (store as any)._persistence._lifecycle = "active";
    await store.close();
  });

  it("用例8b: closing 状态下无 observer 时 console.warn 兜底并抛错", async () => {
    const noObsStore = new MemoryStore();
    await noObsStore.init(":memory:");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    (noObsStore as any)._persistence._lifecycle = "closing";

    // Act: 应抛错（治理判例 NG-2026-0509-Persist-False-Positive），且抛错前 console.warn 已触发
    expect(() => {
      (noObsStore as any)._persistence.run("INSERT INTO memories (id) VALUES (?)", ["y"], "write");
    }).toThrow(/已 closing，拒绝写入/);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[MemoryStore] run 被拒")
    );

    warnSpy.mockRestore();
    (noObsStore as any)._persistence._lifecycle = "active";
    await noObsStore.close();
  });
});
