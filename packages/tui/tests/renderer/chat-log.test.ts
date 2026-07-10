// @ci: unit
import { describe, it, expect } from "vitest";
import { ChatLog } from "../../src/renderer/chat-log.js";

describe("ChatLog", () => {
  it("空ChatLog输出空", () => { const cl = new ChatLog(); expect(cl.render(80).length).toBe(0); });
  it("addUser追加消息", () => { const cl = new ChatLog(); cl.addUser("hi"); expect(cl.render(80).length).toBe(1); });
  it("start/update/finalize流式", () => {
    const cl = new ChatLog();
    cl.startAssistant("r1");
    // startAssistant 创建空内容消息 → render 跳过空 → 0 行
    expect(cl.render(80).length).toBe(0);
    cl.updateAssistant("r1", "hello");
    // 有内容但未完成 → 显示 ⠋
    expect(cl.render(80)[0]).toContain("⠋");
    cl.finalizeAssistant("r1");
    // 完成后无 ⠋
    expect(cl.render(80)[0]).not.toContain("⠋");
  });
  it("loadHistory回填", () => {
    const cl = new ChatLog();
    cl.loadHistory([{ role: "user", content: "old msg" }]);
    expect(cl.render(80).length).toBe(1);
  });
});
