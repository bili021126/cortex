// @ci: unit
/**
 * 共享测试夹具 —— 消除跨测试文件的 mock 复制粘贴。
 *
 * 使用方式：
 *   import { mockLlmAdapter, mockStuckAdapter, makeTestNode } from "../fixtures/mock-adapter.js";
 */
import { LlmAdapter } from "@cortex/llm";
import type { TaskNode, NodeResult } from "@cortex/shared";

/** 标准成功 mock：一次调用即返回最终答案 */
export function mockLlmAdapter(output = "Task completed."): LlmAdapter {
  const adapter = new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "mock-chat",
    reasonerModel: "mock-reasoner",
  });
  adapter.injectMock(async () => ({
    content: output,
    toolCalls: [],
  }));
  return adapter;
}

/** 无限循环 mock：永远返回 toolCall（用于测试 maxLoops 耗尽） */
export function mockStuckAdapter(): LlmAdapter {
  const adapter = new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "mock-chat",
    reasonerModel: "mock-reasoner",
  });
  let callCount = 0;
  adapter.injectMock(async () => {
    callCount++;
    return {
      content: `Working on attempt ${callCount}`,
      toolCalls: [
        { id: `c${callCount}`, name: "search_code", arguments: { query: "test" } },
      ],
    };
  });
  return adapter;
}

/** 崩溃 mock：每次调用都抛错 */
export function mockCrashAdapter(errorMsg = "LLM service unavailable"): LlmAdapter {
  const adapter = new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "mock-chat",
    reasonerModel: "mock-reasoner",
  });
  adapter.injectMock(async () => {
    throw new Error(errorMsg);
  });
  return adapter;
}

/** 工具调后用 mock：先返回 toolCall，再返回最终答案 */
export function mockToolThenFinalAdapter(
  toolCall: { name: string; arguments: Record<string, unknown> },
  finalOutput = "Final answer.",
): LlmAdapter {
  const adapter = new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "mock-chat",
    reasonerModel: "mock-reasoner",
  });
  let calledOnce = false;
  adapter.injectMock(async () => {
    if (!calledOnce) {
      calledOnce = true;
      return {
        content: "Let me use a tool first.",
        toolCalls: [{ id: "c1", name: toolCall.name, arguments: toolCall.arguments }],
      };
    }
    return { content: finalOutput, toolCalls: [] };
  });
  return adapter;
}

/** 快捷构造 TaskNode（默认值填充） */
export function makeTestNode(overrides: Partial<TaskNode> = {}): TaskNode {
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
    reasoningEffort: overrides.reasoningEffort,
  };
}
