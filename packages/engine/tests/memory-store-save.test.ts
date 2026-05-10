import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentType, MemoryType, MemoryState, PipelinePriority } from "@cortex/shared";
import { MemoryStore } from "../src/memory-store.js";
import { PipelineObserver } from "../src/pipeline-observer.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("MemoryStore._saveDb", () => {
  let store: MemoryStore;
  let observer: PipelineObserver;
  let dbPath: string;

  beforeEach(() => {
    observer = new PipelineObserver();
    store = new MemoryStore(observer);
    dbPath = path.join(os.tmpdir(), `test-memory-${Date.now()}.db`);
  });

  afterEach(() => {
    if (fs.existsSync(dbPath)) {
      try { fs.unlinkSync(dbPath); } catch { /* cleanup */ }
    }
  });

  it("persists and reloads data correctly (happy path, no retry needed)", async () => {
    await store.init(dbPath);
    expect(store.isPersisted).toBe(true);

    // 写入一条记忆（触发 _saveDb）
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: { key: "value", nested: { a: 1 } },
      summary: "test persistence",
      agentType: AgentType.Code,
      creatorId: "test-agent",
    });

    // 确认数据在内存中
    const entry = store.peek(id);
    expect(entry).toBeDefined();
    expect(entry!.summary).toBe("test persistence");

    // 等待防抖刷盘完成（默认 200ms 延迟）
    await store.flush();

    // 确认 db 文件存在且非空
    const stat = fs.statSync(dbPath);
    expect(stat.size).toBeGreaterThan(0);

    // 重新加载：创建新 MemoryStore 从同一 db 文件初始化
    const store2 = new MemoryStore();
    await store2.init(dbPath);
    const reloaded = store2.peek(id);
    expect(reloaded).toBeDefined();
    expect(reloaded!.content).toEqual({ key: "value", nested: { a: 1 } });
    store2.close();
  });

  it("writes without persistence when init is not called (pure memory)", () => {
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: { test: true },
      summary: "memory-only",
      agentType: AgentType.Code,
      creatorId: "test",
    });
    expect(store.isPersisted).toBe(false);
    expect(store.peek(id)).toBeDefined();
  });

  it("write triggers observer on critical path through save", async () => {
    await store.init(dbPath);
    const events: Array<{ type: string }> = [];
    observer.on(PipelinePriority.CRITICAL, (e) => {
      events.push({ type: e.type });
    });

    // 写入一条记忆，触发 _saveDb（正常路径，不会有 persist_failed）
    store.write({
      memoryType: MemoryType.Episodic,
      content: { test: true },
      summary: "observer test",
      agentType: AgentType.Code,
      creatorId: "test",
    });

    // 正常写入不应触发 persist_failed
    const persistErrors = events.filter((e) => e.type === "memory.persist_failed");
    expect(persistErrors).toHaveLength(0);
    store.close();
  });
});

describe("MemoryStore._deserializeRow", () => {
  it("handles normal JSON content correctly via write + read", () => {
    const store = new MemoryStore();

    // 写带 JSON content 的记忆
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: { message: "hello", count: 42 },
      summary: "json test",
      agentType: AgentType.Review,
      creatorId: "tester",
    });

    // 读回——不应崩溃
    const results = store.read({ keywords: ["json"] });
    expect(results).toHaveLength(1);
    expect(results[0].content).toEqual({ message: "hello", count: 42 });
  });

  it("handles content with special characters without crash", () => {
    const store = new MemoryStore();

    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: { text: "包含中文和符号 {}[]:\"", nested: { x: null } },
      summary: "special chars",
      agentType: AgentType.Analysis,
      creatorId: "tester",
    });

    const results = store.read({ keywords: ["special"] });
    expect(results).toHaveLength(1);
    expect(results[0].content.text).toContain("中文");
  });

  it("persists and reloads content with metadata correctly", async () => {
    const dbPath = path.join(os.tmpdir(), `test-deserialize-${Date.now()}.db`);
    const store = new MemoryStore();
    await store.init(dbPath);

    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: { data: "persisted" },
      summary: "with metadata",
      agentType: AgentType.Code,
      creatorId: "test",
      metadata: { version: 1, env: "test" },
    });

    // 等待防抖刷盘完成后，从同一文件重新加载
    await store.flush();

    const store2 = new MemoryStore();
    await store2.init(dbPath);
    const reloaded = store2.peek(id);
    expect(reloaded).toBeDefined();
    expect(reloaded!.metadata).toEqual({ version: 1, env: "test" });
    expect(reloaded!.content).toEqual({ data: "persisted" });

    store.close();
    store2.close();
    try { fs.unlinkSync(dbPath); } catch { /* cleanup */ }
  });
});
