// @ci: unit
/**
 * @cortex/plugin-runner — AbstractPlugin & isPlugin 单元测试
 *
 * 覆盖：
 *   - AbstractPlugin 默认属性
 *   - init() 调用与返回值（Promise<void>）
 *   - execute() 调用、返回值、ctx.output 传递
 *   - destroy() 调用与返回值
 *   - isPlugin 类型守卫边界
 */

import { describe, it, expect } from "vitest";
import { AbstractPlugin, isPlugin } from "../src/plugin.js";
import type { ExecuteContext } from "../src/types.js";

// ── 辅助：测试用具体插件 ──

class TestPlugin extends AbstractPlugin {
  readonly name = "test-plugin";
  readonly version = "2.0.0";
  readonly description = "A test plugin";
  readonly tags = ["test", "example"];

  async execute(context: ExecuteContext): Promise<void> {
    context.output = { received: context.payload };
  }
}

// ── 辅助：最小化插件（仅实现抽象方法） ──

class MinimalPlugin extends AbstractPlugin {
  readonly name = "minimal";
  async execute(_ctx: ExecuteContext): Promise<void> {
    // 空实现
  }
}

// ── 测试套件 ──

describe("AbstractPlugin — plugin.ts", () => {
  // ── 默认属性 ──

  it("应提供合理的默认值", () => {
    const plugin = new TestPlugin();

    expect(plugin.name).toBe("test-plugin");
    expect(plugin.version).toBe("2.0.0");
    expect(plugin.description).toBe("A test plugin");
    expect(plugin.dependencies).toEqual([]);
    expect(plugin.tags).toEqual(["test", "example"]);
    expect(plugin.hooks).toEqual({});
  });

  it("默认 status 应为 created", () => {
    const plugin = new TestPlugin();
    const s = plugin.status;

    expect(s.name).toBe("test-plugin");
    expect(s.phase).toBe("created");
    expect(s.executionCount).toBe(0);
    expect(s.failureCount).toBe(0);
    expect(s.healthy).toBe(true);
  });

  // ── init() ──

  it("init() 应返回 Promise<void>（不抛出）", async () => {
    const plugin = new TestPlugin();
    const result = plugin.init({ enabled: true });

    // 确保返回的是 Promise（thenable）
    expect(result).toBeInstanceOf(Promise);
    // 确保 resolve 后值为 undefined
    await expect(result).resolves.toBeUndefined();
  });

  it("init() 调用后 status.phase 应为 initialized", async () => {
    const plugin = new TestPlugin();
    await plugin.init({ enabled: true });
    expect(plugin.status.phase).toBe("initialized");
    expect(plugin.status.healthy).toBe(true);
  });

  it("init() 可被多次安全调用", async () => {
    const plugin = new TestPlugin();
    await plugin.init({ enabled: true });
    await plugin.init({ enabled: false });
    expect(plugin.status.phase).toBe("initialized");
  });

  // ── execute() ──

  it("execute() 应返回 Promise<void>（不抛出）", async () => {
    const plugin = new TestPlugin();
    const ctx: ExecuteContext = {
      payload: null,
      deps: new Map(),
      workDir: "/tmp",
    };
    const result = plugin.execute(ctx);

    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeUndefined();
  });

  it("execute() 应通过 ctx.output 传递执行结果", async () => {
    const plugin = new TestPlugin();
    const ctx: ExecuteContext = {
      payload: { foo: "bar" },
      deps: new Map(),
      workDir: "/tmp",
    };
    await plugin.execute(ctx);
    expect(ctx.output).toEqual({ received: { foo: "bar" } });
  });

  it("execute() payload 为 null 时不应崩溃", async () => {
    const plugin = new TestPlugin();
    const ctx: ExecuteContext = {
      payload: null,
      deps: new Map(),
      workDir: "/tmp",
    };
    await expect(plugin.execute(ctx)).resolves.toBeUndefined();
    expect(ctx.output).toEqual({ received: null });
  });

  it("execute() 应处理空 deps Map", async () => {
    const plugin = new TestPlugin();
    const ctx: ExecuteContext = {
      payload: "ping",
      deps: new Map(),
      workDir: "/tmp",
    };
    await plugin.execute(ctx);
    expect(ctx.output).toEqual({ received: "ping" });
  });

  // ── destroy() ──

  it("destroy() 应返回 Promise<void>（不抛出）", async () => {
    const plugin = new TestPlugin();

    const result = plugin.destroy();
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeUndefined();
  });

  it("destroy() 调用后 status.phase 应为 destroyed", async () => {
    const plugin = new TestPlugin();
    await plugin.destroy();
    expect(plugin.status.phase).toBe("destroyed");
    expect(plugin.status.healthy).toBe(true);
  });

  it("destroy() 在未 init 状态下调用仍应正常完成", async () => {
    const plugin = new TestPlugin();
    await expect(plugin.destroy()).resolves.toBeUndefined();
    expect(plugin.status.phase).toBe("destroyed");
  });

  it("destroy() 可被多次安全调用（幂等）", async () => {
    const plugin = new TestPlugin();
    await plugin.destroy();
    await plugin.destroy();
    expect(plugin.status.phase).toBe("destroyed");
  });

  // ── 完整生命周期 ──

  it("应支持完整的 init → execute → destroy 生命周期", async () => {
    const plugin = new TestPlugin();

    // init
    await plugin.init({ enabled: true });
    expect(plugin.status.phase).toBe("initialized");

    // execute
    const ctx: ExecuteContext = {
      payload: { task: "demo" },
      deps: new Map(),
      workDir: "/tmp",
    };
    await plugin.execute(ctx);
    expect(ctx.output).toEqual({ received: { task: "demo" } });

    // destroy
    await plugin.destroy();
    expect(plugin.status.phase).toBe("destroyed");
  });

  // ── MinimalPlugin（只有 name + execute） ──

  it("最小化插件也应完整走通生命周期", async () => {
    const p = new MinimalPlugin();
    expect(p.name).toBe("minimal");

    await p.init({ enabled: true });
    expect(p.status.phase).toBe("initialized");

    const ctx: ExecuteContext = { payload: "x", deps: new Map(), workDir: "/tmp" };
    await p.execute(ctx);
    expect(p.status.phase).toBe("initialized"); // execute 不改 phase

    await p.destroy();
    expect(p.status.phase).toBe("destroyed");
  });
});

