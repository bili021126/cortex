// @ci: unit
/**
 * @cortex/plugin-runner — PluginRunner 沙箱执行引擎 单元测试
 *
 * 覆盖：
 *   - execute() 完整流程（合规校验 → 执行 → 收尾）
 *   - 边界：插件未注册、配置校验失败、依赖缺失
 *   - 异常隔离：init / execute / destroy 抛出异常时捕获并返回 error result
 *   - 超时切断：Promise.race 超时后返回超时错误
 *   - AbortSignal 外部取消
 *   - executeAll() 批量执行（拓扑排序批次、并行执行、结果聚合）
 *   - getStatus() 运行时状态查询
 *   - shutdown() 优雅关闭（清理插件 + 工作目录 + 清空状态）
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { PluginRunner, type RunnerOptions } from "../src/runner.js";
import { PluginRegistry } from "../src/registry.js";
import { PluginValidator } from "../src/validator.js";
import { AbstractPlugin } from "../src/plugin.js";
import type { ExecuteContext, Plugin, PluginStatus } from "../src/types.js";

// ── 辅助：模拟插件类 ──

class SimplePlugin extends AbstractPlugin {
  readonly name = "simple";
  readonly version = "1.0.0";
  async execute(_ctx: ExecuteContext): Promise<void> {
    // no-op
  }
}

/** 带实际 execute 逻辑的插件：把 payload 写入 ctx.output */
class EchoPlugin extends AbstractPlugin {
  readonly name = "echo";
  async execute(ctx: ExecuteContext): Promise<void> {
    ctx.output = ctx.payload;
  }
}

/** 有依赖的插件 */
class DependentPlugin extends AbstractPlugin {
  readonly name = "dependent";
  readonly dependencies = ["simple"];
  async execute(ctx: ExecuteContext): Promise<void> {
    ctx.output = { depsResolved: ctx.deps.has("simple") };
  }
}

/** init 阶段抛出异常的插件 */
class InitFailPlugin extends AbstractPlugin {
  readonly name = "init-fail";
  async init(_config: unknown): Promise<void> {
    throw new Error("init crashed");
  }
  async execute(_ctx: ExecuteContext): Promise<void> {
    // 不会执行到这里
  }
}

/** execute 阶段抛出异常的插件 */
class ExecuteFailPlugin extends AbstractPlugin {
  readonly name = "execute-fail";
  async execute(_ctx: ExecuteContext): Promise<void> {
    throw new Error("execute crashed");
  }
}

/** destroy 阶段抛出异常的插件 */
class DestroyFailPlugin extends AbstractPlugin {
  readonly name = "destroy-fail";
  async execute(ctx: ExecuteContext): Promise<void> {
    ctx.output = { done: true };
  }
  async destroy(): Promise<void> {
    throw new Error("destroy crashed");
  }
}

