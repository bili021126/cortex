// @ci: unit
import { describe, it, expect, vi } from "vitest";
import { LlmAdapter } from "@cortex/llm";
import type { LlmMessage } from "@cortex/shared";

const MOCK_CONFIG = {
  baseUrl: "https://api.mock.example/v1",
  apiKey: "sk-test-mock-key",
  chatModel: "mock-model",
};

describe("LLM deep", () => {
  it("extraBody 非reasoner时不注入", async () => {
    // reasoner_effort 仅 pro/reasoner 模型注入，flash 不注入
    const adapter = new LlmAdapter({ ...MOCK_CONFIG, extraBody: { thinking: { type: "detailed" } } });
    // mock fetch 捕获请求体
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }),
    );
    // flash 模型不应注入 reasoning_effort
    await adapter.chat("deepseek-v4-flash", [{ role: "user", content: "hi" }]);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body.reasoning_effort).toBeUndefined();
    // extraBody 始终注入（不依赖模型）
    expect(body.extra_body).toEqual({ thinking: { type: "detailed" } });
    fetchSpy.mockRestore();
  });

  it("ChatStream body 包含 stream_options", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'));
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    );
    const adapter = new LlmAdapter({ ...MOCK_CONFIG, label: "test" });
    const onChunk = vi.fn();
    await adapter.chatStream("test-model", [{ role: "user", content: "hi" }], undefined, onChunk);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    fetchSpy.mockRestore();
  });

  it("无capabilities时thinking回退: chat()不注入reasoning_effort", async () => {
    // 构造无 capabilities 且无 extraBody.thinking 的 adapter
    // _shouldEnableThinking 应保守返回 false，不注入 reasoning_effort
    const adapter = new LlmAdapter({ ...MOCK_CONFIG });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }),
    );
    // 即使传入 pro 类模型名，无 capabilities 时应保守跳过 thinking
    await adapter.chat("deepseek-v4-pro", [{ role: "user", content: "test" }]);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("429降级: flash→pro 自动切换", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, statusText: "Too Many Requests", headers: { "Content-Type": "text/plain" } }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, statusText: "Too Many Requests", headers: { "Content-Type": "text/plain" } }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, statusText: "Too Many Requests", headers: { "Content-Type": "text/plain" } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "pro response" } }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }),
      );
    const adapter = new LlmAdapter({
      ...MOCK_CONFIG,
      label: "test",
      capabilities: {
        thinking: false,
        functionCalling: true,
        streaming: true,
        maxOutputTokens: 65536,
        contextWindow: 1_048_576,
        degradesTo: "deepseek-v4-pro",
      },
    });
    const resp = await adapter.chat("deepseek-v4-flash", [{ role: "user", content: "test" }]);
    expect(resp.content).toBe("pro response");
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    const lastBody = JSON.parse(fetchSpy.mock.calls[3]![1]!.body as string) as Record<string, unknown>;
    expect(lastBody.model).toBe("deepseek-v4-pro");
    fetchSpy.mockRestore();
  });
});
