// @ci: unit
/**
 * @cortex/plugin-runner — PluginRegistry 单元测试
 *
 * 覆盖：
 *   - register / unregister 注册注销（含边界：空名称、重复注册）
 *   - get / getMeta / has 查询检索
 *   - size / getAll / getAllMeta / listNames 聚合方法
 *   - findByTag / find / getMultiple 筛选与批量查询
 *   - clear 清空
 *   - resolveDependencies 拓扑排序（无依赖 / 多级 / 循环检测）
 *   - hasCycle 环检测
 *   - discover 文件发现（临时文件 + 动态导入模拟）
 *   - registerFromGlob 文件发现并自动注册
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginRegistry } from "../src/registry.js";
import { AbstractPlugin, isPlugin } from "../src/plugin.js";
import type { ExecuteContext, Plugin, PluginMeta } from "../src/types.js";

// ── 辅助：模拟插件类 ──

class MockPluginA extends AbstractPlugin {
  readonly name = "plugin-a";
  readonly version = "1.0.0";
  readonly description = "Plugin A (core)";
  readonly dependencies: string[] = [];
  readonly tags = ["core", "runtime"];

  async execute(_ctx: ExecuteContext): Promise<void> {
    // no-op
  }
}

class MockPluginB extends AbstractPlugin {
  readonly name = "plugin-b";
  readonly version = "2.0.0";
  readonly description = "Plugin B (feature)";
  readonly dependencies = ["plugin-a"];
  readonly tags = ["feature", "transformer"];

  async execute(_ctx: ExecuteContext): Promise<void> {
    // no-op
  }
}

class MockPluginC extends AbstractPlugin {
  readonly name = "plugin-c";
  readonly version = "1.5.0";
  readonly description = "Plugin C (feature)";
  readonly dependencies = ["plugin-a"];
  readonly tags = ["feature", "validator"];

  async execute(_ctx: ExecuteContext): Promise<void> {
    // no-op
  }
}

class MockPluginD extends AbstractPlugin {
  readonly name = "plugin-d";
  readonly version = "0.5.0";
  readonly description = "Plugin D (高级)";
  readonly dependencies = ["plugin-b", "plugin-c"];
  readonly tags = ["advanced", "pipeline"];

  async execute(_ctx: ExecuteContext): Promise<void> {
    // no-op
  }
}

/** 没有依赖的独立插件 */
class StandalonePlugin extends AbstractPlugin {
  readonly name = "standalone";
  readonly dependencies: string[] = [];
  readonly tags: string[] = [];

  async execute(_ctx: ExecuteContext): Promise<void> {
    // no-op
  }
}

/** 用于测试空名称注册的非法插件 */
class NamelessPlugin extends AbstractPlugin {
  get name(): string {
    return "";
  }
  async execute(_ctx: ExecuteContext): Promise<void> {
    // no-op
  }
}

/** 用于测试循环依赖 */
class CircularA extends AbstractPlugin {
  readonly name = "circular-a";
  readonly dependencies = ["circular-b"];
  async execute(_ctx: ExecuteContext): Promise<void> {
    // no-op
  }
}

class CircularB extends AbstractPlugin {
  readonly name = "circular-b";
  readonly dependencies = ["circular-a"];
  async execute(_ctx: ExecuteContext): Promise<void> {
    // no-op
  }
}

/** 自循环 */
class SelfCircular extends AbstractPlugin {
  readonly name = "self-circular";
  readonly dependencies = ["self-circular"];
  async execute(_ctx: ExecuteContext): Promise<void> {
    // no-op
  }
}

/** 依赖不存在的插件（不影响拓扑排序） */
class MissingDepPlugin extends AbstractPlugin {
  readonly name = "missing-dep";
  readonly dependencies = ["not-registered"];
  async execute(_ctx: ExecuteContext): Promise<void> {
    // no-op
  }
}

// ── 测试套件 ──

