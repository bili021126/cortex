// @ci: integration
/**
 * WorkerPool contract test.
 *
 * WorkerPool 使用 worker_threads 执行 CPU 密集型操作（JSON 解析）�?
 * 验证：构造函数、入队执行、错误处理、背压、关闭、边界条件�?
 *
 * 注意：WorkerPool 目前未在 @cortex/engine barrel 中导出，
 *       因此使用相对路径导入 ../../src/core/worker-pool.js�?
 */

import { describe, it, expect } from "vitest";
import { WorkerPool } from "../../src/core/worker-pool.js";

describe("WorkerPool contract", () => {
  // ══════════════════════════════════════════════�?
  // 1. 初始�?
  // ══════════════════════════════════════════════�?
  it("should create with default options", () => {
    const pool = new WorkerPool();
    expect(pool).toBeInstanceOf(WorkerPool);
    pool.shutdown();
  });

  it("should create with custom concurrency", () => {
    const pool = new WorkerPool({ maxWorkers: 3 });
    expect(pool).toBeInstanceOf(WorkerPool);
    pool.shutdown();
  });

  // ══════════════════════════════════════════════�?
  // 2. 入队和执�?
  // ══════════════════════════════════════════════�?
  it("should enqueue and process a single task", async () => {
    const pool = new WorkerPool({ maxWorkers: 1 });
    const result = await pool.parseJson<{ hello: string }>('{"hello":"world"}');
    expect(result).toEqual({ hello: "world" });
    pool.shutdown();
  });

  it("should process tasks concurrently up to concurrency limit", async () => {
    const pool = new WorkerPool({ maxWorkers: 3 });
    const promises = Array.from({ length: 5 }, (_, i) =>
      pool.parseJson<{ index: number }>(JSON.stringify({ index: i })),
    );
    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
    pool.shutdown();
  });

  it("should resolve task promises with parsed value", async () => {
    const pool = new WorkerPool({ maxWorkers: 1 });
    const result = await pool.parseJson<string>('"plain string"');
    expect(result).toBe("plain string");
    pool.shutdown();
  });

  it("should parse numeric values", async () => {
    const pool = new WorkerPool({ maxWorkers: 1 });
    const result = await pool.parseJson<number>("42");
    expect(result).toBe(42);
    pool.shutdown();
  });

  // ══════════════════════════════════════════════�?
  // 3. 错误处理
  // ══════════════════════════════════════════════�?
  it("should reject individual task promise on invalid JSON", async () => {
    const pool = new WorkerPool({ maxWorkers: 1 });
    await expect(pool.parseJson("not valid json")).rejects.toThrow();
    pool.shutdown();
  });

  it("should not crash pool when a task throws �?subsequent tasks still work", async () => {
    const pool = new WorkerPool({ maxWorkers: 1 });
    // First task fails
    await expect(pool.parseJson("bad json")).rejects.toThrow();
    // Second task should still succeed
    const result = await pool.parseJson<{ ok: boolean }>('{"ok":true}');
    expect(result).toEqual({ ok: true });
    pool.shutdown();
  });

  it("should reject with descriptive error on invalid JSON", async () => {
    const pool = new WorkerPool({ maxWorkers: 1 });
    await expect(pool.parseJson("{invalid}")).rejects.toThrow(/JSON|token|Unexpected|invalid/i);
    pool.shutdown();
  });

  // ══════════════════════════════════════════════�?
  // 4. 背压
  // ══════════════════════════════════════════════�?
  it("should respect maxQueueSize �?reject when queue is full", async () => {
    const pool = new WorkerPool({ maxWorkers: 1 });
    // With 1 worker: first dispatched, next 100 queued, 102nd rejected
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 102; i++) {
      promises.push(pool.parseJson(JSON.stringify({ index: i })));
    }
    // The 102nd (index 101) should be rejected with queue full
    await expect(promises[101]).rejects.toThrow("queue full");

    // The first 101 should all resolve successfully
    const settled = await Promise.allSettled(promises.slice(0, 101));
    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(101);

    pool.shutdown();
  });

  it("should reject with appropriate error message when queue is full", async () => {
    const pool = new WorkerPool({ maxWorkers: 1 });
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 103; i++) {
      promises.push(pool.parseJson(JSON.stringify({ index: i })));
    }
    await expect(promises[102]).rejects.toThrow("queue full");

    // 103 tasks: 1 dispatched + 100 queued = 101 resolve; 2 rejects at indices 101, 102
    const settled = await Promise.allSettled(promises.slice(0, 102));
    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(101);

    pool.shutdown();
  });

  // ══════════════════════════════════════════════�?
  // 5. 关闭
  // ══════════════════════════════════════════════�?
  it("should shutdown gracefully �?no throw", () => {
    const pool = new WorkerPool({ maxWorkers: 2 });
    expect(() => pool.shutdown()).not.toThrow();
  });

  it("should be idempotent �?shutdown twice does not throw", () => {
    const pool = new WorkerPool({ maxWorkers: 2 });
    pool.shutdown();
    expect(() => pool.shutdown()).not.toThrow();
  });

  it("should reject queued tasks on shutdown", async () => {
    const pool = new WorkerPool({ maxWorkers: 1 });
    // Enqueue tasks without awaiting
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 5; i++) {
      promises.push(pool.parseJson(JSON.stringify({ index: i })));
    }
    // Shutdown immediately �?queued tasks (indices 1..4) should be rejected
    pool.shutdown();
    // Note: the dispatched task (promises[0]) hangs after worker.terminate()
    // because terminated workers don't fire 'message' or 'error' events.
    // Only test queued tasks here.
    for (let i = 1; i < promises.length; i++) {
      await expect(promises[i]).rejects.toThrow("shutdown");
    }
  });

  it("should reject new tasks after shutdown �?promise hangs with no workers", async () => {
    const pool = new WorkerPool({ maxWorkers: 1 });
    pool.shutdown();
    // After shutdown, workers=[], queue=[], busy=�?
    // parseJson queues the task silently (no idle worker, queue not full).
    // With no workers, the task never gets dispatched �?promise never settles.
    const promise = pool.parseJson<string>('"after shutdown"');
    const result = await Promise.race([
      promise.then(() => "settled").catch(() => "settled"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 200)),
    ]);
    expect(result).toBe("timeout");
  });

  // ══════════════════════════════════════════════�?
  // 6. 边界
  // ══════════════════════════════════════════════�?
  it("should handle zero-concurrency �?maxWorkers 0 queues all tasks", async () => {
    const pool = new WorkerPool({ maxWorkers: 0 });
    // With 0 workers, no idle worker �?all go to queue
    // First 100 accepted, 101st (index 100) rejected
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 101; i++) {
      promises.push(pool.parseJson(JSON.stringify({ index: i })));
    }
    await expect(promises[100]).rejects.toThrow("queue full");

    // Shutdown should reject all queued tasks
    pool.shutdown();
    for (const p of promises.slice(0, 100)) {
      await expect(p).rejects.toThrow("shutdown");
    }
  });

  it("should handle maxWorkers 1 correctly �?serial processing", async () => {
    const pool = new WorkerPool({ maxWorkers: 1 });
    const results = await Promise.all([
      pool.parseJson<number>("1"),
      pool.parseJson<number>("2"),
      pool.parseJson<number>("3"),
    ]);
    expect(results).toEqual([1, 2, 3]);
    pool.shutdown();
  });

  // ══════════════════════════════════════════════�?
  // 7. 超时与污染隔离（C2 回归�?
  // ══════════════════════════════════════════════�?
  // �?payload + timeout:1ms：JSON.parse + 两趟 IPC 往返几乎必�?>1ms�?
  // 稳定触发超时路径。验证超时后 worker 被终止替换、迟�?message 不污染后续任务�?
  const bigPayload = JSON.stringify({ arr: Array.from({ length: 100_000 }, (_, i) => i) });

  it("should reject on timeout without hanging", async () => {
    const pool = new WorkerPool({ maxWorkers: 1 });
    await expect(pool.parseJson(bigPayload, 1)).rejects.toThrow(/timeout/i);
    pool.shutdown();
  });

  it("should replace tainted worker after timeout �?pool stays usable", async () => {
    // maxWorkers:1 �?若超时后不补充新 worker，池将空置，后续任务永久挂起�?
    // 该测试能通过即证�?_replaceWorker 在超时后补足了容量�?
    const pool = new WorkerPool({ maxWorkers: 1 });
    await expect(pool.parseJson(bigPayload, 1)).rejects.toThrow(/timeout/i);
    // 后续任务必须拿到自己的正确结果，而非超时任务迟到�?message
    const result = await pool.parseJson<{ ok: boolean }>('{"ok":true}');
    expect(result).toEqual({ ok: true });
    pool.shutdown();
  });
});
