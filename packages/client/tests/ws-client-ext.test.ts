// @ci: unit
/**
 * @cortex/client — WS 客户端底座扩展守护测试（spec 阶段三 B1/B2/B3/B4）
 *
 * 守护事实：
 *   B1 typed on()：事件 data 按通道类型收窄（消费方零 as cast）
 *   B2 ackNotification：S2-12 客户端闭环命令
 *   B3 onStatus：连接生命周期事件（connected/disconnected/reconnecting/reconnect_failed）
 *   B4 发送缓冲：非 OPEN 入队、open 后 flush（重连瞬间命令不丢）
 */
import { describe, it, expect, vi } from "vitest";
import { CortexWSClient, type WSConnectionEvent } from "../src/ws-client.js";

/** 可控的 mock WebSocket（与 ws-client.test.ts 同构） */
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

function makeClient(): { client: CortexWSClient; mockWs: MockWebSocket } {
  const client = new CortexWSClient({
    url: "ws://localhost:3210",
    WebSocketImpl: MockWebSocket as never,
    reconnect: { maxRetries: 2, backoffMs: 100, maxBackoffMs: 500 },
  });
  client.connect();
  const mockWs = (client as never)["ws"] as MockWebSocket;
  return { client, mockWs };
}

describe("B2: ackNotification（S2-12 客户端闭环）", () => {
  it("发送 notification.ack 命令", () => {
    const { client, mockWs } = makeClient();
    mockWs._open();
    client.ackNotification("n-1", false);
    const cmd = JSON.parse(mockWs.sentMessages.at(-1)!);
    expect(cmd).toEqual({ type: "notification.ack", requestId: "n-1", approved: false });
  });
});

describe("B1: typed on() 事件收窄", () => {
  it("chat 通道 data 收窄后可 switch 判别（无 as cast）", () => {
    const { client, mockWs } = makeClient();
    mockWs._open();
    const seen: string[] = [];
    client.on("chat", (msg) => {
      // 编译期：msg.data 已收窄为 WSChatServerEvent["data"]，可直接 switch data.type
      switch (msg.data.type) {
        case "chat.chunk":
          seen.push(`chunk:${msg.data.content}`);
          break;
        case "chat.tool_start":
          seen.push(`tool:${msg.data.toolName}:${msg.data.toolCallId}`);
          break;
        case "chat.complete":
          seen.push(`done:${msg.data.output}`);
          break;
        default:
          break;
      }
    });
    mockWs._message({ channel: "chat", data: { type: "chat.chunk", sessionId: "s1", content: "hi" } });
    mockWs._message({
      channel: "chat", sessionId: "s1",
      data: { type: "chat.tool_start", sessionId: "s1", toolCallId: "tc1", toolName: "read_file", input: "{}", agent: "cyrene" },
    } as never);
    mockWs._message({ channel: "chat", data: { type: "chat.complete", sessionId: "s1", output: "done" } });
    expect(seen).toEqual(["chunk:hi", "tool:read_file:tc1", "done:done"]);
  });

  it("gate 通道 data 收窄为 WSGateServerEvent['data']", () => {
    const { client, mockWs } = makeClient();
    mockWs._open();
    const seen: string[] = [];
    client.on("gate", (msg) => {
      if (msg.data.type === "gate.request") {
        seen.push(`${msg.data.requestId}:${msg.data.toolName}`);
      }
    });
    mockWs._message({
      channel: "gate",
      data: { type: "gate.request", requestId: "r1", sessionId: "s1", toolName: "write_file", level: "L2", summary: "write" },
    } as never);
    expect(seen).toEqual(["r1:write_file"]);
  });
});

describe("B3: 连接生命周期事件（onStatus）", () => {
  it("连接建立触发 connected", () => {
    const { client, mockWs } = makeClient();
    const events: WSConnectionEvent[] = [];
    client.onStatus((e) => events.push(e));
    mockWs._open();
    expect(events).toEqual([{ type: "connected" }]);
  });

  it("非主动断开触发 disconnected + reconnecting", () => {
    vi.useFakeTimers();
    const { client, mockWs } = makeClient();
    const events: WSConnectionEvent[] = [];
    client.onStatus((e) => events.push(e));
    mockWs._open();
    mockWs.close();
    expect(events[0]).toEqual({ type: "connected" });
    expect(events[1]).toEqual({ type: "disconnected" });
    expect(events[2]!.type).toBe("reconnecting");
    expect((events[2] as { attempt: number }).attempt).toBe(1);
    vi.useRealTimers();
  });

  it("重连耗尽触发 reconnect_failed", () => {
    vi.useFakeTimers();
    const { client, mockWs } = makeClient();
    const events: WSConnectionEvent[] = [];
    client.onStatus((e) => events.push(e));
    mockWs._open();
    // maxRetries=2：第一次 close → attempt 1；advance 后第二次 close → attempt 2；再 advance 后第三次 close → 耗尽
    mockWs.close();
    vi.advanceTimersByTime(1000);
    mockWs.close();
    vi.advanceTimersByTime(1000);
    mockWs.close();
    expect(events.some((e) => e.type === "reconnect_failed")).toBe(true);
    vi.useRealTimers();
  });

  it("onStatus 返回取消函数", () => {
    const { client, mockWs } = makeClient();
    const events: WSConnectionEvent[] = [];
    const unsub = client.onStatus((e) => events.push(e));
    unsub();
    mockWs._open();
    expect(events).toHaveLength(0);
  });
});

describe("B4: 发送缓冲（非 OPEN 入队 + open flush）", () => {
  it("未连接时命令入队，open 后按序 flush", () => {
    const { client, mockWs } = makeClient();
    // 未 _open：startChat + resolveGate 应入队（不发送）
    client.startChat({ input: "hello", agent: "cyrene" });
    client.resolveGate("r1", true);
    expect(mockWs.sentMessages).toHaveLength(0); // 尚未 open，无发送

    mockWs._open();
    // flush 两条 + 订阅恢复（无初始 channels 时不发 subscribe）
    expect(mockWs.sentMessages).toHaveLength(2);
    const first = JSON.parse(mockWs.sentMessages[0]!);
    expect(first.type).toBe("chat.start");
    const second = JSON.parse(mockWs.sentMessages[1]!);
    expect(second).toEqual({ type: "gate.resolve", requestId: "r1", approved: true });
  });

  it("缓冲上限生效（超出丢最旧）", () => {
    const client = new CortexWSClient({
      url: "ws://localhost:3210",
      WebSocketImpl: MockWebSocket as never,
      sendQueueLimit: 2,
    });
    client.connect();
    const mockWs = (client as never)["ws"] as MockWebSocket;
    client.startChat({ input: "a" });
    client.startChat({ input: "b" });
    client.startChat({ input: "c" });
    mockWs._open();
    const sent = mockWs.sentMessages.map((s) => JSON.parse(s) as { input?: string });
    const inputs = sent.map((c) => c.input).filter((x) => x !== undefined);
    expect(inputs).toEqual(["b", "c"]); // 最旧的 "a" 被挤出
  });

  it("disconnect 清空缓冲", () => {
    const { client, mockWs } = makeClient();
    client.startChat({ input: "hello" });
    client.disconnect();
    mockWs._open();
    expect(mockWs.sentMessages).toHaveLength(0);
  });
});
