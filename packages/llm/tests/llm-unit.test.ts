// @ci: unit
// ============================================================
// @cortex/llm —— SimpleCircuitBreaker 单元测试
// 断路器从 @cortex/resilience 导入（llm 依赖 resilience）
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SimpleCircuitBreaker } from "@cortex/resilience";

describe("SimpleCircuitBreaker", () => {
  let breaker: SimpleCircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    breaker = new SimpleCircuitBreaker({
      name: "test-breaker",
      threshold: 5,
      halfOpenAfterMs: 30_000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("初始 CLOSED", () => {
    expect(breaker.state).toBe("CLOSED");
    expect(breaker.consecutiveFailures).toBe(0);
  });

  it("5 次失败→OPEN", () => {
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }
    expect(breaker.state).toBe("OPEN");
    expect(breaker.consecutiveFailures).toBe(5);
  });

  it("30s 后 call 自动进入 HALF_OPEN 并试探", async () => {
    // 制造 OPEN 状态
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }
    expect(breaker.state).toBe("OPEN");

    // 快进 30 秒
    vi.advanceTimersByTime(30_000);

    // call 内部检查时间：OPEN → HALF_OPEN → 执行 fn → 成功 → CLOSED
    await breaker.call(() => Promise.resolve("ok"));

    expect(breaker.state).toBe("CLOSED");
    expect(breaker.consecutiveFailures).toBe(0);
  });

  it("半开期失败回到 OPEN", async () => {
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }
    vi.advanceTimersByTime(30_000);

    // 半开试探失败 → 回到 OPEN
    await expect(
      breaker.call(() => Promise.reject(new Error("fail")))
    ).rejects.toThrow("fail");

    expect(breaker.state).toBe("OPEN");
  });

  it("OPEN 状态无 fallback 时抛 CircuitBreakerOpenError", async () => {
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }

    // OPEN 状态且未到半开时间，无 fallback → 抛错
    await expect(
      breaker.call(() => Promise.resolve("ok"))
    ).rejects.toThrow('Circuit breaker "test-breaker" is OPEN');
  });

  it("OPEN 状态有 fallback 时返回 fallback 结果", async () => {
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }

    const result = await breaker.call(
      () => Promise.resolve("original"),
      () => Promise.resolve("fallback-result"),
    );
    expect(result).toBe("fallback-result");
  });

  it("recordSuccess 清零失败计数", () => {
    for (let i = 0; i < 3; i++) {
      breaker.recordFailure();
    }
    expect(breaker.consecutiveFailures).toBe(3);

    breaker.recordSuccess();
    expect(breaker.consecutiveFailures).toBe(0);
  });

  it("reset 回到 CLOSED", () => {
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }
    expect(breaker.state).toBe("OPEN");

    breaker.reset();
    expect(breaker.state).toBe("CLOSED");
    expect(breaker.consecutiveFailures).toBe(0);
  });

  it("forceState 强制转换", () => {
    breaker.forceState("OPEN");
    expect(breaker.state).toBe("OPEN");

    breaker.forceState("HALF_OPEN");
    expect(breaker.state).toBe("HALF_OPEN");

    breaker.forceState("CLOSED");
    expect(breaker.state).toBe("CLOSED");
  });

  it("onStateChange 回调触发", () => {
    const handler = vi.fn();
    breaker.onStateChange(handler);

    breaker.forceState("OPEN");
    expect(handler).toHaveBeenCalledWith("OPEN", "CLOSED");

    breaker.forceState("CLOSED");
    expect(handler).toHaveBeenCalledWith("CLOSED", "OPEN");
  });
});
