/**
 * @cortex/prompt-kit — PromptTemplateEngine 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PromptTemplateEngine } from "../../src/template-engine/prompt-template-engine.js";
import { PromptBlockType } from "../../src/types.js";
import type { PromptBlock, PromptContext } from "../../src/types.js";

describe("PromptTemplateEngine", () => {
  let engine: PromptTemplateEngine;
  let defaultContext: PromptContext;

  beforeEach(() => {
    engine = new PromptTemplateEngine();
    defaultContext = {
      variables: {
        userName: "开拓者",
        role: "分析师",
        taskName: "分析模块依赖",
        items: ["a", "b", "c"],
        hasMemory: true,
        count: 3,
        nested: { value: "deep" },
      },
    };
  });

  describe("变量插值", () => {
    it("应支持基本变量插值", () => {
      const result = engine.render("你好，{{userName}}！", defaultContext);
      expect(result).toBe("你好，开拓者！");
    });

    it("应支持默认值语法", () => {
      const result = engine.render("任务：{{taskName || 无任务}}", defaultContext);
      expect(result).toBe("任务：分析模块依赖");
    });

    it("未定义变量应使用默认占位符", () => {
      const result = engine.render("{{undefinedVar}}", defaultContext);
      expect(result).toBe("");
    });

    it("默认值在变量未定义时应生效", () => {
      const result = engine.render("{{missing || 默认值}}", defaultContext);
      expect(result).toBe("默认值");
    });

    it("应支持深层路径访问", () => {
      const result = engine.render("{{nested.value}}", defaultContext);
      expect(result).toBe("deep");
    });

    it("应支持 HTML 转义（启用时）", () => {
      const engineEscape = new PromptTemplateEngine({ escapeHtml: true });
      const result = engineEscape.render(
        "{{content}}",
        { variables: { content: '<script>alert("xss")</script>' } },
      );
      expect(result).not.toContain("<script>");
      expect(result).toContain("&lt;script&gt;");
    });
  });

  describe("条件渲染 {{#if}}", () => {
    it("条件为 true 时应渲染内容", () => {
      const result = engine.render(
        "{{#if hasMemory}}有记忆{{/if}}",
        defaultContext,
      );
      expect(result).toBe("有记忆");
    });

    it("条件为 false 时应清空内容", () => {
      const result = engine.render(
        "{{#if missing}}不应出现{{/if}}",
        defaultContext,
      );
      expect(result).toBe("");
    });

    it("应支持 {{else}} 分支（条件为 false 时渲染 else）", () => {
      const result = engine.render(
        "{{#if missing}}是{{else}}否{{/if}}",
        defaultContext,
      );
      expect(result).toBe("否");
    });

    it("条件为真时应渲染 if 分支而非 else", () => {
      const result = engine.render(
        "{{#if hasMemory}}有记忆{{else}}无记忆{{/if}}",
        defaultContext,
      );
      expect(result).toBe("有记忆");
    });
  });

  describe("循环渲染 {{#each}}", () => {
    it("应遍历数组元素", () => {
      const result = engine.render(
        "{{#each items}}{{this}}{{/each}}",
        defaultContext,
      );
      expect(result).toBe("a\nb\nc");
    });

    it("非数组应返回空字符串", () => {
      const result = engine.render(
        "{{#each missing}}不应出现{{/each}}",
        defaultContext,
      );
      expect(result).toBe("");
    });

    it("应支持 index 变量", () => {
      const result = engine.render(
        "{{#each items}}{{index}}:{{this}}\n{{/each}}",
        defaultContext,
      );
      // each 用 \n 连接，所以结果是 "0:a\n1:b\n2:c\n" 的拼接
      expect(result).toContain("0:a");
      expect(result).toContain("1:b");
      expect(result).toContain("2:c");
    });
  });

  describe("角色切换 {{#role}}", () => {
    it("应注入角色 persona", () => {
      const ctx: PromptContext = {
        variables: {
          role_nahida: "智慧与知识的化身",
        },
      };
      const result = engine.render(
        "{{#role nahida}}你好，我是纳西妲{{/role}}",
        ctx,
      );
      expect(result).toContain("[nahida 角色]");
      expect(result).toContain("智慧与知识的化身");
      expect(result).toContain("你好，我是纳西妲");
    });

    it("无角色 persona 时应仅渲染内容", () => {
      const result = engine.render(
        "{{#role unknown}}普通内容{{/role}}",
        defaultContext,
      );
      expect(result).toBe("普通内容");
    });
  });

  describe("{{#block}} 引用（自闭合）", () => {
    it("应引用已注册的块内容", () => {
      const ctx: PromptContext = {
        variables: {
          __blocks: {
            "identity-block": "你是架构分析师。",
          },
        },
      };
      const result = engine.render("引用：{{#block identity-block}}", ctx);
      expect(result).toBe("引用：你是架构分析师。");
    });

    it("未找到的块应显示占位", () => {
      const result = engine.render("{{#block missing-block}}", defaultContext);
      expect(result).toBe('[块 "missing-block" 未找到]');
    });
  });

  describe("{{#date}} 指令（自闭合）", () => {
    it("应格式化当前日期", () => {
      const now = new Date();
      const year = String(now.getFullYear());
      const result = engine.render("{{#date YYYY}}", defaultContext);
      expect(result).toBe(year);
    });

    it("默认格式为 YYYY-MM-DD", () => {
      const now = new Date();
      const expected = [
        String(now.getFullYear()),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-");
      const result = engine.render("{{#date}}", defaultContext);
      expect(result).toBe(expected);
    });
  });

  describe("{{#ref}} 与 {{#include}}（自闭合）", () => {
    it("{{#ref}} 应标记占位符", () => {
      const result = engine.render("引用：{{#ref shared-format}}", defaultContext);
      expect(result).toBe("引用：__REF_shared-format__");
    });

    it("{{#include}} 应标记占位符", () => {
      const result = engine.render("包含：{{#include prompts/rules.md}}", defaultContext);
      expect(result).toBe("包含：__INCLUDE_prompts/rules.md__");
    });
  });

  describe("renderBlock 与 renderBlocks", () => {
    it("renderBlock 应渲染单块", () => {
      const block: PromptBlock = {
        id: "test",
        type: PromptBlockType.Identity,
        content: "你是{{role}}",
        priority: 1,
      };
      const result = engine.renderBlock(block, defaultContext);
      expect(result).toBe("你是分析师");
    });

    it("renderBlocks 应拼接多个块", () => {
      const blocks: PromptBlock[] = [
        { id: "b1", type: PromptBlockType.Identity, content: "身份", priority: 1 },
        { id: "b2", type: PromptBlockType.Instruction, content: "指令", priority: 2 },
      ];
      const result = engine.renderBlocks(blocks, defaultContext, "\n---\n");
      expect(result).toBe("身份\n---\n指令");
    });

    it("空块列表应返回空字符串", () => {
      const result = engine.renderBlocks([], defaultContext);
      expect(result).toBe("");
    });
  });

  describe("自定义辅助函数与指令", () => {
    it("应支持注册自定义 helper", () => {
      expect(() => engine.registerHelper("test", () => "ok")).not.toThrow();
    });

    it("应支持注册自定义 directive", () => {
      engine.registerDirective("uppercase", (params, body) => {
        return body.toUpperCase();
      });
      const result = engine.render("{{#uppercase params}}hello world{{/uppercase}}", defaultContext);
      expect(result).toBe("HELLO WORLD");
    });
  });

  describe("边界情况", () => {
    it("空模板应返回空字符串", () => {
      expect(engine.render("", defaultContext)).toBe("");
    });

    it("无模板语法的纯文本应原样返回", () => {
      const text = "这是一段纯文本，没有模板语法。";
      expect(engine.render(text, defaultContext)).toBe(text);
    });

    it("不匹配的指令标签应保留原样", () => {
      const result = engine.render("{{#unknown}}内容{{/unknown}}", defaultContext);
      // 未知指令保持原样
      expect(result).toBe("{{#unknown}}内容{{/unknown}}");
    });

    it("自闭合指令与块指令可共存", () => {
      const result = engine.render(
        "日期：{{#date YYYY-MM-DD}}\n{{#if hasMemory}}有记忆{{/if}}",
        defaultContext,
      );
      expect(result).toContain("日期：");
      expect(result).toContain("有记忆");
    });
  });
});
