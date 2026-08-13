// @ci: unit
/**
 * TUI 核心测试：remote-query-loop（远程查询循环——取消函数）
 */
import { describe, it, expect, vi } from "vitest";
import { createRemoteCancel } from "../src/tui/remote-query-loop.js";

describe("createRemoteCancel", () => {
  it("调用时触发 conn.ws.cancelChat(sessionId)", () => {
    const cancelChat = vi.fn();
    const conn = { ws: { cancelChat } };
    const cancel = createRemoteCancel(conn as never, "sess-1");
    cancel();
    expect(cancelChat).toHaveBeenCalledWith("sess-1");
  });

  it("多次调用安全（不抛异常）", () => {
    const cancelChat = vi.fn();
    const conn = { ws: { cancelChat } };
    const cancel = createRemoteCancel(conn as never, "sess-2");
    expect(() => { cancel(); cancel(); cancel(); }).not.toThrow();
    expect(cancelChat).toHaveBeenCalledTimes(3);
  });
});
