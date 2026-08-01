// @ci: unit
/**
 * @cortex/server — WS 入站命令校验守护测试（spec 阶段三 A2）
 *
 * 守护事实：daemon.handleWsCommand 用 isWSClientCommand 结构性守卫替换类型断言；
 * 非法命令回 system.error 错误帧（不静默丢弃），合法 6 命令正常分发。
 */
import { describe, it, expect, vi } from "vitest";
import { CortexDaemon } from "../src/daemon.js";

type SendToSpy = ReturnType<typeof vi.fn>;

/** 构造 daemon + 注入 mock wsGateway（捕获 sendTo） */
function makeDaemon(): { daemon: CortexDaemon; sendTo: SendToSpy } {
  const daemon = new CortexDaemon({ projectRoot: "/tmp/ws-validation" });
  const sendTo = vi.fn();
  (daemon as unknown as { wsGateway: unknown }).wsGateway = { sendTo };
  return { daemon, sendTo };
}

/** 触发私有 handleWsCommand */
function handleWsCommand(daemon: CortexDaemon, msg: unknown): void {
  (daemon as unknown as { handleWsCommand(connId: string, msg: unknown): void })
    .handleWsCommand("conn-1", msg);
}

describe("WS 入站命令校验（A2）", () => {
  it("合法 subscribe 命令通过（无错误帧）", () => {
    const { daemon, sendTo } = makeDaemon();
    handleWsCommand(daemon, { type: "subscribe", channels: ["state"] });
    expect(sendTo).not.toHaveBeenCalled();
  });

  it("合法 chat.start 命令通过（依赖未初始化时安全跳过）", () => {
    const { daemon, sendTo } = makeDaemon();
    handleWsCommand(daemon, {
      type: "chat.start", sessionId: "s1", input: "hi", mode: "chat", agent: "cyrene",
    });
    expect(sendTo).not.toHaveBeenCalled();
  });

  it("合法 notification.ack 命令通过（engine 未初始化时安全跳过）", () => {
    const { daemon, sendTo } = makeDaemon();
    handleWsCommand(daemon, { type: "notification.ack", requestId: "n1", approved: true });
    expect(sendTo).not.toHaveBeenCalled();
  });

  it("非法命令回 system.error 错误帧", () => {
    const { daemon, sendTo } = makeDaemon();
    handleWsCommand(daemon, { type: "invalid", channels: [] });
    expect(sendTo).toHaveBeenCalledTimes(1);
    const [connId, channel, data] = sendTo.mock.calls[0] as [string, string, { type: string; message: string }];
    expect(connId).toBe("conn-1");
    expect(channel).toBe("system");
    expect(data.type).toBe("system.error");
    expect(data.message).toContain("invalid");
  });

  it("缺字段命令回错误帧（chat.start 缺 sessionId）", () => {
    const { daemon, sendTo } = makeDaemon();
    handleWsCommand(daemon, { type: "chat.start", input: "hi", mode: "chat", agent: "cyrene" });
    expect(sendTo).toHaveBeenCalledTimes(1);
    const data = sendTo.mock.calls[0]?.[2] as { type: string };
    expect(data.type).toBe("system.error");
  });

  it("非对象消息回错误帧", () => {
    const { daemon, sendTo } = makeDaemon();
    handleWsCommand(daemon, "hello");
    expect(sendTo).toHaveBeenCalledTimes(1);
    const data = sendTo.mock.calls[0]?.[2] as { type: string };
    expect(data.type).toBe("system.error");
  });

  it("notification.ack 缺 approved 回错误帧", () => {
    const { daemon, sendTo } = makeDaemon();
    handleWsCommand(daemon, { type: "notification.ack", requestId: "n1" });
    expect(sendTo).toHaveBeenCalledTimes(1);
    const data = sendTo.mock.calls[0]?.[2] as { type: string };
    expect(data.type).toBe("system.error");
  });
});
