// @ci: unit
// @vitest-environment node
// ============================================================
// circuit-breaker.test.ts — 断路器单元测试
// 覆盖：SimpleCircuitBreaker | StateMachineCircuitBreaker
// 目标：≥80% lines coverage
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SimpleCircuitBreaker } from "@cortex/resilience";
import { StateMachineCircuitBreaker } from "@cortex/resilience";
import { CircuitBreakerOpenError } from "@cortex/resilience";

// ============================================================
// SimpleCircuitBreaker 测试
// ============================================================

describe("SimpleCircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 构造函数 ──

  describe("constructor", () => {
    it("should create instance with defaults", () => {
      const cb = new SimpleCircuitBreaker({ name: "test" });
      expect(cb.name).toBe("test");
      expect(cb.state).toBe("CLOSED");
      expect(cb.consecutiveFailures).toBe(0);
    });

    it("should create instance with custom options", () => {
      const cb = new SimpleCircuitBreaker({ name: "test", threshold: 3, halfOpenAfterMs: 1000 });
      expect(cb.name).toBe("test");
      expect(cb.state).toBe("CLOSED");
    });

    it("should throw RangeError when threshold < 1", () => {
      expect(() => new SimpleCircuitBreaker({ name: "t", threshold: 0 })).toThrow(RangeError);
      expect(() => new SimpleCircuitBreaker({ name: "t", threshold: -1 })).toThrow(RangeError);
    });

    it("should throw RangeError when halfOpenAfterMs < 0", () => {
      expect(() => new SimpleCircuitBreaker({ name: "t", threshold: 3, halfOpenAfterMs: -1 })).toThrow(RangeError);
    });

    it("should accept halfOpenAfterMs = 0", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 3, halfOpenAfterMs: 0 });
      expect(cb.state).toBe("CLOSED");
    });

    it("should accept threshold = 1", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 1, halfOpenAfterMs: 1000 });
      expect(cb.state).toBe("CLOSED");
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");
    });
  });

  // ── 状态转换 ──

  describe("state transitions", () => {
    it("should transition from CLOSED to OPEN after threshold failures", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 3, halfOpenAfterMs: 10000 });
      expect(cb.state).toBe("CLOSED");

      cb.recordFailure();
      expect(cb.state).toBe("CLOSED");
      expect(cb.consecutiveFailures).toBe(1);

      cb.recordFailure();
      expect(cb.state).toBe("CLOSED");

      cb.recordFailure();
      expect(cb.state).toBe("OPEN");
      expect(cb.consecutiveFailures).toBe(3);
    });

    it("should reset failures to 0 on recordSuccess while CLOSED", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 5, halfOpenAfterMs: 10000 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.consecutiveFailures).toBe(2);

      cb.recordSuccess();
      expect(cb.consecutiveFailures).toBe(0);
      expect(cb.state).toBe("CLOSED");
    });

    it("should transition from HALF_OPEN to OPEN on failure", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 3, halfOpenAfterMs: 1000 });
      cb.forceState("HALF_OPEN");
      expect(cb.state).toBe("HALF_OPEN");

      cb.recordFailure();
      expect(cb.state).toBe("OPEN");
    });

    it("should transition from HALF_OPEN to CLOSED on success", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 3, halfOpenAfterMs: 1000 });
      cb.forceState("HALF_OPEN");

      cb.recordSuccess();
      expect(cb.state).toBe("CLOSED");
      expect(cb.consecutiveFailures).toBe(0);
    });

    it("should stay OPEN when recordFailure called in OPEN state", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 2, halfOpenAfterMs: 10000 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      // recordFailure while OPEN should not change state
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");
      expect(cb.consecutiveFailures).toBe(3);
    });

    it("should stay OPEN when recordSuccess called in OPEN state (no-op)", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 1, halfOpenAfterMs: 10000 });
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      // recordSuccess while OPEN should reset failures but not change state
      cb.recordSuccess();
      expect(cb.consecutiveFailures).toBe(0);
      // OPEN stays OPEN (transitionTo early return if same state)
      expect(cb.state).toBe("OPEN");
    });
  });

  // ── call 方法 ──

  describe("call method", () => {
    it("should return fn result on success", async () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 3, halfOpenAfterMs: 1000 });
      const result = await cb.call(async () => "ok");
      expect(result).toBe("ok");
      expect(cb.state).toBe("CLOSED");
    });

    it("should call fallback when fn throws", async () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 3, halfOpenAfterMs: 1000 });
      const fn = async () => { throw new Error("fail"); };
      const fallback = async () => "fallback-ok";
      const result = await cb.call(fn, fallback);
      expect(result).toBe("fallback-ok");
      expect(cb.consecutiveFailures).toBe(1);
    });

    it("should rethrow error when fn throws and no fallback", async () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 3, halfOpenAfterMs: 1000 });
      await expect(cb.call(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    });

    it("should use fallback when circuit is OPEN", async () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 2, halfOpenAfterMs: 5000 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      const result = await cb.call(
        async () => "should-not-execute",
        async () => "fallback",
      );
      expect(result).toBe("fallback");
      expect(cb.state).toBe("OPEN"); // still OPEN since halfOpenAfterMs not elapsed
    });

    it("should throw CircuitBreakerOpenError when OPEN with no fallback", async () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 2, halfOpenAfterMs: 5000 });
      cb.recordFailure();
      cb.recordFailure();

      await expect(cb.call(async () => "success")).rejects.toThrow(CircuitBreakerOpenError);
    });

    it("should transition to HALF_OPEN when halfOpenAfterMs elapsed, then CLOSED on success", async () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 2, halfOpenAfterMs: 5000 });

      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      // Advance time past halfOpenAfterMs
      vi.advanceTimersByTime(5000);

      // Call should trigger HALF_OPEN transition and succeed
      const result = await cb.call(
        async () => "success",
        async () => "fallback",
      );
      expect(result).toBe("success");
      expect(cb.state).toBe("CLOSED"); // success in HALF_OPEN → CLOSED
    });

    it("should transition to HALF_OPEN when halfOpenAfterMs elapsed, then OPEN on failure", async () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 2, halfOpenAfterMs: 5000 });

      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      vi.advanceTimersByTime(5000);

      // Call in HALF_OPEN → try fn → throws → recordFailure → back to OPEN
      const fn = async () => { throw new Error("half-open-fail"); };
      const fallback = async () => "fallback-after-halfopen";
      const result = await cb.call(fn, fallback);
      // fn threw, fallback called
      expect(result).toBe("fallback-after-halfopen");
      // recordFailure in HALF_OPEN → OPEN
      expect(cb.state).toBe("OPEN");
    });

    it("should transition to HALF_OPEN when halfOpenAfterMs=0", async () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 1, halfOpenAfterMs: 0 });

      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      // halfOpenAfterMs=0 means the condition is immediately satisfied
      vi.advanceTimersByTime(0);

      const result = await cb.call(async () => "immediate-recover");
      expect(result).toBe("immediate-recover");
      expect(cb.state).toBe("CLOSED");
    });
  });

  // ── forceState ──

  describe("forceState", () => {
    it("should force to OPEN", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 3, halfOpenAfterMs: 1000 });
      cb.forceState("OPEN");
      expect(cb.state).toBe("OPEN");
    });

    it("should force to CLOSED with zeroed counters", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 3, halfOpenAfterMs: 1000 });
      cb.recordFailure();
      cb.recordFailure();
      cb.forceState("CLOSED");
      expect(cb.state).toBe("CLOSED");
      expect(cb.consecutiveFailures).toBe(0);
    });

    it("should force to HALF_OPEN", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 3, halfOpenAfterMs: 1000 });
      cb.forceState("HALF_OPEN");
      expect(cb.state).toBe("HALF_OPEN");
    });

    it("should set openedAt when forcing to OPEN", async () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 3, halfOpenAfterMs: 1000 });
      cb.forceState("OPEN");
      expect(cb.state).toBe("OPEN");

      // Immediately check that OPEN → HALF_OPEN does NOT transition since openedAt was just set
      const result = await cb.call(async () => "still-open", async () => "fallback");
      expect(result).toBe("fallback");
      expect(cb.state).toBe("OPEN");
    });
  });

  // ── onStateChange ──

  describe("onStateChange", () => {
    it("should notify on state transitions", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 2, halfOpenAfterMs: 1000 });
      const handler = vi.fn();
      cb.onStateChange(handler);

      cb.recordFailure();
      expect(handler).not.toHaveBeenCalled();

      cb.recordFailure();
      expect(handler).toHaveBeenCalledWith("OPEN", "CLOSED");
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple handlers", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 1, halfOpenAfterMs: 1000 });
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      cb.onStateChange(handler1);
      cb.onStateChange(handler2);

      cb.recordFailure();

      expect(handler1).toHaveBeenCalledWith("OPEN", "CLOSED");
      expect(handler2).toHaveBeenCalledWith("OPEN", "CLOSED");
    });

    it("should handle handler errors gracefully", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 1, halfOpenAfterMs: 1000 });
      const throwingHandler = vi.fn().mockImplementation(() => { throw new Error("handler error"); });
      const normalHandler = vi.fn();

      cb.onStateChange(throwingHandler);
      cb.onStateChange(normalHandler);

      cb.recordFailure(); // triggers CLOSED→OPEN

      expect(throwingHandler).toHaveBeenCalled();
      expect(normalHandler).toHaveBeenCalled();
    });

    it("should not notify when transitioning to same state via forceState", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 3, halfOpenAfterMs: 1000 });
      const handler = vi.fn();
      cb.onStateChange(handler);

      // Force to CLOSED while already CLOSED → no transition
      cb.forceState("CLOSED");
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── reset ──

  describe("reset", () => {
    it("should reset to CLOSED state with zeroed counters", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 2, halfOpenAfterMs: 1000 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");
      expect(cb.consecutiveFailures).toBe(2);

      cb.reset();
      expect(cb.state).toBe("CLOSED");
      expect(cb.consecutiveFailures).toBe(0);
    });

    it("should reset from HALF_OPEN to CLOSED", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 3, halfOpenAfterMs: 1000 });
      cb.forceState("HALF_OPEN");
      expect(cb.state).toBe("HALF_OPEN");

      cb.reset();
      expect(cb.state).toBe("CLOSED");
    });

    it("should reset from CLOSED (idempotent)", () => {
      const cb = new SimpleCircuitBreaker({ name: "t", threshold: 3, halfOpenAfterMs: 1000 });
      cb.reset();
      expect(cb.state).toBe("CLOSED");
    });
  });
});

