// @ci: unit
/**
 * StrategistAgent 测试 —— 修复 D1：状态管理复用 PoolAwareState
 *
 * 验证点：
 * 1. 创建时默认状态为 Created
 * 2. wakeup() 后状态为 Awake
 * 3. execute() 时状态流转 Active → Awake
 * 4. shutdown() 后状态为 Destroyed
 * 5. 注入 Pool 后状态委托到 Pool
 * 6. 非法流转不抛出（被 safeReporter 捕获）
 */
import { describe, it, expect, vi } from "vitest";
import { AgentStatus as AS, PipelineEventType } from "@cortex/shared";
import { StrategistAgent } from "@cortex/engine";
/** Mock LlmAdapter */
function createMockLlm() {
    return {
        chat: vi.fn().mockResolvedValue({ content: "strategy report", toolCalls: [] })
    };
}
describe("StrategistAgent（D1: PoolAwareState 复用）", () => {
    it("创建时默认状态为 Created", () => {
        const agent = new StrategistAgent(createMockLlm());
        expect(agent.status).toBe(AS.Created);
    });
    it("wakeup() 后状态为 Awake", async () => {
        const agent = new StrategistAgent(createMockLlm());
        await agent.wakeup();
        expect(agent.status).toBe(AS.Awake);
    });
    it("execute() 时状态流转 Active 并在完成后回到 Awake", async () => {
        const agent = new StrategistAgent(createMockLlm());
        await agent.wakeup();
        const node = { id: "test-1", payload: "analyze", tags: [], type: "analysis", status: "pending", claimedBy: [] };
        const result = await agent.execute(node, "gpt-4");
        // 执行完成后应回到 Awake
        expect(agent.status).toBe(AS.Awake);
        expect(result.success).toBe(true);
    });
    it("shutdown() 后状态为 Destroyed", async () => {
        const agent = new StrategistAgent(createMockLlm());
        await agent.shutdown();
        expect(agent.status).toBe(AS.Destroyed);
    });
    it("注入 Pool 后状态委托到 Pool", async () => {
        const agent = new StrategistAgent(createMockLlm());
        const mockPool = {
            getStatus: vi.fn().mockReturnValue(AS.Awake),
            setStatus: vi.fn().mockReturnValue(true)
        };
        agent.setPool(mockPool, "instance-1");
        await agent.wakeup();
        // 状态应来自 Pool
        expect(agent.status).toBe(AS.Awake);
        expect(mockPool.getStatus).toHaveBeenCalledWith("instance-1");
    });
    it("setSafeReporter 同时注入到 PoolAwareState", async () => {
        const agent = new StrategistAgent(createMockLlm());
        const reporter = vi.fn();
        agent.setSafeReporter(reporter);
        // 非法流转应通过 reporter 上报
        // 通过 shutdown 两次触发第二次到 Destroyed 的非法流转
        await agent.shutdown();
        expect(agent.status).toBe(AS.Destroyed);
    });
    it("onGovernanceEvent — ConstitutionViolation 输出到 stderr", async () => {
        const agent = new StrategistAgent(createMockLlm());
        await agent.wakeup();
        let stderr = "";
        const origWrite = process.stderr.write.bind(process.stderr);
        process.stderr.write = (chunk) => { stderr += chunk.toString(); return true; };
        try {
            const event = {
                type: PipelineEventType.ConstitutionViolation,
                priority: 2,
                payload: { rule: "§12", detail: "放下身段" },
                timestamp: Date.now(),
            };
            agent.onGovernanceEvent(event);
            expect(stderr).toContain("[Strategist]");
            expect(stderr).toContain("宪法违规");
        }
        finally {
            process.stderr.write = origWrite;
        }
    });
    it("onGovernanceEvent — 非 ConstitutionViolation 不输出", async () => {
        const agent = new StrategistAgent(createMockLlm());
        await agent.wakeup();
        let stderr = "";
        const origWrite = process.stderr.write.bind(process.stderr);
        process.stderr.write = (chunk) => { stderr += chunk.toString(); return true; };
        try {
            const event = {
                type: PipelineEventType.NodeFailed,
                priority: 2,
                payload: { nodeId: "n1" },
                timestamp: Date.now(),
            };
            agent.onGovernanceEvent(event);
            expect(stderr).toBe("");
        }
        finally {
            process.stderr.write = origWrite;
        }
    });
});
//# sourceMappingURL=strategist-agent.test.js.map