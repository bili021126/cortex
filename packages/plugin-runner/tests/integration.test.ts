// @ci: unit
/**
 * @cortex/plugin-runner — 集成测试：全链路验证
 *
 * 覆盖完整管道：注册（Registry）→ 校验（Validator）→ 执行（Runner init+execute）→ 销毁（destroy）
 *
 * 测试范围：
 *   1. 全链路快乐路径（单个插件：注册 → 校验 → init → execute → destroy）
 *   2. Schema 配置校验联动（validateConfig 拒绝 → 管道提前中断）
 *   3. 依赖解析 + 拓扑排序 + executeAll 批量执行（注册 → 依赖校验 → 按序执行 → 销毁）
 *   4. 异常隔离 + 资源清理（execute 抛出 → destroy 仍被调用）
 *   5. 多次执行 + 状态追踪
 *   6. shutdown 全局清理
 *   7. config.ts（PluginConfigManager）与 registry/runner 配合使用
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { PluginRegistry } from "../src/registry.js";
import { PluginValidator } from "../src/validator.js";
import { PluginRunner } from "../src/runner.js";
import { AbstractPlugin } from "../src/plugin.js";
import { PluginConfigManager } from "../src/config.js";
import { definePluginSchema, s } from "../src/schema.js";
import type { ExecuteContext, PluginSchema, Plugin, PluginConfig } from "../src/types.js";

// ═══════════════════════════════════════════════════════════════════
// 辅助：模拟插件
// ═══════════════════════════════════════════════════════════════════

/**
 * GreeterPlugin —— 接收 name 并返回问候语。
 */
class GreeterPlugin extends AbstractPlugin {
  readonly name = "greeter";
  readonly version = "1.0.0";
  readonly description = "返回问候语";
  readonly tags = ["demo", "string"];

  /** 记录生命周期调用顺序（用于验证） */
  callOrder: string[] = [];

  async init(_config: PluginConfig): Promise<void> {
    this.callOrder.push("init");
    await super.init(_config);
  }

  async execute(ctx: ExecuteContext): Promise<void> {
    this.callOrder.push("execute");
    const name = (ctx.payload as { name?: string })?.name ?? "World";
    ctx.output = { greeting: `Hello, ${name}!` };
  }

  async destroy(): Promise<void> {
    this.callOrder.push("destroy");
    await super.destroy();
  }
}

/**
 * CalculatorPlugin —— 执行数字运算，依赖 greeter（仅演示依赖，实际不调用）。
 */
class CalculatorPlugin extends AbstractPlugin {
  readonly name = "calculator";
  readonly version = "2.0.0";
  readonly description = "执行数字加法";
  readonly dependencies = ["greeter"];
  readonly tags = ["math"];

  callOrder: string[] = [];

  async init(_config: PluginConfig): Promise<void> {
    this.callOrder.push("init");
    await super.init(_config);
  }

  async execute(ctx: ExecuteContext): Promise<void> {
    this.callOrder.push("execute");
    const { a = 0, b = 0 } = (ctx.payload as { a?: number; b?: number }) ?? {};
    ctx.output = { sum: a + b };
  }

  async destroy(): Promise<void> {
    this.callOrder.push("destroy");
    await super.destroy();
  }
}

/**
 * FailOnExecutePlugin —— execute 阶段抛异常，用于验证异常隔离和资源清理。
 */
class FailOnExecutePlugin extends AbstractPlugin {
  readonly name = "fail-execute";
  readonly version = "1.0.0";

  callOrder: string[] = [];

  async init(_config: PluginConfig): Promise<void> {
    this.callOrder.push("init");
    await super.init(_config);
  }

  async execute(_ctx: ExecuteContext): Promise<void> {
    this.callOrder.push("execute");
    throw new Error("execute 阶段发生了预期错误");
  }

  async destroy(): Promise<void> {
    this.callOrder.push("destroy");
    await super.destroy();
  }
}

/**
 * FailOnInitPlugin —— init 阶段抛异常。
 */
class FailOnInitPlugin extends AbstractPlugin {
  readonly name = "fail-init";
  readonly version = "1.0.0";

  callOrder: string[] = [];