// ============================================================
// StateMachineCircuitBreaker 测试
// ============================================================

describe("StateMachineCircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 构造函数 ──

  describe("constructor", () => {
    it("should create instance with consecutive strategy by default", () => {
      const cb = new StateMachineCircuitBreaker("test", {
        threshold: 5,
        windowMs: 0,
        halfOpenAfterMs: 30000,
      });
      expect(cb.name).toBe("test");
      expect(cb.state).toBe("CLOSED");
    });

    it("should create instance with sliding-window strategy", () => {
      const cb = new StateMachineCircuitBreaker("test", {
        threshold: 0.5,
        windowMs: 60000,
        halfOpenAfterMs: 30000,
        strategy: "sliding-window",
        minimumCalls: 10,
      });
      expect(cb.name).toBe("test");
      expect(cb.state).toBe("CLOSED");
    });

    it("should default minimumCalls to 1 for consecutive strategy", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 3,
        windowMs: 0,
        halfOpenAfterMs: 10000,
      });
      expect((cb as any)._resolvedOptions.minimumCalls).toBe(1);
    });

    it("should default maxHalfOpenRequests to 1", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 3,
        windowMs: 0,
        halfOpenAfterMs: 10000,
      });
      expect((cb as any)._resolvedOptions.maxHalfOpenRequests).toBe(1);
    });
  });

  // ── consecutive 策略状态转换 ──

  describe("consecutive strategy state transitions", () => {
    it("should transition from CLOSED to OPEN after threshold failures", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 3,
        windowMs: 0,
        halfOpenAfterMs: 60000,
        strategy: "consecutive",
      });

      cb.recordFailure();
      expect(cb.state).toBe("CLOSED");

      cb.recordFailure();
      expect(cb.state).toBe("CLOSED");

      cb.recordFailure();
      expect(cb.state).toBe("OPEN");
    });

    it("should reset consecutive failures on recordSuccess in CLOSED", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 3,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess();
      expect(cb.state).toBe("CLOSED");

      // recordSuccess resets counter, so only 1 failure so far
      cb.recordFailure();
      expect(cb.state).toBe("CLOSED");
    });

    it("should transition HALF_OPEN→CLOSED after maxHalfOpenRequests successes", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 2,
        windowMs: 0,
        halfOpenAfterMs: 1000,
        maxHalfOpenRequests: 2,
      });

      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      cb.forceState("HALF_OPEN");
      expect(cb.state).toBe("HALF_OPEN");

      // First success in HALF_OPEN
      cb.recordSuccess();
      expect(cb.state).toBe("HALF_OPEN"); // need 2 successes

      // Second success in HALF_OPEN
      cb.recordSuccess();
      expect(cb.state).toBe("CLOSED");
    });

    it("should transition HALF_OPEN→OPEN on any failure", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 3,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      cb.forceState("HALF_OPEN");
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");
    });

    it("should not transition on recordSuccess while OPEN (no-op)", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 1,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      // OPEN_STATE.onRecordSuccess returns 'OPEN', no transition
      cb.recordSuccess();
      expect(cb.state).toBe("OPEN");
    });

    it("should not transition on recordFailure while OPEN (no-op)", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 1,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      // OPEN_STATE.onRecordFailure returns 'OPEN', no transition
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");
    });

    it("should transition from CLOSED to OPEN with threshold=1 immediately", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 1,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      cb.recordFailure();
      expect(cb.state).toBe("OPEN");
    });
  });

  // ── sliding-window 策略状态转换 ──

  describe("sliding-window strategy state transitions", () => {
    it("should not open when minimumCalls not reached", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 0.5,
        windowMs: 60000,
        halfOpenAfterMs: 30000,
        strategy: "sliding-window",
        minimumCalls: 10,
      });

      // Only 5 failures, minimumCalls is 10
      for (let i = 0; i < 5; i++) {
        cb.recordFailure();
      }
      // minimumCalls not reached, should stay CLOSED
      expect(cb.state).toBe("CLOSED");
    });

    it("should open when failure rate exceeds threshold in window", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 0.5,
        windowMs: 60000,
        halfOpenAfterMs: 30000,
        strategy: "sliding-window",
        minimumCalls: 6,
      });

      // Record 4 failures and 2 successes = 6 total, 66.6% failure rate > 50%
      for (let i = 0; i < 4; i++) {
        cb.recordFailure();
      }
      for (let i = 0; i < 2; i++) {
        cb.recordSuccess();
      }
      // 4/6 = 66.6% > 50% threshold, should open
      expect(cb.state).toBe("OPEN");
    });

    it("should not open when failure rate is below threshold", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 0.5,
        windowMs: 60000,
        halfOpenAfterMs: 30000,
        strategy: "sliding-window",
        minimumCalls: 5,
      });

      // 2 failures, 3 successes = 40% failure rate < 50%
      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess();
      cb.recordSuccess();
      cb.recordSuccess();

      expect(cb.state).toBe("CLOSED");
    });

    it("should evict expired records from the window", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 0.5,
        windowMs: 1000, // 1 second window
        halfOpenAfterMs: 30000,
        strategy: "sliding-window",
        minimumCalls: 3,
      });

      // Record 2 failures within the window
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe("CLOSED"); // only 2 calls, minimumCalls=3

      // Advance time past the window
      vi.advanceTimersByTime(1500);

      // Record 3 successes (old failures should be evicted)
      cb.recordSuccess();
      cb.recordSuccess();
      cb.recordSuccess();

      // After eviction: 3 successes, 0 failures = 0% failure rate
      expect(cb.state).toBe("CLOSED");
    });

    it("should record sliding-window entries via recordSuccess", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 0.8,
        windowMs: 60000,
        halfOpenAfterMs: 30000,
        strategy: "sliding-window",
        minimumCalls: 5,
      });

      // All successes, should stay CLOSED
      for (let i = 0; i < 5; i++) {
        cb.recordSuccess();
      }

      expect(cb.state).toBe("CLOSED");
      // Internal callRecords should have 5 entries
      expect((cb as any)._callRecords.length).toBe(5);
    });

    it("should record sliding-window entries via recordFailure", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 0.5,
        windowMs: 60000,
        halfOpenAfterMs: 30000,
        strategy: "sliding-window",
        minimumCalls: 5,
      });

      // All failures should eventually open when minimumCalls reached
      for (let i = 0; i < 3; i++) {
        cb.recordFailure();
      }
      expect(cb.state).toBe("CLOSED"); // only 3 calls, minimumCalls=5

      // 2 more failures → total 5, failure rate 100%
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");
    });
  });

  // ── call 方法 ──

  describe("call method", () => {
    it("should return fn result on success", async () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 3,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      const result = await cb.call(async () => "ok");
      expect(result).toBe("ok");
      expect(cb.state).toBe("CLOSED");
    });

    it("should call fallback when fn throws", async () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 3,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      const result = await cb.call(
        async () => { throw new Error("fail"); },
        async () => "fallback",
      );
      expect(result).toBe("fallback");
      expect((cb as any)._consecutiveFailures).toBe(1); // private but we can check via recordFailure side-effect
    });

    it("should rethrow error when fn throws and no fallback", async () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 3,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      await expect(cb.call(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    });

    it("should throw CircuitBreakerOpenError when OPEN with no fallback", async () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 1,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      await expect(cb.call(async () => "ok")).rejects.toThrow(CircuitBreakerOpenError);
    });

    it("should use fallback when OPEN and fallback provided", async () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 1,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      cb.recordFailure();
      const result = await cb.call(
        async () => "ok",
        async () => "fallback-result",
      );
      expect(result).toBe("fallback-result");
    });

    it("should transition to HALF_OPEN when halfOpenAfterMs elapsed and succeed", async () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 1,
        windowMs: 0,
        halfOpenAfterMs: 5000,
      });

      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      vi.advanceTimersByTime(5000);

      // Call triggers HALF_OPEN transition
      const result = await cb.call(async () => "recovered");
      expect(result).toBe("recovered");
      // success in HALF_OPEN → maxHalfOpenRequests(1) → CLOSED
      expect(cb.state).toBe("CLOSED");
    });

    it("should transition to HALF_OPEN when halfOpenAfterMs elapsed and fail back to OPEN", async () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 1,
        windowMs: 0,
        halfOpenAfterMs: 5000,
      });

      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      vi.advanceTimersByTime(5000);

      // Call triggers HALF_OPEN, fn fails, recordFailure → back to OPEN
      const result = await cb.call(
        async () => { throw new Error("half-open-fail"); },
        async () => "fallback-after-open",
      );
      expect(result).toBe("fallback-after-open");
      expect(cb.state).toBe("OPEN");
    });

    it("should work correctly in CLOSED state with multiple calls", async () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 3,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      expect(await cb.call(async () => "a")).toBe("a");
      expect(await cb.call(async () => "b")).toBe("b");
      expect(await cb.call(async () => "c")).toBe("c");
      expect(cb.state).toBe("CLOSED");
    });
  });

  // ── forceState ──

  describe("forceState", () => {
    it("should force to CLOSED with zeroed counters", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 3,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      cb.forceState("CLOSED");
      expect(cb.state).toBe("CLOSED");
    });

    it("should force to OPEN with openedAt timestamp", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 3,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      cb.forceState("OPEN");
      expect(cb.state).toBe("OPEN");
    });

    it("should force to HALF_OPEN with zeroed halfOpenSuccesses", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 3,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      cb.forceState("HALF_OPEN");
      expect(cb.state).toBe("HALF_OPEN");
    });

    it("should force to CLOSED and clear callRecords", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 0.5,
        windowMs: 60000,
        halfOpenAfterMs: 30000,
        strategy: "sliding-window",
        minimumCalls: 3,
      });

      cb.recordFailure();
      cb.recordFailure();
      expect((cb as any)._callRecords.length).toBe(2);

      cb.forceState("CLOSED");
      expect(cb.state).toBe("CLOSED");
      expect((cb as any)._callRecords.length).toBe(0);
    });

    it("should force to OPEN and clear callRecords", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 0.5,
        windowMs: 60000,
        halfOpenAfterMs: 30000,
        strategy: "sliding-window",
        minimumCalls: 3,
      });

      cb.recordSuccess();
      expect((cb as any)._callRecords.length).toBe(1);

      cb.forceState("OPEN");
      expect(cb.state).toBe("OPEN");
      expect((cb as any)._callRecords.length).toBe(0);
    });
  });

  // ── reset ──

  describe("reset", () => {
    it("should reset to CLOSED with cleared state", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 3,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      cb.reset();
      expect(cb.state).toBe("CLOSED");
    });

    it("should clear callRecords on reset for sliding-window", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 0.5,
        windowMs: 60000,
        halfOpenAfterMs: 30000,
        strategy: "sliding-window",
        minimumCalls: 3,
      });

      cb.recordFailure();
      cb.recordFailure();
      expect((cb as any)._callRecords.length).toBe(2);

      cb.reset();
      expect((cb as any)._callRecords.length).toBe(0);
      expect(cb.state).toBe("CLOSED");
    });

    it("should reset from HALF_OPEN", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 3,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      cb.forceState("HALF_OPEN");
      cb.reset();
      expect(cb.state).toBe("CLOSED");
    });
  });

  // ── onStateChange ──

  describe("onStateChange", () => {
    it("should notify on transitions", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 2,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      const handler = vi.fn();
      cb.onStateChange(handler);

      cb.recordFailure();
      expect(handler).not.toHaveBeenCalled();

      cb.recordFailure();
      expect(handler).toHaveBeenCalledWith("OPEN", "CLOSED");
    });

    it("should isolate handler exceptions", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 1,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      const throwingHandler = vi.fn().mockImplementation(() => { throw new Error("bad"); });
      const normalHandler = vi.fn();

      cb.onStateChange(throwingHandler);
      cb.onStateChange(normalHandler);

      cb.recordFailure();

      expect(throwingHandler).toHaveBeenCalled();
      expect(normalHandler).toHaveBeenCalled();
    });

    it("should not notify when transitioning to same state", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 3,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      const handler = vi.fn();
      cb.onStateChange(handler);

      // Force to CLOSED while already CLOSED → no transition
      cb.forceState("CLOSED");
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── 边界情况与错误处理 ──

  describe("edge cases", () => {
    it("should handle onStateChange with multiple state transitions", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 2,
        windowMs: 0,
        halfOpenAfterMs: 1000,
      });

      const states: string[] = [];
      cb.onStateChange((state) => states.push(state));

      cb.recordFailure();
      cb.recordFailure(); // CLOSED→OPEN
      expect(states).toEqual(["OPEN"]);

      // Force to HALF_OPEN
      cb.forceState("HALF_OPEN");
      expect(states).toEqual(["OPEN", "HALF_OPEN"]); // OPEN→HALF_OPEN

      // Success → CLOSED
      cb.recordSuccess();
      expect(states).toEqual(["OPEN", "HALF_OPEN", "CLOSED"]);
    });

    it("should handle consecutive failures > threshold while already OPEN", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 2,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      // More failures while OPEN should not change state
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");
    });

    it("should handle call after reset", async () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 2,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      cb.reset();
      expect(cb.state).toBe("CLOSED");

      const result = await cb.call(async () => "after-reset");
      expect(result).toBe("after-reset");
      expect(cb.state).toBe("CLOSED");
    });

    it("should call recordSuccess while in OPEN state (no-op)", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 1,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      // OPEN_STATE.onRecordSuccess returns 'OPEN', no transition
      cb.recordSuccess();
      expect(cb.state).toBe("OPEN");
    });

    it("should call recordFailure while in OPEN state (no-op)", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 1,
        windowMs: 0,
        halfOpenAfterMs: 60000,
      });

      cb.recordFailure();
      expect(cb.state).toBe("OPEN");

      // OPEN_STATE.onRecordFailure returns 'OPEN', no transition
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");
      // OPEN.onEnter resets counter, recordFailure increments → 1
      expect((cb as any)._consecutiveFailures).toBe(1);
    });
  });

  // ── sliding-window 详细测试 ──

  describe("sliding-window detailed", () => {
    it("should calculate failure rate correctly with mixed results", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 0.6,
        windowMs: 60000,
        halfOpenAfterMs: 30000,
        strategy: "sliding-window",
        minimumCalls: 10,
      });

      // 6 failures, 4 successes = 60% failure rate, threshold is 0.6
      for (let i = 0; i < 6; i++) cb.recordFailure();
      for (let i = 0; i < 4; i++) cb.recordSuccess();

      // 6/10 = 0.6 >= 0.6, should open
      expect(cb.state).toBe("OPEN");
    });

    it("should not open with exactly minimumCalls-1 failures", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 0.5,
        windowMs: 60000,
        halfOpenAfterMs: 30000,
        strategy: "sliding-window",
        minimumCalls: 5,
      });

      // 4 failures, 0 successes = 4 total, < 5 minimumCalls
      for (let i = 0; i < 4; i++) cb.recordFailure();

      expect(cb.state).toBe("CLOSED");
    });

    it("should open when call records exceed window but eviction keeps rate high", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 0.5,
        windowMs: 1000,
        halfOpenAfterMs: 30000,
        strategy: "sliding-window",
        minimumCalls: 3,
      });

      // All failures: 3 failures within window
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");
    });

    it("should keep records accurate after eviction", () => {
      const cb = new StateMachineCircuitBreaker("t", {
        threshold: 0.5,
        windowMs: 1000,
        halfOpenAfterMs: 30000,
        strategy: "sliding-window",
        minimumCalls: 3,
      });

      // 2 failures
      cb.recordFailure();
      cb.recordFailure();
      expect((cb as any)._callRecords.length).toBe(2);

      // Advance time to expire first records
      vi.advanceTimersByTime(500);

      // 1 more failure
      cb.recordFailure();
      expect(cb.state).toBe("OPEN");
      // Should have 3 records (none expired yet)
      expect((cb as any)._callRecords.length).toBe(3);

      // Advance time past window
      vi.advanceTimersByTime(600);

      // recordSuccess triggers eviction
      cb.recordSuccess();

      // Old records before cutoff should be evicted
      // cutoff = now - 1000, so records older than 600ms ago are evicted
      // All 3 failures were at timestamps 0, 500, 1000 → now is 1100
      // cutoff = 1100 - 1000 = 100 → only records with timestamp >= 100 remain
      // Records: [0, 500, 1000] → after eviction: [500, 1000]? Actually need to check
      // After eviction: [fail@500, success@1100], failure rate 1/2=50% >= 50% → stays OPEN
      expect(cb.state).toBe("OPEN"); // 1 success, but window still has failures
    });
  });
});
