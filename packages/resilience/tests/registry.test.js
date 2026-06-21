// @ci: unit
// @vitest-environment node
// ============================================================
// registry.test.ts — 注册中心单元测试
// 覆盖：Registry | ResilienceContextManager | 错误类型
// 目标行覆盖 ≥80%
// ============================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Registry, CircuitBreakerOpenError, TimeoutError, ResilienceContextManager, ExponentialBackoff, FixedRetry, SimpleCircuitBreaker, StateMachineCircuitBreaker, FixedTimeout, AdaptiveTimeout, } from "@cortex/resilience";
// ============================================================
// CircuitBreakerOpenError 测试
// ============================================================
describe("CircuitBreakerOpenError", () => {
    it("should have correct name and message", () => {
        const err = new CircuitBreakerOpenError("my-circuit");
        expect(err.name).toBe("CircuitBreakerOpenError");
        expect(err.message).toContain("my-circuit");
        expect(err.circuitName).toBe("my-circuit");
        expect(err.state).toBe("OPEN");
    });
    it("should be an instance of Error", () => {
        const err = new CircuitBreakerOpenError("test");
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(CircuitBreakerOpenError);
    });
    it("should handle empty circuit name", () => {
        const err = new CircuitBreakerOpenError("");
        expect(err.circuitName).toBe("");
        expect(err.message).toContain('""');
    });
    it("should handle circuit name with special characters", () => {
        const err = new CircuitBreakerOpenError("service/api@v2");
        expect(err.circuitName).toBe("service/api@v2");
        expect(err.message).toContain("service/api@v2");
    });
});
// ============================================================
// TimeoutError 测试
// ============================================================
describe("TimeoutError", () => {
    it("should have correct properties", () => {
        const err = new TimeoutError(5000, 5234);
        expect(err.name).toBe("TimeoutError");
        expect(err.message).toContain("5000");
        expect(err.timeoutMs).toBe(5000);
        expect(err.elapsedMs).toBe(5234);
    });
    it("should be an instance of Error", () => {
        const err = new TimeoutError(1000, 1500);
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(TimeoutError);
    });
    it("should handle zero timeout", () => {
        const err = new TimeoutError(0, 0);
        expect(err.timeoutMs).toBe(0);
        expect(err.elapsedMs).toBe(0);
    });
    it("should handle large values", () => {
        const err = new TimeoutError(999999, 1000000);
        expect(err.timeoutMs).toBe(999999);
        expect(err.elapsedMs).toBe(1000000);
        expect(err.message).toContain("999999");
    });
});
// ============================================================
// ResilienceContextManager 测试
// ============================================================
describe("ResilienceContextManager", () => {
    it("should run function within context", async () => {
        const result = await ResilienceContextManager.run("test-policy", async (ctx) => {
            expect(ctx.policyName).toBe("test-policy");
            expect(ctx.policyChain).toEqual(["test-policy"]);
            expect(ctx.attempt).toBe(0);
            expect(ctx.metadata).toBeInstanceOf(Map);
            return "context-result";
        });
        expect(result).toBe("context-result");
    });
    it("should generate unique execution IDs", async () => {
        let id1;
        let id2;
        await ResilienceContextManager.run("p1", async (ctx) => {
            id1 = ctx.executionId;
        });
        await ResilienceContextManager.run("p2", async (ctx) => {
            id2 = ctx.executionId;
        });
        expect(id1).toBeDefined();
        expect(id2).toBeDefined();
        expect(id1).not.toBe(id2);
    });
    it("current() should return undefined outside of run", () => {
        expect(ResilienceContextManager.current()).toBeUndefined();
    });
    it("should set startedAt to a recent timestamp", async () => {
        const before = Date.now();
        let startedAt = 0;
        await ResilienceContextManager.run("ts-test", async (ctx) => {
            startedAt = ctx.startedAt;
        });
        expect(startedAt).toBeGreaterThanOrEqual(before);
        expect(startedAt).toBeLessThanOrEqual(Date.now());
    });
    it("should propagate context through nested run calls", async () => {
        // The context is per-run, so nested runs create a new context
        // This test ensures the outer context is not affected by inner runs
        let outerCtx;
        await ResilienceContextManager.run("outer", async (ctx) => {
            outerCtx = ctx.executionId;
            await ResilienceContextManager.run("inner", async (innerCtx) => {
                // Inner context should have a different execution ID
                expect(innerCtx.executionId).not.toBe(outerCtx);
                expect(innerCtx.policyName).toBe("inner");
            });
        });
    });
    it("should handle synchronous throws in the run function", async () => {
        await expect(ResilienceContextManager.run("throw-test", async () => {
            throw new Error("sync-fail");
        })).rejects.toThrow("sync-fail");
    });
    it("should allow metadata mutation within context", async () => {
        await ResilienceContextManager.run("meta-test", async (ctx) => {
            ctx.metadata.set("key1", "value1");
            ctx.metadata.set("key2", 42);
            expect(ctx.metadata.get("key1")).toBe("value1");
            expect(ctx.metadata.get("key2")).toBe(42);
        });
    });
});
// ============================================================
// Registry 测试
// ============================================================
describe("Registry", () => {
    let registry;
    beforeEach(() => {
        registry = new Registry();
    });
    // ── 注册与查询 ──
    describe("register and query", () => {
        it("should register and retrieve policies", () => {
            const retry = new FixedRetry({ maxAttempts: 3 });
            const cb = new SimpleCircuitBreaker({ name: "cb1", threshold: 5, halfOpenAfterMs: 30000 });
            const timeout = new FixedTimeout({ durationMs: 10000 });
            registry.register("my-service", { retry, circuitBreaker: cb, timeout });
            expect(registry.getRetry("my-service")).toBe(retry);
            expect(registry.getCircuitBreaker("my-service")).toBe(cb);
            expect(registry.getTimeout("my-service")).toBe(timeout);
        });
        it("should return undefined for unregistered names", () => {
            expect(registry.getRetry("nonexistent")).toBeUndefined();
            expect(registry.getCircuitBreaker("nonexistent")).toBeUndefined();
            expect(registry.getTimeout("nonexistent")).toBeUndefined();
        });
        it("should fill missing policies with null objects", () => {
            registry.register("partial", { retry: new FixedRetry() });
            expect(registry.getRetry("partial")?.name).toBe("fixed-retry");
            expect(registry.getCircuitBreaker("partial")?.name).toBe("no-breaker");
            expect(registry.getTimeout("partial")?.name).toBe("no-timeout");
        });
        it("should overwrite existing entries and emit REGISTRY_OVERWRITE event", () => {
            const eventHandler = vi.fn();
            registry.onEvent(eventHandler);
            registry.register("svc", { retry: new FixedRetry({ maxAttempts: 3 }) });
            expect(eventHandler).not.toHaveBeenCalled();
            registry.register("svc", { retry: new FixedRetry({ maxAttempts: 5 }) });
            expect(eventHandler).toHaveBeenCalledWith(expect.objectContaining({ type: "REGISTRY_OVERWRITE", name: "svc" }));
        });
        it("should preserve existing policies on partial re-registration", () => {
            const retry = new FixedRetry({ maxAttempts: 3 });
            const cb = new SimpleCircuitBreaker({ name: "cb", threshold: 5, halfOpenAfterMs: 30000 });
            // Register with retry and CB
            registry.register("svc", { retry, circuitBreaker: cb });
            // Re-register with only timeout — retry and CB should be preserved
            const timeout = new FixedTimeout({ durationMs: 5000 });
            registry.register("svc", { timeout });
            expect(registry.getRetry("svc")).toBe(retry);
            expect(registry.getCircuitBreaker("svc")).toBe(cb);
            expect(registry.getTimeout("svc")).toBe(timeout);
        });
        it("should fill with null objects when re-registering with no policies and no existing", () => {
            // Register with nothing, then re-register with nothing
            registry.register("empty", {});
            expect(registry.getRetry("empty")?.name).toBe("no-retry");
            expect(registry.getCircuitBreaker("empty")?.name).toBe("no-breaker");
            expect(registry.getTimeout("empty")?.name).toBe("no-timeout");
        });
        it("should unregister policies and return undefined after", () => {
            registry.register("svc", { retry: new FixedRetry() });
            expect(registry.getRetry("svc")).toBeDefined();
            registry.unregister("svc");
            expect(registry.getRetry("svc")).toBeUndefined();
            expect(registry.getCircuitBreaker("svc")).toBeUndefined();
            expect(registry.getTimeout("svc")).toBeUndefined();
        });
        it("should unregister non-existent name without throwing", () => {
            expect(() => registry.unregister("never-existed")).not.toThrow();
        });
        it("should allow multiple registrations with different names", () => {
            registry.register("svc1", { retry: new FixedRetry({ maxAttempts: 3 }) });
            registry.register("svc2", { retry: new FixedRetry({ maxAttempts: 5 }) });
            registry.register("svc3", { retry: new FixedRetry({ maxAttempts: 7 }) });
            expect(registry.getRetry("svc1")?.maxAttempts).toBe(3);
            expect(registry.getRetry("svc2")?.maxAttempts).toBe(5);
            expect(registry.getRetry("svc3")?.maxAttempts).toBe(7);
        });
    });
    // ── Registry.create ──
    describe("Registry.create", () => {
        it("should create registry with default policies", () => {
            const r = Registry.create({
                timeout: new FixedTimeout({ durationMs: 15000 }),
            });
            expect(r.getTimeout("default")?.timeoutMs).toBe(15000);
            expect(r.getRetry("default")?.name).toBe("no-retry");
            expect(r.getCircuitBreaker("default")?.name).toBe("no-breaker");
        });
        it("should create empty registry when no defaults given", () => {
            const r = Registry.create();
            expect(r.getRetry("default")).toBeUndefined();
        });
        it("should create registry with empty defaults object", () => {
            const r = Registry.create({});
            expect(r.getRetry("default")?.name).toBe("no-retry");
            expect(r.getCircuitBreaker("default")?.name).toBe("no-breaker");
            expect(r.getTimeout("default")?.name).toBe("no-timeout");
        });
        it("should create registry with only retry default", () => {
            const retry = new FixedRetry({ maxAttempts: 5 });
            const r = Registry.create({ retry });
            expect(r.getRetry("default")?.maxAttempts).toBe(5);
            expect(r.getCircuitBreaker("default")?.name).toBe("no-breaker");
            expect(r.getTimeout("default")?.name).toBe("no-timeout");
        });
        it("should create registry with only circuit breaker default", () => {
            const cb = new SimpleCircuitBreaker({ name: "default-cb", threshold: 3, halfOpenAfterMs: 1000 });
            const r = Registry.create({ circuitBreaker: cb });
            expect(r.getRetry("default")?.name).toBe("no-retry");
            expect(r.getCircuitBreaker("default")?.name).toBe("default-cb");
            expect(r.getTimeout("default")?.name).toBe("no-timeout");
        });
    });
    // ── 组合执行 ──
    describe("execute", () => {
        it("should throw when no policies registered for name", async () => {
            await expect(registry.execute("unknown", async () => "result")).rejects.toThrow(/No resilience policies registered/);
        });
        it("should execute function successfully with minimal policies", async () => {
            registry.register("svc", {
                retry: new FixedRetry({ maxAttempts: 1 }),
                circuitBreaker: new SimpleCircuitBreaker({ name: "svc", threshold: 10, halfOpenAfterMs: 1000 }),
                timeout: new FixedTimeout({ durationMs: 5000 }),
            });
            const result = await registry.execute("svc", async () => "hello");
            expect(result).toBe("hello");
        });
        it("should retry on failure and succeed", async () => {
            registry.register("svc", {
                retry: new FixedRetry({ maxAttempts: 3, delayMs: 10 }),
                circuitBreaker: new SimpleCircuitBreaker({ name: "svc", threshold: 10, halfOpenAfterMs: 1000 }),
                timeout: new FixedTimeout({ durationMs: 5000 }),
            });
            let callCount = 0;
            const fn = async () => {
                callCount++;
                if (callCount < 3)
                    throw new Error("not yet");
                return "finally";
            };
            const result = await registry.execute("svc", fn);
            expect(result).toBe("finally");
            expect(callCount).toBe(3);
        });
        it("should emit RETRY_ATTEMPT events during retry", async () => {
            const events = [];
            registry.onEvent((e) => events.push(e));
            registry.register("svc", {
                retry: new FixedRetry({ maxAttempts: 3, delayMs: 10 }),
                circuitBreaker: new SimpleCircuitBreaker({ name: "svc", threshold: 10, halfOpenAfterMs: 1000 }),
                timeout: new FixedTimeout({ durationMs: 5000 }),
            });
            let callCount = 0;
            const fn = async () => {
                callCount++;
                if (callCount < 3)
                    throw new Error("not yet");
                return "ok";
            };
            await registry.execute("svc", fn);
            const retryEvents = events.filter((e) => e.type === "RETRY_ATTEMPT");
            expect(retryEvents.length).toBeGreaterThanOrEqual(1);
        });
        it("should emit RETRY_EXHAUSTED when all retries fail", async () => {
            const events = [];
            registry.onEvent((e) => events.push(e));
            registry.register("svc", {
                retry: new FixedRetry({ maxAttempts: 2, delayMs: 10 }),
                circuitBreaker: new SimpleCircuitBreaker({ name: "svc", threshold: 10, halfOpenAfterMs: 1000 }),
                timeout: new FixedTimeout({ durationMs: 5000 }),
            });
            const fn = async () => { throw new Error("always-fail"); };
            await expect(registry.execute("svc", fn)).rejects.toThrow("always-fail");
            const exhaustedEvents = events.filter((e) => e.type === "RETRY_EXHAUSTED");
            expect(exhaustedEvents.length).toBe(1);
        });
        it("should still execute via fallback when circuit is open", async () => {
            const cb = new SimpleCircuitBreaker({ name: "svc", threshold: 1, halfOpenAfterMs: 10000 });
            registry.register("svc", {
                retry: new FixedRetry({ maxAttempts: 1 }),
                circuitBreaker: cb,
                timeout: new FixedTimeout({ durationMs: 5000 }),
            });
            cb.recordFailure();
            expect(cb.state).toBe("OPEN");
            const result = await registry.execute("svc", async () => "fallback-executed");
            expect(result).toBe("fallback-executed");
        });
        it("should throw TimeoutError when timeout exceeded", async () => {
            registry.register("svc", {
                retry: new FixedRetry({ maxAttempts: 1 }),
                circuitBreaker: new SimpleCircuitBreaker({ name: "svc", threshold: 10, halfOpenAfterMs: 1000 }),
                timeout: new FixedTimeout({ durationMs: 50 }),
            });
            await expect(registry.execute("svc", async () => {
                await new Promise((r) => setTimeout(r, 1000));
                return "too-late";
            })).rejects.toThrow(TimeoutError);
        });
        it("should emit EXECUTION_ERROR on failure", async () => {
            const events = [];
            registry.onEvent((e) => events.push(e));
            registry.register("svc", {
                retry: new FixedRetry({ maxAttempts: 1 }),
                circuitBreaker: new SimpleCircuitBreaker({ name: "svc", threshold: 10, halfOpenAfterMs: 1000 }),
                timeout: new FixedTimeout({ durationMs: 5000 }),
            });
            await expect(registry.execute("svc", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
            const errorEvents = events.filter((e) => e.type === "EXECUTION_ERROR");
            expect(errorEvents.length).toBe(1);
            expect(errorEvents[0]).toMatchObject({ type: "EXECUTION_ERROR", name: "svc" });
            expect(errorEvents[0].error).toBeInstanceOf(Error);
            expect(errorEvents[0].error.message).toBe("boom");
        });
        it("should use overrides when provided", async () => {
            registry.register("svc", {
                retry: new FixedRetry({ maxAttempts: 1 }),
                circuitBreaker: new SimpleCircuitBreaker({ name: "svc", threshold: 10, halfOpenAfterMs: 1000 }),
                timeout: new FixedTimeout({ durationMs: 5000 }),
            });
            const overrideRetry = new FixedRetry({ maxAttempts: 3, delayMs: 10 });
            let callCount = 0;
            const result = await registry.execute("svc", async () => {
                callCount++;
                if (callCount < 3)
                    throw new Error("retry");
                return "override-ok";
            }, { retry: overrideRetry });
            expect(result).toBe("override-ok");
            expect(callCount).toBe(3);
        });
        it("should override circuit breaker in execute", async () => {
            const originalCb = new SimpleCircuitBreaker({ name: "original", threshold: 10, halfOpenAfterMs: 1000 });
            const overrideCb = new SimpleCircuitBreaker({ name: "override", threshold: 1, halfOpenAfterMs: 1000 });
            registry.register("svc", {
                retry: new FixedRetry({ maxAttempts: 1 }),
                circuitBreaker: originalCb,
                timeout: new FixedTimeout({ durationMs: 5000 }),
            });
            overrideCb.recordFailure(); // Trip the override CB
            expect(overrideCb.state).toBe("OPEN");
            // With override CB open, the function should still execute via fallback
            const result = await registry.execute("svc", async () => "override-cb-ok", { circuitBreaker: overrideCb });
            expect(result).toBe("override-cb-ok");
        });
        it("should override timeout in execute", async () => {
            registry.register("svc", {
                retry: new FixedRetry({ maxAttempts: 1 }),
                circuitBreaker: new SimpleCircuitBreaker({ name: "svc", threshold: 10, halfOpenAfterMs: 1000 }),
                timeout: new FixedTimeout({ durationMs: 5000 }),
            });
            // Override with a very short timeout that will trigger
            const overrideTimeout = new FixedTimeout({ durationMs: 10 });
            await expect(registry.execute("svc", async () => {
                await new Promise((r) => setTimeout(r, 100));
                return "too-late";
            }, { timeout: overrideTimeout })).rejects.toThrow(TimeoutError);
        });
        it("should handle non-Error thrown values by wrapping them", async () => {
            registry.register("svc", {
                retry: new FixedRetry({ maxAttempts: 1 }),
                circuitBreaker: new SimpleCircuitBreaker({ name: "svc", threshold: 10, halfOpenAfterMs: 1000 }),
                timeout: new FixedTimeout({ durationMs: 5000 }),
            });
            // Throwing a string instead of Error
            await expect(registry.execute("svc", async () => {
                // eslint-disable-next-line no-throw-literal
                throw "string-error";
            })).rejects.toThrow();
        });
        it("should retry with ExponentialBackoff and succeed", async () => {
            registry.register("svc", {
                retry: new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 10, jitterFactor: 0 }),
                circuitBreaker: new SimpleCircuitBreaker({ name: "svc", threshold: 10, halfOpenAfterMs: 1000 }),
                timeout: new FixedTimeout({ durationMs: 5000 }),
            });
            let attempts = 0;
            const result = await registry.execute("svc", async () => {
                attempts++;
                if (attempts < 3)
                    throw new Error("try-again");
                return "exponential-ok";
            });
            expect(result).toBe("exponential-ok");
            expect(attempts).toBe(3);
        });
    });
    // ── execute edge cases (retry exhaustion via zero delay) ──
    describe("execute with retry edge cases", () => {
        it("should emit RETRY_EXHAUSTED and throw when nextDelay returns zero", async () => {
            const events = [];
            registry.onEvent((e) => events.push(e));
            // Create a custom retry policy that returns zero delay
            const zeroDelayRetry = new FixedRetry({ maxAttempts: 3, delayMs: 0 });
            registry.register("svc", {
                retry: zeroDelayRetry,
                circuitBreaker: new SimpleCircuitBreaker({ name: "svc", threshold: 10, halfOpenAfterMs: 1000 }),
                timeout: new FixedTimeout({ durationMs: 5000 }),
            });
            const fn = async () => { throw new Error("fail"); };
            await expect(registry.execute("svc", fn)).rejects.toThrow("fail");
            const exhaustedEvents = events.filter((e) => e.type === "RETRY_EXHAUSTED");
            expect(exhaustedEvents.length).toBe(1);
        });
        it("should emit RETRY_EXHAUSTED when shouldRetry returns false before maxAttempts", async () => {
            const events = [];
            registry.onEvent((e) => events.push(e));
            // Create a retry policy where shouldRetry returns false early
            const conditionalRetry = new FixedRetry({
                maxAttempts: 5,
                delayMs: 10,
                shouldRetry: (attempt) => attempt < 2, // Only allow 1 retry
            });
            registry.register("svc", {
                retry: conditionalRetry,
                circuitBreaker: new SimpleCircuitBreaker({ name: "svc", threshold: 10, halfOpenAfterMs: 1000 }),
                timeout: new FixedTimeout({ durationMs: 5000 }),
            });
            await expect(registry.execute("svc", async () => { throw new Error("no-more-retries"); })).rejects.toThrow("no-more-retries");
            // shouldRetry returned false at attempt 2, which is < maxAttempts (5)
            // So RETRY_EXHAUSTED should NOT be emitted (since attempt < maxAttempts)
            const exhaustedEvents = events.filter((e) => e.type === "RETRY_EXHAUSTED");
            expect(exhaustedEvents.length).toBe(0);
        });
        it("should handle string rejection from the business function", async () => {
            registry.register("svc", {
                retry: new FixedRetry({ maxAttempts: 1 }),
                circuitBreaker: new SimpleCircuitBreaker({ name: "svc", threshold: 10, halfOpenAfterMs: 1000 }),
                timeout: new FixedTimeout({ durationMs: 5000 }),
            });
            await expect(registry.execute("svc", async () => {
                throw "non-error-object";
            })).rejects.toThrow();
        });
    });
    // ── Snapshot ──
    describe("snapshot", () => {
        it("should return empty array for empty registry", () => {
            expect(registry.snapshot()).toEqual([]);
        });
        it("should include all registered policies", () => {
            const retry = new FixedRetry({ maxAttempts: 3 });
            const cb = new SimpleCircuitBreaker({ name: "my-cb", threshold: 5, halfOpenAfterMs: 30000 });
            const timeout = new FixedTimeout({ durationMs: 10000 });
            registry.register("svc1", { retry, circuitBreaker: cb, timeout });
            registry.register("svc2", { retry: new ExponentialBackoff({ maxAttempts: 5, baseDelayMs: 1000 }) });
            const snap = registry.snapshot();
            expect(snap.length).toBe(2);
            const svc1 = snap.find((s) => s.name === "svc1");
            expect(svc1).toBeDefined();
            expect(svc1?.retry).toBe("fixed-retry");
            expect(svc1?.circuitBreaker?.name).toBe("my-cb");
            expect(svc1?.circuitBreaker?.state).toBe("CLOSED");
            expect(svc1?.timeout).toBe("fixed-timeout");
            const svc2 = snap.find((s) => s.name === "svc2");
            expect(svc2).toBeDefined();
            expect(svc2?.retry).toBe("exponential-backoff");
            expect(svc2?.circuitBreaker).toBeDefined();
            expect(svc2?.circuitBreaker?.name).toBe("no-breaker");
            expect(svc2?.timeout).toBe("no-timeout");
        });
        it("should reflect circuit breaker state changes", () => {
            const cb = new SimpleCircuitBreaker({ name: "trip-cb", threshold: 2, halfOpenAfterMs: 1000 });
            registry.register("svc", { circuitBreaker: cb });
            // Initially CLOSED
            expect(registry.snapshot()[0].circuitBreaker?.state).toBe("CLOSED");
            // Trip the breaker
            cb.recordFailure();
            cb.recordFailure();
            expect(registry.snapshot()[0].circuitBreaker?.state).toBe("OPEN");
        });
    });
    // ── Reset ──
    describe("reset", () => {
        it("should call reset on all registered policies and restore states", () => {
            const retry = new FixedRetry({ maxAttempts: 3 });
            const cb = new SimpleCircuitBreaker({ name: "svc", threshold: 3, halfOpenAfterMs: 1000 });
            const timeout = new FixedTimeout({ durationMs: 5000 });
            cb.recordFailure();
            cb.recordFailure();
            cb.recordFailure();
            expect(cb.state).toBe("OPEN");
            registry.register("svc", { retry, circuitBreaker: cb, timeout });
            registry.reset();
            expect(cb.state).toBe("CLOSED");
        });
        it("should not throw when registry is empty", () => {
            expect(() => registry.reset()).not.toThrow();
        });
        it("should reset multiple registered entries", () => {
            const cb1 = new SimpleCircuitBreaker({ name: "cb1", threshold: 1, halfOpenAfterMs: 1000 });
            const cb2 = new SimpleCircuitBreaker({ name: "cb2", threshold: 1, halfOpenAfterMs: 1000 });
            registry.register("svc1", { circuitBreaker: cb1 });
            registry.register("svc2", { circuitBreaker: cb2 });
            cb1.recordFailure();
            cb2.recordFailure();
            expect(cb1.state).toBe("OPEN");
            expect(cb2.state).toBe("OPEN");
            registry.reset();
            expect(cb1.state).toBe("CLOSED");
            expect(cb2.state).toBe("CLOSED");
        });
    });
    // ── 事件系统 ──
    describe("event system", () => {
        it("should emit REGISTRY_OVERWRITE when re-registering", () => {
            const events = [];
            registry.onEvent((e) => events.push(e));
            registry.register("svc", { retry: new FixedRetry() });
            expect(events.length).toBe(0);
            registry.register("svc", { retry: new FixedRetry({ maxAttempts: 5 }) });
            expect(events.length).toBe(1);
            expect(events[0]).toMatchObject({ type: "REGISTRY_OVERWRITE", name: "svc" });
        });
        it("should emit TIMEOUT_OCCURRED on timeout in execute", async () => {
            const events = [];
            registry.onEvent((e) => events.push(e));
            registry.register("svc", {
                retry: new FixedRetry({ maxAttempts: 1 }),
                circuitBreaker: new SimpleCircuitBreaker({ name: "svc", threshold: 10, halfOpenAfterMs: 1000 }),
                timeout: new FixedTimeout({ durationMs: 50 }),
            });
            await expect(registry.execute("svc", async () => {
                await new Promise((r) => setTimeout(r, 1000));
                return "too-late";
            })).rejects.toThrow(TimeoutError);
            const timeoutEvents = events.filter((e) => e.type === "TIMEOUT_OCCURRED");
            expect(timeoutEvents.length).toBe(1);
            expect(timeoutEvents[0]).toMatchObject({ type: "TIMEOUT_OCCURRED", name: "svc" });
        });
        it("should isolate throwing event handlers from other handlers", async () => {
            const normalHandler = vi.fn();
            const throwingHandler = vi.fn().mockImplementation(() => {
                throw new Error("handler-crash");
            });
            registry.onEvent(throwingHandler);
            registry.onEvent(normalHandler);
            // Trigger an event by re-registering
            registry.register("svc", { retry: new FixedRetry() });
            registry.register("svc", { retry: new FixedRetry({ maxAttempts: 5 }) });
            // The throwing handler should have been called (and crashed silently)
            expect(throwingHandler).toHaveBeenCalled();
            // The normal handler should still have received the event
            expect(normalHandler).toHaveBeenCalled();
        });
        it("should handle multiple event handlers receiving events", async () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();
            const handler3 = vi.fn();
            registry.onEvent(handler1);
            registry.onEvent(handler2);
            registry.onEvent(handler3);
            registry.register("svc", { retry: new FixedRetry() });
            registry.register("svc", { retry: new FixedRetry({ maxAttempts: 3 }) });
            // All handlers should receive the REGISTRY_OVERWRITE event
            expect(handler1).toHaveBeenCalledWith(expect.objectContaining({ type: "REGISTRY_OVERWRITE" }));
            expect(handler2).toHaveBeenCalledWith(expect.objectContaining({ type: "REGISTRY_OVERWRITE" }));
            expect(handler3).toHaveBeenCalledWith(expect.objectContaining({ type: "REGISTRY_OVERWRITE" }));
        });
        it("should emit EXECUTION_ERROR with the actual error object", async () => {
            const events = [];
            registry.onEvent((e) => events.push(e));
            registry.register("svc", {
                retry: new FixedRetry({ maxAttempts: 1 }),
                circuitBreaker: new SimpleCircuitBreaker({ name: "svc", threshold: 10, halfOpenAfterMs: 1000 }),
                timeout: new FixedTimeout({ durationMs: 5000 }),
            });
            class CustomError extends Error {
                constructor() {
                    super("custom-thing");
                    this.name = "CustomError";
                }
            }
            await expect(registry.execute("svc", async () => { throw new CustomError(); })).rejects.toThrow(CustomError);
            const errorEvent = events.find((e) => e.type === "EXECUTION_ERROR");
            expect(errorEvent).toBeDefined();
            if (errorEvent && errorEvent.type === "EXECUTION_ERROR") {
                expect(errorEvent.error).toBeInstanceOf(CustomError);
                expect(errorEvent.error.message).toBe("custom-thing");
            }
        });
    });
    // ── Integration: full policy chain ──
    describe("integration", () => {
        it("should execute through full policy chain (timeout→cb→retry→fn)", async () => {
            registry.register("integration", {
                retry: new ExponentialBackoff({ maxAttempts: 3, baseDelayMs: 10, jitterFactor: 0 }),
                circuitBreaker: new StateMachineCircuitBreaker("integration", {
                    threshold: 5,
                    windowMs: 0,
                    halfOpenAfterMs: 30000,
                }),
                timeout: new FixedTimeout({ durationMs: 5000 }),
            });
            const result = await registry.execute("integration", async () => "chain-ok");
            expect(result).toBe("chain-ok");
        });
        it("should work with AdaptiveTimeout in chain", async () => {
            registry.register("adaptive", {
                retry: new FixedRetry({ maxAttempts: 1 }),
                circuitBreaker: new SimpleCircuitBreaker({ name: "adaptive", threshold: 10, halfOpenAfterMs: 1000 }),
                timeout: new AdaptiveTimeout({
                    initialTimeoutMs: 5000,
                    minTimeoutMs: 1000,
                    maxTimeoutMs: 10000,
                }),
            });
            const result = await registry.execute("adaptive", async () => "adaptive-ok");
            expect(result).toBe("adaptive-ok");
        });
    });
});
//# sourceMappingURL=registry.test.js.map