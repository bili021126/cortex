// ============================================================
// MemoryEntryStateMachine 集成测试
//
// 验证 FSM 编译器集成后的状态转换正确性。
// ============================================================

import { describe, it, expect } from "vitest";
import { MemoryEntryStateMachine, stateTransitionToEvent } from "../src/memory-state-machine.js";
import type { MemState } from "../src/memory-state-machine.js";

// ══════════════════════════════════════════════
// stateTransitionToEvent — 状态对→事件映射
// ══════════════════════════════════════════════

describe("stateTransitionToEvent", () => {
  it("pending→active 映射到 commit 事件", () => {
    expect(stateTransitionToEvent("pending", "active")).toBe("commit");
  });

  it("pending→obliterated 映射到 rollback 事件", () => {
    expect(stateTransitionToEvent("pending", "obliterated")).toBe("rollback");
  });

  it("active→archived 映射到 archive 事件", () => {
    expect(stateTransitionToEvent("active", "archived")).toBe("archive");
  });

  it("active→obliterated 映射到 obliterate 事件", () => {
    expect(stateTransitionToEvent("active", "obliterated")).toBe("obliterate");
  });

  it("archived→active 映射到 restore 事件", () => {
    expect(stateTransitionToEvent("archived", "active")).toBe("restore");
  });

  it("非法转换返回 null", () => {
    expect(stateTransitionToEvent("obliterated", "active")).toBeNull();
    expect(stateTransitionToEvent("active", "pending")).toBeNull();
  });
});

// ══════════════════════════════════════════════
// MemoryEntryStateMachine — 核心状态转换
// ══════════════════════════════════════════════

describe("MemoryEntryStateMachine", () => {
  const makeCtx = (overrides: Partial<Parameters<MemoryEntryStateMachine["cas"]>[3]> = {}) => ({
    weight: 1.0,
    accessCount: 1,
    lastAccessedAt: Date.now(),
    memoryId: "test-mem-1",
    ...overrides,
  });

  describe("构造与初始状态", () => {
    it("默认从 active 状态初始化", () => {
      const fsm = new MemoryEntryStateMachine("active");
      expect(fsm.current).toBe("active");
      expect(fsm.isFinal).toBe(false);
    });

    it("从 pending 状态初始化", () => {
      const fsm = new MemoryEntryStateMachine("pending");
      expect(fsm.current).toBe("pending");
    });
  });

  describe("cas() — CAS 兼容接口", () => {
    it("commit: pending→active 成功", () => {
      const fsm = new MemoryEntryStateMachine("pending");
      const ok = fsm.cas("mem-1", "pending", "commit", makeCtx());
      expect(ok).toBe(true);
      expect(fsm.current).toBe("active");
      expect(fsm.history.length).toBe(1);
    });

    it("cas 期望状态不匹配时拒绝", () => {
      const fsm = new MemoryEntryStateMachine("active");
      const ok = fsm.cas("mem-1", "pending", "commit", makeCtx());
      expect(ok).toBe(false);
      expect(fsm.current).toBe("active");
    });

    it("cas 无效事件时拒绝", () => {
      const fsm = new MemoryEntryStateMachine("obliterated");
      const ok = fsm.cas("mem-1", "obliterated", "commit" as any, makeCtx());
      expect(ok).toBe(false);
    });
  });

  describe("典型生命周期", () => {
    it("Pending → Commit → Active → Archive → Restore → Obliterate", () => {
      const fsm = new MemoryEntryStateMachine("pending");

      // pending → commit → active
      fsm.dispatch("commit", makeCtx({ memoryId: "life-1" }));
      expect(fsm.current).toBe("active");

      // active → archive (低权重应通过 guard)
      fsm.dispatch("archive", makeCtx({ memoryId: "life-1", weight: 0.2, lastAccessedAt: Date.now() - 31 * 24 * 3600_000 }));
      expect(fsm.current).toBe("archived");

      // archive → restore → active
      fsm.dispatch("restore", makeCtx({ memoryId: "life-1" }));
      expect(fsm.current).toBe("active");

      // active → obliterate
      fsm.dispatch("obliterate", makeCtx({ memoryId: "life-1" }));
      expect(fsm.current).toBe("obliterated");
      expect(fsm.isFinal).toBe(true);

      // 终态后任何 dispatch 抛错
      expect(() => fsm.dispatch("commit", makeCtx({ memoryId: "life-1" }))).toThrow();
    });

    it("Pending → Rollback → Obliterated (两阶段回滚)", () => {
      const fsm = new MemoryEntryStateMachine("pending");
      fsm.dispatch("rollback", makeCtx({ memoryId: "rollback-1" }));
      expect(fsm.current).toBe("obliterated");
      expect(fsm.isFinal).toBe(true);
    });
  });

  describe("guard 评估", () => {
    it("canArchive: weight < 0.5 允许归档", () => {
      const fsm = new MemoryEntryStateMachine("active");
      const ctx = makeCtx({ weight: 0.3, lastAccessedAt: Date.now() });
      expect(fsm.canWithContext("archive", ctx)).toBe(true);
      const ok = fsm.cas("mem-guard-1", "active", "archive", ctx);
      expect(ok).toBe(true);
    });

    it("canArchive: weight >= 0.5 且近期访问 → 拒绝", () => {
      const fsm = new MemoryEntryStateMachine("active");
      const ctx = makeCtx({ weight: 0.8, lastAccessedAt: Date.now() });
      // canWithContext 返回 false 因为 guard 评估不过
      const ok = fsm.cas("mem-guard-2", "active", "archive", ctx);
      expect(ok).toBe(false);
    });

    it("canArchive: weight >= 0.5 但超 30 天未访问 → 允许", () => {
      const fsm = new MemoryEntryStateMachine("active");
      const ctx = makeCtx({ weight: 0.8, lastAccessedAt: Date.now() - 31 * 24 * 3600_000 });
      expect(fsm.canWithContext("archive", ctx)).toBe(true);
    });
  });

  describe("validEvents", () => {
    it("active 状态允许 archive 和 obliterate", () => {
      const fsm = new MemoryEntryStateMachine("active");
      expect(fsm.validEvents).toContain("archive");
      expect(fsm.validEvents).toContain("obliterate");
    });

    it("obliterated 终态无有效事件", () => {
      const fsm = new MemoryEntryStateMachine("obliterated");
      expect(fsm.validEvents).toEqual([]);
    });
  });

  describe("审计记录", () => {
    it("每次 dispatch 记录一条 TransitionRecord", () => {
      const fsm = new MemoryEntryStateMachine("pending");
      fsm.dispatch("commit", makeCtx({ memoryId: "audit-1" }));
      expect(fsm.history).toHaveLength(1);
      expect(fsm.history[0].from).toBe("pending");
      expect(fsm.history[0].to).toBe("active");
      expect(fsm.history[0].event).toBe("commit");
      expect(fsm.history[0].context?.memoryId).toBe("audit-1");
    });
  });
});
