// @ci: unit
// ============================================================
// @cortex/schema — Unit tests
//
// 覆盖核心类型 + 原始类型 + 复合类型 + 修饰子 + 工厂入口。
// 所有测试使用 vitest 的 describe/it/expect。
// 零 any / 零非空断言 / 零空 catch。
// ============================================================

import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr } from "@cortex/result";
import { s, SchemaError, type Schema, type SchemaResult } from "../src/index.js";

// ─── SchemaError ───────────────────────────────────────────

describe("SchemaError", () => {
  it("should create an error with path, message, and code", () => {
    const error = new SchemaError(["user", "name"], "Expected a string", "EXPECTED_STRING");

    expect(error.name).toBe("SchemaError");
    expect(error.path).toEqual(["user", "name"]);
    expect(error.message).toBe("Expected a string");
    expect(error.code).toBe("EXPECTED_STRING");
    expect(error).toBeInstanceOf(Error);
  });

  it("should retain cause chain when provided", () => {
    const cause = new Error("original cause");
    const error = new SchemaError([], "validation failed", "FAILED", { cause });

    expect(error.cause).toBe(cause);
  });
});

// ─── StringSchema ──────────────────────────────────────────

describe("StringSchema", () => {
  it("should parse valid string", () => {
    const result = s.string().parse("hello");

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe("hello");
    }
  });

  it("should fail on non-string input", () => {
    const result = s.string().parse(42);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error[0].code).toBe("EXPECTED_STRING");
    }
  });

  it("should fail on null", () => {
    const result = s.string().parse(null);

    expect(isErr(result)).toBe(true);
  });

  it("should fail on undefined", () => {
    const result = s.string().parse(undefined);

    expect(isErr(result)).toBe(true);
  });

  it("should enforce minLength", () => {
    const schema = s.string({ minLength: 3 });
    const result = schema.parse("ab");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error[0].code).toBe("STRING_TOO_SHORT");
    }
  });

  it("should enforce maxLength", () => {
    const schema = s.string({ maxLength: 5 });
    const result = schema.parse("toolong");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error[0].code).toBe("STRING_TOO_LONG");
    }
  });

  it("should enforce pattern", () => {
    const schema = s.string({ pattern: /^[a-z]+$/ });
    const result = schema.parse("Hello123");

    expect(isErr(result)).toBe(true);
  });

  it("should pass valid string with all constraints", () => {
    const schema = s.string({ minLength: 2, maxLength: 10, pattern: /^[a-zA-Z]+$/ });
    const result = schema.parse("Alice");

    expect(isOk(result)).toBe(true);
  });

  it("should return errors via validate()", () => {
    const errors = s.string({ minLength: 3 }).validate("ab");

    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe("STRING_TOO_SHORT");
  });

  it("should return empty errors via validate() for valid data", () => {
    const errors = s.string().validate("hello");

    expect(errors.length).toBe(0);
  });
});

// ─── NumberSchema ─────────────────────────────────────────

describe("NumberSchema", () => {
  it("should parse valid number", () => {
    const result = s.number().parse(42);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });

  it("should fail on non-number input", () => {
    const result = s.number().parse("42");

    expect(isErr(result)).toBe(true);
  });

  it("should fail on NaN by default", () => {
    const result = s.number().parse(NaN);

    expect(isErr(result)).toBe(true);
  });

  it("should allow NaN when configured", () => {
    const schema = s.number({ allowNaN: true });
    const result = schema.parse(NaN);

    expect(isOk(result)).toBe(true);
  });

  it("should enforce integer constraint", () => {
    const schema = s.number({ integer: true });
    const result = schema.parse(3.14);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error[0].code).toBe("NOT_INTEGER");
    }
  });

  it("should enforce min constraint", () => {
    const schema = s.number({ min: 0 });
    const result = schema.parse(-1);

    expect(isErr(result)).toBe(true);
  });

  it("should enforce max constraint", () => {
    const schema = s.number({ max: 100 });
    const result = schema.parse(101);

    expect(isErr(result)).toBe(true);
  });

  it("should pass valid number with all constraints", () => {
    const schema = s.number({ min: 0, max: 100, integer: true });
    const result = schema.parse(50);

    expect(isOk(result)).toBe(true);
  });
});

// ─── BooleanSchema ─────────────────────────────────────────

describe("BooleanSchema", () => {
  it("should parse true", () => {
    const result = s.boolean().parse(true);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(true);
    }
  });

  it("should parse false", () => {
    const result = s.boolean().parse(false);

    expect(isOk(result)).toBe(true);
  });

  it("should fail on non-boolean", () => {
    const result = s.boolean().parse("true");

    expect(isErr(result)).toBe(true);
  });

  it("should fail on number", () => {
    const result = s.boolean().parse(1);

    expect(isErr(result)).toBe(true);
  });
});

