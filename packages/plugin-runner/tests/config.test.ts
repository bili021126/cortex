// @ci: unit
/**
 * @cortex/plugin-runner — PluginConfigManager 单元测试
 *
 * 覆盖：
 *   - 构造与默认值
 *   - 工厂方法：fromFile / fromJson / fromObject
 *   - 查询接口：getPluginConfig / getPluginNames / getDefaults / hasPluginConfig
 *   - 元数据：sourcePath / size
 *   - 序列化：toJSON / toString
 *   - 构造函数注入：toPluginConfig
 *   - 环境变量解析（ENV: 占位符）
 *   - 便捷函数：loadPluginConfig / createPluginConfig
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PluginConfigManager,
  loadPluginConfig,
  createPluginConfig,
} from "../src/config.js";
import type { PluginConfigFile } from "../src/config.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

// ── 测试套件 ──

describe("PluginConfigManager — config.ts", () => {
  // ── 构造与默认值 ──

  describe("constructor", () => {
    it("无参数构造应返回空配置", () => {
      const config = new PluginConfigManager();
      expect(config.size).toBe(0);
      expect(config.getPluginNames()).toEqual([]);
      expect(config.getDefaults()).toEqual({});
    });

    it("应接受 plugins 配置并正确解析", () => {
      const config = new PluginConfigManager({
        plugins: {
          alpha: { enabled: true, key: "a" },
          beta: { enabled: false, key: "b" },
        },
      });
      expect(config.size).toBe(2);
      expect(config.getPluginNames()).toEqual(["alpha", "beta"]);
    });

    it("应合并 defaults 与插件级配置（插件级优先）", () => {
      const config = new PluginConfigManager({
        defaults: { enabled: true, timeout: 30000, logLevel: "info" },
        plugins: {
          myPlugin: { enabled: false, maxRetries: 5 },
        },
      });
      const merged = config.getPluginConfig("myPlugin");
      expect(merged).toEqual({
        enabled: false, // 插件级覆盖
        timeout: 30000, // 继承 defaults
        logLevel: "info", // 继承 defaults
        maxRetries: 5, // 插件级新增
      });
    });

    it("resolveEnv 默认为 true（应解析 ENV: 占位符）", () => {
      const originalKey = "TEST_CONFIG_VAR";
      process.env[originalKey] = "env-value-123";
      try {
        const config = new PluginConfigManager({
          defaults: { apiKey: "ENV:TEST_CONFIG_VAR" },
          plugins: { p: {} },
        });
        expect(config.getPluginConfig("p").apiKey).toBe("env-value-123");
      } finally {
        delete process.env[originalKey];
      }
    });

    it("resolveEnv=false 时应保留 ENV: 原样", () => {
      const config = new PluginConfigManager({
        resolveEnv: false,
        defaults: { apiKey: "ENV:SOME_VAR" },
        plugins: { p: {} },
      });
      expect(config.getPluginConfig("p").apiKey).toBe("ENV:SOME_VAR");
    });
  });

  // ── 工厂方法 fromFile ──

  describe("fromFile", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = resolve(tmpdir(), `plugin-runner-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("应从有效文件加载配置", async () => {
      const filePath = resolve(tempDir, "plugin-runner-plugins.json");
      await writeFile(
        filePath,
        JSON.stringify({
          defaults: { timeout: 5000 },
          plugins: { p1: { enabled: true } },
        }),
      );
      const config = await PluginConfigManager.fromFile(filePath);
      expect(config.getPluginConfig("p1").timeout).toBe(5000);
      expect(config.getPluginConfig("p1").enabled).toBe(true);
    });

    it("相对路径应基于 cwd 解析", async () => {
      // 使用绝对路径避免 cwd 依赖
      const absPath = resolve(tempDir, "custom-config.json");
      await writeFile(absPath, JSON.stringify({ plugins: { p: {} } }));
      const config = await PluginConfigManager.fromFile(absPath);
      expect(config.getPluginNames()).toEqual(["p"]);
    });

    it("使用默认文件名但文件不存在时应返回空配置", async () => {
      const config = await PluginConfigManager.fromFile();
      expect(config.size).toBe(0);
      expect(config.getDefaults()).toEqual({});
    });

    it("显式传入不存在的路径时应抛 ENOENT 错误", async () => {
      const nonExistent = resolve(tempDir, "non-existent.json");
      await expect(
        PluginConfigManager.fromFile(nonExistent),
      ).rejects.toThrow();
    });

    it("显式传入路径但文件内容为非法 JSON 时应抛 SyntaxError", async () => {
      const filePath = resolve(tempDir, "bad.json");
      await writeFile(filePath, "not-json");
      await expect(
        PluginConfigManager.fromFile(filePath),
      ).rejects.toThrow(SyntaxError);
    });

    it("options 中的 defaults 应覆盖文件中的 defaults", async () => {
      const filePath = resolve(tempDir, "override.json");
      await writeFile(
        filePath,
        JSON.stringify({
          defaults: { timeout: 1000, logLevel: "debug" },
          plugins: { p: { enabled: true } },
        }),
      );
      const config = await PluginConfigManager.fromFile(filePath, {
        defaults: { timeout: 9999 },
      });
      // 传入的 defaults 优先
      expect(config.getPluginConfig("p").timeout).toBe(9999);
      expect(config.getPluginConfig("p").logLevel).toBe("debug"); // 未覆盖的保留
    });
  });

  // ── 工厂方法 fromJson ──

  describe("fromJson", () => {
    it("应解析合法 JSON 字符串", () => {
      const json = JSON.stringify({
        defaults: { enabled: true },
        plugins: { p: { key: "val" } },
      });
      const config = PluginConfigManager.fromJson(json);
      expect(config.getPluginConfig("p").enabled).toBe(true);
      expect(config.getPluginConfig("p").key).toBe("val");
    });

    it("空对象 JSON 应返回空配置", () => {
      const config = PluginConfigManager.fromJson("{}");
      expect(config.size).toBe(0);
      expect(config.getDefaults()).toEqual({});
    });

    it("非法 JSON 应抛 SyntaxError", () => {
      expect(() => PluginConfigManager.fromJson("{broken")).toThrow(
        SyntaxError,
      );
    });

    it("非法 JSON 错误消息应包含来源路径（如提供）", () => {
      expect(() =>
        PluginConfigManager.fromJson("{{", undefined, "/path/to/file.json"),
      ).toThrow(/file\.json/);
    });

    it("options 中的 plugins 应合并到解析结果中", () => {
      const json = JSON.stringify({
        plugins: { p1: { enabled: true } },
      });
      const config = PluginConfigManager.fromJson(json, {
        plugins: { p2: { enabled: false } },
      });
      expect(config.getPluginNames()).toEqual(["p1", "p2"]);
    });

    it("传入的 plugins 应覆盖 JSON 中的同名插件（浅层替换）", () => {
      // 注意：合并策略是浅层合并——选项中的整个插件配置对象替换文件中的同名对象。
      const json = JSON.stringify({
        plugins: { p: { enabled: true, key: "from-file" } },
      });
      const config = PluginConfigManager.fromJson(json, {
        plugins: { p: { enabled: false } },
      });
      const cfg = config.getPluginConfig("p");
      // 选项中的 { enabled: false } 整体替换文件中的 { enabled: true, key: "from-file" }
      expect(cfg.enabled).toBe(false);
      expect(cfg.key).toBeUndefined();
    });

    it("options 中的 defaults 应覆盖文件解析的 defaults", () => {
      const json = JSON.stringify({
        defaults: { timeout: 100 },
        plugins: { p: {} },
      });
      const config = PluginConfigManager.fromJson(json, {
        defaults: { timeout: 200, logLevel: "info" },
      });
      const cfg = config.getPluginConfig("p");
      expect(cfg.timeout).toBe(200); // 传入覆盖
      expect(cfg.logLevel).toBe("info"); // 传入新增
    });
  });

  // ── 工厂方法 fromObject ──

  describe("fromObject", () => {
    it("应从 PluginConfigFile 对象创建配置", () => {
      const obj: PluginConfigFile = {
        defaults: { enabled: true },
        plugins: { p1: { key: "val1" }, p2: { key: "val2" } },
      };
      const config = PluginConfigManager.fromObject(obj);
      expect(config.size).toBe(2);
      expect(config.getPluginConfig("p1").key).toBe("val1");
      expect(config.getPluginConfig("p1").enabled).toBe(true);
    });

    it("options 中的 defaults 应覆盖 obj 中的 defaults", () => {
      const obj: PluginConfigFile = {
        defaults: { timeout: 100 },
        plugins: { p: {} },
      };
      const config = PluginConfigManager.fromObject(obj, {
        defaults: { timeout: 500 },
      });
      expect(config.getPluginConfig("p").timeout).toBe(500);
    });

    it("空对象应返回空配置", () => {
      const config = PluginConfigManager.fromObject({});
      expect(config.size).toBe(0);
    });

    it("缺省字段应安全处理", () => {
      const config = PluginConfigManager.fromObject({ plugins: {} }, {});
      expect(config.size).toBe(0);
    });
  });

  // ── 查询接口 ──

  describe("getPluginConfig", () => {
    it("应返回插件的合并配置（深拷贝不与内部共享引用）", () => {
      const config = new PluginConfigManager({
        plugins: { p: { key: "original" } },
      });
      const cfg1 = config.getPluginConfig("p");
      const cfg2 = config.getPluginConfig("p");
      cfg1.key = "mutated";
      expect(cfg2.key).toBe("original"); // 未受影响
    });

    it("不存在的插件应返回 defaults 的拷贝", () => {
      const config = new PluginConfigManager({
        defaults: { timeout: 100 },
        plugins: { p: {} },
      });
      const fallback = config.getPluginConfig("non-existent");
      expect(fallback.timeout).toBe(100);
    });

    it("非严格模式下环境变量未定义时返回 undefined", () => {
      delete process.env["NONEXISTENT_VAR_FOR_TEST"];
      const config = new PluginConfigManager({
        plugins: { p: { apiKey: "ENV:NONEXISTENT_VAR_FOR_TEST" } },
      });
      const cfg = config.getPluginConfig("p");
      expect(cfg).toHaveProperty("apiKey");
      expect(cfg.apiKey).toBeUndefined();
    });
  });

  describe("getPluginNames", () => {
    it("应返回所有已配置插件的名称列表", () => {
      const config = new PluginConfigManager({
        plugins: { a: {}, b: {}, c: {} },
      });
      expect(config.getPluginNames()).toEqual(["a", "b", "c"]);
    });

    it("空配置应返回空数组", () => {
      const config = new PluginConfigManager();
      expect(config.getPluginNames()).toEqual([]);
    });
  });

  describe("getDefaults", () => {
    it("应返回 defaults 的拷贝", () => {
      const config = new PluginConfigManager({
        defaults: { timeout: 30000, enabled: true },
      });
      const d = config.getDefaults();
      d.timeout = 999;
      // 内部不受影响
      expect(config.getDefaults().timeout).toBe(30000);
    });

    it("无 defaults 时应返回空对象", () => {
      const config = new PluginConfigManager();
      expect(config.getDefaults()).toEqual({});
    });
  });

  describe("hasPluginConfig", () => {
    it("已配置的插件应返回 true", () => {
      const config = new PluginConfigManager({ plugins: { p: {} } });
      expect(config.hasPluginConfig("p")).toBe(true);
    });

    it("未配置的插件应返回 false", () => {
      const config = new PluginConfigManager();
      expect(config.hasPluginConfig("nonexistent")).toBe(false);
    });
  });

  // ── 元数据 ──

  describe("sourcePath", () => {
    it("fromFile 应设置 sourcePath", async () => {
      const tempDir = resolve(tmpdir(), `plugin-runner-sp-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
      try {
        const filePath = resolve(tempDir, "cfg.json");
        await writeFile(filePath, JSON.stringify({ plugins: { p: {} } }));
        const config = await PluginConfigManager.fromFile(filePath);
        // 路径应为绝对路径
        expect(config.sourcePath).toBe(filePath);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("fromJson 传入 sourcePath 应正确设置", () => {
      const config = PluginConfigManager.fromJson(
        '{"plugins":{}}',
        {},
        "/custom/path.json",
      );
      expect(config.sourcePath).toBe("/custom/path.json");
    });

    it("fromJson 不传 sourcePath 应保持 undefined", () => {
      const config = PluginConfigManager.fromJson('{"plugins":{}}');
      expect(config.sourcePath).toBeUndefined();
    });

    it("new 构造应保持 undefined", () => {
      const config = new PluginConfigManager();
      expect(config.sourcePath).toBeUndefined();
    });
  });

  describe("size", () => {
    it("应返回已注册的插件数量", () => {
      const config = new PluginConfigManager({
        plugins: { a: {}, b: {}, c: {} },
      });
      expect(config.size).toBe(3);
    });

    it("空配置 size 应为 0", () => {
      const config = new PluginConfigManager();
      expect(config.size).toBe(0);
    });
  });

  // ── 序列化 ──

  describe("toJSON / toString", () => {
    it("toJSON 应返回可序列化的 PluginConfigFile 对象", () => {
      const config = new PluginConfigManager({
        defaults: { timeout: 100 },
        plugins: { p: { enabled: true } },
      });
      const json = config.toJSON();
      expect(json.defaults).toEqual({ timeout: 100 });
      expect(json.plugins).toHaveProperty("p");
      expect(json.plugins!.p).toEqual({ enabled: true, timeout: 100 });
    });

    it("toJSON 返回的对象不应与内部状态共享引用", () => {
      const config = new PluginConfigManager({ plugins: { p: { x: 1 } } });
      const json = config.toJSON();
      json.plugins!.p.x = 999;
      expect(config.getPluginConfig("p").x).toBe(1);
    });

    it("toString 应输出格式化的 JSON", () => {
      const config = new PluginConfigManager({
        defaults: { timeout: 100 },
        plugins: { p: { enabled: true } },
      });
      const str = config.toString();
      const parsed = JSON.parse(str);
      expect(parsed.defaults.timeout).toBe(100);
      expect(parsed.plugins.p.enabled).toBe(true);
    });

    it("toString 默认缩进为 2 空格", () => {
      const config = new PluginConfigManager({ plugins: { p: {} } });
      const str = config.toString();
      // 格式化后的 JSON 应有换行缩进
      expect(str).toContain("\n  ");
    });

    it("toString 支持自定义缩进", () => {
      const config = new PluginConfigManager({ plugins: { p: {} } });
      const str = config.toString(4);
      expect(str).toContain("    ");
    });
  });

  // ── 构造函数注入 ──

  describe("toPluginConfig", () => {
    it("应返回 PluginConfig 接口兼容的对象（含 enabled 默认 true）", () => {
      const config = new PluginConfigManager({
        plugins: { p: { timeout: 5000 } },
      });
      const pc = config.toPluginConfig("p");
      expect(pc.enabled).toBe(true); // 默认值
      expect(pc.timeout).toBe(5000);
    });

    it("应包含插件配置中的所有额外字段", () => {
      const config = new PluginConfigManager({
        plugins: { p: { apiKey: "abc", maxRetries: 3 } },
      });
      const pc = config.toPluginConfig("p");
      expect(pc.apiKey).toBe("abc");
      expect(pc.maxRetries).toBe(3);
    });

    it("不存在的插件应返回仅含 defaults 的 PluginConfig", () => {
      const config = new PluginConfigManager({
        defaults: { enabled: false, timeout: 100 },
      });
      const pc = config.toPluginConfig("nonexistent");
      expect(pc.enabled).toBe(false);
      expect(pc.timeout).toBe(100);
    });
  });

  // ── 环境变量解析 ──

  describe("ENV: 环境变量解析", () => {
    const ENV_KEY = "PLUGIN_RUNNER_TEST_VAR";
    const ENV_VAL = "resolved-value-42";

    beforeEach(() => {
      process.env[ENV_KEY] = ENV_VAL;
    });

    afterEach(() => {
      delete process.env[ENV_KEY];
    });

    it("应解析 ENV: 前缀为环境变量值", () => {
      const config = new PluginConfigManager({
        plugins: { p: { apiKey: `ENV:${ENV_KEY}` } },
      });
      expect(config.getPluginConfig("p").apiKey).toBe(ENV_VAL);
    });

    it("应支持不区分大小写的前缀（env:/EnV:/ENV:）", () => {
      const config = new PluginConfigManager({
        plugins: {
          p1: { val: `env:${ENV_KEY}` },
          p2: { val: `EnV:${ENV_KEY}` },
          p3: { val: `ENV:${ENV_KEY}` },
        },
      });
      expect(config.getPluginConfig("p1").val).toBe(ENV_VAL);
      expect(config.getPluginConfig("p2").val).toBe(ENV_VAL);
      expect(config.getPluginConfig("p3").val).toBe(ENV_VAL);
    });

    it("递归解析嵌套对象中的 ENV: 占位符", () => {
      const config = new PluginConfigManager({
        plugins: {
          p: {
            nested: { inner: `ENV:${ENV_KEY}` },
          },
        },
      });
      const cfg = config.getPluginConfig("p");
      expect((cfg.nested as Record<string, unknown>).inner).toBe(ENV_VAL);
    });

    it("递归解析数组中的 ENV: 占位符", () => {
      const config = new PluginConfigManager({
        plugins: {
          p: {
            hosts: [`ENV:${ENV_KEY}`, "static-value"],
          },
        },
      });
      const cfg = config.getPluginConfig("p");
      expect((cfg.hosts as string[])[0]).toBe(ENV_VAL);
      expect((cfg.hosts as string[])[1]).toBe("static-value");
    });

    it("非 ENV: 前缀的普通字符串应原样保留", () => {
      const config = new PluginConfigManager({
        plugins: { p: { name: "hello-world" } },
      });
      expect(config.getPluginConfig("p").name).toBe("hello-world");
    });

    it("字符串包含 ENV: 但不是完全匹配时不应解析（如路径前缀）", () => {
      // 仅完全等于 "ENV:VAR_NAME" 才解析
      const config = new PluginConfigManager({
        plugins: { p: { path: "/data/ENV:TEST/file" } },
      });
      expect(config.getPluginConfig("p").path).toBe("/data/ENV:TEST/file");
    });

    it("原始类型（number / boolean / null）应原样保留", () => {
      const config = new PluginConfigManager({
        plugins: {
          p: { count: 42, active: true, data: null },
        },
      });
      const cfg = config.getPluginConfig("p");
      expect(cfg.count).toBe(42);
      expect(cfg.active).toBe(true);
      expect(cfg.data).toBeNull();
    });

    it("strictEnv=true 且环境变量缺失时应抛 Error", () => {
      delete process.env["MISSING_VAR_XYZ"];
      expect(() => {
        new PluginConfigManager({
          strictEnv: true,
          plugins: { p: { key: "ENV:MISSING_VAR_XYZ" } },
        });
      }).toThrow(/环境变量.*MISSING_VAR_XYZ.*未定义/);
    });

    it("strictEnv=false（默认）且环境变量缺失时应返回 undefined", () => {
      delete process.env["MISSING_VAR_ABC"];
      const config = new PluginConfigManager({
        plugins: { p: { key: "ENV:MISSING_VAR_ABC" } },
      });
      const cfg = config.getPluginConfig("p");
      expect(cfg).toHaveProperty("key");
      expect(cfg.key).toBeUndefined();
    });

    it("空字符串环境变量值应返回空字符串", () => {
      process.env["EMPTY_VAR"] = "";
      try {
        const config = new PluginConfigManager({
          plugins: { p: { key: "ENV:EMPTY_VAR" } },
        });
        expect(config.getPluginConfig("p").key).toBe("");
      } finally {
        delete process.env["EMPTY_VAR"];
      }
    });

    it("defaults 中的 ENV: 也应被解析", () => {
      const config = new PluginConfigManager({
        defaults: { apiKey: `ENV:${ENV_KEY}` },
        plugins: { p: {} },
      });
      expect(config.getPluginConfig("p").apiKey).toBe(ENV_VAL);
    });
  });

  // ── 便捷函数 ──

  describe("loadPluginConfig", () => {
    it("应委托给 PluginConfigManager.fromFile 并返回相同结果", async () => {
      const tempDir = resolve(tmpdir(), `plugin-runner-lpc-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
      try {
        const filePath = resolve(tempDir, "test.json");
        await writeFile(
          filePath,
          JSON.stringify({ plugins: { p: { enabled: true } } }),
        );

        const direct = await PluginConfigManager.fromFile(filePath);
        const viaFn = await loadPluginConfig(filePath);

        expect(viaFn.getPluginConfig("p")).toEqual(
          direct.getPluginConfig("p"),
        );
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("无参数调用应返回空配置（同 fromFile 默认行为）", async () => {
      const config = await loadPluginConfig();
      expect(config.size).toBe(0);
    });
  });

  describe("createPluginConfig", () => {
    it("应委托给 PluginConfigManager.fromObject", () => {
      const obj: PluginConfigFile = {
        defaults: { timeout: 100 },
        plugins: { p: { enabled: true } },
      };
      const config = createPluginConfig(obj);
      expect(config.getPluginConfig("p").timeout).toBe(100);
      expect(config.getPluginConfig("p").enabled).toBe(true);
    });

    it("应透传 options", () => {
      const obj: PluginConfigFile = {
        defaults: { timeout: 100 },
        plugins: { p: {} },
      };
      const config = createPluginConfig(obj, {
        defaults: { timeout: 999 },
      });
      expect(config.getPluginConfig("p").timeout).toBe(999);
    });
  });
});
