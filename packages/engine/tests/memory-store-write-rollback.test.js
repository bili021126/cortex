// @ci: unit
/**
 * 测试文件: MemoryStore 写路径后端失败回滚测试
 *
 * 测试范围:
 * - write() 后端失败回滚：backend.write() 失败时内存中无残留
 * - link() 后端失败回滚：backend.link() 失败时 link 回滚
 * - cas() 后端失败回滚：backend.cas() 失败时 state 不变
 * - obliterate() 后端失败回滚：backend.obliterate() 失败时 state 不变
 * - close() 后拒绝写入（幂等关闭）
 *
 * @since v3.0.0 — 适配器委托 @cortex/memory 后端
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentType, LinkType } from "@cortex/shared";
import { PipelineObserver } from "@cortex/scheduler";
import { MemoryStore } from "@cortex/memory-store";
import { InMemoryMemoryStore } from "@cortex/memory";
const mockEmbedder = {
    embedText: async () => { throw new Error("mock embedding unavailable"); },
    embedBatch: async () => { throw new Error("mock embedding unavailable"); },
};
describe("MemoryStore 写路径后端失败回滚", () => {
    let store;
    let observer;
    beforeEach(() => {
        observer = new PipelineObserver();
        store = new MemoryStore(new InMemoryMemoryStore(), observer, mockEmbedder);
    });
    // ─── 用例1: write() 正常写入 ─────────────────────────
    it("用例1: write() 正常写入后可通过 read() 检索", async () => {
        await store.init(":memory:");
        const id = await store.write({
            kind: "TaskLog",
            content_blob: { task: "test_write" },
            summary: "正常写入测试",
            semantic_gist: "正常写入测试",
            content_hash: "",
            source: { agentType: AgentType.Code, taskId: "" }
        });
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
        const results = await store.read({ keywords: ["正常写入"] });
        expect(results).toHaveLength(1);
        expect(results[0].summary).toBe("正常写入测试");
        await store.close();
    });
    // ─── 用例2: write() 后端失败回滚 ─────────────────
    it("用例2: write() — 模拟后端写入失败，内存中的 entry 被回滚", async () => {
        await store.init(":memory:");
        // Arrange: mock backend.write 抛异常
        vi.spyOn(store._backend, "write").mockRejectedValueOnce(new Error("SIMULATED_DISK_FULL"));
        // Act: 写入——应抛异常
        await expect(store.write({
            kind: "TaskLog",
            content_blob: { task: "rollback_test" },
            summary: "应被回滚的记忆",
            semantic_gist: "应被回滚的记忆",
            content_hash: "",
            source: { agentType: AgentType.Code, taskId: "" }
        })).rejects.toThrow("SIMULATED_DISK_FULL");
        // Assert: 内存中无残留
        const results = await store.read({ keywords: ["回滚"] });
        expect(results).toHaveLength(0);
        await store.close();
    });
    // ─── 用例3: link() 正常关联 ─────────────────────────
    it("用例3: link() 正常建立关联边并可通过 getLinks() 获取", async () => {
        await store.init(":memory:");
        const a = await store.write({
            kind: "TaskLog",
            content_blob: {},
            summary: "源记忆",
            semantic_gist: "源记忆",
            content_hash: "",
            source: { agentType: AgentType.Code, taskId: "" }
        });
        const b = await store.write({
            kind: "TaskLog",
            content_blob: {},
            summary: "目标记忆",
            semantic_gist: "目标记忆",
            content_hash: "",
            source: { agentType: AgentType.Review, taskId: "" }
        });
        // D5: link() 改为 3 参数签名
        const link = store.link(a, b, LinkType.ProducedBy);
        expect(link).toBeTruthy();
        expect(store.getLinks(a)).toHaveLength(1);
        await store.close();
    });
    // ─── 用例4: link() 后端失败回滚 ─────────────────────
    it("用例4: link() — 后端 link 失败，link 回滚", async () => {
        await store.init(":memory:");
        const a = await store.write({
            kind: "TaskLog",
            content_blob: {},
            summary: "源记忆",
            semantic_gist: "源记忆",
            content_hash: "",
            source: { agentType: AgentType.Code, taskId: "" }
        });
        const b = await store.write({
            kind: "TaskLog",
            content_blob: {},
            summary: "目标记忆",
            semantic_gist: "目标记忆",
            content_hash: "",
            source: { agentType: AgentType.Review, taskId: "" }
        });
        // 劫持 backend.link 抛异常
        vi.spyOn(store._backend, "link").mockImplementation(() => {
            throw new Error("SIMULATED_LINK_DB_FAIL");
        });
        // Act: link 应抛异常
        expect(() => {
            store.link(a, b, LinkType.ProducedBy);
        }).toThrow("SIMULATED_LINK_DB_FAIL");
        // Assert: 内存中的 link 已回滚
        expect(store.getLinks(a)).toHaveLength(0);
        await store.close();
    });
    // ─── 用例5: cas() 后端失败回滚 ─────────────────────
    it("用例5: cas() — 后端 cas 失败，state 回滚到 expected", async () => {
        await store.init(":memory:");
        const id = await store.write({
            kind: "TaskLog",
            content_blob: {},
            summary: "CAS 回滚测试",
            semantic_gist: "CAS 回滚测试",
            content_hash: "",
            source: { agentType: AgentType.Code, taskId: "" }
        });
        // 确认初始状态
        expect(store.peek(id).semantic_state).toBe("Active");
        // 劫持 backend.cas 抛异常
        vi.spyOn(store._backend, "cas").mockImplementation(() => {
            throw new Error("SIMULATED_CAS_DB_FAIL");
        });
        // Act: cas 应抛异常
        expect(() => {
            store.cas(id, "Active", "Archived");
        }).toThrow("SIMULATED_CAS_DB_FAIL");
        // Assert: state 回滚为 Active（expected 值）
        expect(store.peek(id).semantic_state).toBe("Active");
        await store.close();
    });
    // ─── 用例6: obliterate() 后端失败回滚 ───────────────
    it("用例6: obliterate() — 后端 obliterate 失败，state 回滚到 previousState", async () => {
        await store.init(":memory:");
        const id = await store.write({
            kind: "TaskLog",
            content_blob: {},
            summary: "湮灭回滚测试",
            semantic_gist: "湮灭回滚测试",
            content_hash: "",
            source: { agentType: AgentType.Code, taskId: "" }
        });
        // 先归档
        store.archive(id);
        expect(store.peek(id).semantic_state).toBe("Archived");
        // 劫持 backend.obliterate 抛异常
        vi.spyOn(store._backend, "obliterate").mockImplementation(() => {
            throw new Error("SIMULATED_OBLITERATE_DB_FAIL");
        });
        // Act: obliterate 应抛异常
        expect(() => {
            store.obliterate(id);
        }).toThrow("SIMULATED_OBLITERATE_DB_FAIL");
        // Assert: state 回滚为 Archived（previousState）
        expect(store.peek(id).semantic_state).toBe("Archived");
        await store.close();
    });
    // ─── 用例7: close() 后拒绝写入 ───
    it("用例7: close() 后拒绝写入（幂等关闭）", async () => {
        await store.init(":memory:");
        await store.write({
            kind: "TaskLog",
            content_blob: { x: 1 },
            summary: "预关闭记忆",
            semantic_gist: "预关闭记忆",
            content_hash: "",
            source: { agentType: AgentType.Code, taskId: "" }
        });
        // 关闭 store
        await store.close();
        // 确认关闭后写入被拒绝
        await expect(store.write({
            kind: "TaskLog",
            content_blob: { x: 2 },
            summary: "关闭后写入",
            semantic_gist: "关闭后写入",
            content_hash: "",
            source: { agentType: AgentType.Code, taskId: "" }
        })).rejects.toThrow(/已关闭/);
        // 二次 close 不抛异常（幂等）
        await expect(store.close()).resolves.toBeUndefined();
    });
    // ─── 用例8: close() closing 状态 ────────
    it("用例8: close() closing 状态拒绝二次关闭但不拒绝已调用 close", async () => {
        await store.init(":memory:");
        await store.write({
            kind: "TaskLog",
            content_blob: {},
            summary: "关闭前记忆",
            semantic_gist: "关闭前记忆",
            content_hash: "",
            source: { agentType: AgentType.Code, taskId: "" }
        });
        // 第一次 close
        await store.close();
        // 关闭后 read() 被拒绝
        await expect(store.read({ keywords: ["关闭前"] })).rejects.toThrow(/已关闭/);
        // 第二次 close 不抛异常（幂等）
        await expect(store.close()).resolves.toBeUndefined();
    });
});
//# sourceMappingURL=memory-store-write-rollback.test.js.map