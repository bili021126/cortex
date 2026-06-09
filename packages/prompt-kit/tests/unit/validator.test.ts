// @ci: unit
/**
 * @cortex/prompt-kit — PromptValidator 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PromptValidator } from "../../src/validator/prompt-validator.js";
import { PromptBlockType } from "../../src/types.js";
import type { PromptTemplate, PromptResult } from "../../src/types.js";

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: "test-template",
    name: "测试模板",
    version: "1.0.0",
    blocks: [
      { id: "identity", type: PromptBlockType.Identity, content: "你是AI助手", priority: 10 },
      { id: "instruction", type: PromptBlockType.Instruction, content: "请帮助用户", priority: 40 },
    ],
    tags: ["test"],
    source: "test",
    ...overrides,
  };
}

function makeResult(overrides: Partial<PromptResult> = {}): PromptResult {
  return {
    text: "完整的渲染结果",
    templateId: "test-template",
    version: "1.0.0",
    renderedBlocks: [
      { id: "identity", type: PromptBlockType.Identity, content: "你是AI助手", order: 0 },
      { id: "instruction", type: PromptBlockType.Instruction, content: "请帮助用户", order: 1 },
    ],
    skippedBlocks: [],
    renderTimeMs: 10,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("PromptValidator", () => {
  let validator: PromptValidator;

  beforeEach(() => {
    validator = new PromptValidator();
  });

  describe("validateTemplate", () => {
    it("有效的模板应返回 valid=true", () => {
      const template = makeTemplate();
      const result = validator.validateTemplate(template);
      expect(result.valid).toBe(true);
    });

    it("缺少 id 应报错", () => {
      const template = makeTemplate({ id: "" });
      const result = validator.validateTemplate(template);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "id")).toBe(true);
    });

    it("缺少 name 应报错", () => {
      const template = makeTemplate({ name: "" });
      const result = validator.validateTemplate(template);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "name")).toBe(true);
    });

    it("空 blocks 列表应报错", () => {
      const template = makeTemplate({ blocks: [] });
      const result = validator.validateTemplate(template);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "blocks")).toBe(true);
    });

    it("重复的块 ID 应报错", () => {
      const template = makeTemplate({
        blocks: [
          { id: "dup", type: PromptBlockType.Identity, content: "a", priority: 1 },
          { id: "dup", type: PromptBlockType.Instruction, content: "b", priority: 2 },
        ],
      });
      const result = validator.validateTemplate(template);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("dup"))).toBe(true);
    });

    it("缺少 Identity/Persona 块应产生警告", () => {
      const template = makeTemplate({
        blocks: [
          { id: "instr", type: PromptBlockType.Instruction, content: "指令", priority: 1 },
        ],
      });
      const result = validator.validateTemplate(template);
      expect(result.valid).toBe(true); // 不阻断
      expect(result.warnings.some((w) => w.includes("Identity") || w.includes("Persona"))).toBe(true);
    });
  });

  describe("validateResult", () => {
    it("有效的渲染结果应返回 valid=true", () => {
      const result = makeResult();
      const validation = validator.validateResult(result);
      expect(validation.valid).toBe(true);
    });

    it("空文本应报错", () => {
      const result = makeResult({ text: "" });
      const validation = validator.validateResult(result);
      expect(validation.valid).toBe(false);
    });

    it("纯空白文本应报错", () => {
      const result = makeResult({ text: "   \n  \t  " });
      const validation = validator.validateResult(result);
      expect(validation.valid).toBe(false);
    });

    it("被跳过的高优先级块应产生警告", () => {
      const result = makeResult({
        text: "部分结果",
        skippedBlocks: [
          { id: "private-block", type: PromptBlockType.Private, reason: "access_denied" },
        ],
      });
      const validation = validator.validateResult(result);
      expect(validation.valid).toBe(true);
      expect(validation.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("checkRequiredSections", () => {
    it("应检测到所有必需段存在", () => {
      const result = makeResult();
      const check = validator.checkRequiredSections(result, [
        PromptBlockType.Identity,
        PromptBlockType.Instruction,
      ]);
      expect(check.allPresent).toBe(true);
      expect(check.missing).toHaveLength(0);
    });

    it("应检测到缺失的必需段", () => {
      const result = makeResult();
      const check = validator.checkRequiredSections(result, [
        PromptBlockType.OutputFormat,
      ]);
      expect(check.allPresent).toBe(false);
      expect(check.missing).toContain(PromptBlockType.OutputFormat);
    });

    it("空的 requiredTypes 应返回 allPresent=true", () => {
      const result = makeResult();
      const check = validator.checkRequiredSections(result, []);
      expect(check.allPresent).toBe(true);
    });
  });

  describe("自定义校验规则", () => {
    it("应支持注册自定义规则", () => {
      validator.registerRule("custom-rule", (template) => {
        if (template.version === "0.0.0") {
          return {
            path: "version",
            message: "版本号 0.0.0 不允许",
            severity: "error",
            code: "INVALID_VERSION",
          };
        }
        return null;
      });

      const invalid = makeTemplate({ version: "0.0.0" });
      const result = validator.validateTemplate(invalid);
      expect(result.errors.some((e) => e.code === "INVALID_VERSION")).toBe(true);
    });

    it("自定义规则应不影响有效模板", () => {
      validator.registerRule("always-ok", () => null);
      const template = makeTemplate();
      const result = validator.validateTemplate(template);
      expect(result.valid).toBe(true);
    });
  });

  describe("默认规则", () => {
    it("应检测未闭合的模板语法", () => {
      const template = makeTemplate({
        blocks: [
          { id: "b1", type: PromptBlockType.Identity, content: "你好 {{ name", priority: 1 },
        ],
      });
      const result = validator.validateTemplate(template);
      expect(result.errors.some((e) => e.code === "UNCLOSED_SYNTAX")).toBe(true);
    });

    it("应检测 #if 与 /if 不匹配", () => {
      const template = makeTemplate({
        blocks: [
          { id: "b1", type: PromptBlockType.Identity, content: "{{#if cond}}内容", priority: 1 },
        ],
      });
      const result = validator.validateTemplate(template);
      expect(result.errors.some((e) => e.code === "MISMATCHED_DIRECTIVES")).toBe(true);
    });

    it("缺少 source 应产生警告", () => {
      const template = makeTemplate({ source: undefined });
      const result = validator.validateTemplate(template);
      expect(result.warnings.some((w) => w.includes("来源"))).toBe(true);
    });
  });
});
