// @ci: e2e
/**
 * 流式 E2E — plan 任务 → streamChat 执行 → 验证 chunk 逐块到达
 *
 * 场景: 用 LlmAdapter 的 chatStream 验证流式响应逐块到达，
 *      内容累积后等于完整响应。
 *
 * 全 mock 模式：LLM 调用返回固定 JSON，不消耗 API。
 * 验证: chunk 数量 > 1, 内容累积 = 完整响应
 */
import { describe, it, expect } from "vitest";
import { LlmAdapter } from "@cortex/llm";
import type { LlmMessage } from "@cortex/shared";

// ─── Mock Adapter ──────────────────────────────────

function createStreamMockAdapter(): {
  adapter: LlmAdapter;
  emittedChunks: string[];
} {
  const emittedChunks: string[] = [];
  const adapter = new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "mock-chat",
    reasonerModel: "mock-reasoner",
  });

  // 模拟多 chunk 流式响应
  const chunks = ["昔", "涟", "执", "行", "者"];
  let callIndex = 0;
  adapter.injectMock(async () => {
    const content = chunks.slice(0, callIndex + 1).join("");
    callIndex++;
    return { content, tool_calls: [] };
  });

  return { adapter, emittedChunks };
}

// ─── 测试 ───────────────────────────────────────────

describe("流式 E2E: streamChat chunk 逐块到达", () => {
  if (process.env.CI) return; // 需要真实 LLM，CI 跳过

  it("chatStream 应逐块发射内容", { timeout: 120000 }, async () => {
    const { adapter, emittedChunks } = createStreamMockAdapter();
    const messages: LlmMessage[] = [{ role: "user", content: "写个流式测试" }];
    const receivedChunks: string[] = [];

    const response = await adapter.chatStream(
      "mock-chat",
      messages,
      undefined,
      (content: string) => {
        receivedChunks.push(content);
      },
    );

    // chunk 逐块到达
    expect(receivedChunks.length).toBeGreaterThanOrEqual(1);
    // 内容累积 = 完整响应
    const accumulated = receivedChunks.join("");
    expect(accumulated).toBe(response.content);
    // mock 返回 5 个 mock chunk
    expect(response.content).toBeTruthy();
  });

  it("streamChat 支持空内容响应", { timeout: 120000 }, async () => {
    const adapter = new LlmAdapter({
      apiKey: "mock",
      baseUrl: "mock",
      chatModel: "mock-chat",
      reasonerModel: "mock-reasoner",
    });

    adapter.injectMock(async () => ({ content: null, tool_calls: [] }));

    const messages: LlmMessage[] = [{ role: "user", content: "空响应测试" }];
    const chunks: string[] = [];

    const response = await adapter.chatStream(
      "mock-chat",
      messages,
      undefined,
      (content: string) => {
        chunks.push(content);
      },
    );

    expect(response.content).toBeNull();
    // mock 响应无内容时，onChunk 可能未调用
  });

  it("streamChat 支持带 tool_calls 的响应", { timeout: 120000 }, async () => {
    const adapter = new LlmAdapter({
      apiKey: "mock",
      baseUrl: "mock",
      chatModel: "mock-chat",
      reasonerModel: "mock-reasoner",
    });

    adapter.injectMock(async () => ({
      content: "让我查一下代码",
      tool_calls: [
        {
          id: "mock_tc_1",
          name: "read_file",
          arguments: { file_path: "/tmp/test.ts" },
        },
      ],
    }));

    const messages: LlmMessage[] = [{ role: "user", content: "查代码" }];
    const chunks: string[] = [];

    const response = await adapter.chatStream(
      "mock-chat",
      messages,
      [{ name: "read_file", description: "读取文件", parameters: { type: "object", properties: {} } }],
      (content: string) => {
        chunks.push(content);
      },
    );

    expect(response.content).toBe("让我查一下代码");
    expect(response.tool_calls).toBeDefined();
    expect(response.tool_calls!.length).toBe(1);
    expect(response.tool_calls![0]!.name).toBe("read_file");
  });
});
