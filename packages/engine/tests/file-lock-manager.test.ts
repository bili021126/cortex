// @ci: unit
import { describe, it, expect } from "vitest";
import { FileLockManager } from "../src/file-lock-manager";
import { LockType } from "@cortex/shared";

describe("FileLockManager", () => {
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
});
