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

  it("非法命令不通过", () => {
    expect(isWSClientCommand({ type: "subscribe", channels: "state" })).toBe(false);
    expect(isWSClientCommand({ type: "invalid", channels: [] })).toBe(false);
    expect(isWSClientCommand(null)).toBe(false);
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
