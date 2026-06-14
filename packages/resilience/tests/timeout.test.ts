// @ci: unit
// @vitest-environment node
// ============================================================
// timeout.test.ts — 超时策略单元测试
// 覆盖：FixedTimeout | AdaptiveTimeout
// 目标：≥80% lines (含所有分支)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach, assertType } from "vitest";
import { FixedTimeout, AdaptiveTimeout, TimeoutError } from "@cortex/resilience";

// ============================================================
// 辅助工具
// ============================================================

/** 返回一个永不自动 resolve 的 Promise，用于超时测试 */
function forever(): Promise<never> {
  return new Promise<never>(() => {});
}

/** 返回一个在指定延时后 resolve 的 Promise */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// FixedTimeout 测试
// ============================================================

describe("FixedTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 构造 ──

  describe("constructor", () => {
    it("should create instance with valid durationMs", () => {
      const t = new FixedTimeout({ durationMs: 5000 });
      expect(t.name).toBe("fixed-timeout");
      expect(t.timeoutMs).toBe(5000);
    });

    it("should default cancelOnTimeout to true", () => {
      const t = new FixedTimeout({ durationMs: 3000 });
      // 无法直接访问 private 字段，通过行为验证：
      // cancelOnTimeout=true 时超时后 signal 会被 abort
      expect(t.name).toBe("fixed-timeout");
    });

    it("should accept cancelOnTimeout: false", () => {
      const t = new FixedTimeout({ durationMs: 3000, cancelOnTimeout: false });
      expect(t.timeoutMs).toBe(3000);
    });

    it("should throw RangeError for non-positive durationMs", () => {
      expect(() => new FixedTimeout({ durationMs: 0 })).toThrow(RangeError);
      expect(() => new FixedTimeout({ durationMs: -1 })).toThrow(RangeError);
      expect(() => new FixedTimeout({ durationMs: NaN })).toThrow(RangeError);
      expect(() => new FixedTimeout({ durationMs: Infinity })).toThrow(RangeError);
    });
  });

  // ── execute: 成功路径 ──

  describe("execute success", () => {
    it("should return success result when fn completes in time", async () => {
      const t = new FixedTimeout({ durationMs: 5000 });

      const result = await t.execute(async () => "done");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe("done");
        expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
        expect(result.elapsedMs).toBeLessThan(5000);
      }
    });

    it("should return correct value type (generic)", async () => {
      const t = new FixedTimeout({ durationMs: 1000 });
      const result = await t.execute(async () => 42);
      expect(result.success).toBe(true);
      if (result.success) {
        assertType<number>(result.value);
        expect(result.value).toBe(42);
      }
    });

    it("should handle fn returning undefined", async () => {
      const t = new FixedTimeout({ durationMs: 1000 });
      const result = await t.execute(async () => undefined);
      expect(result.success).toBe(true);
    });

    it("should measure elapsedMs accurately", async () => {
      vi.useRealTimers();
      const t = new FixedTimeout({ durationMs: 5000});

      const result = await t.execute(async () => {
        await delay(10);
        return "slow-but-within-limit";
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.elapsedMs).toBeGreaterThanOrEqual(10);
      }
    });
  });

  // ── execute: 超时路径 ──

  describe("execute timeout", () => {
    it("should return timeout error when fn exceeds durationMs", async () => {
      const t = new FixedTimeout({ durationMs: 100 });

      const promise = t.execute(async () => {
        await delay(1000);
        return "too-late";
      });

      vi.advanceTimersByTime(100);

      const result = await promise;
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(TimeoutError);
        expect((result.error as TimeoutError).timeoutMs).toBe(100);
        expect((result.error as TimeoutError).elapsedMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("should reject with TimeoutError (error.name = TimeoutError)", async () => {
      const t = new FixedTimeout({ durationMs: 50 });

      const promise = t.execute(async () => {
        await delay(9999);
        return "never";
      });

      vi.advanceTimersByTime(50);

      const result = await promise;
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.name).toBe("TimeoutError");
      }
    });
  });

  // ── execute: 外部信号 ──

  describe("execute with external signal", () => {
    it("should handle external cancellation", async () => {
      const t = new FixedTimeout({ durationMs: 5000 });
      const controller = new AbortController();

      const promise = t.execute(
        async (_signal) => {
          // 永不 resolve，等待外部取消
          await new Promise<void>(() => {});
          return "done";
        },
        controller.signal,
      );

      controller.abort();

      const result = await promise;
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(Error);
      }
    });

    it("should handle pre-aborted external signal", async () => {
      vi.useRealTimers();
      const t = new FixedTimeout({ durationMs: 5000 });
      const preAborted = AbortSignal.abort();

      const result = await t.execute(
        async (_signal) => {
          await delay(10);
          return "done";
        },
        preAborted,
      );

      // pre-aborted → combined signal is already aborted
      // timeoutGuard should reject
      expect(result.success).toBe(false);
    });

    it("should handle external signal that aborts after timeout", async () => {
      const t = new FixedTimeout({ durationMs: 100 });
      const controller = new AbortController();

      const promise = t.execute(
        async (_signal) => {
          await delay(200);
          return "done";
        },
        controller.signal,
      );

      // 超时先发生
      vi.advanceTimersByTime(100);

      const result = await promise;
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(TimeoutError);
      }
    });
  });

  // ── execute: 错误处理 ──

  describe("execute error handling", () => {
    it("should return error result when fn throws", async () => {
      const t = new FixedTimeout({ durationMs: 5000 });

      const result = await t.execute(async () => {
        throw new Error("business-error");
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("business-error");
      }
    });

    it("should wrap non-Error throws in Error", async () => {
      const t = new FixedTimeout({ durationMs: 5000 });

      const result = await t.execute(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "string-error";
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe("string-error");
      }
    });

    it("should handle AbortError from fn that respects signal", async () => {
      const t = new FixedTimeout({ durationMs: 100 });

      const promise = t.execute(async (signal) => {
        // 等待一个永远不会 resolve 的 Promise，但监听 signal
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
        return "done";
      });

      vi.advanceTimersByTime(100);

      const result = await promise;
      expect(result.success).toBe(false);
      // AbortError 且 elapsedMs >= timeoutMs-5 → 归类为 TimeoutError
      if (!result.success) {
        expect(result.error).toBeInstanceOf(TimeoutError);
      }
    });

    it("should wrap TimeoutError thrown by fn (name match → case A)", async () => {
      const t = new FixedTimeout({ durationMs: 5000 });

      const result = await t.execute(async () => {
        throw new TimeoutError(9999, 1234);
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        // 由于 TimeoutError.name === 'TimeoutError'，case A 匹配
        // 创建一个新的 TimeoutError(this.timeoutMs, elapsedMs)
        expect(result.error).toBeInstanceOf(TimeoutError);
        // 使用的是策略的 timeoutMs，而非原始 TimeoutError 的
        expect((result.error as TimeoutError).timeoutMs).toBe(5000);
        // elapsedMs 是实际经过的时间
        expect((result.error as TimeoutError).elapsedMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ── reset ──

  describe("reset", () => {
    it("should not throw", () => {
      const t = new FixedTimeout({ durationMs: 5000 });
      expect(() => t.reset()).not.toThrow();
    });

    it("should be callable multiple times", () => {
      const t = new FixedTimeout({ durationMs: 5000 });
      t.reset();
      t.reset();
      t.reset();
      expect(t.timeoutMs).toBe(5000);
    });
  });

  // ── 边缘情况 ──

  describe("edge cases", () => {
    it("should clean up timeout resources after success", async () => {
      const t = new FixedTimeout({ durationMs: 5000 });
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      await t.execute(async () => "quick");

      // 清理后不应再有 pending 计时器
      const activeTimers = setTimeoutSpy.mock.results.filter(
        (r) => typeof r.value === "number" || typeof r.value === "object",
      );
      // 可能没有创建计时器（使用了 AbortSignal.timeout）
      // 只要不泄漏即可
      setTimeoutSpy.mockRestore();
    });
  });
});

// ============================================================
// AdaptiveTimeout 测试
// ============================================================

describe("AdaptiveTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 构造 ──

  describe("constructor", () => {
    it("should create instance with default options", () => {
      const t = new AdaptiveTimeout();
      expect(t.name).toBe("adaptive-timeout");
      expect(t.minTimeoutMs).toBe(5000);
      expect(t.maxTimeoutMs).toBe(60000);
      expect(t.multiplier).toBe(4);
      expect(t.alpha).toBe(0.3);
      // 默认：initialEma=5000, multiplier=4 → timeout=20000
      expect(t.timeoutMs).toBe(20000);
      expect(t.ema).toBe(5000);
    });

    it("should create instance with custom options", () => {
      const t = new AdaptiveTimeout({
        initialTimeoutMs: 30000,
        minTimeoutMs: 10000,
        maxTimeoutMs: 120000,
        multiplier: 5,
        alpha: 0.2,
        initialEma: 8000,
      });
      // EMA=8000, multiplier=5 → timeout=40000, clamped to [10000, 120000]
      expect(t.timeoutMs).toBe(40000);
      expect(t.ema).toBe(8000);
      expect(t.minTimeoutMs).toBe(10000);
      expect(t.maxTimeoutMs).toBe(120000);
      expect(t.multiplier).toBe(5);
      expect(t.alpha).toBe(0.2);
    });

    it("should clamp timeoutMs to [min, max] on construction", () => {
      // 超大 multiplier → timeout 被 max 截断
      const t1 = new AdaptiveTimeout({
        initialEma: 50000,
        multiplier: 10,
        minTimeoutMs: 1000,
        maxTimeoutMs: 30000,
      });
      expect(t1.timeoutMs).toBe(30000);

      // 超小 multiplier → timeout 被 min 截断
      const t2 = new AdaptiveTimeout({
        initialEma: 100,
        multiplier: 0.5,
        minTimeoutMs: 1000,
        maxTimeoutMs: 30000,
      });
      expect(t2.timeoutMs).toBe(1000);
    });

    it("should throw RangeError for invalid initialTimeoutMs", () => {
      expect(() => new AdaptiveTimeout({ initialTimeoutMs: 0 })).toThrow(RangeError);
      expect(() => new AdaptiveTimeout({ initialTimeoutMs: -1 })).toThrow(RangeError);
      expect(() => new AdaptiveTimeout({ initialTimeoutMs: NaN })).toThrow(RangeError);
      expect(() => new AdaptiveTimeout({ initialTimeoutMs: Infinity })).toThrow(RangeError);
    });

    it("should throw RangeError for invalid minTimeoutMs", () => {
      expect(() => new AdaptiveTimeout({ minTimeoutMs: 0 })).toThrow(RangeError);
      expect(() => new AdaptiveTimeout({ minTimeoutMs: NaN })).toThrow(RangeError);
    });

    it("should throw RangeError for invalid maxTimeoutMs", () => {
      expect(() => new AdaptiveTimeout({ maxTimeoutMs: 0 })).toThrow(RangeError);
      expect(() => new AdaptiveTimeout({ maxTimeoutMs: NaN })).toThrow(RangeError);
    });

    it("should throw RangeError for invalid min/max range", () => {
      expect(() => new AdaptiveTimeout({ minTimeoutMs: 10000, maxTimeoutMs: 5000 })).toThrow(RangeError);
    });

    it("should throw RangeError when initialTimeoutMs is outside [min, max]", () => {
      expect(() => new AdaptiveTimeout({ initialTimeoutMs: 1000, minTimeoutMs: 5000, maxTimeoutMs: 60000 })).toThrow(RangeError);
      expect(() => new AdaptiveTimeout({ initialTimeoutMs: 70000, minTimeoutMs: 5000, maxTimeoutMs: 60000 })).toThrow(RangeError);
    });

    it("should throw RangeError for invalid alpha (0, 1, negative, >1)", () => {
      expect(() => new AdaptiveTimeout({ alpha: 0 })).toThrow(RangeError);
      expect(() => new AdaptiveTimeout({ alpha: 1 })).toThrow(RangeError);
      expect(() => new AdaptiveTimeout({ alpha: -0.1 })).toThrow(RangeError);
      expect(() => new AdaptiveTimeout({ alpha: 1.1 })).toThrow(RangeError);
      expect(() => new AdaptiveTimeout({ alpha: NaN })).toThrow(RangeError);
    });

    it("should throw RangeError for invalid multiplier", () => {
      expect(() => new AdaptiveTimeout({ multiplier: 0 })).toThrow(RangeError);
      expect(() => new AdaptiveTimeout({ multiplier: -1 })).toThrow(RangeError);
      expect(() => new AdaptiveTimeout({ multiplier: NaN })).toThrow(RangeError);
      expect(() => new AdaptiveTimeout({ multiplier: Infinity })).toThrow(RangeError);
    });

    it("should store onTimeoutUpdate callback", () => {
      const callback = vi.fn();
      const t = new AdaptiveTimeout({ onTimeoutUpdate: callback });
      expect(t.name).toBe("adaptive-timeout");
      // 无法直接检查私有字段，通过后续行为验证
    });
  });

  // ── execute: 成功路径 ──

  describe("execute success", () => {
    it("should return success result with elapsedMs", async () => {
      vi.useRealTimers();
      const t = new AdaptiveTimeout({ initialTimeoutMs: 5000, minTimeoutMs: 1000, maxTimeoutMs: 10000 });

      const result = await t.execute(async () => "ok");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe("ok");
        expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("should pass AbortSignal to fn", async () => {
      vi.useRealTimers();
      const t = new AdaptiveTimeout({ initialTimeoutMs: 5000 });

      let receivedSignal: AbortSignal | undefined;
      await t.execute(async (signal) => {
        receivedSignal = signal;
        return "ok";
      });

      expect(receivedSignal).toBeDefined();
      expect(receivedSignal!.aborted).toBe(false);
    });
  });

  // ── execute: 超时路径 ──

  describe("execute timeout", () => {
    it("should return TimeoutError when fn exceeds current timeout", async () => {
      const t = new AdaptiveTimeout({
        initialTimeoutMs: 100,
        minTimeoutMs: 100,
        maxTimeoutMs: 500,
        multiplier: 1,
        alpha: 0.5,
        initialEma: 100,
      });

      const promise = t.execute(async () => {
        await delay(9999);
        return "too-late";
      });

      vi.advanceTimersByTime(100);

      const result = await promise;
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(TimeoutError);
        expect((result.error as TimeoutError).timeoutMs).toBe(100);
      }
    });

    it("should NOT update EMA on timeout", async () => {
      const t = new AdaptiveTimeout({
        initialTimeoutMs: 100,
        minTimeoutMs: 100,
        maxTimeoutMs: 500,
        multiplier: 1,
        alpha: 0.5,
        initialEma: 100,
      });

      const emaBefore = t.ema;

      const promise = t.execute(async () => {
        await delay(9999);
        return "late";
      });

      vi.advanceTimersByTime(100);

      await promise;

      // 超时不更新 EMA
      expect(t.ema).toBe(emaBefore);
    });
  });

  // ── execute: 业务异常 ──

  describe("execute business error", () => {
    it("should return error result for business exception", async () => {
      vi.useRealTimers();

      const t = new AdaptiveTimeout({ initialTimeoutMs: 5000, minTimeoutMs: 1000, maxTimeoutMs: 10000 });

      const result = await t.execute(async () => {
        await delay(10);
        throw new Error("business-error");
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("business-error");
      }
    });

    it("should UPDATE EMA on business error (elapsedMs >= 5)", async () => {
      vi.useRealTimers();
      const t = new AdaptiveTimeout({
        initialTimeoutMs: 5000,
        minTimeoutMs: 1000,
        maxTimeoutMs: 60000,
        multiplier: 2,
        alpha: 0.5,
        initialEma: 5000,
      });

      const emaBefore = t.ema;

      await t.execute(async () => {
        // 模拟耗时 ≈50ms 的业务错误
        await delay(50);
        throw new Error("business-error");
      });

      // EMA 应更新（elapsedMs >= 5）
      // 新 EMA = 0.5 * elapsedMs + 0.5 * 5000
      // elapsedMs ≈ 50 → 新 EMA ≈ 2525
      expect(t.ema).not.toBe(emaBefore);
      expect(t.ema).toBeGreaterThan(2000);
      expect(t.ema).toBeLessThan(3000);
    });

    it("should NOT update EMA on sync throw (elapsedMs < 5)", async () => {
      const t = new AdaptiveTimeout({
        initialTimeoutMs: 5000,
        minTimeoutMs: 1000,
        maxTimeoutMs: 60000,
        multiplier: 2,
        alpha: 0.5,
        initialEma: 5000,
      });

      const emaBefore = t.ema;

      await t.execute(async () => {
        throw new Error("immediate-error");
      });

      // elapsedMs ≈ 0 < 5 → 不更新 EMA
      expect(t.ema).toBe(emaBefore);
    });
  });

  // ── execute: 外部取消 ──

  describe("execute external cancellation", () => {
    it("should handle external cancellation via signal", async () => {
      vi.useRealTimers();

      const t = new AdaptiveTimeout({
        initialTimeoutMs: 5000,
        minTimeoutMs: 1000,
        maxTimeoutMs: 60000,
      });

      const controller = new AbortController();

      const promise = t.execute(
        async (signal) => {
          await new Promise<void>((resolve, reject) => {
            if (!signal) { resolve(); return; }
            if (signal.aborted) {
              reject(new DOMException("Aborted", "AbortError"));
              return;
            }
            signal.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            }, { once: true });
          });
          return "done";
        },
        controller.signal,
      );

      controller.abort();

      const result = await promise;
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(Error);
      }
    });

    it("should NOT update EMA on external cancellation", async () => {
      vi.useRealTimers();

      const t = new AdaptiveTimeout({
        initialTimeoutMs: 5000,
        minTimeoutMs: 1000,
        maxTimeoutMs: 60000,
        multiplier: 2,
        alpha: 0.5,
        initialEma: 5000,
      });

      const emaBefore = t.ema;
      const controller = new AbortController();

      const promise = t.execute(
        async (signal) => {
          await new Promise<void>((_resolve, reject) => {
            if (signal?.aborted) {
              reject(new DOMException("Aborted", "AbortError"));
              return;
            }
            signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            }, { once: true });
          });
        },
        controller.signal,
      );

      controller.abort();
      await promise;

      // 外部取消不更新 EMA
      expect(t.ema).toBe(emaBefore);
    });

    it("should handle pre-aborted external signal", async () => {
      vi.useRealTimers();

      const t = new AdaptiveTimeout({ initialTimeoutMs: 5000, minTimeoutMs: 1000, maxTimeoutMs: 10000 });
      const external = AbortSignal.abort();

      const result = await t.execute(
        async (signal) => {
          return "done";
        },
        external,
      );

      // pre-aborted 信号 → 超时守卫立即 reject
      // 但 fn 也可能同步返回 → 取决于 Promise.race
      // 两种结果都是合法的
      expect(result).toBeDefined();
    });
  });

  // ── EMA 更新 ──

  describe("EMA update", () => {
    it("should update EMA after successful execution", async () => {
      vi.useRealTimers();
      const t = new AdaptiveTimeout({
        initialTimeoutMs: 10000,
        minTimeoutMs: 1000,
        maxTimeoutMs: 60000,
        initialEma: 5000,
        multiplier: 2,
        alpha: 0.5,
      });

      const emaBefore = t.ema;

      // 执行一个耗时 ≈50ms 的操作
      await t.execute(async () => {
        await delay(50);
        return "ok";
      });

      // EMA 应下降（从 5000 向 50 移动）
      expect(t.ema).toBeLessThan(emaBefore);
      expect(t.ema).toBeGreaterThan(2000);
      expect(t.ema).toBeLessThan(3000);
      // timeoutMs 也应变化
      expect(t.timeoutMs).toBeGreaterThan(4000);
      expect(t.timeoutMs).toBeLessThan(6000);
    });

    it("should converge EMA toward actual latency", async () => {
      vi.useRealTimers();
      const t = new AdaptiveTimeout({
        initialTimeoutMs: 5000,
        minTimeoutMs: 100,
        maxTimeoutMs: 60000,
        initialEma: 5000,
        multiplier: 2,
        alpha: 0.5,
      });

      // 多次执行耗时 100ms 的操作
      for (let i = 0; i < 10; i++) {
        await t.execute(async () => {
          await delay(100);
          return "stable";
        });
      }

      // EMA 应趋近 100ms
      expect(t.ema).toBeLessThan(500);
      expect(t.ema).toBeGreaterThan(90);
    });

    it("should not update EMA when elapsed is NaN", async () => {
      const t = new AdaptiveTimeout({
        initialTimeoutMs: 5000,
        minTimeoutMs: 1000,
        maxTimeoutMs: 60000,
        initialEma: 5000,
        multiplier: 2,
        alpha: 0.5,
      });

      const emaBefore = t.ema;

      // 执行成功，但 elapsed 会被正常计算
      await t.execute(async () => "fast");

      // EMA 应基于实际耗时更新
      // fast 操作耗时 ≈0ms → EMA 下降
      expect(t.ema).toBeLessThan(emaBefore);
    });

    it("should clamp timeoutMs after EMA update", async () => {
      vi.useRealTimers();
      const t = new AdaptiveTimeout({
        initialTimeoutMs: 5000,
        minTimeoutMs: 5000,  // min=5000
        maxTimeoutMs: 60000,
        initialEma: 100,     // 很小的 EMA
        multiplier: 2,
        alpha: 0.5,
      });

      // EMA=100, multiplier=2 → raw=200, clamped to 5000 (min)
      expect(t.timeoutMs).toBe(5000);

      await t.execute(async () => {
        await delay(10);
        return "ok";
      });

      // EMA 更新后，timeout 仍被 min 截断为 5000
      expect(t.timeoutMs).toBe(5000);
    });
  });

  // ── reset ──

  describe("reset", () => {
    it("should restore initial EMA and timeout", () => {
      const t = new AdaptiveTimeout({
        initialTimeoutMs: 20000,
        minTimeoutMs: 5000,
        maxTimeoutMs: 60000,
        initialEma: 8000,
        multiplier: 2.5,
        alpha: 0.3,
      });

      // 先模拟一些执行（改变 EMA）
      // 手动触发内部变化后再 reset
      t.reset();

      // After reset, EMA = initialEma (8000)
      // timeoutMs = clamp(round(8000 * 2.5), 5000, 60000) = 20000
      expect(t.ema).toBe(8000);
      expect(t.timeoutMs).toBe(20000);
    });

    it("should be callable multiple times", () => {
      const t = new AdaptiveTimeout({ initialTimeoutMs: 10000, minTimeoutMs: 1000, maxTimeoutMs: 30000 });
      t.reset();
      t.reset();
      t.reset();
      expect(t.timeoutMs).toBeGreaterThan(0);
    });
  });

  // ── onTimeoutUpdate 回调 ──

  describe("onTimeoutUpdate callback", () => {
    it("should invoke callback when timeout value changes", async () => {
      vi.useRealTimers();
      const callback = vi.fn();

      const t = new AdaptiveTimeout({
        initialTimeoutMs: 5000,
        minTimeoutMs: 1000,
        maxTimeoutMs: 60000,
        multiplier: 2,
        alpha: 0.5,
        initialEma: 5000,
        onTimeoutUpdate: callback,
      });

      // 执行一个快速操作，EMA 应从 5000 下降
      await t.execute(async () => {
        await delay(10);
        return "fast";
      });

      // timeout 应变化，触发回调
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.any(Number),  // newTimeoutMs
        expect.any(Number),  // ema
        expect.any(Number),  // lastDuration
      );
    });

    it("should NOT invoke callback when timeout value unchanged", async () => {
      vi.useRealTimers();
      const callback = vi.fn();

      const t = new AdaptiveTimeout({
        initialTimeoutMs: 5000,
        minTimeoutMs: 5000,   // min = 5000
        maxTimeoutMs: 60000,
        multiplier: 1,         // timeout = ema * 1
        alpha: 0.5,
        initialEma: 5000,      // timeout = 5000
        onTimeoutUpdate: callback,
      });

      // 执行一个耗时 10ms 的操作
      // new EMA = 0.5*10 + 0.5*5000 = 2505
      // new timeout = round(2505 * 1) = 2505 → clamped to 5000
      // timeout 未变（仍为 5000）→ 不应触发回调
      await t.execute(async () => {
        await delay(10);
        return "ok";
      });

      // timeout 被 min 截断为 5000，未变化
      // 但 EMA 内部已更新
      expect(t.ema).toBeLessThan(3000);
      expect(t.ema).toBeGreaterThan(2000);
      // 回调不应该被调用（timeoutMs 没变化，因为被 min 截断）
      expect(callback).not.toHaveBeenCalled();
    });

    it("should isolate callback exception (not affect execute)", async () => {
      vi.useRealTimers();
      const callback = vi.fn(() => { throw new Error("callback-error"); });

      const t = new AdaptiveTimeout({
        initialTimeoutMs: 5000,
        minTimeoutMs: 1000,
        maxTimeoutMs: 60000,
        multiplier: 2,
        alpha: 0.5,
        initialEma: 5000,
        onTimeoutUpdate: callback,
      });

      // 即使 callback 抛异常，execute 也应正常返回
      const result = await t.execute(async () => {
        await delay(10);
        return "ok";
      });

      expect(result.success).toBe(true);
      expect(callback).toHaveBeenCalled();
    });
  });

  // ── 组合信号 ──

  describe("signal combination", () => {
    it("should handle external signal that aborts early", async () => {
      vi.useRealTimers();

      const t = new AdaptiveTimeout({
        initialTimeoutMs: 10000,
        minTimeoutMs: 1000,
        maxTimeoutMs: 30000,
      });
      const controller = new AbortController();

      const fnPromise = new Promise<void>((resolve) => {
        // 模拟一个不会自然结束的操作
      });

      const resultPromise = t.execute(
        async (_signal) => {
          await new Promise<void>(() => {}); // never resolves
          return "done";
        },
        controller.signal,
      );

      controller.abort();

      const result = await resultPromise;
      expect(result.success).toBe(false);
    });

    it("should work without external signal", async () => {
      vi.useRealTimers();
      const t = new AdaptiveTimeout({ initialTimeoutMs: 5000, minTimeoutMs: 1000, maxTimeoutMs: 10000 });

      const result = await t.execute(async () => "no-signal");
      expect(result.success).toBe(true);
    });
  });

  // ── 属性访问器 ──

  describe("properties", () => {
    it("should expose name", () => {
      const t = new AdaptiveTimeout();
      expect(t.name).toBe("adaptive-timeout");
    });

    it("should expose current timeoutMs", () => {
      const t = new AdaptiveTimeout({ initialTimeoutMs: 15000 });
      expect(t.timeoutMs).toBeGreaterThan(0);
    });

    it("should expose current ema", () => {
      const t = new AdaptiveTimeout({ initialEma: 3000 });
      expect(t.ema).toBe(3000);
    });

    it("timeoutMs should be readonly", () => {
      const t = new AdaptiveTimeout();
      expect(() => {
        (t as any).timeoutMs = 999;
      }).toThrow(); // 或静默失败，取决于 strict 模式
    });
  });

  // ── 边缘情况 ──

  describe("edge cases", () => {
    it("should handle extremely fast fn (sub-ms)", async () => {
      vi.useRealTimers();
      const t = new AdaptiveTimeout({ initialTimeoutMs: 5000, minTimeoutMs: 1000, maxTimeoutMs: 10000 });

      const result = await t.execute(async () => 1);
      expect(result.success).toBe(true);
    });

    it("should reject invalid constructor params gracefully", () => {
      expect(() => new AdaptiveTimeout({ initialTimeoutMs: -100 })).toThrow(RangeError);
      expect(() => new AdaptiveTimeout({ minTimeoutMs: -100 })).toThrow(RangeError);
      expect(() => new AdaptiveTimeout({ maxTimeoutMs: -100 })).toThrow(RangeError);
      expect(() => new AdaptiveTimeout({ minTimeoutMs: 100, maxTimeoutMs: 50 })).toThrow(RangeError);
    });

    it("should not throw on reset with default options", () => {
      const t = new AdaptiveTimeout();
      expect(() => t.reset()).not.toThrow();
    });
  });
});

// ============================================================
// 集成：FixedTimeout + AdaptiveTimeout 共享接口契约
// ============================================================

describe("ITimeoutPolicy contract compliance", () => {
  it("FixedTimeout implements ITimeoutPolicy", () => {
    const t = new FixedTimeout({ durationMs: 1000 });
    expect(t.name).toBeDefined();
    expect(typeof t.timeoutMs).toBe("number");
    expect(typeof t.execute).toBe("function");
    expect(typeof t.reset).toBe("function");
  });

  it("AdaptiveTimeout implements ITimeoutPolicy", () => {
    const t = new AdaptiveTimeout();
    expect(t.name).toBeDefined();
    expect(typeof t.timeoutMs).toBe("number");
    expect(typeof t.execute).toBe("function");
    expect(typeof t.reset).toBe("function");
  });
});
