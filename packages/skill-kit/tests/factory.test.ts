// @ci: removed — skill-kit 核心逻辑已迁移至 @cortex/engine（TUI 深化 v2.6.4）
// ============================================================
// @cortex/skill-kit — SkillFactory 单元测试
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  type SkillDefinition,
  SkillCategory,
} from "../dist/types.js";
import { SkillFactory } from "../dist/factory.js";
import { DynamicImportLoader } from "../dist/loader.js";
import { SimpleSkillValidator } from "../dist/validator.js";
import { PipelineExecutor } from "../dist/executor.js";
import { DefaultSkillCache } from "../dist/cache.js";

describe("SkillFactory", () => {
  let factory: SkillFactory;
  let loader: DynamicImportLoader;

  beforeEach(() => {
    loader = new DynamicImportLoader({ baseDir: process.cwd() });
    factory = new SkillFactory({
      loader,
    });
  });

  it("构造时不抛出错误", () => {
    expect(factory).toBeDefined();
  });

  it("getLoader() 返回加载器", () => {
    expect(factory.getLoader()).toBe(loader);
  });

  it("getCache() 返回缓存实例", () => {
    const cache = factory.getCache();
    expect(cache).toBeDefined();
    expect(cache.stats).toBeDefined();
  });

  it("register() 委托给加载器", () => {
    factory.register("test", "./path/to/skill.ts");
    expect(factory.getLoader()).toBe(loader);
    expect(loader.getRegisteredIds()).toContain("test");
  });

  it("registerMany() 批量注册", () => {
    factory.registerMany([
      { id: "a", path: "./a.ts" },
      { id: "b", path: "./b.ts" },
    ]);
    expect(loader.getRegisteredIds()).toContain("a");
    expect(loader.getRegisteredIds()).toContain("b");
  });

  it("validate() 返回校验结果（技能未注册）", async () => {
    const result = await factory.validate("nonexistent");
    expect(result.valid).toBe(false);
  });

  it("dispose() 不抛出错误", async () => {
    await expect(factory.dispose()).resolves.toBeUndefined();
  });
});

describe("SkillFactory — 使用自定义组件", () => {
  it("接受自定义 validator / executor / cache", () => {
    const factory = new SkillFactory({
      loader: new DynamicImportLoader(),
      validator: new SimpleSkillValidator({ strictVersion: false }),
      executor: new PipelineExecutor({ defaultTimeout: 10_000 }),
      cache: new DefaultSkillCache({ maxSize: 50 }),
    });
    expect(factory).toBeDefined();
  });
});