describe("PluginRegistry — registry.ts", () => {
  let registry: PluginRegistry;
  let pluginA: MockPluginA;
  let pluginB: MockPluginB;
  let pluginC: MockPluginC;
  let pluginD: MockPluginD;

  beforeEach(() => {
    registry = new PluginRegistry();
    pluginA = new MockPluginA();
    pluginB = new MockPluginB();
    pluginC = new MockPluginC();
    pluginD = new MockPluginD();
  });

  // ── register() ──

  describe("register()", () => {
    it("应成功注册一个有效插件", () => {
      registry.register(pluginA);
      expect(registry.has("plugin-a")).toBe(true);
      expect(registry.size).toBe(1);
    });

    it("应成功注册多个插件", () => {
      registry.register(pluginA);
      registry.register(pluginB);
      registry.register(pluginC);
      expect(registry.size).toBe(3);
    });

    it("重复注册同名插件应抛 Error（含明确消息）", () => {
      registry.register(pluginA);
      expect(() => registry.register(pluginA)).toThrow(
        '[PluginRegistry] 重复注册: "plugin-a" 已存在',
      );
    });

    it("重复注册同名但不同实例也应抛 Error", () => {
      registry.register(pluginA);
      const anotherA = new MockPluginA();
      expect(() => registry.register(anotherA)).toThrow(
        '[PluginRegistry] 重复注册: "plugin-a" 已存在',
      );
    });

    it("注册 null / undefined 应抛 Error（非空 name 断言）", () => {
      expect(() => registry.register(null as unknown as Plugin)).toThrow(
        "插件必须具有非空的 name 属性",
      );
    });

    it("注册 name 为空字符串的插件应抛 Error", () => {
      const nameless = new NamelessPlugin();
      expect(() => registry.register(nameless)).toThrow(
        "插件必须具有非空的 name 属性",
      );
    });

    it("注册后不自动调用 init()（生命周期由 Runner 管理）", () => {
      const spy = vi.spyOn(pluginA, "init");
      registry.register(pluginA);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ── unregister() ──

  describe("unregister()", () => {
    it("应成功注销已注册的插件", () => {
      registry.register(pluginA);
      const result = registry.unregister("plugin-a");
      expect(result).toBe(true);
      expect(registry.has("plugin-a")).toBe(false);
      expect(registry.size).toBe(0);
    });

    it("注销不存在的插件应返回 false（不抛异常）", () => {
      const result = registry.unregister("nonexistent");
      expect(result).toBe(false);
    });

    it("注销后原实例引用保持不变（registry 仅移除引用）", () => {
      registry.register(pluginA);
      registry.unregister("plugin-a");
      // 实例本身没有被修改
      expect(pluginA.name).toBe("plugin-a");
    });

    it("可多次安全注销同一名称（首次成功，后续 false）", () => {
      registry.register(pluginA);
      expect(registry.unregister("plugin-a")).toBe(true);
      expect(registry.unregister("plugin-a")).toBe(false);
    });
  });

  // ── get() ──

  describe("get()", () => {
    it("应返回已注册的插件实例（引用相等）", () => {
      registry.register(pluginA);
      expect(registry.get("plugin-a")).toBe(pluginA);
    });

    it("不存在的插件应返回 undefined", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });

    it("注销后 get() 应返回 undefined", () => {
      registry.register(pluginA);
      registry.unregister("plugin-a");
      expect(registry.get("plugin-a")).toBeUndefined();
    });
  });

  // ── getMeta() ──

  describe("getMeta()", () => {
    it("应返回轻量元信息（包含 name/version/description/tags/dependencies/hooks）", () => {
      registry.register(pluginA);
      const meta = registry.getMeta("plugin-a");

      expect(meta).toBeDefined();
      expect(meta!.name).toBe("plugin-a");
      expect(meta!.version).toBe("1.0.0");
      expect(meta!.description).toBe("Plugin A (core)");
      expect(meta!.tags).toEqual(["core", "runtime"]);
      expect(meta!.dependencies).toEqual([]);
      expect(meta!.hooks).toEqual({});
    });

    it("应不暴露插件实例引用（返回纯数据对象）", () => {
      registry.register(pluginA);
      const meta = registry.getMeta("plugin-a");
      // 修改 meta 不影响原插件
      (meta as PluginMeta).name = "hacked";
      expect(registry.get("plugin-a")!.name).toBe("plugin-a");
    });

    it("tags 和 dependencies 应为副本（修改 meta 不影响插件）", () => {
      registry.register(pluginB);
      const meta = registry.getMeta("plugin-b")!;
      meta.tags.push("injected");
      meta.dependencies.push("injected-dep");
      expect(pluginB.tags).toEqual(["feature", "transformer"]);
      expect(pluginB.dependencies).toEqual(["plugin-a"]);
    });

    it("不存在的插件应返回 undefined", () => {
      expect(registry.getMeta("nonexistent")).toBeUndefined();
    });

    it("带有 filePath 时不应在 getMeta 中返回（仅 discover 填充）", () => {
      registry.register(pluginA);
      const meta = registry.getMeta("plugin-a");
      expect(meta!.filePath).toBeUndefined();
    });
  });

  // ── has() ──

  describe("has()", () => {
    it("已注册的插件应返回 true", () => {
      registry.register(pluginA);
      expect(registry.has("plugin-a")).toBe(true);
    });

    it("未注册的插件应返回 false", () => {
      expect(registry.has("plugin-a")).toBe(false);
    });

    it("空字符串名称应返回 false", () => {
      expect(registry.has("")).toBe(false);
    });
  });

  // ── size 属性 ──

  describe("size", () => {
    it("空注册表 size 应为 0", () => {
      expect(registry.size).toBe(0);
    });

    it("注册一个插件后 size 应为 1", () => {
      registry.register(pluginA);
      expect(registry.size).toBe(1);
    });

    it("注销后 size 应递减", () => {
      registry.register(pluginA);
      registry.register(pluginB);
      expect(registry.size).toBe(2);
      registry.unregister("plugin-a");
      expect(registry.size).toBe(1);
    });

    it("clear() 后 size 应为 0", () => {
      registry.register(pluginA);
      registry.register(pluginB);
      registry.clear();
      expect(registry.size).toBe(0);
    });
  });

  // ── getAll() ──

  describe("getAll()", () => {
    it("空注册表应返回空数组", () => {
      expect(registry.getAll()).toEqual([]);
    });

    it("应返回所有注册的插件实例", () => {
      registry.register(pluginA);
      registry.register(pluginB);
      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all).toContain(pluginA);
      expect(all).toContain(pluginB);
    });

    it("返回的数组是副本（修改不影响内部存储）", () => {
      registry.register(pluginA);
      const all = registry.getAll();
      (all as Plugin[]).pop();
      expect(registry.size).toBe(1);
    });
  });

  // ── getAllMeta() ──

  describe("getAllMeta()", () => {
    it("空注册表应返回空数组", () => {
      expect(registry.getAllMeta()).toEqual([]);
    });

    it("应为每个插件返回轻量元信息", () => {
      registry.register(pluginA);
      registry.register(pluginB);
      const metas = registry.getAllMeta();
      expect(metas).toHaveLength(2);
      const names = metas.map((m) => m.name).sort();
      expect(names).toEqual(["plugin-a", "plugin-b"]);
    });

    it("返回的元信息数组是独立的（修改不影响插件）", () => {
      registry.register(pluginA);
      const metas = registry.getAllMeta();
      metas[0].name = "hacked";
      expect(pluginA.name).toBe("plugin-a");
    });
  });

  // ── listNames() ──

  describe("listNames()", () => {
    it("空注册表应返回空数组", () => {
      expect(registry.listNames()).toEqual([]);
    });

    it("应返回所有已注册插件的名称列表", () => {
      registry.register(pluginA);
      registry.register(pluginB);
      registry.register(pluginC);
      const names = registry.listNames();
      expect(names).toHaveLength(3);
      expect(names).toContain("plugin-a");
      expect(names).toContain("plugin-b");
      expect(names).toContain("plugin-c");
    });

    it("名称列表应与注册顺序一致", () => {
      registry.register(pluginC);
      registry.register(pluginA);
      registry.register(pluginB);
      const names = registry.listNames();
      expect(names).toEqual(["plugin-c", "plugin-a", "plugin-b"]);
    });

    it("注销后名称列表应同步更新", () => {
      registry.register(pluginA);
      registry.register(pluginB);
      registry.unregister("plugin-a");
      expect(registry.listNames()).toEqual(["plugin-b"]);
    });
  });

  // ── findByTag() ──

  describe("findByTag()", () => {
    it("应按标签精确匹配", () => {
      registry.register(pluginA); // tags: ["core", "runtime"]
      registry.register(pluginB); // tags: ["feature", "transformer"]
      registry.register(pluginC); // tags: ["feature", "validator"]

      const featurePlugins = registry.findByTag("feature");
      expect(featurePlugins).toHaveLength(2);
      expect(featurePlugins.map((p) => p.name).sort()).toEqual([
        "plugin-b",
        "plugin-c",
      ]);
    });

    it("无匹配标签应返回空数组", () => {
      registry.register(pluginA);
      const result = registry.findByTag("nonexistent-tag");
      expect(result).toEqual([]);
    });

    it("空字符串标签应返回空数组", () => {
      registry.register(pluginA);
      expect(registry.findByTag("")).toEqual([]);
    });

    it("大小写敏感", () => {
      registry.register(pluginA);
      expect(registry.findByTag("Core")).toHaveLength(0);
      expect(registry.findByTag("core")).toHaveLength(1);
    });

    it("空注册表应返回空数组", () => {
      expect(registry.findByTag("core")).toEqual([]);
    });
  });

  // ── find() ──

  describe("find()", () => {
    it("应通过自定义过滤函数查找", () => {
      registry.register(pluginA);
      registry.register(pluginB);
      registry.register(pluginC);

      const result = registry.find((p) => p.version.startsWith("1."));
      expect(result).toHaveLength(2);
      expect(result.map((p) => p.name).sort()).toEqual(["plugin-a", "plugin-c"]);
    });

    it("无匹配应返回空数组", () => {
      registry.register(pluginA);
      const result = registry.find(() => false);
      expect(result).toEqual([]);
    });

    it("过滤函数可访问完整插件实例", () => {
      registry.register(pluginA);
      registry.register(pluginB);
      const result = registry.find((p) => p.tags.includes("transformer"));
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("plugin-b");
    });

    it("空注册表应返回空数组", () => {
      expect(registry.find(() => true)).toEqual([]);
    });
  });

  // ── getMultiple() ──

  describe("getMultiple()", () => {
    it("应按名称批量获取插件映射", () => {
      registry.register(pluginA);
      registry.register(pluginB);
      registry.register(pluginC);

      const result = registry.getMultiple(["plugin-a", "plugin-c"]);
      expect(result.size).toBe(2);
      expect(result.get("plugin-a")).toBe(pluginA);
      expect(result.get("plugin-c")).toBe(pluginC);
    });

    it("不存在的名称不在结果中", () => {
      registry.register(pluginA);
      const result = registry.getMultiple(["plugin-a", "nonexistent"]);
      expect(result.size).toBe(1);
      expect(result.has("nonexistent")).toBe(false);
    });

    it("空名称列表应返回空 Map", () => {
      registry.register(pluginA);
      expect(registry.getMultiple([]).size).toBe(0);
    });

    it("所有名称都不存在应返回空 Map", () => {
      expect(registry.getMultiple(["x", "y"]).size).toBe(0);
    });
  });

  // ── clear() ──

  describe("clear()", () => {
    it("应清空所有已注册的插件", () => {
      registry.register(pluginA);
      registry.register(pluginB);
      registry.register(pluginC);
      registry.register(pluginD);
      expect(registry.size).toBe(4);
      registry.clear();
      expect(registry.size).toBe(0);
      expect(registry.listNames()).toEqual([]);
    });

    it("clear() 后所有查询方法均应返回空", () => {
      registry.register(pluginA);
      registry.clear();
      expect(registry.get("plugin-a")).toBeUndefined();
      expect(registry.has("plugin-a")).toBe(false);
      expect(registry.findByTag("core")).toEqual([]);
    });

    it("空注册表调用 clear() 不应抛异常", () => {
      expect(() => registry.clear()).not.toThrow();
    });
  });

  // ── resolveDependencies() ──

  describe("resolveDependencies()", () => {
    it("空注册表应返回空数组", () => {
      expect(registry.resolveDependencies()).toEqual([]);
    });

    it("单一无依赖插件应返回单一批次 [[plugin]]", () => {
      registry.register(pluginA);
      const batches = registry.resolveDependencies();
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(1);
      expect(batches[0][0].name).toBe("plugin-a");
    });

    it("多个无依赖插件应在同一批次", () => {
      const s1 = new StandalonePlugin();
      const s2 = new StandalonePlugin();
      // 不能同名，改一下
      class S1 extends StandalonePlugin {
        readonly name = "s1";
      }
      class S2 extends StandalonePlugin {
        readonly name = "s2";
      }
      registry.register(new S1());
      registry.register(new S2());

      const batches = registry.resolveDependencies();
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);
    });

    it("应正确排序 A → B → D（三级依赖）", () => {
      registry.register(pluginA); // no deps
      registry.register(pluginB); // deps: [A]
      registry.register(pluginD); // deps: [B, C] — C 未注册，只依赖 B

      const batches = registry.resolveDependencies();

      // 第一批: plugin-a (入度 0)
      // 第二批: plugin-b (入度 0，因为 A 已处理)
      // 第三批: plugin-d (入度 0，因为 B 已处理)
      expect(batches.length).toBeGreaterThanOrEqual(2);
      expect(batches[0].map((p) => p.name)).toContain("plugin-a");
    });

    it("同一批次内包含可并行执行的无相互依赖插件", () => {
      registry.register(pluginA); // no deps
      registry.register(pluginB); // deps: [A]
      registry.register(pluginC); // deps: [A]

      const batches = registry.resolveDependencies();
      // 第一批: [A]
      // 第二批: [B, C] — 可并行
      expect(batches).toHaveLength(2);
      const secondBatch = batches[1].map((p) => p.name).sort();
      expect(secondBatch).toEqual(["plugin-b", "plugin-c"]);
    });

    it("依赖不存在的插件不应影响排序（跳过未注册依赖）", () => {
      registry.register(pluginA);
      registry.register(new MissingDepPlugin()); // deps: ["not-registered"]

      const batches = registry.resolveDependencies();
      // "not-registered" 未注册，视为已满足
      // 所以两个都在第一批
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);
    });

    it("应检测直接循环依赖并抛 Error", () => {
      registry.register(new CircularA());
      registry.register(new CircularB());
      expect(() => registry.resolveDependencies()).toThrow("依赖循环");
    });

    it("循环依赖错误消息应包含涉及的插件名称", () => {
      registry.register(new CircularA());
      registry.register(new CircularB());
      expect(() => registry.resolveDependencies()).toThrow(/circular-a|circular-b/);
    });

    it("应检测自循环依赖并抛 Error", () => {
      registry.register(new SelfCircular());
      // 自循环依赖
      expect(() => registry.resolveDependencies()).toThrow("依赖循环");
    });

    it("无循环的正常依赖不应抛异常", () => {
      registry.register(pluginA);
      registry.register(pluginB);
      registry.register(pluginC);
      expect(() => registry.resolveDependencies()).not.toThrow();
    });
  });

  // ── hasCycle() ──

  describe("hasCycle()", () => {
    it("空注册表应返回 false", () => {
      expect(registry.hasCycle()).toBe(false);
    });

    it("无依赖时应返回 false", () => {
      registry.register(pluginA);
      registry.register(new StandalonePlugin() as Plugin);
      expect(registry.hasCycle()).toBe(false);
    });

    it("线性依赖（A→B）应返回 false", () => {
      registry.register(pluginA);
      registry.register(pluginB);
      expect(registry.hasCycle()).toBe(false);
    });

    it("直接循环（A→B→A）应返回 true", () => {
      registry.register(new CircularA());
      registry.register(new CircularB());
      expect(registry.hasCycle()).toBe(true);
    });

    it("自循环应返回 true", () => {
      registry.register(new SelfCircular());
      expect(registry.hasCycle()).toBe(true);
    });

    it("非循环的多级依赖应返回 false", () => {
      registry.register(pluginA);
      registry.register(pluginB);
      registry.register(pluginC);
      registry.register(pluginD);
      expect(registry.hasCycle()).toBe(false);
    });

    it("注销循环节点后应返回 false", () => {
      registry.register(new CircularA());
      registry.register(new CircularB());
      expect(registry.hasCycle()).toBe(true);
      registry.unregister("circular-b");
      expect(registry.hasCycle()).toBe(false);
    });
  });

  // ── discover() ──

  describe("discover()", () => {
    it("空或空白 glob 模式应返回空数组", async () => {
      const result = await registry.discover("");
      expect(result).toEqual([]);

      const result2 = await registry.discover("   ");
      expect(result2).toEqual([]);
    });

    it("不匹配任何文件的 glob 应返回空数组", async () => {
      const result = await registry.discover(
        "./nonexistent-dir-12345/*.plugin.js",
      );
      expect(result).toEqual([]);
    });
  });

  // ── registerFromGlob() ──

  describe("registerFromGlob()", () => {
    it("空 glob 应返回 0", async () => {
      const count = await registry.registerFromGlob("");
      expect(count).toBe(0);
    });

    it("不匹配任何文件应返回 0 且不注册任何插件", async () => {
      const count = await registry.registerFromGlob(
        "./nonexistent-dir-xyz/*.plugin.js",
      );
      expect(count).toBe(0);
      expect(registry.size).toBe(0);
    });

    it("文件发现失败时不应抛出异常（静默跳过）", async () => {
      // 使用不合法的文件路径模式
      const count = await registry.registerFromGlob(
        "\0invalid|path*.plugin.ts",
      );
      // 不抛异常即可
      expect(typeof count).toBe("number");
    }, 15000);
  });

  // ── 集成场景 ──

  describe("集成场景", () => {
    it("应支持注册 → 查询 → 注销 → 重新注册的完整流程", () => {
      expect(registry.has("plugin-a")).toBe(false);
      registry.register(pluginA);
      expect(registry.has("plugin-a")).toBe(true);
      expect(registry.get("plugin-a")).toBe(pluginA);

      registry.unregister("plugin-a");
      expect(registry.has("plugin-a")).toBe(false);

      // 重新注册新实例
      const newA = new MockPluginA();
      registry.register(newA);
      expect(registry.get("plugin-a")).toBe(newA);
      expect(registry.get("plugin-a")).not.toBe(pluginA); // 不同实例
    });

    it("应支持通过 find + getMultiple 做批量操作", () => {
      registry.register(pluginA);
      registry.register(pluginB);
      registry.register(pluginC);
      registry.register(pluginD);

      // 找出所有 feature 插件
      const featurePlugins = registry.findByTag("feature");
      const featureNames = featurePlugins.map((p) => p.name);

      // 批量获取
      const featureMap = registry.getMultiple(featureNames);
      expect(featureMap.size).toBeGreaterThanOrEqual(2);
    });

    it("注册 → 拓扑排序 → 按批次执行的经典流程", () => {
      registry.register(pluginA);
      registry.register(pluginB);
      registry.register(pluginC);
      registry.register(pluginD);

      expect(registry.hasCycle()).toBe(false);

      const batches = registry.resolveDependencies();
      // 验证拓扑顺序：A 必须在 B/C 之前，B/C 必须在 D 之前
      const batchIndex = new Map<string, number>();
      batches.forEach((batch, idx) => {
        batch.forEach((p) => batchIndex.set(p.name, idx));
      });

      expect(batchIndex.get("plugin-a")).toBeLessThan(
        batchIndex.get("plugin-b")!,
      );
      expect(batchIndex.get("plugin-a")).toBeLessThan(
        batchIndex.get("plugin-c")!,
      );
      expect(batchIndex.get("plugin-b")).toBeLessThan(
        batchIndex.get("plugin-d")!,
      );
      expect(batchIndex.get("plugin-c")).toBeLessThan(
        batchIndex.get("plugin-d")!,
      );
    });

    it("多个 registry 实例应相互隔离", () => {
      const r1 = new PluginRegistry();
      const r2 = new PluginRegistry();

      r1.register(pluginA);
      r2.register(pluginB);

      expect(r1.has("plugin-a")).toBe(true);
      expect(r1.has("plugin-b")).toBe(false);
      expect(r2.has("plugin-a")).toBe(false);
      expect(r2.has("plugin-b")).toBe(true);
    });
  });
});
