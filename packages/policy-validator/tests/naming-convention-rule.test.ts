// @ci: unit
/**
 * @cortex/policy-validator — NamingConventionRule 单元测试
 */

import { describe, it, expect } from "vitest";
import { NamingConventionRule, createRule } from "@cortex/policy-validator";

function makeRule(options?: { checkFunctionCamelCase?: boolean; checkClassPascalCase?: boolean }) {
  const ruleDef = createRule(
    "naming/convention",
    "style",
    "warning",
    "命名约定检查",
    "NAMING_CONVENTION",
    { fixSuggestion: "按命名规范重命名" },
  );
  return new NamingConventionRule(ruleDef, options);
}

describe("NamingConventionRule", () => {
  // ── 合规代码 ──

  it("should pass for camelCase function names", async () => {
    const rule = makeRule();
    const result = await rule.validate("test.ts", "function myFunction() {}");
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it("should pass for PascalCase class names", async () => {
    const rule = makeRule();
    const result = await rule.validate("test.ts", "class MyClass {}");
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it("should pass for UPPER_SNAKE_CASE constants", async () => {
    const rule = makeRule();
    const result = await rule.validate("test.ts", "const MAX_COUNT = 100;");
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it("should pass for single-word uppercase constants", async () => {
    const rule = makeRule();
    const result = await rule.validate("test.ts", "const MAXCOUNT = 100;");
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it("should pass for non-TS/JS files", async () => {
    const rule = makeRule();
    const result = await rule.validate("test.json", "{}");
    expect(result).toBeNull();
  });

  it("should pass for camelCase arrow function variable", async () => {
    const rule = makeRule();
    const result = await rule.validate("test.ts", "const myFunc = () => {}");
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  // ── 违规代码 ──

  it("should fail for function name in snake_case", async () => {
    const rule = makeRule();
    const result = await rule.validate("test.ts", "function my_function() {}");
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain("my_function");
  });

  it("should fail for class name in camelCase", async () => {
    const rule = makeRule();
    const result = await rule.validate("test.ts", "class myClass {}");
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain("myClass");
  });

  it("should fail for arrow function variable in snake_case", async () => {
    const rule = makeRule();
    const result = await rule.validate("test.ts", "const my_func = () => {}");
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain("my_func");
  });

  // ── 配置选项 ──

  it("should skip function check when disabled", async () => {
    const rule = makeRule({ checkFunctionCamelCase: false, checkClassPascalCase: true });
    // snake_case function should NOT fail because check disabled
    const result = await rule.validate("test.ts", "function my_function() {}");
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it("should skip class check when disabled", async () => {
    const rule = makeRule({ checkFunctionCamelCase: true, checkClassPascalCase: false });
    const result = await rule.validate("test.ts", "class myClass {}");
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  // ── 构造函数注入验证 ──

  it("should store injected option values", () => {
    const ruleDef = createRule("naming/convention", "style", "warning", "test", "T");
    const rule = new NamingConventionRule(ruleDef, {
      checkFunctionCamelCase: false,
      checkClassPascalCase: false,
      checkConstantUpperSnakeCase: false,
      checkPrivatePrefix: false,
    });
    expect(rule.name).toBe("NamingConventionRule");
    expect(rule.ruleId).toBe("naming/convention");
  });
});
