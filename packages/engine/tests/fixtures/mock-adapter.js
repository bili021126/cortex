// @ci: unit
/**
 * 共享测试夹具 —— 消除跨测试文件的 mock 复制粘贴。
 *
 * 使用方式：
 *   import { mockLlmAdapter, mockStuckAdapter, makeTestNode } from "../fixtures/mock-adapter.js";
 */
import { LlmAdapter } from "@cortex/llm";
/** 标准成功 mock：一次调用即返回最终答案 */
export function mockLlmAdapter(output = "Task completed.") {
    const adapter = new LlmAdapter({
        apiKey: "mock",
        baseUrl: "mock",
        chatModel: "mock-chat",
        reasonerModel: "mock-reasoner"
    });
    adapter.injectMock(async () => ({
        content: output,
        tool_calls: []
    }));
    return adapter;
}
/** 无限循环 mock：永远返回 toolCall（用于测试 maxLoops 耗尽） */
export function mockStuckAdapter() {
    const adapter = new LlmAdapter({
        apiKey: "mock",
        baseUrl: "mock",
        chatModel: "mock-chat",
        reasonerModel: "mock-reasoner"
    });
    let callCount = 0;
    adapter.injectMock(async () => {
        callCount++;
        return {
            content: `Working on attempt ${callCount}`,
            tool_calls: [
                { id: `c${callCount}`, name: "search_code", arguments: { query: "test" } },
            ]
        };
    });
    return adapter;
}
/** 崩溃 mock：每次调用都抛错 */
export function mockCrashAdapter(errorMsg = "LLM service unavailable") {
    const adapter = new LlmAdapter({
        apiKey: "mock",
        baseUrl: "mock",
        chatModel: "mock-chat",
        reasonerModel: "mock-reasoner"
    });
    adapter.injectMock(async () => {
        throw new Error(errorMsg);
    });
    return adapter;
}
/** 工具调后用 mock：先返回 toolCall，再返回最终答案 */
export function mockToolThenFinalAdapter(toolCall, finalOutput = "Final answer.") {
    const adapter = new LlmAdapter({
        apiKey: "mock",
        baseUrl: "mock",
        chatModel: "mock-chat",
        reasonerModel: "mock-reasoner"
    });
    let calledOnce = false;
    adapter.injectMock(async () => {
        if (!calledOnce) {
            calledOnce = true;
            return {
                content: "Let me use a tool first.",
                tool_calls: [{ id: "c1", name: toolCall.name, arguments: toolCall.arguments }]
            };
        }
        return { content: finalOutput, tool_calls: [] };
    });
    return adapter;
}
/** 快捷构造 TaskNode（默认值填充） */
export function makeTestNode(overrides = {}) {
    return {
        id: overrides.id ?? "test-node-1",
        type: overrides.type ?? "implementation",
        tags: overrides.tags ?? [],
        needsMultiPerspective: overrides.needsMultiPerspective ?? false,
        status: overrides.status ?? "pending",
        claimedBy: overrides.claimedBy ?? [],
        payload: overrides.payload ?? "Implement a calculator add function",
        results: overrides.results ?? [],
        createdAt: overrides.createdAt ?? Date.now(),
        reasoningEffort: overrides.reasoningEffort
    };
}
//# sourceMappingURL=mock-adapter.js.map