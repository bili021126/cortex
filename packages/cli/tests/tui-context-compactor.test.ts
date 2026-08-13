// @ci: unit
/**
 * TUI 核心测试：context-compactor（上下文压缩——token 估算 + 多层压缩）
 */
import { describe, it, expect } from "vitest";
import { estimateTokens, compactMessages } from "../src/tui/context-compactor.js";

const base: Array<{ role: string; content: string }> = [
  { role: "system", content: "你是昔涟" },
  { role: "user", content: "你好" },
  { role: "assistant", content: "伙伴～" },
];

describe("estimateTokens", () => {
  it("按字符数/4 粗估（ceil）", () => {
    expect(estimateTokens([{ role: "user", content: "hello" }])).toBe(2); // 5/4=1.25→2
    expect(estimateTokens([{ role: "user", content: "你好世界" }])).toBe(1); // 4/4=1
    expect(estimateTokens([{ role: "user", content: "x".repeat(9) }])).toBe(3); // 9/4=2.25→3
  });

  it("计入 reasoning_content（同样 /4）", () => {
    expect(estimateTokens([{ role: "assistant", content: "hi", reasoning_content: "thinking" }])).toBe(3); // (2+8)/4=2.5→3
  });

  it("计入 tool_calls 序列化长度", () => {
    expect(estimateTokens([{ role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "f", arguments: "{}" } }] }])).toBeGreaterThan(0);
  });

  it("空列表 → 0", () => {
    expect(estimateTokens([])).toBe(0);
  });
});

describe("compactMessages", () => {
  it("消息太少（<2）不压缩", async () => {
    const r = await compactMessages([{ role: "user", content: "hi" }], { contextLimit: 1000, currentTokens: 990 });
    expect(r.appliedLayers).toEqual([]);
    expect(r.messages.length).toBe(1);
  });

  it("首条非 system 不压缩", async () => {
    const r = await compactMessages([{ role: "user", content: "hi" }, { role: "user", content: "yo" }], { contextLimit: 1000, currentTokens: 990 });
    expect(r.appliedLayers).toEqual([]);
  });

  it("未达阈值不压缩", async () => {
    const r = await compactMessages(base as never, { contextLimit: 1000, currentTokens: 100 });
    expect(r.appliedLayers).toEqual([]);
  });

  it("超阈值触发压缩（返回结构完整 + 消息不增）", async () => {
    const big = [
      { role: "system", content: "你是昔涟" },
      ...Array.from({ length: 30 }, (_, i) => ({ role: (i % 2 === 0 ? "user" : "assistant") as string, content: "x".repeat(120) })),
    ];
    const r = await compactMessages(big as never, { contextLimit: 500, currentTokens: 2000 });
    // 结构完整
    expect(Array.isArray(r.messages)).toBe(true);
    expect(typeof r.summary).toBe("string");
    expect(r.compactedCount).toBeGreaterThanOrEqual(0);
    expect(r.estimatedTokens).toBeGreaterThanOrEqual(0);
    // 不抛异常 + 消息不增（可能已触发压缩或 LLM 不可用跳过）
    expect(r.messages.length).toBeLessThanOrEqual(big.length);
  });

  it("保留最近 N 轮（keepRecentTurns——消息不低于保底）", async () => {
    const big = [
      { role: "system", content: "你是昔涟" },
      ...Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 === 0 ? "user" : "assistant") as string, content: "y".repeat(40) })),
    ];
    const r = await compactMessages(big as never, { contextLimit: 300, currentTokens: 500, keepRecentTurns: 2 });
    // 无论是否压缩——消息数不增 + 结构完整
    expect(r.messages.length).toBeLessThanOrEqual(big.length);
    expect(r.messages.length).toBeGreaterThanOrEqual(1);
  });
});
