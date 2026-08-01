// @ci: unit
import { describe, it, expect } from "vitest";
import { isProtocolEnvelope, isProblemDetails, isWSClientCommand, isWSMessage } from "../src/validation.js";

describe("isProtocolEnvelope", () => {
  it("合法信封通过", () => {
    expect(isProtocolEnvelope({
      id: "abc", type: "test", timestamp: 123, version: "1.0.0", payload: {},
    })).toBe(true);
  });

  it("缺少字段不通过", () => {
    expect(isProtocolEnvelope({ id: "abc", type: "test" })).toBe(false);
    expect(isProtocolEnvelope(null)).toBe(false);
    expect(isProtocolEnvelope("string")).toBe(false);
  });
});

describe("isProblemDetails", () => {
  it("合法 ProblemDetails 通过", () => {
    expect(isProblemDetails({
      type: "https://cortex.dev/errors/not-found",
      title: "Not Found",
      status: 404,
    })).toBe(true);
  });

  it("缺少 status 不通过", () => {
    expect(isProblemDetails({ type: "x", title: "y" })).toBe(false);
  });
});

describe("isWSClientCommand", () => {
  it("subscribe 命令通过", () => {
    expect(isWSClientCommand({ type: "subscribe", channels: ["state", "pipeline"] })).toBe(true);
  });

  it("unsubscribe 命令通过", () => {
    expect(isWSClientCommand({ type: "unsubscribe", channels: ["tui"] })).toBe(true);
  });

  it("chat.start 命令通过", () => {
    expect(isWSClientCommand({
      type: "chat.start", sessionId: "s1", input: "你好", mode: "chat", agent: "cyrene",
    })).toBe(true);
  });

  it("chat.start 带 history 通过", () => {
    expect(isWSClientCommand({
      type: "chat.start", sessionId: "s1", input: "hi", mode: "chat", agent: "cyrene",
      history: [{ role: "user", content: "hi" }],
    })).toBe(true);
  });

  it("chat.cancel 命令通过", () => {
    expect(isWSClientCommand({ type: "chat.cancel", sessionId: "s1" })).toBe(true);
  });

  it("gate.resolve 命令通过", () => {
    expect(isWSClientCommand({ type: "gate.resolve", requestId: "r1", approved: true })).toBe(true);
  });

  it("notification.ack 命令通过（S2-12）", () => {
    expect(isWSClientCommand({ type: "notification.ack", requestId: "n1", approved: false })).toBe(true);
  });

  it("缺字段不通过", () => {
    expect(isWSClientCommand({ type: "subscribe", channels: "state" })).toBe(false);
    expect(isWSClientCommand({ type: "chat.start", sessionId: "s1" })).toBe(false);
    expect(isWSClientCommand({ type: "chat.cancel" })).toBe(false);
    expect(isWSClientCommand({ type: "gate.resolve", requestId: "r1" })).toBe(false);
    expect(isWSClientCommand({ type: "notification.ack", requestId: "n1" })).toBe(false);
  });

  it("非法命令不通过", () => {
    expect(isWSClientCommand({ type: "invalid", channels: [] })).toBe(false);
    expect(isWSClientCommand(null)).toBe(false);
    expect(isWSClientCommand("subscribe")).toBe(false);
  });
});

describe("isWSMessage", () => {
  it("合法消息通过", () => {
    expect(isWSMessage({ channel: "state", data: {} })).toBe(true);
  });

  it("缺少 data 不通过", () => {
    expect(isWSMessage({ channel: "state" })).toBe(false);
  });
});
