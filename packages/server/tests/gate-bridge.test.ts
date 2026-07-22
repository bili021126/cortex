// server/tests/gate-bridge.test.ts — RemoteGateBridge 核心行为测试
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RemoteGateBridge } from "../src/gate-bridge.js";

describe("RemoteGateBridge", () => {
  let broadcastFn: ReturnType<typeof vi.fn>;
  let bridge: RemoteGateBridge;

  beforeEach(() => {
    broadcastFn = vi.fn();
    bridge = new RemoteGateBridge(broadcastFn);
  });

  it("confirm 广播 gate.request 到客户端", async () => {
    const promise = bridge.confirm({
      id: "req-1",
      toolName: "write_file",
      level: "L2",
      summary: "Write file confirmation",
      detail: '{"path":"/f"}',
    });

    expect(broadcastFn).toHaveBeenCalledWith("gate", {
      type: "gate.request",
      requestId: "req-1",
      sessionId: "",
      toolName: "write_file",
      level: "L2",
      summary: "Write file confirmation",
      detail: '{"path":"/f"}',
    });

    // Avoid dangling promise
    bridge.resolve("req-1", true);
    const resp = await promise;
    expect(resp.approved).toBe(true);
  });

  it("resolve 批准后 confirm promise 返回 approved:true", async () => {
    const promise = bridge.confirm({
      id: "req-2",
      toolName: "write_file",
      level: "L2",
      summary: "Write file",
      detail: "{}",
    });

    bridge.resolve("req-2", true);
    const resp = await promise;
    expect(resp).toEqual({ requestId: "req-2", approved: true });
  });

  it("resolve 拒绝后 confirm promise 返回 approved:false", async () => {
    const promise = bridge.confirm({
      id: "req-3",
      toolName: "delete_file",
      level: "L3",
      summary: "Delete file",
      detail: "{}",
    });

    bridge.resolve("req-3", false);
    const resp = await promise;
    expect(resp).toEqual({ requestId: "req-3", approved: false });
  });

  it("resolve 不存在的 requestId 返回 false", () => {
    const result = bridge.resolve("nonexistent", true);
    expect(result).toBe(false);
  });

  it("超时 300s 后自动拒绝", async () => {
    vi.useFakeTimers();
    const promise = bridge.confirm({
      id: "req-timeout",
      toolName: "write_file",
      level: "L2",
      summary: "timeout test",
      detail: "{}",
    });

    vi.advanceTimersByTime(300_001);
    const resp = await promise;
    expect(resp).toEqual({ requestId: "req-timeout", approved: false });
    vi.useRealTimers();
  });

  it("重复 resolve 同 requestId——第二次返回 false", () => {
    void bridge.confirm({ id: "dup", toolName: "read", level: "L0", summary: "x", detail: "{}" });
    const first = bridge.resolve("dup", true);
    const second = bridge.resolve("dup", true);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});