// ── isPlugin 类型守卫 ──

describe("isPlugin() — plugin.ts", () => {
  it("应正确识别符合 Plugin 接口的对象", () => {
    expect(isPlugin(new TestPlugin())).toBe(true);
    expect(isPlugin(new MinimalPlugin())).toBe(true);
  });

  it("null / undefined 应返回 false", () => {
    expect(isPlugin(null)).toBe(false);
    expect(isPlugin(undefined)).toBe(false);
  });

  it("非对象应返回 false", () => {
    expect(isPlugin(42)).toBe(false);
    expect(isPlugin("string")).toBe(false);
    expect(isPlugin(true)).toBe(false);
  });

  it("缺少 name/version/init/execute/destroy 应返回 false", () => {
    expect(isPlugin({ name: "foo" })).toBe(false);
    expect(isPlugin({ name: "foo", version: "1.0" })).toBe(false);
    expect(
      isPlugin({
        name: "foo",
        version: "1.0",
        init: () => {},
        execute: () => {},
      }),
    ).toBe(false); // 缺少 destroy
  });

  it("方法不是 function 时不应误判", () => {
    const fake = {
      name: "foo",
      version: "1.0",
      init: "not-a-function",
      execute: () => {},
      destroy: () => {},
    };
    expect(isPlugin(fake)).toBe(false);
  });
});