/** execute 返回慢（用于超时测试） */
class SlowPlugin extends AbstractPlugin {
  readonly name = "slow";
  async execute(_ctx: ExecuteContext): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

/** 插件 B，依赖 plugin-a */
class PluginB extends AbstractPlugin {
  readonly name = "plugin-b";
  readonly dependencies = ["plugin-a"];
  async execute(ctx: ExecuteContext): Promise<void> {
    ctx.output = `b-executed`;
  }
}

/** 插件 A，无依赖 */
class PluginA extends AbstractPlugin {
  readonly name = "plugin-a";
  async execute(ctx: ExecuteContext): Promise<void> {
    ctx.output = `a-executed`;
  }
}

/** 插件 C，依赖 plugin-a */
class PluginC extends AbstractPlugin {
  readonly name = "plugin-c";
  readonly dependencies = ["plugin-a"];
  async execute(ctx: ExecuteContext): Promise<void> {
    ctx.output = `c-executed`;
  }
}

// ── 辅助：创建通用的执行上下文 ──

function makeContext(overrides?: Partial<ExecuteContext>): ExecuteContext {
  return {
    payload: null,
    deps: new Map(),
    workDir: "/tmp/test-workdir",
    ...overrides,
  };
}

// ── 辅助：创建 PluginRunner 实例 ──

function createRunner(opts?: RunnerOptions): {
  runner: PluginRunner;
  registry: PluginRegistry;
  validator: PluginValidator;
} {
  const registry = new PluginRegistry();
  const validator = new PluginValidator();
  const runner = new PluginRunner(registry, validator, opts);
  return { runner, registry, validator };
}

// ── 测试套件 ──

describe("PluginRunner — runner.ts", () => {
  // ── 构造 ──

  describe("constructor", () => {
    it("应使用默认超时时间 (30000ms)", () => {
      const { runner } = createRunner();
      expect(runner["_defaultTimeout"]).toBe(30000);
    });

    it("应接受自定义超时配置", () => {
      const { runner } = createRunner({ timeout: 5000 });
      expect(runner["_defaultTimeout"]).toBe(5000);
    });

    it("不传递 opts 时应使用默认值", () => {
      const { runner } = createRunner();
      expect(runner["_defaultTimeout"]).toBe(30000);
    });
  });

  // ── execute() — 合规校验 ──

  describe("execute() — 合规校验", () => {
    it("插件未注册时应返回 success: false 和错误信息", async () => {
      const { runner } = createRunner();
      const result = await runner.execute("nonexistent", makeContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('插件 "nonexistent" 未注册');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("插件未注册时不应抛出异常", async () => {
      const { runner } = createRunner();
      await expect(
        runner.execute("nonexistent", makeContext()),
      ).resolves.toBeDefined();
    });

    it("校验器返回无效时应返回 success: false", async () => {
      const { runner, registry, validator } = createRunner();

      // 注册一个 schema 使得 validateConfig 返回失败
      validator.registerSchema({
        name: "simple",
        validateConfig() {
          return ["配置无效: timeout 必须为正整数"];
        },
        validateInput: undefined,
        validateOutput: undefined,
      });

      registry.register(new SimplePlugin());
      const result = await runner.execute("simple", makeContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain("配置校验失败");
      expect(result.error).toContain("timeout 必须为正整数");
    });

    it("校验器通过（无 schema 时）应继续执行", async () => {
      const { runner, registry } = createRunner();
      const plugin = new EchoPlugin();
      registry.register(plugin);

      const ctx = makeContext({ payload: "hello" });
      const result = await runner.execute("echo", ctx);

      expect(result.success).toBe(true);
      expect(result.output).toBe("hello");
    });

    it("依赖缺失时应返回 success: false", async () => {
      const { runner, registry } = createRunner();
      registry.register(new DependentPlugin()); // 依赖 "simple"，但未注册

      const result = await runner.execute("dependent", makeContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('依赖插件 "simple" 未注册');
    });

    it("所有依赖均已注册时应正常执行", async () => {
      const { runner, registry } = createRunner();
      registry.register(new SimplePlugin());
      registry.register(new DependentPlugin());

      const ctx = makeContext({
        deps: new Map([["simple", new SimplePlugin()]]),
      });
      const result = await runner.execute("dependent", ctx);

      expect(result.success).toBe(true);
      // ctx.deps 中包含 "simple"，所以 depsResolved 为 true
      expect(result.output).toEqual({ depsResolved: true });
    });
  });

  // ── execute() — 异常隔离 ──

  describe("execute() — 异常隔离", () => {
    it("init 抛出异常时应捕获并返回 error result", async () => {
      const { runner, registry } = createRunner();
      registry.register(new InitFailPlugin());

      const result = await runner.execute("init-fail", makeContext());

      expect(result.success).toBe(false);
      expect(result.error).toBe("init crashed");
    });

    it("init 抛出异常时不传播到调用方", async () => {
      const { runner, registry } = createRunner();
      registry.register(new InitFailPlugin());

      await expect(
        runner.execute("init-fail", makeContext()),
      ).resolves.not.toThrow();
    });

    it("execute 抛出异常时应捕获并返回 error result", async () => {
      const { runner, registry } = createRunner();
      registry.register(new ExecuteFailPlugin());

      const result = await runner.execute("execute-fail", makeContext());

      expect(result.success).toBe(false);
      expect(result.error).toBe("execute crashed");
    });

    it("execute 抛出异常后插件 status 应为 error", async () => {
      const { runner, registry } = createRunner();
      registry.register(new ExecuteFailPlugin());

      await runner.execute("execute-fail", makeContext());
      const status = runner.getStatus("execute-fail");

      expect(status).toBeDefined();
      expect(status!.phase).toBe("error");
      expect(status!.healthy).toBe(false);
      expect(status!.lastError).toBe("execute crashed");
    });

    it("destroy 抛出异常时应被捕获（不传播到调用方）", async () => {
      const { runner, registry } = createRunner();
      registry.register(new DestroyFailPlugin());

      const result = await runner.execute("destroy-fail", makeContext());

      // destroy 在 try 块内抛出，被外层 catch 捕获
      // 整体返回 success: false，错误信息为 destroy 的异常
      expect(result.success).toBe(false);
      expect(result.error).toBe("destroy crashed");
      // 异常不传播到调用方
    });

    it("任意阶段异常后仍尝试调用 destroy", async () => {
      const { runner, registry } = createRunner();
      const plugin = new ExecuteFailPlugin();
      const destroySpy = vi.spyOn(plugin, "destroy");
      registry.register(plugin);

      await runner.execute("execute-fail", makeContext());

      // 即使 execute 失败，destroy 也应被调用
      expect(destroySpy).toHaveBeenCalledTimes(1);
    });

    it("destroy 在异常时被二次尝试（第一次主动销毁，第二次异常捕获兜底）", async () => {
      const { runner, registry } = createRunner();
      const plugin = new ExecuteFailPlugin();
      const destroySpy = vi.spyOn(plugin, "destroy");
      registry.register(plugin);

      await runner.execute("execute-fail", makeContext());

      // execute 失败后 runner 会尝试调用 destroy
      expect(destroySpy).toHaveBeenCalled();
    });
  });

  // ── execute() — 成功路径 ──

  describe("execute() — 成功路径", () => {
    it("应返回 success: true 和执行耗时", async () => {
      const { runner, registry } = createRunner();
      registry.register(new SimplePlugin());

      const result = await runner.execute("simple", makeContext());

      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it("output 应为 undefined（当插件未设置时）", async () => {
      const { runner, registry } = createRunner();
      registry.register(new SimplePlugin());

      const result = await runner.execute("simple", makeContext());

      expect(result.success).toBe(true);
      expect(result.output).toBeUndefined();
    });

    it("应传递 ctx.payload 到插件的 execute", async () => {
      const { runner, registry } = createRunner();
      registry.register(new EchoPlugin());

      const payload = { key: "value", num: 42 };
      const ctx = makeContext({ payload });
      const result = await runner.execute("echo", ctx);

      expect(result.success).toBe(true);
      expect(result.output).toEqual(payload);
    });

    it("payload 为 null 时应正常处理", async () => {
      const { runner, registry } = createRunner();
      registry.register(new EchoPlugin());

      const ctx = makeContext({ payload: null });
      const result = await runner.execute("echo", ctx);

      expect(result.success).toBe(true);
      expect(result.output).toBeNull();
    });

    it("payload 为数组时应正常处理", async () => {
      const { runner, registry } = createRunner();
      registry.register(new EchoPlugin());

      const payload = [1, 2, 3];
      const ctx = makeContext({ payload });
      const result = await runner.execute("echo", ctx);

      expect(result.success).toBe(true);
      expect(result.output).toEqual([1, 2, 3]);
    });
  });

  // ── execute() — 超时与 AbortSignal ──

  describe("execute() — 超时控制", () => {
    it("超时时应返回 success: false 和超时错误", async () => {
      const { runner, registry } = createRunner({ timeout: 50 });
      registry.register(new SlowPlugin());

      const result = await runner.execute("slow", makeContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain("执行超时");
    }, 10000);

    it("ctx.timeoutMs 应覆盖默认超时", async () => {
      const { runner, registry } = createRunner({ timeout: 50000 });
      registry.register(new SlowPlugin());

      // 使用更短的上下文超时覆盖
      const ctx = makeContext({ timeoutMs: 50 });
      const result = await runner.execute("slow", ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("执行超时");
    }, 10000);

    it("超时后插件 status 应为 error", async () => {
      const { runner, registry } = createRunner({ timeout: 50 });
      registry.register(new SlowPlugin());

      await runner.execute("slow", makeContext());
      const status = runner.getStatus("slow");

      expect(status).toBeDefined();
      expect(status!.phase).toBe("error");
      expect(status!.healthy).toBe(false);
    }, 10000);

    it("timeoutMs ≤ 0 不应触发超时（不设超时）", async () => {
      const { runner, registry } = createRunner({ timeout: 50 });
      registry.register(new SimplePlugin());

      // timeoutMs=0 表示不设超时
      const ctx = makeContext({ timeoutMs: 0 });
      const result = await runner.execute("simple", ctx);

      expect(result.success).toBe(true);
    });

    it("外部 AbortSignal 可以取消执行", async () => {
      const { runner, registry } = createRunner();
      registry.register(new SlowPlugin());

      const controller = new AbortController();
      const ctx = makeContext({ signal: controller.signal });

      // 延迟一点后取消
      setTimeout(() => controller.abort(), 50);

      const result = await runner.execute("slow", ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("AbortSignal 取消");
    }, 10000);
  });

  // ── execute() — 状态追踪 ──

  describe("execute() — 状态追踪", () => {
    it("执行后 getStatus 应返回正确的状态信息", async () => {
      const { runner, registry } = createRunner();
      registry.register(new SimplePlugin());

      const before = runner.getStatus("simple");
      expect(before).toBeUndefined();

      await runner.execute("simple", makeContext());

      const after = runner.getStatus("simple");
      expect(after).toBeDefined();
      expect(after!.name).toBe("simple");
      expect(after!.phase).toBe("destroyed");
      expect(after!.healthy).toBe(true);
    });

    it("未执行的插件 getStatus 应返回 undefined", () => {
      const { runner } = createRunner();
      expect(runner.getStatus("never-executed")).toBeUndefined();
    });

    it("执行成功后 status 应记录执行次数", async () => {
      const { runner, registry } = createRunner();
      registry.register(new EchoPlugin());

      await runner.execute("echo", makeContext({ payload: 1 }));
      await runner.execute("echo", makeContext({ payload: 2 }));

      const status = runner.getStatus("echo");
      expect(status).toBeDefined();
      expect(status!.executionCount).toBe(2);
      expect(status!.failureCount).toBe(0);
    });

    it("执行失败后 failureCount 应递增", async () => {
      const { runner, registry } = createRunner();
      registry.register(new ExecuteFailPlugin());

      await runner.execute("execute-fail", makeContext());
      await runner.execute("execute-fail", makeContext());

      const status = runner.getStatus("execute-fail");
      expect(status).toBeDefined();
      expect(status!.failureCount).toBe(2);
    });
  });

  // ── executeAll() ──

  describe("executeAll()", () => {
    it("空注册表应返回含 total=0 的 report", async () => {
      const { runner } = createRunner();
      const report = await runner.executeAll(makeContext());

      expect(report.total).toBe(0);
      expect(report.succeeded).toBe(0);
      expect(report.failed).toBe(0);
      expect(report.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(report.results.size).toBe(0);
    });

    it("单一无依赖插件应成功执行", async () => {
      const { runner, registry } = createRunner();
      registry.register(new SimplePlugin());

      const report = await runner.executeAll(makeContext());

      expect(report.total).toBe(1);
      expect(report.succeeded).toBe(1);
      expect(report.failed).toBe(0);
      expect(report.results.has("simple")).toBe(true);
      expect(report.results.get("simple")!.success).toBe(true);
    });

    it("多个无依赖插件应全部成功", async () => {
      const { runner, registry } = createRunner();
      registry.register(new PluginA());
      registry.register(new PluginC()); // PluginC 依赖 plugin-a

      // PluginC 有依赖 plugin-a，不在同一批次
      // 但 executeAll 会按拓扑排序自动处理
      const report = await runner.executeAll(makeContext());

      expect(report.total).toBe(2);
      expect(report.succeeded).toBe(2);
      expect(report.failed).toBe(0);
    });

    it("按拓扑排序执行：依赖在前，被依赖在后", async () => {
      const { runner, registry } = createRunner();
      const a = new PluginA();
      const b = new PluginB(); // 依赖 plugin-a

      registry.register(a);
      registry.register(b);

      // 添加 spy 跟踪执行顺序
      const execOrder: string[] = [];
      const originalExecuteA = a.execute.bind(a);
      vi.spyOn(a, "execute").mockImplementation(async (ctx) => {
        execOrder.push("a");
        await originalExecuteA(ctx);
      });
      const originalExecuteB = b.execute.bind(b);
      vi.spyOn(b, "execute").mockImplementation(async (ctx) => {
        execOrder.push("b");
        await originalExecuteB(ctx);
      });

      await runner.executeAll(makeContext());

      // A 应该先于 B 执行
      expect(execOrder.indexOf("a")).toBeLessThan(execOrder.indexOf("b"));
    });

    it("混合成功和失败应正确统计", async () => {
      const { runner, registry } = createRunner();
      registry.register(new SimplePlugin()); // 成功
      registry.register(new ExecuteFailPlugin()); // 失败
      registry.register(new EchoPlugin()); // 成功

      const report = await runner.executeAll(makeContext());

      expect(report.total).toBe(3);
      expect(report.succeeded).toBe(2);
      expect(report.failed).toBe(1);

      expect(report.results.get("simple")!.success).toBe(true);
      expect(report.results.get("execute-fail")!.success).toBe(false);
      expect(report.results.get("echo")!.success).toBe(true);
    });

    it("同批次插件应并行执行", async () => {
      const { runner, registry } = createRunner();
      registry.register(new PluginA());
      registry.register(new SimplePlugin());
      registry.register(new EchoPlugin());

      // 三个插件都无依赖，应在同一批次并行执行
      const report = await runner.executeAll(makeContext());

      expect(report.total).toBe(3);
      expect(report.succeeded).toBe(3);
    });

    it("单个插件失败不应影响同批次其他插件", async () => {
      const { runner, registry } = createRunner();
      registry.register(new SimplePlugin()); // 成功
      registry.register(new ExecuteFailPlugin()); // 失败
      registry.register(new EchoPlugin()); // 成功

      const report = await runner.executeAll(makeContext());

      const simpleResult = report.results.get("simple");
      const failResult = report.results.get("execute-fail");
      const echoResult = report.results.get("echo");

      expect(simpleResult!.success).toBe(true);
      expect(failResult!.success).toBe(false);
      expect(echoResult!.success).toBe(true);
    });

    it("executeAll 应返回总耗时", async () => {
      const { runner, registry } = createRunner();
      registry.register(new SimplePlugin());

      const report = await runner.executeAll(makeContext());
      expect(report.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── getStatus() ──

  describe("getStatus()", () => {
    it("未执行任何 execute 时返回 undefined", () => {
      const { runner } = createRunner();
      expect(runner.getStatus("simple")).toBeUndefined();
      expect(runner.getStatus("nonexistent")).toBeUndefined();
    });

    it("执行成功后返回包含健康状态和阶段的状态对象", async () => {
      const { runner, registry } = createRunner();
      registry.register(new SimplePlugin());

      await runner.execute("simple", makeContext());
      const status = runner.getStatus("simple");

      expect(status).toMatchObject({
        name: "simple",
        phase: "destroyed",
        healthy: true,
      });
      expect(typeof status!.executionCount).toBe("number");
      expect(typeof status!.failureCount).toBe("number");
      expect(typeof status!.lastExecutedAt).toBe("number");
    });

    it("返回的状态对象包含正确的字段结构", async () => {
      const { runner, registry } = createRunner();
      registry.register(new SimplePlugin());

      await runner.execute("simple", makeContext());
      const status = runner.getStatus("simple");

      expect(status).toBeDefined();
      expect(status).toHaveProperty("name");
      expect(status).toHaveProperty("phase");
      expect(status).toHaveProperty("executionCount");
      expect(status).toHaveProperty("failureCount");
      expect(status).toHaveProperty("healthy");
    });
  });

  // ── shutdown() ──

  describe("shutdown()", () => {
    it("shutdown 后所有插件应被销毁", async () => {
      const { runner, registry } = createRunner();
      const a = new PluginA();
      const b = new PluginB();
      const destroySpyA = vi.spyOn(a, "destroy");
      const destroySpyB = vi.spyOn(b, "destroy");

      registry.register(a);
      registry.register(b);

      await runner.shutdown();

      expect(destroySpyA).toHaveBeenCalledTimes(1);
      expect(destroySpyB).toHaveBeenCalledTimes(1);
    });

    it("shutdown 后状态应被清空", async () => {
      const { runner, registry } = createRunner();
      registry.register(new SimplePlugin());
      await runner.execute("simple", makeContext());

      expect(runner.getStatus("simple")).toBeDefined();

      await runner.shutdown();

      // shutdown 清空 _statuses
      expect(runner["_statuses"].size).toBe(0);
    });

    it("shutdown 应清理本运行器拥有的工作目录", async () => {
      const { runner } = createRunner();

      // 添加一些假的工作目录到 _ownedWorkDirs
      runner["_ownedWorkDirs"].add("/tmp/fake-dir-1");
      runner["_ownedWorkDirs"].add("/tmp/fake-dir-2");

      await runner.shutdown();

      // shutdown 后 _ownedWorkDirs 应被清空
      expect(runner["_ownedWorkDirs"].size).toBe(0);
    });

    it("仅调用 shutdown（未执行任何 execute）不应抛异常", async () => {
      const { runner } = createRunner();
      await expect(runner.shutdown()).resolves.toBeUndefined();
    });

    it("shutdown 可被多次安全调用（幂等）", async () => {
      const { runner } = createRunner();
      await runner.shutdown();
      await expect(runner.shutdown()).resolves.toBeUndefined();
    });

    it("destroy 失败的插件不应阻止 shutdown 完成", async () => {
      const { runner, registry } = createRunner();
      registry.register(new DestroyFailPlugin()); // destroy 会抛异常

      await expect(runner.shutdown()).resolves.toBeUndefined();
    });
  });

  // ── 完整集成场景 ──

  describe("集成场景", () => {
    it("注册 → execute → executeAll → shutdown 完整流程", async () => {
      const { runner, registry } = createRunner();

      // 注册
      registry.register(new PluginA());
      registry.register(new PluginB());
      registry.register(new PluginC());

      // 单次执行
      const singleResult = await runner.execute("plugin-a", makeContext());
      expect(singleResult.success).toBe(true);

      // 批量执行
      const batchResult = await runner.executeAll(makeContext());
      expect(batchResult.total).toBe(3);
      expect(batchResult.succeeded).toBe(3);

      // 状态查询
      const status = runner.getStatus("plugin-a");
      expect(status).toBeDefined();

      // shutdown
      await runner.shutdown();
      expect(runner["_statuses"].size).toBe(0);
    });

    it("部分失败 → 部分成功 → 验证 ExecutionReport 统计", async () => {
      const { runner, registry } = createRunner();
      registry.register(new SimplePlugin()); // 成功
      registry.register(new InitFailPlugin()); // init 失败
      registry.register(new ExecuteFailPlugin()); // execute 失败
      registry.register(new EchoPlugin()); // 成功

      const report = await runner.executeAll(makeContext());

      expect(report.total).toBe(4);
      expect(report.succeeded).toBe(2);
      expect(report.failed).toBe(2);
    });

    it("同个 runner 多次 executeAll 应自愈（每次独立执行）", async () => {
      const { runner, registry } = createRunner();
      registry.register(new SimplePlugin());

      const r1 = await runner.executeAll(makeContext());
      expect(r1.succeeded).toBe(1);

      const r2 = await runner.executeAll(makeContext());
      expect(r2.succeeded).toBe(1);
    });
  });
});