  async init(_config: PluginConfig): Promise<void> {
    this.callOrder.push("init");
    throw new Error("init 阶段发生了预期错误");
  }

  async execute(_ctx: ExecuteContext): Promise<void> {
    this.callOrder.push("execute");
  }

  async destroy(): Promise<void> {
    this.callOrder.push("destroy");
    await super.destroy();
  }
}

/**
 * NoopPlugin —— 最小化无操作插件。
 */
class NoopPlugin extends AbstractPlugin {
  readonly name = "noop";
  readonly version = "0.0.1";
  async execute(_ctx: ExecuteContext): Promise<void> {
    // noop
  }
}

/**
 * 自定义配置插件的插件（验证 schema 配置校验联动）。
 */
class ConfigCheckedPlugin extends AbstractPlugin {
  readonly name = "config-checked";
  readonly version = "1.0.0";
  readonly description = "需要 apiKey 配置";

  async execute(ctx: ExecuteContext): Promise<void> {
    ctx.output = { ok: true };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 辅助：工厂函数
// ═══════════════════════════════════════════════════════════════════

interface TestHarness {
  registry: PluginRegistry;
  validator: PluginValidator;
  runner: PluginRunner;
}

function createHarness(timeout = 30_000): TestHarness {
  const registry = new PluginRegistry();
  const validator = new PluginValidator();
  const runner = new PluginRunner(registry, validator, { timeout });
  return { registry, validator, runner };
}

function makeContext(overrides?: Partial<ExecuteContext>): ExecuteContext {
  return {
    payload: null,
    deps: new Map(),
    workDir: "/tmp/integration-test",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════════

describe("全链路集成测试", () => {
  let harness: TestHarness;
  let greeter: GreeterPlugin;
  let calc: CalculatorPlugin;

  beforeEach(() => {
    harness = createHarness();
    greeter = new GreeterPlugin();
    calc = new CalculatorPlugin();
  });

  afterEach(async () => {
    await harness.runner.shutdown();
    harness.registry.clear();
  });

  // ────────────────────────────────────────────────────────────────
  // 1. 快乐路径：注册 → 校验 → 执行 → 销毁
  // ────────────────────────────────────────────────────────────────

  describe("1. 快乐路径（单插件全链路）", () => {
    it("应完成 注册 → 合规校验 → init → execute → destroy 完整流程", async () => {
      const { registry, runner } = harness;

      // ① 注册
      registry.register(greeter);

      // ② 执行（内含：合规校验 → init → execute → destroy）
      const ctx = makeContext({ payload: { name: "Cortex" } });
      const result = await runner.execute("greeter", ctx);

      // ③ 验证结果
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ greeting: "Hello, Cortex!" });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      // ④ 验证生命周期调用顺序
      expect(greeter.callOrder).toEqual(["init", "execute", "destroy"]);
    });

    it("销毁后 status.phase 应为 destroyed", async () => {
      const { registry, runner } = harness;
      registry.register(greeter);

      await runner.execute("greeter", makeContext());
      const status = runner.getStatus("greeter");

      expect(status).toBeDefined();
      expect(status!.phase).toBe("destroyed");
      expect(status!.healthy).toBe(true);
      expect(status!.executionCount).toBe(1);
      expect(status!.failureCount).toBe(0);
    });

    it("init 只被调用一次，execute/destroy 各一次", async () => {
      const { registry, runner } = harness;
      registry.register(greeter);

      await runner.execute("greeter", makeContext());

      expect(greeter.callOrder.filter((c) => c === "init")).toHaveLength(1);
      expect(greeter.callOrder.filter((c) => c === "execute")).toHaveLength(1);
      expect(greeter.callOrder.filter((c) => c === "destroy")).toHaveLength(1);
    });

    it("多次执行同一插件应每次走完整生命周期", async () => {
      const { registry, runner } = harness;
      registry.register(greeter);

      const r1 = await runner.execute("greeter", makeContext({ payload: { name: "Alice" } }));
      expect(r1.success).toBe(true);
      expect(r1.output).toEqual({ greeting: "Hello, Alice!" });

      const r2 = await runner.execute("greeter", makeContext({ payload: { name: "Bob" } }));
      expect(r2.success).toBe(true);
      expect(r2.output).toEqual({ greeting: "Hello, Bob!" });

      const inits = greeter.callOrder.filter((c) => c === "init");
      const executes = greeter.callOrder.filter((c) => c === "execute");
      const destroys = greeter.callOrder.filter((c) => c === "destroy");

      expect(inits).toHaveLength(2);
      expect(executes).toHaveLength(2);
      expect(destroys).toHaveLength(2);

      expect(greeter.callOrder).toEqual([
        "init", "execute", "destroy",
        "init", "execute", "destroy",
      ]);
    });

    it("执行完成后 status 应记录执行次数", async () => {
      const { registry, runner } = harness;
      registry.register(greeter);

      await runner.execute("greeter", makeContext());
      await runner.execute("greeter", makeContext());
      await runner.execute("greeter", makeContext());

      const status = runner.getStatus("greeter");
      expect(status!.executionCount).toBe(3);
      expect(status!.failureCount).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 2. Schema 配置校验联动
  // ────────────────────────────────────────────────────────────────

  describe("2. Schema 配置校验联动", () => {
    it("缺少必填配置时应被 schema 拦截，管道提前中断", async () => {
      const { registry, validator, runner } = harness;

      const StrictSchema = definePluginSchema("config-checked", {
        config: s.object({
          enabled: s.boolean().optional(),
          apiKey: s.string().nonEmpty(),
        }),
      });
      validator.registerSchema(StrictSchema);

      const plugin = new ConfigCheckedPlugin();
      registry.register(plugin);

      // 默认配置 { enabled: true } 缺少 apiKey，校验应失败
      const result = await runner.execute("config-checked", makeContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain("配置校验失败");
    });

    it("无 schema 时默认配置应通过校验", async () => {
      const { registry, runner } = harness;

      registry.register(new NoopPlugin());

      const result = await runner.execute("noop", makeContext());
      expect(result.success).toBe(true);
    });

    it("schema 注册后对同名插件的配置校验立即生效", async () => {
      const { registry, validator, runner } = harness;

      registry.register(new NoopPlugin());

      const r1 = await runner.execute("noop", makeContext());
      expect(r1.success).toBe(true);

      validator.registerSchema({
        name: "noop",
        validateConfig() {
          return ["故意失败"];
        },
      });

      const r2 = await runner.execute("noop", makeContext());
      expect(r2.success).toBe(false);
      expect(r2.error).toContain("配置校验失败");
    });

    it("schema 注销后配置校验不再拦截", async () => {
      const { registry, validator, runner } = harness;

      registry.register(new NoopPlugin());

      validator.registerSchema({
        name: "noop",
        validateConfig() {
          return ["blocked"];
        },
      });

      const r1 = await runner.execute("noop", makeContext());
      expect(r1.success).toBe(false);

      validator.unregisterSchema("noop");

      const r2 = await runner.execute("noop", makeContext());
      expect(r2.success).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 3. 依赖解析 + 拓扑排序 + executeAll 批量执行
  // ────────────────────────────────────────────────────────────────

  describe("3. 依赖解析与批量执行", () => {
    it("有依赖插件应通过 executeAll 按拓扑顺序执行", async () => {
      const { registry, runner } = harness;

      registry.register(greeter);
      registry.register(calc);

      // 验证拓扑排序
      const batches = registry.resolveDependencies();
      expect(batches.length).toBeGreaterThanOrEqual(2);
      expect(batches[0].map((p) => p.name)).toContain("greeter");
      expect(batches[batches.length - 1].map((p) => p.name)).toContain("calculator");

      // 使用全局执行顺序数组验证跨插件的先后顺序
      const executeOrder: string[] = [];
      const origGreeterExec = greeter.execute.bind(greeter);
      vi.spyOn(greeter, "execute").mockImplementation(async (ctx) => {
        executeOrder.push("greeter-execute");
        await origGreeterExec(ctx);
      });
      const origCalcExec = calc.execute.bind(calc);
      vi.spyOn(calc, "execute").mockImplementation(async (ctx) => {
        executeOrder.push("calc-execute");
        await origCalcExec(ctx);
      });

      const report = await runner.executeAll(makeContext());

      expect(report.total).toBe(2);
      expect(report.succeeded).toBe(2);

      // greeter 的 execute 应先于 calculator 的 execute
      const greeterPos = executeOrder.indexOf("greeter-execute");
      const calcPos = executeOrder.indexOf("calc-execute");
      expect(greeterPos).toBeLessThan(calcPos);
    });

    it("依赖缺失时应返回特定错误（生命周期不被触发）", async () => {
      const { registry, runner } = harness;

      registry.register(calc); // 依赖 greeter，但 greeter 未注册

      const result = await runner.execute("calculator", makeContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('依赖插件 "greeter" 未注册');

      // 验证生命周期未执行
      expect(calc.callOrder).toEqual([]);
    });

    it("executeAll 混合成功/失败应正确统计", async () => {
      const { registry, runner } = harness;

      registry.register(new NoopPlugin());
      registry.register(greeter);
      registry.register(new FailOnExecutePlugin());

      const report = await runner.executeAll(makeContext());

      expect(report.total).toBe(3);
      expect(report.succeeded).toBe(2);
      expect(report.failed).toBe(1);

      expect(report.results.get("noop")!.success).toBe(true);
      expect(report.results.get("greeter")!.success).toBe(true);
      expect(report.results.get("fail-execute")!.success).toBe(false);
    });

    it("executeAll 后每个失败的插件 destroy 仍被调用", async () => {
      const { registry, runner } = harness;

      const failPlugin = new FailOnExecutePlugin();
      registry.register(new NoopPlugin());
      registry.register(failPlugin);

      await runner.executeAll(makeContext());

      expect(failPlugin.callOrder).toContain("destroy");
      expect(failPlugin.callOrder).toEqual(["init", "execute", "destroy"]);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 4. 异常隔离 + 资源清理
  // ────────────────────────────────────────────────────────────────

  describe("4. 异常隔离与资源清理", () => {
    it("execute 抛异常时 destroy 仍被调用（资源不泄漏）", async () => {
      const { registry, runner } = harness;

      const failPlugin = new FailOnExecutePlugin();
      registry.register(failPlugin);

      await runner.execute("fail-execute", makeContext());

      expect(failPlugin.callOrder).toContain("destroy");
      expect(failPlugin.callOrder.indexOf("destroy")).toBeGreaterThan(
        failPlugin.callOrder.indexOf("execute"),
      );
    });

    it("init 抛异常时 execute 不被调用，destroy 被外层 catch 调用", async () => {
      const { registry, runner } = harness;

      const initFailPlugin = new FailOnInitPlugin();
      registry.register(initFailPlugin);

      const result = await runner.execute("fail-init", makeContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain("init 阶段发生了预期错误");

      expect(initFailPlugin.callOrder).toContain("init");
      expect(initFailPlugin.callOrder).toContain("destroy");
      expect(initFailPlugin.callOrder).not.toContain("execute");
    });

    it("一个插件的失败不应抛异常到调用方（异常隔离）", async () => {
      const { registry, runner } = harness;

      registry.register(new FailOnExecutePlugin());

      await expect(
        runner.execute("fail-execute", makeContext()),
      ).resolves.toBeDefined();
    });

    it("插件未注册时不应抛异常到调用方", async () => {
      const { runner } = harness;

      await expect(
        runner.execute("nonexistent", makeContext()),
      ).resolves.toBeDefined();

      const result = await runner.execute("nonexistent", makeContext());
      expect(result.success).toBe(false);
      expect(result.error).toContain('插件 "nonexistent" 未注册');
    });

    it("executeAll 中单插件失败不影响同批次其他插件", async () => {
      const { registry, runner } = harness;

      const noop = new NoopPlugin();
      const fail = new FailOnExecutePlugin();
      const greeter = new GreeterPlugin();

      registry.register(noop);
      registry.register(fail);
      registry.register(greeter);

      const report = await runner.executeAll(makeContext());

      expect(report.total).toBe(3);
      expect(report.succeeded).toBe(2);
      expect(report.failed).toBe(1);

      expect(report.results.get("noop")!.success).toBe(true);
      expect(report.results.get("greeter")!.success).toBe(true);
      expect(report.results.get("fail-execute")!.success).toBe(false);
    });

    it("shutdown 后执行的 execute 仍能正常完成", async () => {
      const { registry, runner } = harness;

      registry.register(greeter);
      await runner.shutdown();

      await runner.execute("greeter", makeContext({ payload: { name: "AfterShutdown" } }));

      const status = runner.getStatus("greeter");
      expect(status).toBeDefined();
      expect(status!.phase).toBe("destroyed");
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 5. 状态追踪
  // ────────────────────────────────────────────────────────────────

  describe("5. 状态追踪", () => {
    it("成功执行后 status 应反映正确的阶段和信息", async () => {
      const { registry, runner } = harness;
      registry.register(greeter);

      await runner.execute("greeter", makeContext({ payload: { name: "StatusTest" } }));

      const status = runner.getStatus("greeter");
      expect(status).toMatchObject({
        name: "greeter",
        phase: "destroyed",
        healthy: true,
        executionCount: 1,
        failureCount: 0,
      });
      expect(status!.lastExecutedAt).toBeGreaterThan(0);
    });

    it("失败执行后 status 应反映失败信息", async () => {
      const { registry, runner } = harness;
      registry.register(new FailOnExecutePlugin());

      await runner.execute("fail-execute", makeContext());

      const status = runner.getStatus("fail-execute");
      expect(status).toMatchObject({
        name: "fail-execute",
        phase: "error",
        healthy: false,
        failureCount: 1,
      });
      expect(status!.lastError).toContain("execute 阶段发生了预期错误");
    });

    it("多次执行后 status 应累计执行和失败次数", async () => {
      const { registry, runner } = harness;
      registry.register(greeter);
      registry.register(new FailOnExecutePlugin());

      await runner.execute("greeter", makeContext());
      await runner.execute("greeter", makeContext());
      await runner.execute("greeter", makeContext());

      await runner.execute("fail-execute", makeContext());
      await runner.execute("fail-execute", makeContext());

      const greeterStatus = runner.getStatus("greeter");
      expect(greeterStatus!.executionCount).toBe(3);
      expect(greeterStatus!.failureCount).toBe(0);

      const failStatus = runner.getStatus("fail-execute");
      expect(failStatus!.executionCount).toBe(2);
      expect(failStatus!.failureCount).toBe(2);
    });

    it("未执行的插件 getStatus 应返回 undefined", () => {
      const { runner } = harness;
      expect(runner.getStatus("never-executed")).toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 6. shutdown 全局清理
  // ────────────────────────────────────────────────────────────────

  describe("6. shutdown 全局清理", () => {
    it("shutdown 应导致所有已注册插件的 destroy 被调用", async () => {
      const { registry, runner } = harness;

      const plugin1 = new GreeterPlugin();
      const plugin2 = new CalculatorPlugin();
      const plugin3 = new NoopPlugin();

      const d1 = vi.spyOn(plugin1, "destroy");
      const d2 = vi.spyOn(plugin2, "destroy");
      const d3 = vi.spyOn(plugin3, "destroy");

      registry.register(plugin1);
      registry.register(plugin2);
      registry.register(plugin3);

      await runner.shutdown();

      expect(d1).toHaveBeenCalled();
      expect(d2).toHaveBeenCalled();
      expect(d3).toHaveBeenCalled();
    });

    it("shutdown 应清空运行时状态（_statuses）", async () => {
      const { registry, runner } = harness;

      registry.register(greeter);
      await runner.execute("greeter", makeContext());

      expect(runner.getStatus("greeter")).toBeDefined();

      await runner.shutdown();

      expect(runner["_statuses"].size).toBe(0);
    });

    it("shutdown 可被多次安全调用", async () => {
      const { runner } = harness;
      await runner.shutdown();
      await expect(runner.shutdown()).resolves.toBeUndefined();
      await expect(runner.shutdown()).resolves.toBeUndefined();
    });

    it("shutdown 后 registry 仍可正常使用", async () => {
      const { registry, runner } = harness;

      registry.register(greeter);
      await runner.shutdown();

      expect(registry.has("greeter")).toBe(true);
      expect(registry.size).toBe(1);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 7. PluginConfigManager 与 registry/runner 配合
  // ────────────────────────────────────────────────────────────────

  describe("7. PluginConfigManager 与全链路集成", () => {
    it("PluginConfigManager 的配置应可注入到插件 init", async () => {
      const { registry, runner } = harness;

      const configMgr = PluginConfigManager.fromObject({
        defaults: {
          enabled: true,
          timeout: 15000,
        },
        plugins: {
          greeter: {
            greeting: "Hi",
            logLevel: "debug",
          },
        },
      });

      const greeterConfig = configMgr.getPluginConfig("greeter");
      expect(greeterConfig.enabled).toBe(true);
      expect(greeterConfig.timeout).toBe(15000);
      expect(greeterConfig.greeting).toBe("Hi");
      expect(greeterConfig.logLevel).toBe("debug");

      const plugin = new GreeterPlugin();
      await plugin.init(greeterConfig as PluginConfig);

      expect(plugin.status.phase).toBe("initialized");

      registry.register(plugin);
      const result = await runner.execute("greeter", makeContext({ payload: { name: "ConfigTest" } }));

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ greeting: "Hello, ConfigTest!" });

      await plugin.destroy();
    });

    it("环境变量占位符应在配置注入前被解析", async () => {
      process.env.INTEGRATION_TEST_API_KEY = "sk-test-12345";

      const configMgr = PluginConfigManager.fromObject({
        plugins: {
          greeter: {
            apiKey: "ENV:INTEGRATION_TEST_API_KEY",
          },
        },
      });

      const config = configMgr.getPluginConfig("greeter");

      expect(config.apiKey).toBe("sk-test-12345");

      delete process.env.INTEGRATION_TEST_API_KEY;
    });

    it("fromJson 工厂方法应与 runner 配合使用", async () => {
      const { registry, runner } = harness;

      const configMgr = PluginConfigManager.fromJson(JSON.stringify({
        defaults: { enabled: true },
        plugins: {
          greeter: { greeting: "Hey" },
        },
      }));

      const config = configMgr.getPluginConfig("greeter");
      expect(config.enabled).toBe(true);
      expect(config.greeting).toBe("Hey");

      const plugin = new GreeterPlugin();
      registry.register(plugin);

      const result = await runner.execute("greeter", makeContext({ payload: { name: "JsonTest" } }));
      expect(result.success).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 8. 完整端到端场景
  // ────────────────────────────────────────────────────────────────

  describe("8. 端到端场景", () => {
    it("注册 → 配置校验 → 依赖解析 → 批量执行 → 状态查询 → shutdown 全流程", async () => {
      const { registry, validator, runner } = harness;

      // ─── 阶段1: 注册 Schema ───
      validator.registerSchema(
        definePluginSchema("greeter", {
          config: s.object({
            enabled: s.boolean().optional(),
            greeting: s.string().optional(),
          }),
        }),
      );
      validator.registerSchema(
        definePluginSchema("calculator", {
          config: s.object({
            enabled: s.boolean().optional(),
            precision: s.number().min(0).max(10).optional(),
          }),
        }),
      );

      // ─── 阶段2: 注册插件 ───
      registry.register(greeter);
      registry.register(calc);

      expect(registry.size).toBe(2);
      expect(registry.hasCycle()).toBe(false);

      // ─── 阶段3: 依赖拓扑排序 ───
      const batches = registry.resolveDependencies();
      expect(batches.length).toBeGreaterThanOrEqual(2);
      expect(batches[0].map((p) => p.name)).toContain("greeter");
      expect(batches[batches.length - 1].map((p) => p.name)).toContain("calculator");

      // ─── 阶段4: 批量执行 ───
      const report = await runner.executeAll(makeContext({
        payload: { name: "E2E", a: 10, b: 20 },
      }));

      expect(report.total).toBe(2);
      expect(report.succeeded).toBe(2);
      expect(report.failed).toBe(0);

      // ─── 阶段5: 验证执行结果 ───
      const greeterResult = report.results.get("greeter");
      expect(greeterResult!.success).toBe(true);
      expect(greeterResult!.output).toEqual({ greeting: "Hello, E2E!" });

      const calcResult = report.results.get("calculator");
      expect(calcResult!.success).toBe(true);
      expect(calcResult!.output).toEqual({ sum: 30 });

      // ─── 阶段6: 状态查询 ───
      const greeterStatus = runner.getStatus("greeter");
      expect(greeterStatus!.phase).toBe("destroyed");
      expect(greeterStatus!.executionCount).toBe(1);

      const calcStatus = runner.getStatus("calculator");
      expect(calcStatus!.phase).toBe("destroyed");
      expect(calcStatus!.executionCount).toBe(1);

      // ─── 阶段7: shutdown 清理 ───
      await runner.shutdown();
      expect(runner["_statuses"].size).toBe(0);

      expect(registry.size).toBe(2);
    });

    it("全部失败场景：配置校验失败 + 配置校验失败 + execute 异常应各有适当错误", async () => {
      const { registry, validator, runner } = harness;

      // 让三个插件都以不同方式失败

      // 插件 A (greeter): schema 配置校验失败
      validator.registerSchema({
        name: "greeter",
        validateConfig() {
          return ["apiKey 为必填项"];
        },
      });
      registry.register(greeter);

      // 插件 B (calculator): 也通过 schema 配置校验让它失败
      // （依赖检查只看注册存在性，不影响执行）
      validator.registerSchema({
        name: "calculator",
        validateConfig() {
          return ["precision 必须为正整数"];
        },
      });
      registry.register(calc);

      // 插件 C: execute 异常
      registry.register(new FailOnExecutePlugin());

      const report = await runner.executeAll(makeContext());

      expect(report.total).toBe(3);
      expect(report.succeeded).toBe(0);
      expect(report.failed).toBe(3);

      const greeterResult = report.results.get("greeter");
      expect(greeterResult!.success).toBe(false);
      expect(greeterResult!.error).toContain("配置校验失败");

      const calcResult = report.results.get("calculator");
      expect(calcResult!.success).toBe(false);
      expect(calcResult!.error).toContain("配置校验失败");

      const failResult = report.results.get("fail-execute");
      expect(failResult!.success).toBe(false);
      expect(failResult!.error).toContain("execute 阶段发生了预期错误");
    });

    it("混合场景：部分插件配置校验拦截 + 部分正常执行", async () => {
      const { registry, validator, runner } = harness;

      validator.registerSchema({
        name: "greeter",
        validateConfig() {
          return ["禁止执行"];
        },
      });

      registry.register(greeter);
      registry.register(new NoopPlugin());
      registry.register(new FailOnExecutePlugin());

      const report = await runner.executeAll(makeContext());

      expect(report.total).toBe(3);
      expect(report.succeeded).toBe(1); // 只有 noop 成功
      expect(report.failed).toBe(2);

      expect(report.results.get("greeter")!.success).toBe(false);
      expect(report.results.get("greeter")!.error).toContain("配置校验失败");

      expect(report.results.get("noop")!.success).toBe(true);

      expect(report.results.get("fail-execute")!.success).toBe(false);
    });

    it("pipeline 中每个阶段应有正确的时序——init → execute → destroy", async () => {
      const { registry, runner } = harness;

      const timestamps: { phase: string; time: number }[] = [];

      class TimedPlugin extends AbstractPlugin {
        readonly name = "timed";
        async init(_config: PluginConfig): Promise<void> {
          timestamps.push({ phase: "init", time: Date.now() });
          await super.init(_config);
        }
        async execute(_ctx: ExecuteContext): Promise<void> {
          timestamps.push({ phase: "execute", time: Date.now() });
        }
        async destroy(): Promise<void> {
          timestamps.push({ phase: "destroy", time: Date.now() });
          await super.destroy();
        }
      }

      registry.register(new TimedPlugin());
      await runner.execute("timed", makeContext());

      expect(timestamps).toHaveLength(3);
      expect(timestamps[0].phase).toBe("init");
      expect(timestamps[1].phase).toBe("execute");
      expect(timestamps[2].phase).toBe("destroy");

      expect(timestamps[0].time).toBeLessThanOrEqual(timestamps[1].time);
      expect(timestamps[1].time).toBeLessThanOrEqual(timestamps[2].time);
    });
  });
});
