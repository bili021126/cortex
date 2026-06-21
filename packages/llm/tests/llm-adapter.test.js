/**
 * @ci: unit
 * llm-adapter.test.ts — @cortex/llm smoke test
 *
 * Covers: constructor, mock injection, chat, cache, cacheStats getter.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { LlmAdapter } from "@cortex/llm";
const MOCK_CONFIG = {
    baseUrl: "https://api.mock.example/v1",
    apiKey: "sk-test-mock-key",
    chatModel: "mock-model",
};
const MOCK_MODEL = "mock-model";
describe("LlmAdapter", () => {
    let adapter;
    beforeEach(() => {
        adapter = new LlmAdapter(MOCK_CONFIG);
        adapter.injectMock(async (_messages, _tools) => ({
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
        const tools = [{ name: "test_tool", description: "a test tool", parameters: { type: "object", properties: {} } }];
        const resp = await adapter.chat(MOCK_MODEL, [{ role: "user", content: "hi" }], tools);
        expect(resp.content).toBe("mock response");
    });
    // ── 缓存 ──
    it("启用缓存后相同请求返回一致结果", async () => {
        adapter.setCacheEnabled(true);
        const msgs = [{ role: "user", content: "cache test" }];
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
});
//# sourceMappingURL=llm-adapter.test.js.map