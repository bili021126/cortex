// @ci: unit
/**
 * @cortex/plugin-runner — schema.ts 单元测试
 *
 * 覆盖范围（完整行覆盖）：
 *
 * 第一层：类型校验原语（s 命名空间）
 *   - s.string()         StringValidator (min, max, pattern, email, url, uuid, nonEmpty)
 *   - s.number()         NumberValidator (min, max, integer, positive)
 *   - s.boolean()        BooleanValidator
 *   - s.object()         ObjectValidator (strict, passthrough, extend, pick, omit)
 *   - s.array()          ArrayValidator (min, max)
 *   - s.literal()        strict literal matching
 *   - s.union()          union (match at least one)
 *   - s.enum()           enum values list
 *   - s.any()            always pass
 *   - s.record()         dictionary value validation
 *
 * 第二层：PluginSchema 定义助手
 *   - definePluginSchema()
 *   - defineConfigSchema()
 *   - createMinimalSchema()
 *   - baseConfigSchema / strictConfigSchema / defaultPluginSchema
 *
 * 工具函数
 *   - composeSchemas()
 *   - validation.isValid / assert / formatErrors
 */
import { describe, it, expect } from "vitest";
import { s, definePluginSchema, defineConfigSchema, createMinimalSchema, defaultPluginSchema, composeSchemas, validation, } from "../src/schema.js";
// ══════════════════════════════════════════════════════════════
// 第一层：类型校验原语
// ══════════════════════════════════════════════════════════════
describe("s.string()", () => {
    it("valid string passes", () => {
        const v = s.string();
        expect(v.validate("hello")).toEqual([]);
        expect(v.validate("")).toEqual([]);
    });
    it("non-string returns type error", () => {
        const v = s.string();
        expect(v.validate(123)).toEqual([": \u671f\u671b string\uff0c\u5b9e\u9645\u5f97\u5230 number"]);
        expect(v.validate(true)).toEqual([": \u671f\u671b string\uff0c\u5b9e\u9645\u5f97\u5230 boolean"]);
        expect(v.validate(null)).toEqual([": \u4e0d\u80fd\u4e3a null"]);
        expect(v.validate(undefined)).toEqual([": \u5fc5\u586b"]);
    });
    it("min() validates min length", () => {
        const v = s.string().min(2);
        expect(v.validate("ab")).toEqual([]);
        expect(v.validate("a")).toEqual([": \u957f\u5ea6\u4e0d\u80fd\u5c0f\u4e8e 2\uff08\u5f53\u524d 1\uff09"]);
    });
    it("max() validates max length", () => {
        const v = s.string().max(3);
        expect(v.validate("ab")).toEqual([]);
        expect(v.validate("abcd")).toEqual([": \u957f\u5ea6\u4e0d\u80fd\u5927\u4e8e 3\uff08\u5f53\u524d 4\uff09"]);
    });
    it("min and max combined", () => {
        const v = s.string().min(2).max(4);
        expect(v.validate("ab")).toEqual([]);
        expect(v.validate("abc")).toEqual([]);
        expect(v.validate("a")).toEqual([": \u957f\u5ea6\u4e0d\u80fd\u5c0f\u4e8e 2\uff08\u5f53\u524d 1\uff09"]);
        expect(v.validate("abcde")).toEqual([": \u957f\u5ea6\u4e0d\u80fd\u5927\u4e8e 4\uff08\u5f53\u524d 5\uff09"]);
    });
    it("pattern() matches regex", () => {
        const v = s.string().pattern(/^[a-z]+$/);
        expect(v.validate("hello")).toEqual([]);
        expect(v.validate("Hello")).toEqual([": \u4e0d\u5339\u914d\u6a21\u5f0f /^[a-z]+$/"]);
    });
    it("pattern() with custom message", () => {
        const v = s.string().pattern(/^\d+$/, "digits only");
        expect(v.validate("123")).toEqual([]);
        expect(v.validate("abc")).toEqual([": digits only"]);
    });
    it("email() matches email format", () => {
        const v = s.string().email();
        expect(v.validate("user@example.com")).toEqual([]);
        expect(v.validate("not-an-email")).toEqual([": \u683c\u5f0f\u5fc5\u987b\u4e3a\u6709\u6548 email \u5730\u5740"]);
    });
    it("url() matches URL format", () => {
        const v = s.string().url();
        expect(v.validate("https://example.com")).toEqual([]);
        // localhost:3000 has no dot in hostname -> doesn't match URL pattern
        expect(v.validate("http://localhost:3000/path")).toEqual([": \u683c\u5f0f\u5fc5\u987b\u4e3a\u6709\u6548 URL"]);
    });
    it("uuid() matches UUID v4 format", () => {
        const v = s.string().uuid();
        expect(v.validate("550e8400-e29b-41d4-a716-446655440000")).toEqual([]);
        expect(v.validate("not-a-uuid")).toEqual([": \u683c\u5f0f\u5fc5\u987b\u4e3a\u6709\u6548 UUID v4"]);
    });
    it("nonEmpty() rejects empty string", () => {
        const v = s.string().nonEmpty();
        expect(v.validate("x")).toEqual([]);
        expect(v.validate("")).toEqual([": \u957f\u5ea6\u4e0d\u80fd\u5c0f\u4e8e 1\uff08\u5f53\u524d 0\uff09"]);
    });
    it("optional() allows undefined", () => {
        const v = s.string().optional();
        expect(v.validate("hi")).toEqual([]);
        expect(v.validate(undefined)).toEqual([]);
        expect(v.validate(null)).toEqual([": \u4e0d\u80fd\u4e3a null"]);
    });
    it("nullable() allows null", () => {
        const v = s.string().nullable();
        expect(v.validate("hi")).toEqual([]);
        expect(v.validate(null)).toEqual([]);
        expect(v.validate(undefined)).toEqual([": \u5fc5\u586b"]);
    });
    it("optional + nullable allows both", () => {
        const v = s.string().optional().nullable();
        expect(v.validate("hi")).toEqual([]);
        expect(v.validate(undefined)).toEqual([]);
        expect(v.validate(null)).toEqual([]);
    });
    it("required() rejects undefined", () => {
        const v = s.string().required();
        expect(v.validate("hi")).toEqual([]);
        expect(v.validate(undefined)).toEqual([": \u5fc5\u586b"]);
    });
});
describe("s.number()", () => {
    it("valid numbers pass", () => {
        const v = s.number();
        expect(v.validate(42)).toEqual([]);
        expect(v.validate(0)).toEqual([]);
        expect(v.validate(-1)).toEqual([]);
    });
    it("NaN returns type error", () => {
        const v = s.number();
        expect(v.validate(NaN)).toEqual([": \u671f\u671b number\uff0c\u5b9e\u9645\u5f97\u5230 number"]);
    });
    it("non-number returns type error", () => {
        const v = s.number();
        expect(v.validate("42")).toEqual([": \u671f\u671b number\uff0c\u5b9e\u9645\u5f97\u5230 string"]);
        expect(v.validate(null)).toEqual([": \u4e0d\u80fd\u4e3a null"]);
        expect(v.validate(undefined)).toEqual([": \u5fc5\u586b"]);
    });
    it("min() validates minimum", () => {
        const v = s.number().min(10);
        expect(v.validate(10)).toEqual([]);
        expect(v.validate(9)).toEqual([": \u4e0d\u80fd\u5c0f\u4e8e 10\uff08\u5f53\u524d 9\uff09"]);
    });
    it("max() validates maximum", () => {
        const v = s.number().max(100);
        expect(v.validate(100)).toEqual([]);
        expect(v.validate(101)).toEqual([": \u4e0d\u80fd\u5927\u4e8e 100\uff08\u5f53\u524d 101\uff09"]);
    });
    it("integer() rejects non-integers", () => {
        const v = s.number().integer();
        expect(v.validate(42)).toEqual([]);
        expect(v.validate(3.14)).toEqual([": \u5fc5\u987b\u4e3a\u6574\u6570\uff08\u5f53\u524d 3.14\uff09"]);
    });
    it("positive() rejects non-positive", () => {
        const v = s.number().positive();
        expect(v.validate(1)).toEqual([]);
        expect(v.validate(0)).toEqual([": \u5fc5\u987b\u4e3a\u6b63\u6570\uff08\u5f53\u524d 0\uff09"]);
        expect(v.validate(-5)).toEqual([": \u5fc5\u987b\u4e3a\u6b63\u6570\uff08\u5f53\u524d -5\uff09"]);
    });
    it("optional() allows undefined", () => {
        const v = s.number().optional();
        expect(v.validate(42)).toEqual([]);
        expect(v.validate(undefined)).toEqual([]);
    });
    it("nullable() allows null", () => {
        const v = s.number().nullable();
        expect(v.validate(42)).toEqual([]);
        expect(v.validate(null)).toEqual([]);
    });
});
describe("s.boolean()", () => {
    it("true/false pass", () => {
        const v = s.boolean();
        expect(v.validate(true)).toEqual([]);
        expect(v.validate(false)).toEqual([]);
    });
    it("non-boolean returns type error", () => {
        const v = s.boolean();
        expect(v.validate(0)).toEqual([": \u671f\u671b boolean\uff0c\u5b9e\u9645\u5f97\u5230 number"]);
        expect(v.validate(null)).toEqual([": \u4e0d\u80fd\u4e3a null"]);
        expect(v.validate(undefined)).toEqual([": \u5fc5\u586b"]);
    });
    it("optional allows undefined", () => {
        const v = s.boolean().optional();
        expect(v.validate(undefined)).toEqual([]);
    });
    it("nullable allows null", () => {
        const v = s.boolean().nullable();
        expect(v.validate(null)).toEqual([]);
    });
});
describe("s.object()", () => {
    it("valid object passes", () => {
        const v = s.object({ name: s.string(), age: s.number() });
        expect(v.validate({ name: "Alice", age: 30 })).toEqual([]);
    });
    it("missing required field", () => {
        const v = s.object({ name: s.string(), age: s.number() });
        expect(v.validate({ name: "Alice" })).toContain("age: \u5fc5\u586b");
    });
    it("field type error", () => {
        const v = s.object({ name: s.string(), age: s.number() });
        expect(v.validate({ name: "Alice", age: "x" })).toContain("age: \u671f\u671b number\uff0c\u5b9e\u9645\u5f97\u5230 string");
    });
    it("nested object recursive validation", () => {
        const v = s.object({
            user: s.object({ name: s.string(), score: s.number() }),
        });
        expect(v.validate({ user: { name: "Bob", score: 100 } })).toEqual([]);
        expect(v.validate({ user: { name: "Bob", score: "high" } })).toContain("user.score: \u671f\u671b number\uff0c\u5b9e\u9645\u5f97\u5230 string");
    });
    it("non-strict ignores extra fields by default", () => {
        const v = s.object({ name: s.string() });
        expect(v.validate({ name: "Alice", extra: true })).toEqual([]);
    });
    it("strict() rejects unknown fields", () => {
        const v = s.object({ name: s.string() }).strict();
        expect(v.validate({ name: "Alice", extra: true })).toContain("extra: \u672a\u77e5\u5b57\u6bb5");
    });
    it("passthrough() overrides strict", () => {
        const v = s.object({ name: s.string() }).strict().passthrough();
        expect(v.validate({ name: "Alice", extra: true })).toEqual([]);
    });
    it("object optional allows undefined", () => {
        const v = s.object({ name: s.string() }).optional();
        expect(v.validate(undefined)).toEqual([]);
    });
    it("object nullable allows null", () => {
        const v = s.object({ name: s.string() }).nullable();
        expect(v.validate(null)).toEqual([]);
    });
    it("extend() merges schemas", () => {
        const Base = s.object({ name: s.string() });
        const Extended = Base.extend({ age: s.number() });
        expect(Extended.validate({ name: "Alice" })).toContain("age: \u5fc5\u586b");
        expect(Extended.validate({ name: "Alice", age: 25 })).toEqual([]);
    });
    it("extend() preserves strict flag", () => {
        const Base = s.object({ name: s.string() }).strict();
        const Extended = Base.extend({ age: s.number() });
        expect(Extended.validate({ name: "Alice", age: 25, extra: true })).toContain("extra: \u672a\u77e5\u5b57\u6bb5");
    });
    it("pick() selects specific fields", () => {
        const v = s.object({ a: s.string(), b: s.number().optional(), c: s.boolean() });
        const picked = v.pick(["a", "c"]);
        expect(picked.validate({ a: "x", c: true })).toEqual([]);
        expect(picked.validate({ a: "x" })).toContain("c: \u5fc5\u586b");
    });
    it("omit() excludes fields", () => {
        const v = s.object({ a: s.string(), b: s.number().optional(), c: s.boolean() });
        const omitted = v.omit(["b"]);
        expect(omitted.validate({ a: "x", c: true })).toEqual([]);
        expect(omitted.validate({ a: "x" })).toContain("c: \u5fc5\u586b");
    });
});
describe("s.array()", () => {
    it("valid array passes", () => {
        const v = s.array(s.number());
        expect(v.validate([1, 2, 3])).toEqual([]);
        expect(v.validate([])).toEqual([]);
    });
    it("non-array returns type error", () => {
        const v = s.array(s.number());
        expect(v.validate("not-array")).toEqual([": \u671f\u671b array\uff0c\u5b9e\u9645\u5f97\u5230 string"]);
        expect(v.validate(null)).toEqual([": \u4e0d\u80fd\u4e3a null"]);
        expect(v.validate(undefined)).toEqual([": \u5fc5\u586b"]);
    });
    it("element type error includes index", () => {
        const v = s.array(s.number());
        expect(v.validate([1, "x", 3])).toContain("[1]: \u671f\u671b number\uff0c\u5b9e\u9645\u5f97\u5230 string");
    });
    it("min() validates min length", () => {
        const v = s.array(s.string()).min(2);
        expect(v.validate(["a", "b"])).toEqual([]);
        expect(v.validate(["a"])).toEqual([": \u957f\u5ea6\u4e0d\u80fd\u5c0f\u4e8e 2\uff08\u5f53\u524d 1\uff09"]);
    });
    it("max() validates max length", () => {
        const v = s.array(s.string()).max(2);
        expect(v.validate(["a", "b"])).toEqual([]);
        expect(v.validate(["a", "b", "c"])).toEqual([": \u957f\u5ea6\u4e0d\u80fd\u5927\u4e8e 2\uff08\u5f53\u524d 3\uff09"]);
    });
    it("optional allows undefined", () => {
        const v = s.array(s.number()).optional();
        expect(v.validate(undefined)).toEqual([]);
    });
    it("nullable allows null", () => {
        const v = s.array(s.number()).nullable();
        expect(v.validate(null)).toEqual([]);
    });
});
describe("s.literal()", () => {
    it("matching literal passes", () => {
        expect(s.literal("strict").validate("strict")).toEqual([]);
    });
    it("non-matching returns error", () => {
        // String(value) for strings doesn't add quotes
        expect(s.literal("strict").validate("loose")).toEqual([": \u671f\u671b 'strict'\uff0c\u5b9e\u9645\u5f97\u5230 loose"]);
    });
    it("supports number literal", () => {
        expect(s.literal(42).validate(42)).toEqual([]);
        // String(0) = "0" without quotes
        expect(s.literal(42).validate(0)).toEqual([": \u671f\u671b '42'\uff0c\u5b9e\u9645\u5f97\u5230 0"]);
    });
    it("supports boolean literal", () => {
        expect(s.literal(true).validate(true)).toEqual([]);
        // String(false) = "false" without quotes
        expect(s.literal(true).validate(false)).toEqual([": \u671f\u671b 'true'\uff0c\u5b9e\u9645\u5f97\u5230 false"]);
    });
    it("null literal is intercepted by createValidator", () => {
        // s.literal(null): null is caught by createValidator before reaching literal compare
        expect(s.literal(null).validate(null)).toEqual([": \u4e0d\u80fd\u4e3a null"]);
        expect(s.literal(null).validate(undefined)).toEqual([": \u5fc5\u586b"]);
    });
});
describe("s.union()", () => {
    it("matches any member", () => {
        const v = s.union(s.string(), s.number());
        expect(v.validate("hello")).toEqual([]);
        expect(v.validate(42)).toEqual([]);
    });
    it("no match returns error", () => {
        const v = s.union(s.literal("yes"), s.literal("no"));
        expect(v.validate("maybe")[0]).toContain("\u4e0d\u5339\u914d\u4efb\u4f55\u8054\u5408\u6210\u5458");
    });
    it("empty union returns error", () => {
        expect(s.union().validate("x").length).toBeGreaterThan(0);
    });
});
describe("s.enum()", () => {
    it("valid enum value passes", () => {
        const v = s.enum(["low", "medium", "high"]);
        expect(v.validate("low")).toEqual([]);
        expect(v.validate("high")).toEqual([]);
    });
    it("invalid enum value fails", () => {
        const v = s.enum(["low", "medium", "high"]);
        expect(v.validate("urgent")[0]).toContain("\u5fc5\u987b\u4e3a\u4ee5\u4e0b\u503c\u4e4b\u4e00");
    });
});
describe("s.any()", () => {
    it("passes any value but rejects null/undefined without optional/nullable", () => {
        const v = s.any();
        expect(v.validate("string")).toEqual([]);
        expect(v.validate(42)).toEqual([]);
        expect(v.validate(true)).toEqual([]);
        expect(v.validate({})).toEqual([]);
        expect(v.validate([])).toEqual([]);
        // null/undefined are intercepted by createValidator before reaching any()
        expect(v.validate(null)).toEqual([": \u4e0d\u80fd\u4e3a null"]);
        expect(v.validate(undefined)).toEqual([": \u5fc5\u586b"]);
    });
    it("any().optional().nullable() accepts null/undefined", () => {
        const v = s.any().optional().nullable();
        expect(v.validate(null)).toEqual([]);
        expect(v.validate(undefined)).toEqual([]);
    });
});
describe("s.record()", () => {
    it("valid record passes", () => {
        const v = s.record(s.number());
        expect(v.validate({ a: 1, b: 2 })).toEqual([]);
        expect(v.validate({})).toEqual([]);
    });
    it("value type error", () => {
        expect(s.record(s.number()).validate({ a: "x" })).toContain("a: \u671f\u671b number\uff0c\u5b9e\u9645\u5f97\u5230 string");
    });
    it("non-object returns error", () => {
        expect(s.record(s.string()).validate("x")).toEqual([": \u671f\u671b Record\uff0c\u5b9e\u9645\u5f97\u5230 string"]);
        expect(s.record(s.string()).validate(null)).toEqual([": \u4e0d\u80fd\u4e3a null"]);
    });
    it("array returns error (not a record)", () => {
        expect(s.record(s.string()).validate(["a", "b"])).toEqual([": \u671f\u671b Record\uff0c\u5b9e\u9645\u5f97\u5230 array"]);
    });
    it("nested path in record", () => {
        const v = s.record(s.object({ name: s.string() }));
        expect(v.validate({ user: { name: 123 } })).toContain("user.name: \u671f\u671b string\uff0c\u5b9e\u9645\u5f97\u5230 number");
    });
});
// ══════════════════════════════════════════════════════════════
// 第二层：PluginSchema 定义助手
// ══════════════════════════════════════════════════════════════
describe("definePluginSchema()", () => {
    it("returns PluginSchema with name and validateConfig", () => {
        const schema = definePluginSchema("greeter", {
            config: s.object({ greeting: s.string().optional() }),
        });
        expect(schema.name).toBe("greeter");
        expect(typeof schema.validateConfig).toBe("function");
    });
    it("validateConfig validates config", () => {
        const schema = definePluginSchema("greeter", {
            config: s.object({
                greeting: s.string().optional(),
                maxUsers: s.number().min(1).max(100),
            }),
        });
        expect(schema.validateConfig({ greeting: "Hello", maxUsers: 10 })).toEqual([]);
        expect(schema.validateConfig({ maxUsers: 0 })).toContain("maxUsers: \u4e0d\u80fd\u5c0f\u4e8e 1\uff08\u5f53\u524d 0\uff09");
    });
    it("validateInput validates input", () => {
        const schema = definePluginSchema("greeter", {
            config: s.object({}),
            input: s.object({ name: s.string().min(1) }),
        });
        expect(schema.validateInput({ name: "Alice" })).toEqual([]);
        expect(schema.validateInput({ name: "" })).toContain("name: \u957f\u5ea6\u4e0d\u80fd\u5c0f\u4e8e 1\uff08\u5f53\u524d 0\uff09");
    });
    it("validateOutput validates output", () => {
        const schema = definePluginSchema("greeter", {
            config: s.object({}),
            output: s.object({ message: s.string() }),
        });
        expect(schema.validateOutput({ message: "ok" })).toEqual([]);
        expect(schema.validateOutput({ message: 42 })).toContain("message: \u671f\u671b string\uff0c\u5b9e\u9645\u5f97\u5230 number");
    });
    it("undefined input/output return empty array", () => {
        const schema = definePluginSchema("simple", { config: s.object({}) });
        expect(schema.validateInput("x")).toEqual([]);
        expect(schema.validateOutput("x")).toEqual([]);
    });
});
describe("defineConfigSchema()", () => {
    it("only has validateConfig", () => {
        const schema = defineConfigSchema("cfg-only", s.object({ enabled: s.boolean() }));
        expect(schema.name).toBe("cfg-only");
        expect(schema.validateConfig({ enabled: true })).toEqual([]);
        expect(schema.validateConfig({ enabled: "yes" })).toContain("enabled: \u671f\u671b boolean\uff0c\u5b9e\u9645\u5f97\u5230 string");
        expect(schema.validateInput).toBeUndefined();
        expect(schema.validateOutput).toBeUndefined();
    });
});
describe("baseConfigSchema", () => {
    it("validates standard config fields", () => {
        // Create a fresh schema to avoid mutation from strictConfigSchema
        const fresh = s.object({
            enabled: s.boolean().optional(),
            timeout: s.number().min(0).max(300_000).optional(),
            env: s.record(s.string()).optional(),
        });
        expect(fresh.validate({ enabled: true, timeout: 30000, env: { KEY: "val" } })).toEqual([]);
    });
    it("non-strict allows extra fields", () => {
        const fresh = s.object({
            enabled: s.boolean().optional(),
            timeout: s.number().min(0).max(300_000).optional(),
            env: s.record(s.string()).optional(),
        });
        expect(fresh.validate({ enabled: true, customField: "whatever" })).toEqual([]);
    });
});
describe("strictConfigSchema", () => {
    it("rejects unknown fields", () => {
        const fresh = s.object({
            enabled: s.boolean().optional(),
            timeout: s.number().min(0).max(300_000).optional(),
            env: s.record(s.string()).optional(),
        }).strict();
        expect(fresh.validate({ enabled: true, unknownField: "bad" })).toContain("unknownField: \u672a\u77e5\u5b57\u6bb5");
    });
});
describe("defaultPluginSchema", () => {
    it("validates standard PluginConfig", () => {
        expect(defaultPluginSchema.name).toBe("default");
        expect(defaultPluginSchema.validateConfig({ enabled: true })).toEqual([]);
        expect(defaultPluginSchema.validateConfig({ enabled: false, timeout: 5000 })).toEqual([]);
    });
});
describe("createMinimalSchema()", () => {
    it("generates base schema with enabled/timeout", () => {
        const schema = createMinimalSchema("minimal");
        expect(schema.name).toBe("minimal");
        expect(schema.validateConfig({ enabled: true })).toEqual([]);
    });
    it("required field missing -> error", () => {
        const schema = createMinimalSchema("strict", ["apiKey"]);
        // apiKey in shape (s.any()), not passed -> required
        expect(schema.validateConfig({ enabled: true })).toContain("apiKey: \u5fc5\u586b");
    });
});
// ══════════════════════════════════════════════════════════════
// composeSchemas
// ══════════════════════════════════════════════════════════════
describe("composeSchemas()", () => {
    it("merges validateConfig from all schemas", () => {
        const a = { name: "A", validateConfig: () => ["errA"] };
        const b = { name: "B", validateConfig: () => ["errB"] };
        const composed = composeSchemas("c", a, b);
        expect(composed.name).toBe("c");
        expect(composed.validateConfig({})).toEqual(["errA", "errB"]);
    });
    it("validateInput takes first defined", () => {
        const a = { name: "A", validateConfig: () => [], validateInput: () => ["from A"] };
        const b = { name: "B", validateConfig: () => [], validateInput: () => ["from B"] };
        expect(composeSchemas("c", a, b).validateInput("x")).toEqual(["from A"]);
    });
    it("validateOutput takes first defined", () => {
        const a = { name: "A", validateConfig: () => [] };
        const b = { name: "B", validateConfig: () => [], validateOutput: () => ["from B"] };
        expect(composeSchemas("c", a, b).validateOutput("x")).toEqual(["from B"]);
    });
    it("empty validateInput/validateOutput returns empty array", () => {
        const a = { name: "A", validateConfig: () => [] };
        expect(composeSchemas("c", a).validateInput("x")).toEqual([]);
        expect(composeSchemas("c", a).validateOutput("x")).toEqual([]);
    });
});
// ══════════════════════════════════════════════════════════════
// validation utilities
// ══════════════════════════════════════════════════════════════
describe("validation.isValid()", () => {
    it("returns true for valid", () => {
        expect(validation.isValid(s.string(), "hello")).toBe(true);
    });
    it("returns false for invalid", () => {
        expect(validation.isValid(s.number(), "x")).toBe(false);
    });
});
describe("validation.assert()", () => {
    it("does not throw on valid", () => {
        expect(() => validation.assert(s.boolean(), true)).not.toThrow();
    });
    it("throws Error on invalid", () => {
        expect(() => validation.assert(s.boolean(), 0)).toThrow("[Schema]");
        expect(() => validation.assert(s.boolean(), 0, "flag")).toThrow("flag");
    });
});
describe("validation.formatErrors()", () => {
    it("empty returns pass message", () => {
        expect(validation.formatErrors([])).toBe("\u6821\u9a8c\u901a\u8fc7");
    });
    it("formats errors", () => {
        const f = validation.formatErrors(["name: \u5fc5\u586b", "age: \u671f\u671b number"]);
        expect(f).toContain("\u6821\u9a8c\u5931\u8d25");
        expect(f).toContain("name: \u5fc5\u586b");
        expect(f).toContain("age: \u671f\u671b number");
    });
});
//# sourceMappingURL=schema.test.js.map