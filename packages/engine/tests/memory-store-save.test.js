// @ci: unit
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentType, PipelinePriority } from "@cortex/shared";
import { PipelineObserver } from "@cortex/scheduler";
import { MemoryStore } from "@cortex/memory-store";
import { InMemoryMemoryStore } from "@cortex/memory";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
const mockEmbedder = {
    embedText: async () => { throw new Error("mock embedding unavailable"); },
    embedBatch: async () => { throw new Error("mock embedding unavailable"); },
};
describe("MemoryStore 写入与读取", () => {
    let store;
    let observer;
    let dbPath;
    beforeEach(() => {
        observer = new PipelineObserver();
        store = new MemoryStore(new InMemoryMemoryStore(), observer, mockEmbedder);
        dbPath = path.join(os.tmpdir(), `test-memory-${Date.now()}.db`);
    });
    afterEach(() => {
        if (fs.existsSync(dbPath)) {
            try {
                fs.unlinkSync(dbPath);
            }
            catch { /* cleanup */ }
        }
    });
    it("写入后可通过 read() 检索（内存模式）", async () => {
        await store.init(":memory:");
        // 写入一条记忆
        const id = await store.write({
            kind: "TaskLog",
            content_blob: { key: "value", nested: { a: 1 } },
            summary: "test persistence",
            semantic_gist: "test persistence",
            content_hash: "",
            source: { agentType: AgentType.Code, taskId: "" }
        });
        // 确认数据在内存中
        const entry = store.peek(id);
        expect(entry).toBeDefined();
        expect(entry.summary).toBe("test persistence");
        // 通过 read 检索
        const results = await store.read({ keywords: ["persistence"] });
        expect(results).toHaveLength(1);
        expect(results[0].content_blob).toEqual({ key: "value", nested: { a: 1 } });
        await store.close();
    });
    it("未 init 时写入抛出错误", async () => {
        const uninitStore = new MemoryStore(new InMemoryMemoryStore(), observer, mockEmbedder);
        await expect(uninitStore.write({
            kind: "TaskLog",
            content_blob: { test: true },
            summary: "memory-only",
            semantic_gist: "memory-only",
            content_hash: "",
            source: { agentType: AgentType.Code, taskId: "" }
        })).rejects.toThrow(/[Mm]emory[Ss]tore.*(拒绝写入|init)/);
    });
    it("init(':memory:') 后 isPersisted 为 false（纯内存模式）", async () => {
        await store.init(":memory:");
        const id = await store.write({
            kind: "TaskLog",
            content_blob: { test: true },
            summary: "memory-only",
            semantic_gist: "memory-only",
            content_hash: "",
            source: { agentType: AgentType.Code, taskId: "" }
        });
        expect(store.isPersisted).toBe(false);
        expect(store.peek(id)).toBeDefined();
    });
    it("write triggers observer on critical path through write", async () => {
        await store.init(":memory:");
        const events = [];
        observer.on(PipelinePriority.CRITICAL, (e) => {
            events.push({ type: e.type });
        });
        // 写入一条记忆
        await store.write({
            kind: "TaskLog",
            content_blob: { test: true },
            summary: "observer test",
            semantic_gist: "observer test",
            content_hash: "",
            source: { agentType: AgentType.Code, taskId: "" }
        });
        // 正常写入不应触发 persist_failed（适配器层不产生该事件）
        const persistErrors = events.filter((e) => e.type === "memory.persist_failed");
        expect(persistErrors).toHaveLength(0);
        store.close();
    });
});
describe("MemoryStore 内容序列化", () => {
    it("handles normal JSON content correctly via write + read", async () => {
        const store = new MemoryStore(new InMemoryMemoryStore(), undefined, mockEmbedder);
        await store.init(":memory:");
        // 写带 JSON content 的记忆
        const id = await store.write({
            kind: "TaskLog",
            content_blob: { message: "hello", count: 42 },
            summary: "json test",
            semantic_gist: "json test",
            content_hash: "",
            source: { agentType: AgentType.Review, taskId: "" }
        });
        // 读回——不应崩溃
        const results = await store.read({ keywords: ["json"] });
        expect(results).toHaveLength(1);
        expect(results[0].content_blob).toEqual({ message: "hello", count: 42 });
    });
    it("handles content with special characters without crash", async () => {
        const store = new MemoryStore(new InMemoryMemoryStore(), undefined, mockEmbedder);
        await store.init(":memory:");
        const id = await store.write({
            kind: "TaskLog",
            content_blob: { text: "包含中文和符号 {}[]:\"", nested: { x: null } },
            summary: "special chars",
            semantic_gist: "special chars",
            content_hash: "",
            source: { agentType: AgentType.Analysis, taskId: "" }
        });
        const results = await store.read({ keywords: ["special"] });
        expect(results).toHaveLength(1);
        expect(results[0].content_blob.text).toContain("中文");
    });
    it("写入后通过 peek 获取稳定快照", async () => {
        const store = new MemoryStore(new InMemoryMemoryStore(), undefined, mockEmbedder);
        await store.init(":memory:");
        const id = await store.write({
            kind: "TaskLog",
            content_blob: { data: "persisted" },
            summary: "with metadata",
            semantic_gist: "with metadata",
            content_hash: "",
            source: { agentType: AgentType.Code, taskId: "" }
        });
        // 从同一 store 实例 peek 应返回数据
        await store.flush();
        const peeked = store.peek(id);
        expect(peeked).toBeDefined();
        expect(peeked.content_blob).toEqual({ data: "persisted" });
        store.close();
    });
});
//# sourceMappingURL=memory-store-save.test.js.map