// ─── LiteralSchema ─────────────────────────────────────────

describe("LiteralSchema", () => {
  it("should match exact string literal", () => {
    const schema = s.literal("active");
    const result = schema.parse("active");

    expect(isOk(result)).toBe(true);
  });

  it("should reject different string literal", () => {
    const schema = s.literal("active");
    const result = schema.parse("inactive");

    expect(isErr(result)).toBe(true);
  });

  it("should match exact number literal", () => {
    const schema = s.literal(42);
    const result = schema.parse(42);

    expect(isOk(result)).toBe(true);
  });

  it("should match exact boolean literal", () => {
    const schema = s.literal(true);
    const result = schema.parse(true);

    expect(isOk(result)).toBe(true);
  });
});

// ─── ObjectSchema ──────────────────────────────────────────

describe("ObjectSchema", () => {
  const userSchema = s.object({
    name: s.string({ minLength: 1 }),
    age: s.number({ integer: true, min: 0 }),
  });

  it("should parse valid object", () => {
    const result = userSchema.parse({ name: "Alice", age: 30 });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({ name: "Alice", age: 30 });
    }
  });

  it("should fail on non-object input", () => {
    const result = userSchema.parse("not an object");

    expect(isErr(result)).toBe(true);
  });

  it("should fail on null", () => {
    const result = userSchema.parse(null);

    expect(isErr(result)).toBe(true);
  });

  it("should fail when required field is missing", () => {
    const result = userSchema.parse({ name: "Alice" });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error[0].code).toBe("REQUIRED_FIELD_MISSING");
      expect(result.error[0].path).toContain("age");
    }
  });

  it("should fail when field value is invalid", () => {
    const result = userSchema.parse({ name: "Alice", age: -1 });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error[0].code).toBe("NUMBER_TOO_SMALL");
    }
  });

  it("should handle optional fields", () => {
    const schema = s.object({
      name: s.string(),
      email: s.string().optional(),
    });

    const result = schema.parse({ name: "Alice" });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({ name: "Alice", email: undefined });
    }
  });
});

// ─── ArraySchema ───────────────────────────────────────────

describe("ArraySchema", () => {
  it("should parse valid array", () => {
    const schema = s.array(s.number());
    const result = schema.parse([1, 2, 3]);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([1, 2, 3]);
    }
  });

  it("should fail on non-array input", () => {
    const result = s.array(s.string()).parse("not array");

    expect(isErr(result)).toBe(true);
  });

  it("should enforce minLength", () => {
    const schema = s.array(s.string(), { minLength: 2 });
    const result = schema.parse(["a"]);

    expect(isErr(result)).toBe(true);
  });

  it("should enforce maxLength", () => {
    const schema = s.array(s.string(), { maxLength: 3 });
    const result = schema.parse(["a", "b", "c", "d"]);

    expect(isErr(result)).toBe(true);
  });

  it("should validate each element", () => {
    const schema = s.array(s.number());
    const result = schema.parse([1, "two", 3]);

    expect(isErr(result)).toBe(true);
  });
});

// ─── UnionSchema ───────────────────────────────────────────

describe("UnionSchema", () => {
  it("should match first schema", () => {
    const schema = s.union<string | number>([s.string(), s.number()]);
    const result = schema.parse("hello");

    expect(isOk(result)).toBe(true);
  });

  it("should match second schema", () => {
    const schema = s.union<string | number>([s.string(), s.number()]);
    const result = schema.parse(42);

    expect(isOk(result)).toBe(true);
  });

  it("should fail when no schema matches", () => {
    const schema = s.union<string | number>([s.string(), s.number()]);
    const result = schema.parse(true);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error[0].code).toBe("UNION_NO_MATCH");
    }
  });
});

// ─── EnumSchema ────────────────────────────────────────────

describe("EnumSchema", () => {
  const colorSchema = s.enum(["red", "green", "blue"] as const);

  it("should parse valid enum value", () => {
    const result = colorSchema.parse("red");

    expect(isOk(result)).toBe(true);
  });

  it("should reject invalid enum value", () => {
    const result = colorSchema.parse("yellow");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error[0].code).toBe("ENUM_MISMATCH");
    }
  });

  it("should reject non-string", () => {
    const result = colorSchema.parse(42);

    expect(isErr(result)).toBe(true);
  });
});

// ─── RecordSchema ──────────────────────────────────────────

