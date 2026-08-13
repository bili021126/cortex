// @ci: unit
/**
 * D2 能力面守卫行为测试——capabilities 驱动降级：
 *  1. 已注入 capabilities 时，未声明/声明 false 的域抛 NotSupportedError（替代 404 盲请求）
 *  2. 未注入时保持向后兼容（旧行为：发请求）
 *  3. 声明 true 的域正常放行
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { CortexHttpClient } from "../src/http-client.js";
import { NotSupportedError } from "../src/errors.js";

/** 构造一个永不触网的客户端（request 全部 mock） */
function makeClient(caps?: Record<string, boolean>): CortexHttpClient {
  const client = new CortexHttpClient({ baseUrl: "http://localhost:1", timeoutMs: 1000 });
  // @ts-expect-error 测试注入——拦截私有 request 避免真实网络
  client.request = vi.fn().mockResolvedValue({ data: {} });
  if (caps) client.setCapabilities({ server: "daemon", version: "1.0.0", api: caps as never, wsChannels: [] });
  return client;
}

const CAPS_KNOWN = {
  state: true, health: true, nodes: true, agents: true, chat: true,
  memory: true, sessions: true, daemonHealth: true, execute: true,
  events: false, config: false,
};

describe("能力面守卫：声明 false / 未声明的域抛 NotSupportedError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("events 声明 false → 拦截", async () => {
    const c = makeClient(CAPS_KNOWN);
    await expect(c.getEvents()).rejects.toBeInstanceOf(NotSupportedError);
    expect(c.request).not.toHaveBeenCalled();
  });

  it("config 声明 false → 拦截（validateConfig）", async () => {
    const c = makeClient(CAPS_KNOWN);
    await expect(c.validateConfig({} as never)).rejects.toBeInstanceOf(NotSupportedError);
  });

  it("models 未声明 → 拦截", async () => {
    const c = makeClient(CAPS_KNOWN);
    await expect(c.getModels()).rejects.toBeInstanceOf(NotSupportedError);
  });

  it("keys 未声明 → 拦截", async () => {
    const c = makeClient(CAPS_KNOWN);
    await expect(c.getKeys()).rejects.toBeInstanceOf(NotSupportedError);
  });

  it("tuning 未声明 → 拦截", async () => {
    const c = makeClient(CAPS_KNOWN);
    await expect(c.getTuning()).rejects.toBeInstanceOf(NotSupportedError);
  });

  it("agents-patch 未声明 → 拦截", async () => {
    const c = makeClient(CAPS_KNOWN);
    await expect(c.patchAgentConfig("code", {})).rejects.toBeInstanceOf(NotSupportedError);
  });
});

describe("能力面守卫：声明 true 的域正常放行", () => {
  afterEach(() => vi.restoreAllMocks());

  it("state 声明 true → 发请求", async () => {
    const c = makeClient(CAPS_KNOWN);
    await c.getState();
    expect(c.request).toHaveBeenCalledTimes(1);
  });

  it("memory 声明 true → 发请求", async () => {
    const c = makeClient(CAPS_KNOWN);
    await c.searchMemory("q");
    expect(c.request).toHaveBeenCalledTimes(1);
  });
});

describe("能力面守卫：未注入 capabilities 时向后兼容", () => {
  afterEach(() => vi.restoreAllMocks());

  it("不抛错、正常发请求（旧行为）", async () => {
    const c = makeClient();
    await c.getModels();
    expect(c.request).toHaveBeenCalledTimes(1);
  });
});
