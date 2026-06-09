// @ci: unit
/**
 * @cortex/prompt-kit — PromptLoader + Sources 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { PromptLoader } from "../../src/loader/prompt-loader.js";
import { FilePromptSource } from "../../src/loader/file-source.js";
import { ConfigPromptSource } from "../../src/loader/config-source.js";
import { InlinePromptSource } from "../../src/loader/inline-source.js";
import { PromptBlockType } from "../../src/types.js";

describe("InlinePromptSource", () => {
  let source: InlinePromptSource;

  beforeEach(() => {
    source = new InlinePromptSource();
  });

  it("注册后应能加载内联模板", async () => {
    source.register("my-prompt", "你是AI助手", PromptBlockType.Identity, 10);
    const template = await source.load("my-prompt");
    expect(template).not.toBeNull();
    expect(template!.id).toBe("my-prompt");
    expect(template!.blocks).toHaveLength(1);
    expect(template!.blocks[0].content).toBe("你是AI助手");
    expect(template!.blocks[0].type).toBe(PromptBlockType.Identity);
  });

  it("未注册的模板应返回 null", async () => {
    const result = await source.load("nonexistent");
    expect(result).toBeNull();
  });

  it("应列出所有已注册模板", async () => {
    source.register("a", "content a");
    source.register("b", "content b");
    const list = await source.list();
    expect(list).toContain("a");
    expect(list).toContain("b");
    expect(list).toHaveLength(2);
  });

  it("应支持移除指定模板", async () => {
    source.register("temp", "临时内容");
    expect(await source.load("temp")).not.toBeNull();
    source.remove("temp");
    expect(await source.load("temp")).toBeNull();
  });

  it("clear 应清空所有模板", async () => {
    source.register("a", "a");
    source.register("b", "b");
    source.clear();
    expect(await source.load("a")).toBeNull();
    expect(await source.load("b")).toBeNull();
  });
});

describe("ConfigPromptSource", () => {
  let source: ConfigPromptSource;

  beforeEach(() => {
    source = new ConfigPromptSource();
  });

  it("应通过注册的配置键加载模板", async () => {
    source.register({
      key: "PLANNING_SYSTEM",
      getValue: () => "你是规划代理，负责分解任务。",
      templateId: "planning-system",
      blockType: PromptBlockType.Identity,
      priority: 10,
    });

    const template = await source.load("planning-system");
    expect(template).not.toBeNull();
    expect(template!.id).toBe("planning-system");
    expect(template!.blocks[0].content).toBe("你是规划代理，负责分解任务。");
    expect(template!.blocks[0].type).toBe(PromptBlockType.Identity);
  });

  it("未注册的模板 ID 应返回 null", async () => {
    const result = await source.load("nonexistent");
    expect(result).toBeNull();
  });

  it("空值配置应返回 null", async () => {
    source.register({
      key: "EMPTY_CONFIG",
      getValue: () => "",
      templateId: "empty",
    });
    const result = await source.load("empty");
    expect(result).toBeNull();
  });

  it("应支持批量注册", async () => {
    source.registerMany([
      {
        key: "SYS_A",
        getValue: () => "system a",
        templateId: "system-a",
      },
      {
        key: "SYS_B",
        getValue: () => "system b",
        templateId: "system-b",
      },
    ]);

    const list = await source.list();
    expect(list).toContain("system-a");
    expect(list).toContain("system-b");
  });
});

describe("PromptLoader", () => {
  let loader: PromptLoader;

  beforeEach(() => {
    loader = new PromptLoader();
    const inlineSource = new InlinePromptSource();
    inlineSource.register("inline-test", "内联内容", PromptBlockType.Instruction, 50);
    loader.registerSource("inline", inlineSource);
  });

  it("应通过已注册来源加载模板", async () => {
    const template = await loader.load("inline-test");
    expect(template).not.toBeNull();
    expect(template.id).toBe("inline-test");
  });

  it("不存在的模板应抛出错误", async () => {
    await expect(loader.load("nonexistent")).rejects.toThrow();
  });

  it("loadFromInline 应构造 PromptTemplate", () => {
    const template = loader.loadFromInline("inline-2", "内联内容2");
    expect(template.id).toBe("inline-2");
    expect(template.blocks).toHaveLength(1);
    expect(template.source).toBe("inline");
  });

  it("clearCache 应清空加载缓存", async () => {
    await loader.load("inline-test");
    const cached = await loader.load("inline-test");
    expect(cached.id).toBe("inline-test");

    loader.clearCache();
    const reloaded = await loader.load("inline-test");
    expect(reloaded.id).toBe("inline-test");
  });
});

describe("FilePromptSource", () => {
  let fileSource: FilePromptSource;

  beforeEach(() => {
    // Vitest runs from package root, so baseDir should point to the package root
    fileSource = new FilePromptSource({
      baseDir: resolve(__dirname, "../.."),
      promptsDir: "tests/fixtures/prompts",
    });
  });

  it("应加载 nahida-system 模板", async () => {
    const template = await fileSource.load("nahida-system");
    expect(template).not.toBeNull();
    expect(template!.id).toBe("nahida-system");
    expect(template!.blocks).toHaveLength(1);
    expect(template!.blocks[0].content).toContain("纳西妲");
  });

  it("应加载 nahida-identity 模板", async () => {
    const template = await fileSource.load("nahida-identity");
    expect(template).not.toBeNull();
    expect(template!.id).toBe("nahida-identity");
    expect(template!.blocks[0].type).toBe(PromptBlockType.Identity);
  });

  it("应加载 shared-identity-anchor 模板", async () => {
    const template = await fileSource.load("shared-identity-anchor");
    expect(template).not.toBeNull();
    expect(template!.id).toBe("shared-identity-anchor");
    expect(template!.blocks[0].content).toContain("身份锚点");
  });

  it("不存在的模板应返回 null", async () => {
    const template = await fileSource.load("nonexistent");
    expect(template).toBeNull();
  });

  it("list 应列出所有可用模板", async () => {
    const list = await fileSource.list();
    expect(list).toContain("nahida-system");
    expect(list).toContain("nahida-identity");
    expect(list).toContain("shared-identity-anchor");
  });

  it("refreshIndex 应重建索引", async () => {
    const before = await fileSource.list();
    expect(before.length).toBeGreaterThan(0);

    fileSource.refreshIndex();
    const after = await fileSource.list();
    expect(after).toEqual(before);
  });

  it("不存在的 prompts 目录应返回空列表", async () => {
    const emptySource = new FilePromptSource({
      baseDir: "/nonexistent/path",
      promptsDir: "prompts",
    });
    const list = await emptySource.list();
    expect(list).toEqual([]);
  });
});
