// @ci: unit
import { describe, it, expect } from "vitest";
import { LlmAdapter } from "@cortex/llm";
import { resolveLlm } from "@cortex/engine";

function mockAdapter(label: string) {
  return new LlmAdapter({ apiKey: `key-${label}`, baseUrl: "mock", chatModel: "mock-chat", reasonerModel: "mock-reasoner" });
}

describe("Key 独立路由 — resolveLlm", () => {
  it("按 key 精确路由到对应适配器", () => {
    const cyrene = mockAdapter("cyrene");
    const chat = mockAdapter("chat");
    const reasoner = mockAdapter("reasoner");

    const llms = new Map<string, LlmAdapter>();
    llms.set("DEEPSEEK_CYRENE", cyrene);
    llms.set("DEEPSEEK_CHAT", chat);
    llms.set("DEEPSEEK_REASONER", reasoner);

    expect(resolveLlm(llms, "DEEPSEEK_CYRENE")).toBe(cyrene);
    expect(resolveLlm(llms, "DEEPSEEK_CHAT")).toBe(chat);
    expect(resolveLlm(llms, "DEEPSEEK_REASONER")).toBe(reasoner);
  });

  it("key 未找到时回退到映射中第一个适配器", () => {
    const cyrene = mockAdapter("cyrene");
    const chat = mockAdapter("chat");

    const llms = new Map<string, LlmAdapter>();
    llms.set("DEEPSEEK_CYRENE", cyrene);
    llms.set("DEEPSEEK_CHAT", chat);

    // 未注册的 key → 回退到第一个
    const result = resolveLlm(llms, "UNKNOWN_KEY");
    expect(result).toBe(cyrene); // 插入顺序第一个
  });

  it("key 为 undefined 时回退到第一个适配器", () => {
    const cyrene = mockAdapter("cyrene");
    const llms = new Map<string, LlmAdapter>();
    llms.set("DEEPSEEK_CYRENE", cyrene);

    expect(resolveLlm(llms, undefined)).toBe(cyrene);
  });

  it("映射为空时抛出错误", () => {
    const llms = new Map<string, LlmAdapter>();
    expect(() => resolveLlm(llms, "DEEPSEEK_CYRENE")).toThrow("llms 映射为空");
  });

  it("三 Key 完全隔离，互不串扰", () => {
    const cyrene = mockAdapter("cyrene");
    const chat = mockAdapter("chat");
    const reasoner = mockAdapter("reasoner");

    const llms = new Map<string, LlmAdapter>();
    llms.set("DEEPSEEK_CYRENE", cyrene);
    llms.set("DEEPSEEK_CHAT", chat);
    llms.set("DEEPSEEK_REASONER", reasoner);

    // chat 不会路由到 cyrene
    expect(resolveLlm(llms, "DEEPSEEK_CHAT")).not.toBe(cyrene);
    expect(resolveLlm(llms, "DEEPSEEK_CHAT")).not.toBe(reasoner);

    // reasoner 不会路由到 chat
    expect(resolveLlm(llms, "DEEPSEEK_REASONER")).not.toBe(chat);
    expect(resolveLlm(llms, "DEEPSEEK_REASONER")).not.toBe(cyrene);

    // cyrene 不会路由到其他
    expect(resolveLlm(llms, "DEEPSEEK_CYRENE")).not.toBe(chat);
    expect(resolveLlm(llms, "DEEPSEEK_CYRENE")).not.toBe(reasoner);
  });
});
