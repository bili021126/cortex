// @ci: unit
// @vitest-environment node
// ============================================================
// retry.test.ts — 重试策略单元测试
// 覆盖：ExponentialBackoff | FixedRetry
// 要求：lines ≥ 80%，branches ≥ 80%
// ============================================================

import { describe, it, expect, vi } from "vitest";
import { ExponentialBackoff, FixedRetry, type IRetryPolicy } from "@cortex/resilience";

// ============================================================
// 接口合规性检查
// ============================================================

describe("IRetryPolicy interface compliance", () => {
  it("ExponentialBackoff should implement IRetryPolicy", () => {
    const retry: IRetryPolicy = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000 });
    expect(retry.name).toBeDefined();
    expect(typeof retry.maxAttempts).toBe("number");
    expect(typeof retry.nextDelay).toBe("function");
    expect(typeof retry.shouldRetry).toBe("function");
    expect(typeof retry.reset).toBe("function");
  });

  it("FixedRetry should implement IRetryPolicy", () => {
    const retry: IRetryPolicy = new FixedRetry();
    expect(retry.name).toBeDefined();
    expect(typeof retry.maxAttempts).toBe("number");
    expect(typeof retry.nextDelay).toBe("function");
    expect(typeof retry.shouldRetry).toBe("function");
    expect(typeof retry.reset).toBe("function");
  });
});

// ============================================================
// ExponentialBackoff 测试
// ============================================================

