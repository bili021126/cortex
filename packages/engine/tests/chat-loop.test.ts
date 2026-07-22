// engine/tests/chat-loop.test.ts — streamChat 核心行为测试
import { describe, it, expect, vi } from "vitest";
import { streamChat, type ChatLoopOptions } from "../src/execution/chat-loop.js";

/** 最小的 mock LlmAdapter */
function mockLlm(responses: { content?: string; tool_calls?: { id: string; name: string; arguments: Record<string, unknown> }[]; reasoning_content?: string }[]) {
  let callIdx = 0;
  const chatStream = vi.fn().mockImplementation(
    (_model: string, _msgs: unknown[], _tools: unknown[], onChunk: (c: string, r?: string) => void) => {
      const r = responses[callIdx++] ?? { content: "done" };
      if (r.content) onChunk(r.content, r.reasoning_content);
      return Promise.resolve({
        content: r.content ?? null,
        tool_calls: r.tool_calls,
        reasoning_content: r.reasoning_content,
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });
    },
  );
  return { chatStream, chatModel: "deepseek-v4-flash" };
}

function mockToolkit(executeResults: { success: boolean; output: string }[] = []) {
  let callIdx = 0;
  return {
    listDefinitions: vi.fn().mockReturnValue([] as { name: string; description: string; parameters?: Record<string, unknown> }[]),
    execute: vi.fn().mockImplementation(() => {
      const r = executeResults[callIdx++] ?? { success: true, output: "ok" };
      return Promise.resolve(r);
    }),
  };
}

function baseOpts(overrides?: Partial<ChatLoopOptions>): ChatLoopOptions {
  const llm = mockLlm([{ content: "hello" }]);
  const toolkit = mockToolkit();
  return {
    llm: llm as never,
    toolkit: toolkit as never,
    agentType: "cyrene",
    model: "test",
    systemPrompt: "[system]",
    messages: [{ role: "user", content: "hi" }],
    onChunk: vi.fn(),
    ...overrides,
  };
}

describe("streamChat", () => {
  it("基本流式对话——返回 output 和 usage", async () => {
    const onChunk = vi.fn();
    const result = await streamChat(baseOpts({ onChunk }));
    expect(result.output).toBe("hello");
    expect(onChunk).toHaveBeenCalledWith("hello", undefined);
    expect(result.usage).toEqual({ prompt_tokens: 100, completion_tokens: 50 });
  });

  it("带上 reasoning_content", async () => {
    const onChunk = vi.fn();
    const llm = mockLlm([{ content: "answer", reasoning_content: "let me think..." }]);
    const result = await streamChat(baseOpts({ llm: llm as never, onChunk }));
    expect(result.reasoning).toBe("let me think...");
    expect(onChunk).toHaveBeenCalledWith("answer", "let me think...");
  });

  it("tool_calls 循环——工具执行后继续", async () => {
    const llm = mockLlm([
      { tool_calls: [{ id: "tc1", name: "read_file", arguments: { path: "/f" } }] },
      { content: "result after tool" },
    ]);
    const toolkit = mockToolkit([{ success: true, output: "file content" }]);
    const result = await streamChat(baseOpts({ llm: llm as never, toolkit: toolkit as never }));
    expect(result.output).toContain("result after tool");
    expect(toolkit.execute).toHaveBeenCalledWith(
      { toolName: "read_file", params: { path: "/f" } },
      "cyrene",
    );
  });

  it("gate 拦截——onBeforeToolExecute 返回 false 则跳过执行", async () => {
    const llm = mockLlm([
      { tool_calls: [{ id: "tc1", name: "write_file", arguments: { path: "/f" } }] },
      { content: "done" },
    ]);
    const toolkit = mockToolkit([{ success: true, output: "ok" }]);
    const onBeforeToolExecute = vi.fn().mockResolvedValue(false);
    const result = await streamChat(baseOpts({ llm: llm as never, toolkit: toolkit as never, onBeforeToolExecute }));
    expect(onBeforeToolExecute).toHaveBeenCalledWith("write_file", { path: "/f" });
    expect(toolkit.execute).not.toHaveBeenCalled();
    expect(result.output).toContain("done");
  });

  it("signal 取消——立即返回 cancelled", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await streamChat(baseOpts({ signal: ctrl.signal }));
    expect(result.cancelled).toBe(true);
    expect(result.output).toBe("");
  });

  it("maxRounds 上限——超限后停止", async () => {
    const toolCall = { id: "tc", name: "read", arguments: {} };
    const llm = mockLlm(Array(3).fill({ tool_calls: [toolCall] }).concat([{ content: "final" }]));
    const toolkit = mockToolkit([{ success: true, output: "ok" }]);
    const result = await streamChat(baseOpts({ llm: llm as never, toolkit: toolkit as never, maxRounds: 2 }));
    // 只有 2 轮，不会输出 "final"
    expect(result.output).toBe("");
  });

  it("无 toolDefs 时不传 tools 到 LLM", async () => {
    const onChunk = vi.fn();
    const llm = mockLlm([{ content: "plain" }]);
    await streamChat(baseOpts({ llm: llm as never, onChunk }));
    expect(llm.chatStream).toHaveBeenCalledWith(
      "test", expect.any(Array), undefined, expect.any(Function), undefined,
    );
  });
});
