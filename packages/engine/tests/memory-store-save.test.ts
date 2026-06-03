// @ci: unit
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentType, PipelinePriority } from "@cortex/shared";
import { MemoryStore, PipelineObserver } from "@cortex/engine";
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
    const id = await store.write({
      kind: "TaskLog",
      content_blob: { key: "value", nested: { a: 1 } },
      summary: "test persistence",
      semantic_gist: "test persistence",
      content_hash: "",
      source: { agentType: AgentType.Code, taskId: "" }});

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
    expect(reloaded!.content_blob).toEqual({ key: "value", nested: { a: 1 } });
    store2.close();
  });

  it("writes without persistence when init is not called (pure memory)", async () => {
    const id = await store.write({
      kind: "TaskLog",
      content_blob: { test: true },
      summary: "memory-only",
      semantic_gist: "memory-only",
      content_hash: "",
      source: { agentType: AgentType.Code, taskId: "" }});
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
    await store.write({
      kind: "TaskLog",
      content_blob: { test: true },
      summary: "observer test",
      semantic_gist: "observer test",
      content_hash: "",
      source: { agentType: AgentType.Code, taskId: "" }});

    // 正常写入不应触发 persist_failed
    const persistErrors = events.filter((e) => e.type === "memory.persist_failed");
    expect(persistErrors).toHaveLength(0);
    store.close();
  });
});

describe("MemoryStore._deserializeRow", () => {
  it("handles normal JSON content correctly via write + read", async () => {
    const store = new MemoryStore();

    // 写带 JSON content 的记忆
    const id = await store.write({
      kind: "TaskLog",
      content_blob: { message: "hello", count: 42 },
      summary: "json test",
      semantic_gist: "json test",
      content_hash: "",
      source: { agentType: AgentType.Review, taskId: "" }});

    // 读回——不应崩溃
    const results = await store.read({ keywords: ["json"] });
    expect(results).toHaveLength(1);
    expect(results[0].content_blob).toEqual({ message: "hello", count: 42 });
  });

  it("handles content with special characters without crash", async () => {
    const store = new MemoryStore();

    const id = await store.write({
      kind: "TaskLog",
      content_blob: { text: "包含中文和符号 {}[]:\"", nested: { x: null } },
      summary: "special chars",
      semantic_gist: "special chars",
      content_hash: "",
      source: { agentType: AgentType.Analysis, taskId: "" }});

    const results = await store.read({ keywords: ["special"] });
    expect(results).toHaveLength(1);
    expect(results[0].content_blob.text).toContain("中文");
  });

  it("persists and reloads content with metadata correctly", async () => {
    const dbPath = path.join(os.tmpdir(), `test-deserialize-${Date.now()}.db`);
    const store = new MemoryStore();
    await store.init(dbPath);

    const id = await store.write({
      kind: "TaskLog",
      content_blob: { data: "persisted" },
      summary: "with metadata",
      semantic_gist: "with metadata",
      content_hash: "",
      source: { agentType: AgentType.Code, taskId: "" }});

    // 等待防抖刷盘完成后，从同一文件重新加载
    await store.flush();

    const store2 = new MemoryStore();
    await store2.init(dbPath);
    const reloaded = store2.peek(id);
    expect(reloaded).toBeDefined();
    expect(reloaded!.content_blob).toEqual({ data: "persisted" });

    store.close();
    store2.close();
    try { fs.unlinkSync(dbPath); } catch { /* cleanup */ }
  });
});