describe("ExponentialBackoff", () => {
  // ── 构造与验证 ──

  describe("constructor", () => {
    it("should create instance with default options", () => {
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000 });
      expect(retry.name).toBe("exponential-backoff");
      expect(retry.maxAttempts).toBe(3);
    });

    it("should apply default jitterFactor (0.1) when not provided", () => {
      // jitterFactor 默认值 0.1 会在 nextDelay 中产生抖动
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000 });
      // 多次调用 nextDelay 验证存在抖动（与 jitterFactor=0 不同）
      const delaysJitter = Array.from({ length: 50 }, () => retry.nextDelay(1));
      // 默认 jitter=0.1 时 ±10% → 范围 [900, 1100]，应至少存在差异
      const allSame = delaysJitter.every((d) => d === 1000);
      expect(allSame).toBe(false);
    });

    it("should apply default maxDelayMs (30000) when not provided", () => {
      const retry = new ExponentialBackoff({ maxAttempts: 10, baseDelayMs: 1000, jitterFactor: 0 });
      // attempt=10 → 1000 * 2^9 = 512000 → 被 30000 截断
      const delay = retry.nextDelay(10);
      expect(delay).toBe(30000);
    });

    it("should apply default retryableErrors (empty) when not provided", () => {
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000 });
      // 空数组 = 所有异常可重试
      expect(retry.shouldRetry(1, new Error("any"))).toBe(true);
      expect(retry.shouldRetry(1, "not an error")).toBe(true);
      expect(retry.shouldRetry(1, undefined)).toBe(true);
    });

    it("should not set shouldRetry hook when not provided", () => {
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000 });
      // 不提供 shouldRetry 时使用默认判断逻辑
      expect(retry.shouldRetry(1, new Error())).toBe(true);
      expect(retry.shouldRetry(3, new Error())).toBe(false);
    });

    it("should throw RangeError when maxAttempts < 1", () => {
      expect(() => new ExponentialBackoff({ maxAttempts: 0, baseDelayMs: 1000 })).toThrow(RangeError);
      expect(() => new ExponentialBackoff({ maxAttempts: 0, baseDelayMs: 1000 })).toThrow(/maxAttempts/);
      expect(() => new ExponentialBackoff({ maxAttempts: -1, baseDelayMs: 1000 })).toThrow(RangeError);
    });

    it("should throw RangeError when baseDelayMs < 0", () => {
      expect(() => new ExponentialBackoff({ maxAttempts: 1, baseDelayMs: -1 })).toThrow(RangeError);
      expect(() => new ExponentialBackoff({ maxAttempts: 1, baseDelayMs: -1 })).toThrow(/baseDelayMs/);
    });

    it("should throw RangeError when jitterFactor is out of [0, 0.5]", () => {
      expect(() => new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000, jitterFactor: -0.1 })).toThrow(RangeError);
      expect(() => new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000, jitterFactor: 0.6 })).toThrow(RangeError);
    });

    it("should accept valid jitterFactor values including boundaries", () => {
      expect(() => new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000, jitterFactor: 0 })).not.toThrow();
      expect(() => new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000, jitterFactor: 0.5 })).not.toThrow();
      expect(() => new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000, jitterFactor: 0.3 })).not.toThrow();
    });

    it("should accept maxDelayMs = 0 (no wait cap)", () => {
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 0, jitterFactor: 0 });
      expect(retry.nextDelay(1)).toBe(0); // clamped to 0
    });

    it("should accept baseDelayMs = 0", () => {
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 0, jitterFactor: 0 });
      expect(retry.nextDelay(1)).toBe(0);
      expect(retry.nextDelay(10)).toBe(0);
    });
  });

  // ── nextDelay ──

  describe("nextDelay", () => {
    it("should return baseDelayMs for attempt=1 with jitterFactor=0", () => {
      const retry = new ExponentialBackoff({ maxAttempts: 5, baseDelayMs: 1000, jitterFactor: 0 });
      const delay = retry.nextDelay(1);
      expect(delay).toBe(1000);
    });

    it("should double each attempt for jitterFactor=0", () => {
      const retry = new ExponentialBackoff({ maxAttempts: 5, baseDelayMs: 1000, jitterFactor: 0 });
      expect(retry.nextDelay(1)).toBe(1000);
      expect(retry.nextDelay(2)).toBe(2000);
      expect(retry.nextDelay(3)).toBe(4000);
      expect(retry.nextDelay(4)).toBe(8000);
    });

    it("should cap at maxDelayMs", () => {
      const retry = new ExponentialBackoff({ maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 5000, jitterFactor: 0 });
      const delay = retry.nextDelay(10);
      expect(delay).toBeLessThanOrEqual(5000);
      // 指数增长远超 5000，应精确等于上限
      expect(delay).toBe(5000);
    });

    it("should apply jitter within expected range", () => {
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000, jitterFactor: 0.1 });
      const delays = Array.from({ length: 100 }, () => retry.nextDelay(1));
      const allInRange = delays.every((d) => d >= 900 && d <= 1100);
      expect(allInRange).toBe(true);
    });

    it("should never return negative values even with large jitterFactor", () => {
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 100, jitterFactor: 0.5 });
      const delays = Array.from({ length: 200 }, () => retry.nextDelay(1));
      const allNonNegative = delays.every((d) => d >= 0);
      expect(allNonNegative).toBe(true);
    });

    it("should clamp exponential growth to maxDelayMs before applying jitter", () => {
      // maxDelayMs=100, baseDelayMs=1000, attempt=10 → 指数=512000 → clamp=100
      const retry = new ExponentialBackoff({ maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 100, jitterFactor: 0.1 });
      const delays = Array.from({ length: 100 }, () => retry.nextDelay(10));
      // 抖动施加在 clamped 值上：100 ± 10 → [90, 110]
      const allInRange = delays.every((d) => d >= 90 && d <= 110);
      expect(allInRange).toBe(true);
    });

    it("should return integer values", () => {
      const retry = new ExponentialBackoff({ maxAttempts: 5, baseDelayMs: 1000, jitterFactor: 0.1 });
      const delays = Array.from({ length: 50 }, () => retry.nextDelay(1));
      const allIntegers = delays.every((d) => Number.isInteger(d));
      expect(allIntegers).toBe(true);
    });

    it("should accept error parameter without affecting calculation", () => {
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000, jitterFactor: 0 });
      const withError = retry.nextDelay(1, new Error("test"));
      const withoutError = retry.nextDelay(1);
      expect(withError).toBe(withoutError);
    });
  });

  // ── shouldRetry ──

  describe("shouldRetry", () => {
    it("should return false when attempt >= maxAttempts", () => {
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000 });
      expect(retry.shouldRetry(3)).toBe(false);
      expect(retry.shouldRetry(4)).toBe(false);
      expect(retry.shouldRetry(100)).toBe(false);
    });

    it("should return true when attempt < maxAttempts and no error filter", () => {
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000 });
      expect(retry.shouldRetry(1)).toBe(true);
      expect(retry.shouldRetry(2)).toBe(true);
    });

    it("should delegate to shouldRetry hook when provided", () => {
      const hook = vi.fn().mockReturnValue(true);
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000, shouldRetry: hook });
      expect(retry.shouldRetry(1)).toBe(true);
      expect(hook).toHaveBeenCalledWith(1, undefined);
    });

    it("should use hook result even when attempt >= maxAttempts (hook override)", () => {
      // 钩子优先于 maxAttempts 判断
      const hook = vi.fn().mockReturnValue(true);
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000, shouldRetry: hook });
      expect(retry.shouldRetry(3)).toBe(true); // hook 返回 true，尽管 attempt >= maxAttempts
      expect(hook).toHaveBeenCalledWith(3, undefined);
    });

    it("should pass the error to shouldRetry hook", () => {
      const hook = vi.fn().mockReturnValue(true);
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000, shouldRetry: hook });
      const error = new Error("boom");
      retry.shouldRetry(1, error);
      expect(hook).toHaveBeenCalledWith(1, error);
    });

    it("should respect retryableErrors filter", () => {
      class NetworkError extends Error {}
      class DatabaseError extends Error {}
      const retry = new ExponentialBackoff({
        maxAttempts: 3,
        baseDelayMs: 1000,
        retryableErrors: [NetworkError as unknown as new (...args: unknown[]) => Error],
      });
      expect(retry.shouldRetry(1, new NetworkError("timeout"))).toBe(true);
      expect(retry.shouldRetry(1, new DatabaseError("down"))).toBe(false);
      expect(retry.shouldRetry(1, new Error("generic"))).toBe(false);
    });

    it("should return false for undefined/null error when retryableErrors is non-empty", () => {
      const retry = new ExponentialBackoff({
        maxAttempts: 3,
        baseDelayMs: 1000,
        retryableErrors: [Error as unknown as new (...args: unknown[]) => Error],
      });
      expect(retry.shouldRetry(1, undefined)).toBe(false);
      expect(retry.shouldRetry(1, null)).toBe(false);
    });

    it("should handle multiple error types in retryableErrors", () => {
      class TimeoutError extends Error {}
      class RateLimitError extends Error {}
      const retry = new ExponentialBackoff({
        maxAttempts: 3,
        baseDelayMs: 1000,
        retryableErrors: [TimeoutError as unknown as new (...args: unknown[]) => Error, RateLimitError as unknown as new (...args: unknown[]) => Error],
      });
      expect(retry.shouldRetry(1, new TimeoutError())).toBe(true);
      expect(retry.shouldRetry(1, new RateLimitError())).toBe(true);
      expect(retry.shouldRetry(1, new Error("other"))).toBe(false);
    });

    it("should return true for any error when retryableErrors is empty", () => {
      const retry = new ExponentialBackoff({
        maxAttempts: 3,
        baseDelayMs: 1000,
        retryableErrors: [],
      });
      expect(retry.shouldRetry(1, new Error())).toBe(true);
      expect(retry.shouldRetry(1, new TypeError())).toBe(true);
      expect(retry.shouldRetry(1, new RangeError())).toBe(true);
    });

    it("should return false when shouldRetry hook returns false", () => {
      const hook = vi.fn().mockReturnValue(false);
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000, shouldRetry: hook });
      expect(retry.shouldRetry(1, new Error())).toBe(false);
    });
  });

  // ── reset ──

  describe("reset", () => {
    it("should not throw", () => {
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 1000 });
      expect(() => retry.reset()).not.toThrow();
    });
  });

  // ── 集成场景 ──

  describe("integration scenarios", () => {
    it("should work with a realistic retry loop", async () => {
      const retry = new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 100, jitterFactor: 0 });
      let attempt = 1;
      const errors: number[] = [];

      while (attempt <= retry.maxAttempts) {
        try {
          // 模拟一个会失败两次的函数
          throw new Error(`fail-${attempt}`);
        } catch (err) {
          errors.push(attempt);
          if (!retry.shouldRetry(attempt, err)) break;
          const delay = retry.nextDelay(attempt, err);
          expect(delay).toBeGreaterThanOrEqual(0);
          attempt++;
        }
      }

      expect(attempt).toBe(3); // maxAttempts=3, 尝试了3次
      expect(errors).toEqual([1, 2, 3]);
    });
  });
});

