/**
 * TUI 核心测试：query-loop（查询循环——人格映射 + 历史提取）
 */
import { describe, it, expect } from "vitest";
import { agentTalkPersona, extractHistory } from "../src/tui/query-loop.js";

describe("agentTalkPersona", () => {
  it("AgentType 枚举直接映射到人格目录", () => {
    const p = agentTalkPersona("cyrene");
    expect(typeof p).toBe("string");
    expect(p.length).toBeGreaterThan(0);
  });

  it("中文名映射（昔涟/纳西妲）", () => {
    const p = agentTalkPersona("昔涟");
    expect(typeof p).toBe("string");
    expect(p.length).toBeGreaterThan(0);
  });

  it("未知 agent 返回兜底（不抛异常）", () => {
    expect(() => agentTalkPersona("unknown-agent-xyz")).not.toThrow();
    const p = agentTalkPersona("unknown-agent-xyz");
    expect(typeof p).toBe("string");
  });

  it("空字符串不抛异常", () => {
    expect(() => agentTalkPersona("")).not.toThrow();
  });
});

describe("extractHistory", () => {
  it("过滤 system 消息", () => {
    const r = extractHistory([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "yo" },
    ]);
    expect(r.length).toBe(2);
    expect(r.every((m) => m.role !== "system")).toBe(true);
  });

  it("全部 system → 空数组", () => {
    expect(extractHistory([{ role: "system", content: "a" }, { role: "system", content: "b" }])).toEqual([]);
  });

  it("无 system → 原样返回", () => {
    const msgs = [{ role: "user", content: "hi" }];
    expect(extractHistory(msgs)).toEqual(msgs);
  });

  it("空数组 → 空数组", () => {
    expect(extractHistory([])).toEqual([]);
  });
});
