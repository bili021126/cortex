// @ci: unit
// ============================================================
// meta-agent-adapter.test.ts — MetaAgentReplanAdapter 单元测试
//
// 覆盖：requestReplan / requestBoundaryReplan 转发到 MetaAgent
// ============================================================
import { describe, it, expect, vi } from "vitest";
import { MetaAgentReplanAdapter } from "@cortex/engine";
// ── 辅助 ──────────────────────────────────────
function makeNode(overrides = {}) {
    return {
        id: "n1",
        type: "code",
        tags: ["code"],
        needsMultiPerspective: false,
        status: "pending",
        claimedBy: [],
        payload: "",
        results: [],
        createdAt: Date.now(),
        ...overrides,
    };
}
// ── Mock MetaAgent ─────────────────────────────
function makeMockMetaAgent() {
    return {
        requestReplan: vi.fn().mockResolvedValue("ok"),
        requestBoundaryReplan: vi.fn().mockResolvedValue("boundary_ok"),
        // 其余 MetaAgent 方法用 noop 填充
        name: "mock-meta",
        type: "meta",
        status: "Active",
        init: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        dispose: vi.fn(),
        execute: vi.fn(),
        getMemoryQuery: vi.fn(),
        getMemoryWriteInput: vi.fn(),
    };
}
// ── Tests ──────────────────────────────────────
describe("MetaAgentReplanAdapter", () => {
    it("requestReplan 转发到 MetaAgent.requestReplan", async () => {
        const meta = makeMockMetaAgent();
        const adapter = new MetaAgentReplanAdapter(meta);
        const node = makeNode({ id: "n1", type: "code" });
        await adapter.requestReplan(node, "test reason", 1, 0, 3);
        expect(meta.requestReplan).toHaveBeenCalledWith(node, "test reason", 1, undefined, 3);
    });
    it("requestBoundaryReplan 转发到 MetaAgent.requestBoundaryReplan", async () => {
        const meta = makeMockMetaAgent();
        const adapter = new MetaAgentReplanAdapter(meta);
        const node = makeNode({ id: "n2", type: "review" });
        await adapter.requestBoundaryReplan(node, "boundary reason", 2, 1, 5);
        expect(meta.requestBoundaryReplan).toHaveBeenCalledWith(node, "boundary reason", 2, undefined, 5);
    });
    it("requestReplan 返回值与 MetaAgent 一致", async () => {
        const meta = makeMockMetaAgent();
        meta.requestReplan.mockResolvedValue("replan_ok");
        const adapter = new MetaAgentReplanAdapter(meta);
        const result = await adapter.requestReplan(makeNode({ id: "n3", type: "analysis" }), "reason", 1);
        expect(result).toBe("replan_ok");
    });
    it("requestBoundaryReplan 返回值与 MetaAgent 一致", async () => {
        const meta = makeMockMetaAgent();
        meta.requestBoundaryReplan.mockResolvedValue("boundary_ok");
        const adapter = new MetaAgentReplanAdapter(meta);
        const result = await adapter.requestBoundaryReplan(makeNode({ id: "n4", type: "ops" }), "reason", 1);
        expect(result).toBe("boundary_ok");
    });
    it("currentDepth 参数被跳过（适配为 undefined）", async () => {
        const meta = makeMockMetaAgent();
        const adapter = new MetaAgentReplanAdapter(meta);
        const node = makeNode({ id: "n5", type: "code" });
        await adapter.requestReplan(node, "reason", 1, 5, 10);
        // currentDepth (5) 被适配器跳过，传入 MetaAgent 的对应参数是 undefined
        const callArgs = meta.requestReplan.mock.calls[0];
        expect(callArgs[3]).toBeUndefined(); // currentDepth → undefined
    });
});
//# sourceMappingURL=meta-agent-adapter.test.js.map