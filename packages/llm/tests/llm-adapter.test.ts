/**
 * @ci: unit
 * llm-adapter.test.ts — @cortex/llm smoke test
 *
 * Covers: constructor, mock injection, chat, cache, cacheStats getter,
 * request body construction, stream_options, Flash→Pro degradation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { LlmAdapter } from "@cortex/llm";
import type { LlmMessage, LlmResponse, ToolDef } from "@cortex/shared";

const MOCK_CONFIG = {
  baseUrl: "https://api.mock.example/v1",
  apiKey: "sk-test-mock-key",
  chatModel: "mock-model",
};

const MOCK_MODEL = "mock-model";

/** 构造一个 mock 流式 Response */
function mockStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

/** 构造一个 mock JSON Response */
function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "Content-Type": "application/json" },
  });
}

describe("LlmAdapter", () => {
  let adapter: LlmAdapter;

  beforeEach(() => {
    adapter = new LlmAdapter(MOCK_CONFIG);
    adapter.injectMock(async (_messages: LlmMessage[], _tools?: ToolDef[]): Promise<LlmResponse> => ({
      content: "mock response",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
  });

  // ── 构造与属性 ──

  it("构造后 chatModel 返回配置值", () => {
    expect(adapter.chatModel).toBe("mock-model");
  });

  it("reasonerModel 回退到 chatModel（未配置时）", () => {
    expect(adapter.reasonerModel).toBe("mock-model");
  });

  // ── mock 注入与调用 ──

  it("注入 mock 后 chat 返回模拟响应", async () => {
    const resp = await adapter.chat(MOCK_MODEL, [{ role: "user", content: "hello" }]);
    expect(resp.content).toBe("mock response");
  });

  it("chat 正常传递工具定义", async () => {
    const tools: ToolDef[] = [{ name: "test_tool", description: "a test tool", parameters: { type: "object", properties: {} } }];
    const resp = await adapter.chat(MOCK_MODEL, [{ role: "user", content: "hi" }], tools);
    expect(resp.content).toBe("mock response");
  });

  // ── 缓存 ──

  it("启用缓存后相同请求返回一致结果", async () => {
    adapter.setCacheEnabled(true);

    const msgs: LlmMessage[] = [{ role: "user", content: "cache test" }];
    const r1 = await adapter.chat(MOCK_MODEL, msgs);
    const r2 = await adapter.chat(MOCK_MODEL, msgs);
    expect(r1.content).toBe(r2.content);
  });

  it("clearCache 后 stats 归零", () => {
    adapter.setCacheEnabled(true);
    adapter.clearCache();
    const stats = adapter.cacheStats;
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
  });

  // ── 无 mock 时的正确报错 ──

  it("未注入 mock 且无真实 API Key 时应抛出", async () => {
    const raw = new LlmAdapter(MOCK_CONFIG);
    await expect(raw.chat(MOCK_MODEL, [{ role: "user", content: "x" }])).rejects.toThrow();
  }, 15000);

  // ── 请求体构造验证 ──

  it("chat() 请求体包含 model 和 extraBody", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }),
    );

    const adapterWithExtra = new LlmAdapter({
      ...MOCK_CONFIG,
      label: "test",
      extraBody: { thinking: { type: "detailed" } },
    });

    await adapterWithExtra.chat("test-model", [{ role: "user", content: "hi" }]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs[0]).toContain("/chat/completions");
    const sentBody = JSON.parse(callArgs[1]!.body as string) as Record<string, unknown>;
    expect(sentBody.model).toBe("test-model");
    expect(sentBody.extra_body).toEqual({ thinking: { type: "detailed" } });

    fetchSpy.mockRestore();
  });

  it("chatStream() 请求体包含 stream_options", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockStreamResponse([
        'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const adapterStream = new LlmAdapter({ ...MOCK_CONFIG, label: "test" });
    const onChunk = vi.fn();
    await adapterStream.chatStream("test-model", [{ role: "user", content: "hi" }], undefined, onChunk);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs[0]).toContain("/chat/completions");
    const sentBody = JSON.parse(callArgs[1]!.body as string) as Record<string, unknown>;
    expect(sentBody.stream).toBe(true);
    expect(sentBody.stream_options).toEqual({ include_usage: true });

    fetchSpy.mockRestore();
  });

  // ── Flash→Pro 降级 ──

  it("Flash→Pro 降级：429 时自动重试 pro 模型", async () => {
    // _fetchWithRetry 内部最多重试 3 次（MAX_RETRIES=3），需要 4 次响应
    // 前 3 次 429 耗尽重试 → 第 4 次用 pro 模型成功
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "Content-Type": "text/plain" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "Content-Type": "text/plain" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "Content-Type": "text/plain" },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          choices: [{ message: { content: "pro response" } }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }),
      );

    const degradeAdapter = new LlmAdapter({
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
    const resp = await degradeAdapter.chat(
      "deepseek-v4-flash",
      [{ role: "user", content: "test degradation" }],
    );

    // 验证降级成功
    expect(resp.content).toBe("pro response");
    // 验证 fetch 被调用 4 次（3 次 flash 重试耗尽 + 1 次 pro）
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    // 验证第 4 次（最后一次）请求体使用 pro 模型
    const fourthBody = JSON.parse(fetchSpy.mock.calls[3][1]!.body as string) as Record<string, unknown>;
    expect(fourthBody.model).toBe("deepseek-v4-pro");

    fetchSpy.mockRestore();
  });
});
