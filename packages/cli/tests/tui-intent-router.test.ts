/**
 * TUI 核心测试：intent-router（意图判定——TUI 零测试缺口补起）
 */
import { describe, it, expect, beforeEach } from "vitest";
import { classifyIntent, parseAgentFromInput } from "../src/tui/intent-router.js";
import { resetPipeline } from "../src/tui/intent-router/router.js";

// 全局管道单例——每个用例前重置（避免状态污染）
beforeEach(() => { resetPipeline(); });

describe("classifyIntent", () => {
  it("任务类：修复类输入 → task", () => {
    expect(classifyIntent("修复 daemon 僵死")).toBe("task");
  });

  it("命令类：斜杠命令 → command", () => {
    expect(classifyIntent("/help")).toBe("command");
    expect(classifyIntent("/mode work")).toBe("command");
    expect(classifyIntent("/quit")).toBe("command");
  });

  it("聊天类：日常问候 → chat", () => {
    expect(classifyIntent("你好")).toBe("chat");
    expect(classifyIntent("今天天气怎么样")).toBe("chat");
    expect(classifyIntent("伙伴，我回来了")).toBe("chat");
  });

  it("agent 调用：@提及 → chat（agent-invoke 映射）", () => {
    expect(classifyIntent("@fix 帮忙看下这个 bug")).toBe("chat");
    expect(classifyIntent("@昔涟 在吗")).toBe("chat");
  });

  it("低置信度回退：含糊输入 → chat", () => {
    expect(classifyIntent("嗯")).toBe("chat");
    expect(classifyIntent("？？？")).toBe("chat");
  });
});

describe("parseAgentFromInput", () => {
  it("英文 type 提及", () => {
    expect(parseAgentFromInput("@fix 修一下")).toBe("fix");
    expect(parseAgentFromInput("@code 写个函数")).toBe("code");
    expect(parseAgentFromInput("@analysis 调研")).toBe("analysis");
  });

  it("中文名提及（映射到 type）", () => {
    const r = parseAgentFromInput("@昔涟 陪我聊会");
    expect(r).not.toBeNull();
  });

  it("别名提及", () => {
    const r = parseAgentFromInput("@butler 帮我整理");
    expect(r).not.toBeNull();
  });

  it("无提及 → null", () => {
    expect(parseAgentFromInput("随便聊聊")).toBeNull();
    expect(parseAgentFromInput("")).toBeNull();
  });
});
