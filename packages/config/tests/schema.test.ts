// @ci: unit
// ============================================================
// tests/schema.test.ts —— JSON Schema 验证器测试
//
// 对标 AJV / Zod 的验证器级测试——确保 validateJsonSchema
// 对每种 type / keyword 正确生效。
// ============================================================

import { describe, it, expect } from "vitest";
import {
  validateJsonSchema,
  validateOrThrow,
  validateSafe,
  type JsonSchema,
} from "../src/loader.js";

// ═══════════════════════════════════════════════════
// object type
// ═══════════════════════════════════════════════════

describe("validateJsonSchema — object", () => {
  const schema: JsonSchema = {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1 },
      age: { type: "integer", minimum: 0 },
    },
  };

  it("合法对象——零错误", () => {
    const errors = validateJsonSchema({ name: "test", age: 25 }, schema);
    expect(errors).toHaveLength(0);
  });

  it("缺少 required 字段——报错", () => {
    const errors = validateJsonSchema({ age: 25 }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe("$.name");
  });

  it("嵌套字段类型错误——报错", () => {
    const errors = validateJsonSchema({ name: "test", age: "not-a-number" }, schema);
    expect(errors.some((e) => e.path === "$.age")).toBe(true);
  });

  it("顶层类型错误——报错", () => {
    const errors = validateJsonSchema("not-an-object", schema);
    expect(errors).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════
// string type
// ═══════════════════════════════════════════════════

describe("validateJsonSchema — string", () => {
  it("合法字符串——零错误", () => {
    expect(validateJsonSchema("hello", { type: "string", minLength: 1 })).toHaveLength(0);
  });

  it("minLength 失败——报错", () => {
    const errors = validateJsonSchema("a", { type: "string", minLength: 3 });
    expect(errors).toHaveLength(1);
  });

  it("enum 命中——零错误", () => {
    expect(
      validateJsonSchema("L0", { type: "string", enum: ["L0", "L1", "L2", "L3"] }),
    ).toHaveLength(0);
  });

  it("enum 未命中——报错", () => {
    const errors = validateJsonSchema("L4", { type: "string", enum: ["L0", "L1", "L2"] });
    expect(errors).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════
// number / integer
// ═══════════════════════════════════════════════════

describe("validateJsonSchema — number", () => {
  it("合法 number——零错误", () => {
    expect(validateJsonSchema(42, { type: "number", minimum: 0 })).toHaveLength(0);
  });

  it("minimum 失败——报错", () => {
    expect(validateJsonSchema(-1, { type: "number", minimum: 0 })).toHaveLength(1);
  });

  it("integer 类型为浮点——报错", () => {
    expect(validateJsonSchema(3.14, { type: "integer" })).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════
// array
// ═══════════════════════════════════════════════════

describe("validateJsonSchema — array", () => {
  it("合法数组——零错误", () => {
    expect(
      validateJsonSchema(["a", "b"], { type: "array", items: { type: "string" } }),
    ).toHaveLength(0);
  });

  it("items 子元素类型错误——报错", () => {
    const errors = validateJsonSchema(["a", 123], {
      type: "array",
      items: { type: "string" },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe("$[1]");
  });
});

// ═══════════════════════════════════════════════════
// boolean
// ═══════════════════════════════════════════════════

describe("validateJsonSchema — boolean", () => {
  it("合法 boolean——零错误", () => {
    expect(validateJsonSchema(true, { type: "boolean" })).toHaveLength(0);
    expect(validateJsonSchema(false, { type: "boolean" })).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════
// validateOrThrow
// ═══════════════════════════════════════════════════

describe("validateOrThrow", () => {
  it("合法数据不抛异常", () => {
    expect(() =>
      validateOrThrow({ name: "ok" }, { type: "object", required: ["name"], properties: { name: { type: "string" } } }),
    ).not.toThrow();
  });

  it("非法数据抛 ConfigValidationError", () => {
    expect(() =>
      validateOrThrow({}, { type: "object", required: ["name"], properties: { name: { type: "string" } } }),
    ).toThrow();
  });
});

// ═══════════════════════════════════════════════════
// models schema 回归
// ═══════════════════════════════════════════════════

describe("models schema 回归", () => {
  it("合法模型条目——零错误", () => {
    const errors = validateJsonSchema(
      {
        "deepseek-v4-flash": {
          label: "Flash",
          capabilities: ["chat", "streaming"],
          thinking: false,
          defaultFor: ["fix"],
        },
      },
      {
        type: "object",
        additionalProperties: {
          type: "object",
          required: ["label", "thinking"],
          properties: {
            label: { type: "string", minLength: 1 },
            thinking: { type: "boolean" },
          },
        },
      },
    );
    expect(errors).toHaveLength(0);
  });

  it("缺 label 的模型条目——被 additionalProperties 拦截", () => {
    const errors = validateJsonSchema(
      {
        "bad-model": {
          thinking: true,
        },
      },
      {
        type: "object",
        additionalProperties: {
          type: "object",
          required: ["label", "thinking"],
          properties: {
            label: { type: "string", minLength: 1 },
            thinking: { type: "boolean" },
          },
        },
      },
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.path.includes("bad-model") && e.message.includes("label"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════
// additionalProperties
// ═══════════════════════════════════════════════════

describe("validateJsonSchema — additionalProperties", () => {
  it("键在 properties 中——不触发 additionalProperties 校验", () => {
    const errors = validateJsonSchema(
      { name: "ok", age: 25 },
      {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
        },
        additionalProperties: { type: "string" },
      },
    );
    expect(errors).toHaveLength(0);
  });

  it("额外键不合法——被 additionalProperties 拦截", () => {
    const errors = validateJsonSchema(
      { name: "ok", extra: 123 },
      {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        additionalProperties: { type: "string" },
      },
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.path === "$.extra")).toBe(true);
  });

  it("无 properties 时所有键走 additionalProperties", () => {
    const errors = validateJsonSchema(
      { a: 1, b: "hello" },
      {
        type: "object",
        additionalProperties: { type: "string" },
      },
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.path === "$.a")).toBe(true);
    expect(errors.some((e) => e.path === "$.b")).toBe(false);
  });

  it("无 additionalProperties——额外键不校验", () => {
    const errors = validateJsonSchema(
      { name: "ok", extra: "any" },
      {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      },
    );
    expect(errors).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════
// Agent manifest 回归（P0-2 roundtable）
// ═══════════════════════════════════════════════════

describe("agent-manifest schema 回归 — roundtable", () => {
  const AGENT_ENTRY_SCHEMA = {
    type: "object",
    required: ["type", "role"],
    properties: {
      type: { type: "string", minLength: 1 },
      role: { type: "string", minLength: 1 },
      emoji: { type: "string" },
      roundtable: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1 },
          persona: { type: "string", minLength: 1 },
        },
        required: ["title"],
      },
    },
  };

  it("合法 roundtable——零错误", () => {
    const errors = validateJsonSchema(
      { type: "code", role: "dev", roundtable: { title: "测试标题", persona: "prompts/test.md" } },
      AGENT_ENTRY_SCHEMA,
    );
    expect(errors).toHaveLength(0);
  });

  it("缺 roundtable——可选，不报错", () => {
    const errors = validateJsonSchema(
      { type: "code", role: "dev" },
      AGENT_ENTRY_SCHEMA,
    );
    expect(errors).toHaveLength(0);
  });

  it("缺 title 的 roundtable——被拦截", () => {
    const errors = validateJsonSchema(
      { type: "code", role: "dev", roundtable: { persona: "prompts/test.md" } },
      AGENT_ENTRY_SCHEMA,
    );
    // roundtable object is valid (optional field with missing title is ok since required is at object level)...
    // actually the schema has required: ["title"] on roundtable, so absense of title should be caught
    const hasTitleError = errors.some((e) => e.path.includes("roundtable"));
    expect(hasTitleError).toBe(true);
  });

  it("缺 type 的 agent 条目——被拦截（P0-1 回归）", () => {
    const errors = validateJsonSchema(
      { "bad-agent": { role: "测试" } },
      {
        type: "object",
        additionalProperties: {
          type: "object",
          required: ["type", "role"],
          properties: {
            type: { type: "string" },
            role: { type: "string" },
          },
        },
      },
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.path.includes("bad-agent") && e.message.includes("type"))).toBe(true);
  });
});
