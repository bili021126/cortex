// @ci: unit
import { describe, it, expect } from "vitest";
import { ChatLog } from "../../src/tui/renderer/chat-log.js";

describe("ChatLog（纯追加模式）", () => {
  it("空 ChatLog 消息列表为空", () => {
    const cl = new ChatLog();
    expect(cl.getMessages().length).toBe(0);
  });

  it("addUser 追加用户消息到内部记录", () => {
    const cl = new ChatLog();
    cl.addUser("hi");
    const msgs = cl.getMessages();
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("hi");
    expect(msgs[0].complete).toBe(true);
  });

  it("start/update/finalize 流式完整流程", () => {
    const cl = new ChatLog();
    cl.startAssistant("r1");
    let msgs = cl.getMessages();
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe("assistant");
    expect(msgs[0].complete).toBe(false);
    expect(msgs[0].content).toBe("");

    cl.updateAssistant("r1", "hello");
    msgs = cl.getMessages();
    expect(msgs[0].content).toBe("hello");
    expect(msgs[0].complete).toBe(false);

    cl.finalizeAssistant("r1");
    msgs = cl.getMessages();
    expect(msgs[0].complete).toBe(true);
    expect(cl.getStreamingRuns().has("r1")).toBe(false);
  });

  it("loadHistory 回填到内部记录", () => {
    const cl = new ChatLog();
    cl.loadHistory([{ role: "user", content: "old msg" }]);
    const msgs = cl.getMessages();
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("old msg");
  });

  it("addToolSegment 追加 tool 到内部记录", () => {
    const cl = new ChatLog();
    cl.startAssistant("r1");
    cl.updateAssistant("r1", "some response");
    cl.addToolSegment("r1", "read_file", "pending");
    const msgs = cl.getMessages();
    const msg = msgs.find(m => m.role === "assistant");
    expect(msg?.segments).toBeDefined();
    expect(msg?.segments?.length).toBe(1);
    expect(msg?.segments?.[0].tool).toBe("read_file");
    expect(msg?.segments?.[0].toolStatus).toBe("pending");
  });

  it("updateToolSegment 更新 tool 状态到内部记录", () => {
    const cl = new ChatLog();
    cl.startAssistant("r1");
    cl.updateAssistant("r1", "response");
    cl.addToolSegment("r1", "read_file", "pending");
    cl.updateToolSegment("r1", "read_file", "success", 42);
    const msgs = cl.getMessages();
    const msg = msgs.find(m => m.role === "assistant");
    const seg = msg?.segments?.find(s => s.tool === "read_file");
    expect(seg?.toolStatus).toBe("success");
    expect(seg?.toolDuration).toBe(42);
  });

  it("多个内联 tool 段交替记录", () => {
    const cl = new ChatLog();
    cl.startAssistant("r1");
    cl.updateAssistant("r1", "thinking...");
    cl.addToolSegment("r1", "search", "pending");
    cl.updateToolSegment("r1", "search", "success", 100);
    cl.addToolSegment("r1", "read", "pending");
    cl.updateToolSegment("r1", "read", "success", 50);
    const msgs = cl.getMessages();
    const msg = msgs.find(m => m.role === "assistant");
    expect(msg?.segments?.length).toBe(2);
  });

  it("segments 模型接口完整性", () => {
    const cl = new ChatLog();
    cl.startAssistant("r1");
    const msgs = cl.getMessages();
    expect(msgs.length).toBe(1);
    expect(msgs[0].segments).toBeDefined();
    expect(Array.isArray(msgs[0].segments)).toBe(true);
  });

  it("getMessages 返回内部消息列表", () => {
    const cl = new ChatLog();
    cl.addUser("user1");
    cl.startAssistant("a1");
    const msgs = cl.getMessages();
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
  });

  it("getStreamingRuns 返回流式消息映射", () => {
    const cl = new ChatLog();
    cl.startAssistant("run1");
    const runs = cl.getStreamingRuns();
    expect(runs.has("run1")).toBe(true);
    expect(runs.get("run1")?.role).toBe("assistant");
  });

  it("clear 清空所有消息", () => {
    const cl = new ChatLog();
    cl.addUser("hello");
    cl.startAssistant("r1");
    expect(cl.getMessages().length).toBe(2);
    cl.clear();
    expect(cl.getMessages().length).toBe(0);
    expect(cl.getStreamingRuns().size).toBe(0);
  });
});
