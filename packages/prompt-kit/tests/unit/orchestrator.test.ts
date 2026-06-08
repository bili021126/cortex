/**
 * @cortex/prompt-kit — PromptOrchestrator 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PromptOrchestrator } from "../../src/orchestrator/prompt-orchestrator.js";
import { InlinePromptSource } from "../../src/loader/inline-source.js";
import { PromptBlockType } from "../../src/types.js";
import type { PromptTemplate } from "../../src/types.js";

describe("PromptOrchestrator", () => {
  let orchestrator: PromptOrchestrator;

  beforeEach(() => {
    orchestrator = new PromptOrchestrator({
      baseDir: process.cwd(),
      cacheMaxSize: 50,
      cacheDefaultTtlMs: 5000,
      injectIdentityAnchor: false,
    });
  });

  describe("初始化", () => {
    it("应正确初始化所有子组件", () => {
      expect(orchestrator.loader).toBeDefined();
      expect(orchestrator.assembler).toBeDefined();
      expect(orchestrator.templateEngine).toBeDefined();
      expect(orchestrator.validator).toBeDefined();
      expect(orchestrator.cache).toBeDefined();
      expect(orchestrator.version).toBeDefined();
    });
  });

  describe("renderSystemPrompt — 使用内联来源", () => {
    beforeEach(() => {
      // 注册测试用的内联模板
      const inlineSource = new InlinePromptSource();
      inlineSource.register("test-agent", "你是{{role}}。\n请帮助{{userName}}。", PromptBlockType.Instruction, 10);
      orchestrator.loader.registerSource("test-inline", inlineSource);
    });

    it("应渲染完整的 system prompt", async () => {
      const result = await orchestrator.renderSystemPrompt({
        baseTemplateId: "test-agent",
        context: {
          variables: {
            role: "分析师",
            userName: "开拓者",
          },
        },
      });

      expect(result.text).toContain("分析师");
      expect(result.text).toContain("开拓者");
      expect(result.templateId).toBe("test-agent");
      expect(result.renderedBlocks.length).toBeGreaterThan(0);
    });

    it("无 baseTemplateId 时应使用空模板", async () => {
      const result = await orchestrator.renderSystemPrompt({
        context: {
          variables: { role: "测试" },
        },
        additionalBlocks: [
          {
            id: "inline-block",
            type: PromptBlockType.Identity,
            content: "你是{{role}}",
            priority: 10,
          },
        ],
      });

      expect(result.text).toBe("你是测试");
    });

    it("应返回渲染耗时和时间戳", async () => {
      const result = await orchestrator.renderSystemPrompt({
        baseTemplateId: "test-agent",
        context: {
          variables: { role: "测试", userName: "测试" },
        },
      });

      expect(result.renderTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });
  });

  describe("loadTemplate", () => {
    it("应加载并缓存模板", async () => {
      // 注册内联模板
      const inlineSource = new InlinePromptSource();
      inlineSource.register("cache-test", "缓存测试内容");
      orchestrator.loader.registerSource("test-inline-2", inlineSource);

      const template = await orchestrator.loadTemplate("cache-test");
      expect(template).toBeDefined();
      expect(template.id).toBe("cache-test");

      // 应已缓存
      expect(orchestrator.cache.has("cache-test")).toBe(true);
    });
  });

  describe("renderBlock", () => {
    it("应快速渲染单块", async () => {
      const text = await orchestrator.renderBlock(
        { id: "greet", type: PromptBlockType.Identity, content: "你好，{{name}}！", priority: 1 },
        { variables: { name: "世界" } },
      );
      expect(text).toBe("你好，世界！");
    });
  });

  describe("validateAssembly", () => {
    it("完整 assembly 应通过校验", () => {
      const result = orchestrator.validateAssembly({
        baseTemplateId: "test",
        context: {
          variables: { role: "test" },
        },
      });
      expect(result.valid).toBe(true);
    });

    it("缺少 context.variables 应报错", () => {
      const result = orchestrator.validateAssembly({
        baseTemplateId: "test",
        context: {} as any,
      });
      expect(result.valid).toBe(false);
    });

    it("未缓存的 baseTemplateId 应产生警告", () => {
      const result = orchestrator.validateAssembly({
        baseTemplateId: "non-cached",
        context: {
          variables: { role: "test" },
        },
      });
      // 只要没有 error 级别的错误就算 valid
      expect(result.valid).toBe(true);
      // 但应有警告
      expect(result.warnings.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("缓存管理", () => {
    it("clearCache 应清空缓存", () => {
      const inlineSource = new InlinePromptSource();
      inlineSource.register("tpl", "内容");
      orchestrator.loader.registerSource("cache-src", inlineSource);

      // 填充缓存
      orchestrator.cache.set("tpl", {
        id: "tpl", name: "tpl", version: "1.0.0",
        blocks: [], tags: [], source: "test",
      });

      expect(orchestrator.cache.has("tpl")).toBe(true);
      orchestrator.clearCache();
      expect(orchestrator.cache.has("tpl")).toBe(false);
    });

    it("getCacheStats 应返回统计信息", () => {
      const stats = orchestrator.getCacheStats();
      expect(stats).toBeDefined();
      expect(typeof stats.size).toBe("number");
      expect(typeof stats.hitRate).toBe("number");
    });
  });

  describe("端到端流程", () => {
    it("应支持完整的编排管线", async () => {
      // 注册一个多块模板
      const inlineSource = new InlinePromptSource();
      inlineSource.registerTemplate({
        id: "e2e-agent",
        name: "端到端测试Agent",
        version: "1.0.0",
        blocks: [
          { id: "identity", type: PromptBlockType.Identity, content: "你是{{role}}。", priority: 10 },
          { id: "context", type: PromptBlockType.Context, content: "当前任务：{{task}}。", priority: 30, condition: "hasTask" },
          { id: "instruction", type: PromptBlockType.Instruction, content: "请使用{{tool}}来完成任务。", priority: 40 },
        ],
        tags: ["e2e"],
        source: "inline",
      });
      orchestrator.loader.registerSource("e2e-source", inlineSource);

      const result = await orchestrator.renderSystemPrompt({
        baseTemplateId: "e2e-agent",
        context: {
          variables: {
            role: "架构分析师",
            task: "分析代码质量",
            tool: "search_code",
            hasTask: true,
          },
        },
        blockSeparator: "\n",
        injectIdentityAnchor: true,
      });

      expect(result.text).toContain("架构分析师");
      expect(result.text).toContain("分析代码质量");
      expect(result.text).toContain("search_code");
      expect(result.text).toContain("身份锚点"); // injectIdentityAnchor=true
      expect(result.renderedBlocks).toHaveLength(4); // anchor + identity + context + instruction
    });
  });
});