describe("RecordSchema", () => {
  it("should parse valid record", () => {
    const schema = s.record(s.number());
    const result = schema.parse({ a: 1, b: 2 });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({ a: 1, b: 2 });
    }
  });

  it("should fail on array", () => {
    const result = s.record(s.string()).parse([1, 2, 3]);

    expect(isErr(result)).toBe(true);
  });

  it("should fail on invalid value", () => {
    const schema = s.record(s.boolean());
    const result = schema.parse({ a: true, b: "not boolean" });

    expect(isErr(result)).toBe(true);
  });
});

// ─── TupleSchema ───────────────────────────────────────────

describe("TupleSchema", () => {
  it("should parse valid tuple", () => {
    const schema = s.tuple([s.string(), s.number()]);
    const result = schema.parse(["hello", 42]);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual(["hello", 42]);
    }
  });

  it("should fail on wrong length", () => {
    const schema = s.tuple([s.string(), s.number()]);
    const result = schema.parse(["hello"]);

    expect(isErr(result)).toBe(true);
  });

  it("should fail on non-array", () => {
    const schema = s.tuple([s.string(), s.number()]);
    const result = schema.parse("not array");

    expect(isErr(result)).toBe(true);
  });

  it("should fail on wrong element type", () => {
    const schema = s.tuple([s.string(), s.number()]);
    const result = schema.parse(["hello", "world"]);

    expect(isErr(result)).toBe(true);
  });
});

// ─── Transform ─────────────────────────────────────────────

describe("Schema.transform", () => {
  it("should transform validated value", () => {
    const schema = s.number().transform((n) => n.toString());
    const result = schema.parse(42);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe("42");
    }
  });

  it("should preserve errors from inner schema", () => {
    const schema = s.number({ integer: true }).transform((n) => n.toString());
    const result = schema.parse(3.14);

    expect(isErr(result)).toBe(true);
  });
});

// ─── Refine ────────────────────────────────────────────────

describe("Schema.refine", () => {
  it("should pass valid predicate", () => {
    const schema = s.number().refine((n) => n > 0, "Must be positive");
    const result = schema.parse(5);

    expect(isOk(result)).toBe(true);
  });

  it("should fail invalid predicate", () => {
    const schema = s.number().refine((n) => n > 0, "Must be positive");
    const result = schema.parse(-1);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error[0].code).toBe("REFINE_FAILED");
      expect(result.error[0].message).toBe("Must be positive");
    }
  });
});

// ─── Optional / Nullable ───────────────────────────────────

describe("Schema.optional", () => {
  it("should accept undefined", () => {
    const schema = s.string().optional();
    const result = schema.parse(undefined);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBeUndefined();
    }
  });

  it("should still validate actual values", () => {
    const schema = s.number().optional();
    const result = schema.parse("not a number");

    expect(isErr(result)).toBe(true);
  });
});

describe("Schema.nullable", () => {
  it("should accept null", () => {
    const schema = s.string().nullable();
    const result = schema.parse(null);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBeNull();
    }
  });

  it("should still validate actual values", () => {
    const schema = s.string().nullable();
    const result = schema.parse(42);

    expect(isErr(result)).toBe(true);
  });
});

// ─── Complex integration ───────────────────────────────────

describe("Complex schema integration", () => {
  it("should validate nested object with array and enum", () => {
    const configSchema = s.object({
      host: s.string({ minLength: 1 }),
      port: s.number({ integer: true, min: 1, max: 65535 }),
      protocol: s.enum(["http", "https"] as const),
      tags: s.array(s.string(), { minLength: 0 }),
      metadata: s.record(s.string()).optional(),
    });

    const validConfig = {
      host: "localhost",
      port: 8080,
      protocol: "http",
      tags: ["dev", "test"],
    };

    const result = configSchema.parse(validConfig);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.host).toBe("localhost");
      expect(result.value.port).toBe(8080);
      expect(result.value.protocol).toBe("http");
      expect(result.value.tags).toEqual(["dev", "test"]);
      expect(result.value.metadata).toBeUndefined();
    }
  });

  it("should collect multiple field errors in object", () => {
    const schema = s.object({
      name: s.string({ minLength: 1 }),
      age: s.number({ min: 0, max: 150 }),
    });

    const result = schema.parse({ name: "", age: 200 });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("should support chained operations", () => {
    const schema = s
      .string()
      .refine((v) => v.length > 0, "Cannot be empty")
      .transform((v) => v.trim());

    const result = schema.parse("  hello  ");

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe("hello");
    }
  });

  it("should validate with tuple containing objects", () => {
    const schema = s.tuple([
      s.object({ x: s.number(), y: s.number() }),
      s.string(),
    ]);

    const result = schema.parse([{ x: 10, y: 20 }, "point A"]);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value[0]).toEqual({ x: 10, y: 20 });
      expect(result.value[1]).toBe("point A");
    }
  });
});
