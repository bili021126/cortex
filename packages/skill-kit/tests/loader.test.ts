// @ci: unit
// ============================================================
// @cortex/skill-kit — DynamicImportLoader 单元测试
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { DynamicImportLoader } from "../dist/loader.js";

describe("DynamicImportLoader — 注册与映射", () => {
  let loader: DynamicImportLoader;

  beforeEach(() => {
    loader = new DynamicImportLoader({ baseDir: process.cwd() });
  });

  it("register() 后可通过 load() 查找注册路径", async () => {
    loader.register("test", "./tests/skills/test-skill.ts");
    const registeredIds = loader.getRegisteredIds();
    expect(registeredIds).toContain("test");
  });

  it("registerMany() 批量注册", () => {
    loader.registerMany([
      { id: "skill-a", path: "./skills/a.ts" },
      { id: "skill-b", path: "./skills/b.ts" },
    ]);
    expect(loader.getRegisteredIds()).toEqual(["skill-a", "skill-b"]);
  });

  it("getRegistrySnapshot() 返回注册表快照", () => {
    loader.register("test", "./skills/test.ts");
    const snapshot = loader.getRegistrySnapshot();
    expect(snapshot).toEqual([{ id: "test", path: "./skills/test.ts" }]);
  });

  it("load() 未注册时抛出错误", async () => {
    await expect(loader.load("nonexistent")).rejects.toThrow("未注册");
  });

  it("loadFromFile() 遇到不支持格式抛出错误", async () => {
    await expect(loader.loadFromFile("./test.txt")).rejects.toThrow("不支持的文件格式");
  });

  it("loadFromFile() 遇到不存在文件抛出错误", async () => {
    await expect(loader.loadFromFile("./nonexistent.json")).rejects.toThrow("不存在");
  });
});

describe("DynamicImportLoader — JSON 技能加载", () => {
  let loader: DynamicImportLoader;

  beforeEach(() => {
    loader = new DynamicImportLoader({ baseDir: process.cwd() });
  });

  it("加载有效的 JSON 技能", async () => {
    // 创建一个临时 JSON 技能文件用于测试
    const fs = await import("node:fs");
    const path = await import("node:path");
    const tmpDir = "./tests/skills";
    const jsonPath = path.join(tmpDir, "test-json-skill.json");

    fs.writeFileSync(jsonPath, JSON.stringify({
      id: "test-json-skill",
      agentType: "code",
      name: "JSON 测试技能",
      triggerTags: ["test"],
      trigger: "测试触发",
      steps: ["步骤1", "步骤2"],
      expectedOutput: "测试输出",
      version: "1.0.0",
    }));

    try {
      const skill = await loader.loadFromFile(jsonPath);
      expect(skill.meta.id).toBe("test-json-skill");
      expect(skill.meta.name).toBe("JSON 测试技能");
      expect(skill.meta.version).toBe("1.0.0");
      expect(typeof skill.execute).toBe("function");

      // 执行 JSON 技能
      const result = await skill.execute({
        input: { branch: "main" },
        env: {},
        signal: new AbortController().signal,
        logger: {
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {},
        },
        store: new Map(),
        traceId: "test",
      });

      expect(result.success).toBe(true);
    } finally {
      fs.unlinkSync(jsonPath);
    }
  });

  it("加载缺少必填字段的 JSON 抛出错误", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const tmpDir = "./tests/skills";
    const jsonPath = path.join(tmpDir, "bad-json.json");

    fs.writeFileSync(jsonPath, JSON.stringify({
      id: "bad",
      // 缺少 name, triggerTags, steps 等
    }));

    try {
      await expect(loader.loadFromFile(jsonPath)).rejects.toThrow("缺少必要字段");
    } finally {
      fs.unlinkSync(jsonPath);
    }
  });
});
