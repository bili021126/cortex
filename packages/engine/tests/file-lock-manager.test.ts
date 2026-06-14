// @ci: unit
import { describe, it, expect, beforeEach, vi } from "vitest";
import { FileLockManager } from "@cortex/engine";
import { LockType, PipelineEventType } from "@cortex/shared";
import type { IPipelineObserver } from "@cortex/shared";

function mockObserver(): { observer: IPipelineObserver; events: any[] } {
  const events: any[] = [];
  return {
    observer: { emit: (e) => { events.push(e); }, on: () => {}, off: () => {} },
    events,
  };
}

describe("FileLockManager 基本锁操作", () => {
  it("首次获取读锁成功", () => {
    const flm = new FileLockManager();
    expect(flm.acquire("/test.ts", LockType.Read, "agent-1")).toBe(true);
    expect(flm.isLocked("/test.ts")).toBe(true);
  });

  it("读锁共存——两个 holder 可同时持有读锁", () => {
    const flm = new FileLockManager();
    expect(flm.acquire("/test.ts", LockType.Read, "agent-1")).toBe(true);
    expect(flm.acquire("/test.ts", LockType.Read, "agent-2")).toBe(true);
    expect(flm.holds("/test.ts", "agent-1")).toBe(true);
    expect(flm.holds("/test.ts", "agent-2")).toBe(true);
  });

  it("写锁排斥读锁", () => {
    const flm = new FileLockManager();
    flm.acquire("/test.ts", LockType.Write, "agent-1");
    expect(flm.acquire("/test.ts", LockType.Read, "agent-2")).toBe(false);
  });

  it("读锁排斥写锁", () => {
    const flm = new FileLockManager();
    flm.acquire("/test.ts", LockType.Read, "agent-1");
    expect(flm.acquire("/test.ts", LockType.Write, "agent-2")).toBe(false);
  });

  it("释放锁后其他 holder 可获取", () => {
    const flm = new FileLockManager();
    flm.acquire("/test.ts", LockType.Write, "agent-1");
    flm.release("/test.ts", "agent-1");
    expect(flm.acquire("/test.ts", LockType.Read, "agent-2")).toBe(true);
  });

  it("全释放后 isLocked 返回 false", () => {
    const flm = new FileLockManager();
    flm.acquire("/test.ts", LockType.Read, "agent-1");
    flm.acquire("/test.ts", LockType.Read, "agent-2");
    flm.release("/test.ts", "agent-1");
    flm.release("/test.ts", "agent-2");
    expect(flm.isLocked("/test.ts")).toBe(false);
  });

  it("touch 刷新锁活跃时间——防止误回收", () => {
    const flm = new FileLockManager(100); // 100ms 超时
    flm.acquire("/test.ts", LockType.Read, "agent-1");
    // 等待超时前 touch 续期
    flm.touch("/test.ts", "agent-1");
    expect(flm.isLocked("/test.ts")).toBe(true);
    expect(flm.holds("/test.ts", "agent-1")).toBe(true);
  });
});

describe("FileLockManager observer 集成", () => {
  it("锁超时回收时通过 observer emit 通知", () => {
    const { observer, events } = mockObserver();
    const flm = new FileLockManager(1, observer); // 1ms 立即过期

    // 获取锁
    flm.acquire("/test.ts", LockType.Read, "holder-1");

    // 等待锁过期（>1ms）
    const start = Date.now();
    while (Date.now() - start < 2) { /* busy-wait */ }

    // 全局清理（锁已过期）
    const cleaned = flm.cleanStaleLocks();
    expect(cleaned).toBe(1);

    // 验证 observer 收到通知
    expect(events.length).toBeGreaterThanOrEqual(1);
    const infraEvt = events.find((e) => e.type === PipelineEventType.InfraFileLockExpiredReclaimed);
    expect(infraEvt).toBeDefined();
    expect(infraEvt!.payload.count).toBe(1);
  });

  it("特定文件过期锁回收——observer 带路径和 holders", () => {
    const { observer, events } = mockObserver();
    const flm = new FileLockManager(1, observer);

    flm.acquire("/a/b/c.ts", LockType.Write, "agent-x");

    // 等待锁过期
    const start = Date.now();
    while (Date.now() - start < 2) { /* busy-wait */ }

    // 通过 isLocked 触发单文件清理
    expect(flm.isLocked("/a/b/c.ts")).toBe(false);

    const infraEvt = events.find((e) => e.type === PipelineEventType.InfraFileLockExpiredReclaimed);
    expect(infraEvt).toBeDefined();
    expect(infraEvt!.payload.path).toBe("/a/b/c.ts");
    expect(infraEvt!.payload.holders).toContain("agent-x");
  });
});

describe("FileLockManager 生命周期", () => {
  it("通过 init() 启动后（已启用 BaseLifecycle），锁操作正常", async () => {
    const flm = new FileLockManager();
    await flm.init();

    // 锁操作应正常
    expect(flm.acquire("/test.ts", LockType.Read, "agent-1")).toBe(true);
    expect(flm.isLocked("/test.ts")).toBe(true);

    // 清理
    flm.dispose();
  });

  it("dispose() 后拒绝所有锁操作", async () => {
    const flm = new FileLockManager();
    await flm.init();
    flm.acquire("/test.ts", LockType.Read, "agent-1");

    flm.dispose();

    expect(() => flm.acquire("/test2.ts", LockType.Read, "agent-2")).toThrow(/已释放.*acquire/);
    expect(() => flm.release("/test.ts", "agent-1")).toThrow(/已释放.*release/);
    expect(() => flm.isLocked("/test.ts")).toThrow(/已释放.*isLocked/);
    expect(() => flm.touch("/test.ts", "agent-1")).toThrow(/已释放.*touch/);
    expect(() => flm.holds("/test.ts", "agent-1")).toThrow(/已释放.*holds/);
  });

  it("dispose() 后 cleanStaleLocks 静默返回 0", async () => {
    const flm = new FileLockManager();
    await flm.init();
    flm.dispose();

    expect(flm.cleanStaleLocks()).toBe(0);
  });

  it("init() + start() 完整生命周期", async () => {
    const flm = new FileLockManager();
    await flm.init();
    await flm.start();

    expect(flm.acquire("/test.ts", LockType.Write, "agent-1")).toBe(true);

    await flm.stop();
    flm.dispose();
  });

  it("无 observer 时锁超时回收不抛异常", () => {
    const flm = new FileLockManager(1); // 1ms 超时，无 observer
    flm.acquire("/test.ts", LockType.Read, "holder-1");

    // 等待锁过期
    const start = Date.now();
    while (Date.now() - start < 2) { /* busy-wait */ }

    const cleaned = flm.cleanStaleLocks();
    expect(cleaned).toBe(1);
  });

  it("cleanStaleLocks 仅回收过期锁，活跃锁不受影响", () => {
    const flm = new FileLockManager(60_000); // 60s 超时

    flm.acquire("/active.ts", LockType.Read, "agent-1");

    const cleaned = flm.cleanStaleLocks();
    expect(cleaned).toBe(0);
    expect(flm.isLocked("/active.ts")).toBe(true);
  });
});