// ============================================================
// FixedRetry 测试
// ============================================================

describe("FixedRetry", () => {
  // ── 构造与验证 ──

  describe("constructor", () => {
    it("should create instance with default options", () => {
      const retry = new FixedRetry();
      expect(retry.name).toBe("fixed-retry");
      expect(retry.maxAttempts).toBe(3);
      expect(retry.delayMs).toBe(1000);
    });

    it("should create instance with custom options", () => {
      const retry = new FixedRetry({ maxAttempts: 5, delayMs: 2000 });
      expect(retry.maxAttempts).toBe(5);
      expect(retry.delayMs).toBe(2000);
    });

    it("should set default retryableErrors to empty array when not provided", () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 1000 });
      // 空数组 = 所有异常可重试
      expect(retry.shouldRetry(1, new Error())).toBe(true);
      expect(retry.shouldRetry(1, new TypeError())).toBe(true);
    });

    it("should not set shouldRetry hook when not provided", () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 1000 });
      // 使用默认判断逻辑
      expect(retry.shouldRetry(1, new Error())).toBe(true);
      expect(retry.shouldRetry(3, new Error())).toBe(false);
    });

    it("should throw RangeError when maxAttempts < 1", () => {
      expect(() => new FixedRetry({ maxAttempts: 0 })).toThrow(RangeError);
      expect(() => new FixedRetry({ maxAttempts: 0 })).toThrow(/maxAttempts/);
      expect(() => new FixedRetry({ maxAttempts: -1 })).toThrow(RangeError);
    });

    it("should throw RangeError when delayMs < 0", () => {
      expect(() => new FixedRetry({ delayMs: -1 })).toThrow(RangeError);
      expect(() => new FixedRetry({ delayMs: -1 })).toThrow(/delayMs/);
    });

    it("should throw RangeError when maxDelayMs < 0", () => {
      expect(() => new FixedRetry({ delayMs: 1000, maxDelayMs: -1 })).toThrow(RangeError);
      expect(() => new FixedRetry({ delayMs: 1000, maxDelayMs: -1 })).toThrow(/maxDelayMs/);
    });

    it("should throw RangeError when delayMs > maxDelayMs", () => {
      expect(() => new FixedRetry({ delayMs: 2000, maxDelayMs: 1000 })).toThrow(RangeError);
      expect(() => new FixedRetry({ delayMs: 2000, maxDelayMs: 1000 })).toThrow(/delayMs.*maxDelayMs/);
    });

    it("should accept delayMs === maxDelayMs", () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 2000, maxDelayMs: 2000 });
      expect(retry.delayMs).toBe(2000);
      expect(retry.maxDelayMs).toBe(2000);
    });

    it("should accept delayMs = 0 (immediate retry)", () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 0 });
      expect(retry.delayMs).toBe(0);
      expect(retry.nextDelay(1)).toBe(0);
    });

    it("should accept maxDelayMs without delayMs (delayMs defaults to 1000)", () => {
      const retry = new FixedRetry({ maxAttempts: 3, maxDelayMs: 5000 });
      expect(retry.delayMs).toBe(1000); // 默认值
      expect(retry.maxDelayMs).toBe(5000);
    });
  });

  // ── nextDelay ──

  describe("nextDelay", () => {
    it("should return fixed delayMs regardless of attempt", () => {
      const retry = new FixedRetry({ maxAttempts: 5, delayMs: 1500 });
      expect(retry.nextDelay(1)).toBe(1500);
      expect(retry.nextDelay(2)).toBe(1500);
      expect(retry.nextDelay(10)).toBe(1500);
    });

    it("should return delayMs when maxDelayMs > delayMs", () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 1000, maxDelayMs: 5000 });
      expect(retry.nextDelay(1)).toBe(1000); // Math.min(1000, 5000) = 1000
    });

    it("should return maxDelayMs when delayMs > maxDelayMs (but constructor prevents this)", () => {
      // 构造器禁止 delayMs > maxDelayMs，所以此处测试 delayMs === maxDelayMs
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 2000, maxDelayMs: 2000 });
      expect(retry.nextDelay(1)).toBe(2000); // Math.min(2000, 2000) = 2000
    });

    it("should return 0 when delayMs is 0", () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 0 });
      expect(retry.nextDelay(1)).toBe(0);
    });

    it("should accept error parameter without affecting calculation", () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 1000 });
      const withError = retry.nextDelay(1, new Error("test"));
      const withoutError = retry.nextDelay(1);
      expect(withError).toBe(withoutError);
    });
  });

  // ── shouldRetry ──

  describe("shouldRetry", () => {
    it("should return false when attempt >= maxAttempts", () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 1000 });
      expect(retry.shouldRetry(3)).toBe(false);
      expect(retry.shouldRetry(4)).toBe(false);
      expect(retry.shouldRetry(100)).toBe(false);
    });

    it("should return true when attempt < maxAttempts and no error filter", () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 1000 });
      expect(retry.shouldRetry(1)).toBe(true);
      expect(retry.shouldRetry(2)).toBe(true);
    });

    it("should respect shouldRetry hook returning explicit boolean", () => {
      const hook = vi.fn().mockReturnValue(false);
      const retry = new FixedRetry({
        maxAttempts: 3,
        delayMs: 1000,
        shouldRetry: hook,
      });
      expect(retry.shouldRetry(1)).toBe(false);
      expect(hook).toHaveBeenCalledWith(1, undefined);
    });

    it("should respect shouldRetry hook returning undefined (fall through)", () => {
      const retry = new FixedRetry({
        maxAttempts: 3,
        delayMs: 1000,
        shouldRetry: () => undefined,
      });
      // undefined 回退到默认逻辑
      expect(retry.shouldRetry(1)).toBe(true);
      expect(retry.shouldRetry(3)).toBe(false);
    });

    it("should pass error to shouldRetry hook", () => {
      const hook = vi.fn().mockReturnValue(true);
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 1000, shouldRetry: hook });
      const error = new Error("test");
      retry.shouldRetry(1, error);
      expect(hook).toHaveBeenCalledWith(1, error);
    });

    it("should filter by retryableErrors", () => {
      class RateLimitError extends Error {}
      class OtherError extends Error {}
      const retry = new FixedRetry({
        maxAttempts: 5,
        delayMs: 1000,
        retryableErrors: [RateLimitError as unknown as new (...args: unknown[]) => Error],
      });
      expect(retry.shouldRetry(1, new RateLimitError("too fast"))).toBe(true);
      expect(retry.shouldRetry(1, new OtherError("other"))).toBe(false);
    });

    it("should handle multiple retryable error types", () => {
      class TimeoutError extends Error {}
      class NetworkError extends Error {}
      const retry = new FixedRetry({
        maxAttempts: 5,
        delayMs: 1000,
        retryableErrors: [TimeoutError as unknown as new (...args: unknown[]) => Error, NetworkError as unknown as new (...args: unknown[]) => Error],
      });
      expect(retry.shouldRetry(1, new TimeoutError())).toBe(true);
      expect(retry.shouldRetry(1, new NetworkError())).toBe(true);
      expect(retry.shouldRetry(1, new Error("generic"))).toBe(false);
    });

    it("should return false for null/undefined error when retryableErrors is non-empty", () => {
      const retry = new FixedRetry({
        maxAttempts: 5,
        delayMs: 1000,
        retryableErrors: [Error as unknown as new (...args: unknown[]) => Error],
      });
      expect(retry.shouldRetry(1, null)).toBe(false);
      expect(retry.shouldRetry(2, undefined)).toBe(false);
    });

    it("should return true for any error when retryableErrors is empty", () => {
      const retry = new FixedRetry({
        maxAttempts: 5,
        delayMs: 1000,
        retryableErrors: [],
      });
      expect(retry.shouldRetry(1, new Error())).toBe(true);
      expect(retry.shouldRetry(1, new SyntaxError())).toBe(true);
    });

    it("should return false when shouldRetry hook returns false", () => {
      const hook = vi.fn().mockReturnValue(false);
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 1000, shouldRetry: hook });
      expect(retry.shouldRetry(1, new Error())).toBe(false);
    });
  });

  // ── toString ──

  describe("toString", () => {
    it("should return descriptive string", () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 1000 });
      expect(retry.toString()).toBe("FixedRetry(maxAttempts=3, delayMs=1000)");
    });

    it("should include maxDelayMs when set", () => {
      const retry = new FixedRetry({ maxAttempts: 5, delayMs: 2000, maxDelayMs: 10000 });
      expect(retry.toString()).toContain("maxDelayMs=10000");
    });

    it("should not include maxDelayMs when not set", () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 1000 });
      expect(retry.toString()).not.toContain("maxDelayMs");
    });

    it("should include retryableErrors when set", () => {
      class MyError extends Error {}
      const retry = new FixedRetry({
        maxAttempts: 3,
        delayMs: 1000,
        retryableErrors: [MyError as unknown as new (...args: unknown[]) => Error],
      });
      expect(retry.toString()).toContain("MyError");
    });

    it("should include multiple retryableErrors names", () => {
      class ErrA extends Error {}
      class ErrB extends Error {}
      const retry = new FixedRetry({
        maxAttempts: 3,
        delayMs: 1000,
        retryableErrors: [ErrA as unknown as new (...args: unknown[]) => Error, ErrB as unknown as new (...args: unknown[]) => Error],
      });
      const str = retry.toString();
      expect(str).toContain("ErrA");
      expect(str).toContain("ErrB");
    });

    it("should not include retryableErrors when empty", () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 1000, retryableErrors: [] });
      expect(retry.toString()).not.toContain("retryableErrors");
    });
  });

  // ── clone ──

  describe("clone", () => {
    it("should create an independent copy", () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 1500 });
      const cloned = retry.clone();
      expect(cloned).not.toBe(retry);
      expect(cloned.maxAttempts).toBe(3);
      expect(cloned.delayMs).toBe(1500);
    });

    it("should copy all configuration properties", () => {
      class CustomError extends Error {}
      const retry = new FixedRetry({
        maxAttempts: 5,
        delayMs: 2000,
        maxDelayMs: 10000,
        retryableErrors: [CustomError as unknown as new (...args: unknown[]) => Error],
        shouldRetry: () => true,
      });
      const cloned = retry.clone();
      expect(cloned.maxAttempts).toBe(5);
      expect(cloned.delayMs).toBe(2000);
      expect(cloned.maxDelayMs).toBe(10000);
      expect(cloned.shouldRetry(1)).toBe(true);
    });

    it("should create truly independent clone (modifications don't affect original)", () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 1000 });
      const cloned = retry.clone();
      // 修改 clone 不影响原实例
      (cloned as unknown as Record<string, unknown>).maxAttempts = 999; // 类型体操用于测试
      expect(retry.maxAttempts).toBe(3);
    });
  });

  // ── reset ──

  describe("reset", () => {
    it("should not throw", () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 1000 });
      expect(() => retry.reset()).not.toThrow();
    });

    it("should be callable multiple times", () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 1000 });
      expect(() => {
        retry.reset();
        retry.reset();
        retry.reset();
      }).not.toThrow();
    });
  });

  // ── 集成场景 ──

  describe("integration scenarios", () => {
    it("should work with a realistic retry loop", async () => {
      const retry = new FixedRetry({ maxAttempts: 3, delayMs: 50 });
      let attempt = 1;
      const errors: number[] = [];

      while (attempt <= retry.maxAttempts) {
        try {
          throw new Error(`fail-${attempt}`);
        } catch (err) {
          errors.push(attempt);
          if (!retry.shouldRetry(attempt, err)) break;
          const delay = retry.nextDelay(attempt, err);
          expect(delay).toBe(50);
          attempt++;
        }
      }

      expect(attempt).toBe(3);
      expect(errors).toEqual([1, 2, 3]);
    });
  });
});
