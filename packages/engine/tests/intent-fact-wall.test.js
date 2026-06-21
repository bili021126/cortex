// @ci: unit
import { describe, it, expect } from "vitest";
import { AgentType } from "@cortex/shared";
import { IntentFactWall } from "@cortex/consistency";
/** 创建测试用 MemoryEntry 辅助函数 */
function makeEntry(overrides = {}) {
    return {
        id: "mem-test-1",
        kind: "TaskLog",
        content_blob: { test: true },
        summary: "测试记忆",
        semantic_gist: "测试记忆",
        content_hash: "",
        source: { agentType: AgentType.Code, taskId: "" },
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0,
        semantic_state: "Active",
        weight: 5,
        ...overrides
    };
}
/** 创建测试用 MemoryWriteInput 辅助函数 */
function makeInput(overrides = {}) {
    return {
        kind: "TaskLog",
        content_blob: { test: true },
        summary: "测试输入",
        semantic_gist: "测试输入",
        content_hash: "",
        source: { agentType: AgentType.Code, taskId: "" },
        ...overrides
    };
}
/** v3: 辅助 — 标记 entry 为 _pending（模拟 writePending 半成品） */
function markPending(entry) {
    entry._pending = true;
    return entry;
}
describe("IntentFactWall", () => {
    const wall = new IntentFactWall();
    // ════════════════════════════════════════════════════════
    // filterRead —— 读路径 Intent 过滤 (v3: _pending + semantic_state)
    // ════════════════════════════════════════════════════════
    describe("filterRead", () => {
        it("HCA 模式下不过滤——MetaAgent 需要全局视图（含半成品 Pending）", () => {
            const entries = [
                makeEntry({ id: "mem-1", summary: "事实记忆" }),
                markPending(makeEntry({ id: "mem-2", summary: "半成品记忆" })),
            ];
            const result = wall.filterRead(entries, "HCA");
            expect(result).toHaveLength(2);
            expect(result.map((e) => e.id)).toEqual(["mem-1", "mem-2"]);
        });
        it("CSA 模式下过滤 Pending 半成品记忆——Agent 只看已确认事实", () => {
            const entries = [
                makeEntry({ id: "mem-1", summary: "事实记忆" }),
                markPending(makeEntry({ id: "mem-2", summary: "半成品意图" })),
            ];
            const result = wall.filterRead(entries, "CSA");
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe("mem-1");
            expect(result[0].summary).toBe("事实记忆");
        });
        it("CSA 模式下——所有 Pending 被排除，仅保留 Active 事实", () => {
            const entries = [
                makeEntry({ id: "mem-1", summary: "事实A" }),
                markPending(makeEntry({ id: "mem-2", summary: "意图X" })),
                markPending(makeEntry({ id: "mem-3", summary: "意图Y" })),
                makeEntry({ id: "mem-4", summary: "事实B" }),
            ];
            const result = wall.filterRead(entries, "CSA");
            expect(result).toHaveLength(2);
            expect(result.map((e) => e.id)).toEqual(["mem-1", "mem-4"]);
        });
        it("CSA 模式下——Archived 态记忆被过滤（非 Active 不通过）", () => {
            const entries = [
                makeEntry({ id: "mem-1", summary: "活跃事实", semantic_state: "Active" }),
                makeEntry({ id: "mem-2", summary: "已归档", semantic_state: "Archived" }),
            ];
            const result = wall.filterRead(entries, "CSA");
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe("mem-1");
        });
        it("空列表——返回空数组不抛异常", () => {
            const result = wall.filterRead([], "CSA");
            expect(result).toHaveLength(0);
        });
        it("全 Pending 列表 CSA 模式——返回空数组", () => {
            const entries = [
                markPending(makeEntry({ id: "mem-1", summary: "意图1" })),
                markPending(makeEntry({ id: "mem-2", summary: "意图2" })),
            ];
            const result = wall.filterRead(entries, "CSA");
            expect(result).toHaveLength(0);
        });
        it("原始数组不被修改（不可变语义）", () => {
            const entries = [
                makeEntry({ id: "mem-1", summary: "事实" }),
                markPending(makeEntry({ id: "mem-2", summary: "意图" })),
            ];
            const snapshot = [...entries];
            wall.filterRead(entries, "CSA");
            expect(entries).toEqual(snapshot); // 原始数组不变
        });
    });
    // ════════════════════════════════════════════════════════
    // stats —— 过滤统计
    // ════════════════════════════════════════════════════════
    describe("stats", () => {
        it("部分过滤——返回正确的过滤比例", () => {
            const entries = [
                makeEntry({}),
                makeEntry({}),
                markPending(makeEntry({})),
                markPending(makeEntry({})),
            ];
            const filtered = wall.filterRead(entries, "CSA");
            const s = wall.stats(entries, filtered);
            expect(s.total).toBe(4);
            expect(s.filtered).toBe(2); // 2 个 Pending 被过滤
            expect(s.ratio).toBe(0.5);
        });
        it("无过滤——返回 ratio 为 0", () => {
            const entries = [
                makeEntry({}),
                makeEntry({}),
            ];
            const filtered = wall.filterRead(entries, "CSA");
            const s = wall.stats(entries, filtered);
            expect(s.total).toBe(2);
            expect(s.filtered).toBe(0);
            expect(s.ratio).toBe(0);
        });
        it("全部过滤——返回 ratio 为 1", () => {
            const entries = [
                markPending(makeEntry({})),
                markPending(makeEntry({})),
            ];
            const filtered = wall.filterRead(entries, "CSA");
            const s = wall.stats(entries, filtered);
            expect(s.total).toBe(2);
            expect(s.filtered).toBe(2);
            expect(s.ratio).toBe(1);
        });
        it("空列表——total 为 0，ratio 为 0（无除零错误）", () => {
            const s = wall.stats([], []);
            expect(s.total).toBe(0);
            expect(s.filtered).toBe(0);
            expect(s.ratio).toBe(0);
        });
    });
    // ════════════════════════════════════════════════════════
    // 集成场景：HCA vs CSA 对比
    // ════════════════════════════════════════════════════════
    describe("HCA vs CSA 场景对比", () => {
        it("同一个记忆列表在 HCA 和 CSA 下返回不同结果", () => {
            const entries = [
                makeEntry({ id: "f1", summary: "已执行的重构" }),
                markPending(makeEntry({ id: "i1", summary: "计划重构 A 模块" })),
                makeEntry({ id: "f2", summary: "CI 通过验证" }),
                markPending(makeEntry({ id: "i2", summary: "考虑引入缓存层" })),
            ];
            const hcaResult = wall.filterRead(entries, "HCA");
            const csaResult = wall.filterRead(entries, "CSA");
            // HCA: 全部可见（含 Pending）
            expect(hcaResult).toHaveLength(4);
            expect(hcaResult.map((e) => e.id)).toEqual(["f1", "i1", "f2", "i2"]);
            // CSA: 仅非 Pending Active 可见
            expect(csaResult).toHaveLength(2);
            expect(csaResult.map((e) => e.id)).toEqual(["f1", "f2"]);
        });
    });
});
//# sourceMappingURL=intent-fact-wall.test.js.map