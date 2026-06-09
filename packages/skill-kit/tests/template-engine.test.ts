// ⚠️ 此测试已停用：核心逻辑已迁移至 @cortex/engine（TUI 深化 v2.6.4）
// ============================================================
// @cortex/skill-kit — SimpleTemplateEngine 单元测试
// ============================================================

import { describe, it, expect } from "vitest";
import { SimpleTemplateEngine } from "../dist/template-engine.js";

describe("SimpleTemplateEngine — 变量插值", () => {
  const engine = new SimpleTemplateEngine();

  it("渲染简单变量", () => {
    const result = engine.render("Hello, {{ name }}!", { name: "World" });
    expect(result).toBe("Hello, World!");
  });

  it("渲染嵌套属性", () => {
    const result = engine.render("{{ user.name }} is {{ user.age }}", {
      user: { name: "Alice", age: 30 },
    });
    expect(result).toBe("Alice is 30");
  });

  it("未定义变量使用占位符（空字符串）", () => {
    const result = engine.render("Hello, {{ name }}!", {});
    expect(result).toBe("Hello, !");
  });

  it("支持默认值语法 ||", () => {
    const result = engine.render("Hello, {{ name || Guest }}!", {});
    expect(result).toBe("Hello, Guest!");
  });

  it("多变量替换", () => {
    const result = engine.render("{{a}} + {{b}} = {{c}}", { a: 1, b: 2, c: 3 });
    expect(result).toBe("1 + 2 = 3");
  });
});

describe("SimpleTemplateEngine — 自定义分隔符", () => {
  it("使用自定义分隔符", () => {
    const engine = new SimpleTemplateEngine({ delimiters: ["{%", "%}"] });
    const result = engine.render("Hello, {% name %}!", { name: "World" });
    expect(result).toBe("Hello, World!");
  });
});

describe("SimpleTemplateEngine — HTML 转义", () => {
  it("启用 HTML 转义", () => {
    const engine = new SimpleTemplateEngine({ escapeHtml: true });
    const result = engine.render("{{ content }}", {
      content: '<script>alert("xss")</script>',
    });
    expect(result).toBe("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
  });

  it("默认不转义 HTML", () => {
    const engine = new SimpleTemplateEngine();
    const result = engine.render("{{ content }}", {
      content: '<script>alert("xss")</script>',
    });
    expect(result).toBe('<script>alert("xss")</script>');
  });
});

describe("SimpleTemplateEngine — 条件渲染", () => {
  const engine = new SimpleTemplateEngine();

  it("{{#if condition}} 真值渲染", () => {
    const result = engine.render("{{#if show}}Visible{{/if}}", { show: true });
    expect(result).toBe("Visible");
  });

  it("{{#if condition}} 假值不渲染", () => {
    const result = engine.render("{{#if show}}Visible{{/if}}", { show: false });
    expect(result).toBe("");
  });

  it("{{#if condition}}...{{else}}...{{/if}}", () => {
    const result = engine.render(
      "Result: {{#if ok}}Yes{{else}}No{{/if}}",
      { ok: false },
    );
    expect(result).toBe("Result: No");
  });

  it("! 取反条件", () => {
    const result = engine.render("{{#if !hidden}}Visible{{/if}}", { hidden: false });
    expect(result).toBe("Visible");
  });
});

describe("SimpleTemplateEngine — 循环渲染", () => {
  const engine = new SimpleTemplateEngine();

  it("{{#each list}}...{{/each}} 数组迭代", () => {
    const result = engine.render(
      "{{#each items}}{{ this }},{{/each}}",
      { items: ["a", "b", "c"] },
    );
    expect(result).toBe("a,b,c,");
  });

  it("循环中访问 index", () => {
    const result = engine.render(
      "{{#each items}}{{ index }}:{{ this }},{{/each}}",
      { items: ["x", "y"] },
    );
    expect(result).toBe("0:x,1:y,");
  });

  it("对象迭代", () => {
    const result = engine.render(
      "{{#each obj}}{{ key }}={{ this }},{{/each}}",
      { obj: { a: 1, b: 2 } },
    );
    expect(result).toContain("a=1,");
    expect(result).toContain("b=2,");
  });

  it("空列表返回空字符串", () => {
    const result = engine.render(
      "{{#each items}}{{ this }}{{/each}}",
      { items: [] },
    );
    expect(result).toBe("");
  });

  it("非数组/对象返回空字符串", () => {
    const result = engine.render(
      "{{#each items}}{{ this }}{{/each}}",
      { items: null },
    );
    expect(result).toBe("");
  });
});

describe("SimpleTemplateEngine — 边界情况", () => {
  const engine = new SimpleTemplateEngine();

  it("空模板返回空字符串", () => {
    expect(engine.render("", {})).toBe("");
  });

  it("无变量模板原样返回", () => {
    const result = engine.render("Hello, World!", {});
    expect(result).toBe("Hello, World!");
  });

  it("undefined 占位符可配置", () => {
    const engineWithPlaceholder = new SimpleTemplateEngine({
      undefinedPlaceholder: "[N/A]",
    });
    const result = engineWithPlaceholder.render("Value: {{ x }}", {});
    expect(result).toBe("Value: [N/A]");
  });

  it("多行模板", () => {
    const result = engine.render("Line1\n{{ var }}\nLine3", { var: "Line2" });
    expect(result).toBe("Line1\nLine2\nLine3");
  });
});

describe("SimpleTemplateEngine — renderEachLine", () => {
  const engine = new SimpleTemplateEngine();

  it("逐行渲染模板数组", () => {
    const templates = ["Hello, {{ name }}!", "Your age: {{ age }}"];
    const result = engine.renderEachLine(templates, {
      name: "Alice",
      age: 30,
    });
    expect(result).toEqual(["Hello, Alice!", "Your age: 30"]);
  });
});
