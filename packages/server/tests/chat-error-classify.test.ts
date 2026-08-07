// @ci: contract
/**
 * U1 错误分类契约测试——classifyChatError（timeout/fatal/network 映射）
 */
import { describe, it, expect } from "vitest";
import { classifyChatError } from "../src/chat-executor.js";

describe("U1 classifyChatError——错误消息 → 状态机 kind", () => {
  it("timeout 类 → timeout（可重试）", () => {
    expect(classifyChatError("LLM API timeout after 30000ms")).toBe("timeout");
    expect(classifyChatError("Request timed out")).toBe("timeout");
    expect(classifyChatError("请求超时")).toBe("timeout");
  });
  it("网络类 → network（续传语义）", () => {
    expect(classifyChatError("fetch failed: ECONNREFUSED")).toBe("network");
    expect(classifyChatError("ENETUNREACH")).toBe("network");
    expect(classifyChatError("socket hang up")).toBe("network");
    expect(classifyChatError("连接被拒绝")).toBe("network");
  });
  it("其余 → fatal（保守——认证/模型等）", () => {
    expect(classifyChatError("401 Unauthorized")).toBe("fatal");
    expect(classifyChatError("Model not found")).toBe("fatal");
    expect(classifyChatError("invalid api key")).toBe("fatal");
  });
});
