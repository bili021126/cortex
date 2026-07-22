// client/tests/ws-client.test.ts — WebSocket 客户端核心行为测试
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CortexWSClient } from "../src/ws-client.js";

/** 可控的 mock WebSocket */
class MockWebSocket {
  static OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event?: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  sentMessages: string[] = [];

  constructor(_url: string) {}

  send(data: string) { this.sentMessages.push(data); }
  close(code?: number) {
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1000 });
  }
  _open() { this.readyState = 1; this.onopen?.(); }
  _message(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
}

describe("CortexWSClient", () => {
  let client: CortexWSClient;
  let mockWs: MockWebSocket;

  beforeEach(() => {
    client = new CortexWSClient({ url: "ws://localhost:3210", WebSocketImpl: MockWebSocket as never, channels: ["chat"] });
    client.connect();
    mockWs = (client as never)["ws"] as MockWebSocket;
    mockWs._open();
  });

  it("连接后自动订阅配置的通道", () => {
    expect(mockWs.sentMessages).toHaveLength(1);
    expect(JSON.parse(mockWs.sentMessages[0]!)).toEqual({ type: "subscribe", channels: ["chat"] });
  });

  it("subscribe 发送正确的命令", () => {
    client.subscribe(["gate", "tui"]);
    const cmd = JSON.parse(mockWs.sentMessages[1]!);
    expect(cmd).toEqual({ type: "subscribe", channels: ["gate", "tui"] });
  });

  it("startChat 发送 chat.start 命令", () => {
    const sid = client.startChat({ input: "hello", agent: "cyrene" });
    expect(sid).toBeTruthy();
    const cmd = JSON.parse(mockWs.sentMessages[1]!);
    expect(cmd.type).toBe("chat.start");
    expect(cmd.input).toBe("hello");
    expect(cmd.agent).toBe("cyrene");
    expect(cmd.mode).toBe("chat");
  });

  it("cancelChat 发送 chat.cancel", () => {
    client.cancelChat("sess-123");
    const cmd = JSON.parse(mockWs.sentMessages[1]!);
    expect(cmd).toEqual({ type: "chat.cancel", sessionId: "sess-123" });
  });

  it("resolveGate 发送 gate.resolve", () => {
    client.resolveGate("req-456", true);
    const cmd = JSON.parse(mockWs.sentMessages[1]!);
    expect(cmd).toEqual({ type: "gate.resolve", requestId: "req-456", approved: true });
  });

  it("on 注册事件处理器并返回取消函数", () => {
    const handler = vi.fn();
    const unsub = client.on("chat", handler as never);
    mockWs._message({ channel: "chat", data: { type: "chat.chunk", content: "hi" } });
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    mockWs._message({ channel: "chat", data: { type: "chat.chunk", content: "bye" } });
    expect(handler).toHaveBeenCalledTimes(1); // 不应再触发
  });

  it("off 移除事件处理器", () => {
    const handler = vi.fn();
    client.on("chat", handler as never);
    client.off("chat", handler as never);
    mockWs._message({ channel: "chat", data: {} });
    expect(handler).not.toHaveBeenCalled();
  });

  it("disconnect 设置 intentionalClose 不触发重连", () => {
    const reconnectSpy = vi.spyOn(client as never, "_scheduleReconnect");
    client.disconnect();
    mockWs.close();
    expect(reconnectSpy).not.toHaveBeenCalled();
    expect((client as never)["reconnectTimer"]).toBeNull();
  });

  it("非主动断开触发重连（指数退避）", async () => {
    vi.useFakeTimers();
    const reconnectSpy = vi.spyOn(client as never, "_scheduleReconnect");
    mockWs.close();
    expect(reconnectSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("重连超限后停止", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 11; i++) {
      mockWs.close();
      vi.advanceTimersByTime(1000);
    }
    expect((client as never)["reconnectAttempts"]).toBeGreaterThanOrEqual(10);
    vi.useRealTimers();
  });
});
