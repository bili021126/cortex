// @ci: unit
/**
 * @cortex/policy-validator — ExportRule 单元测试
 */

import { describe, it, expect } from "vitest";
import { ExportRule, createRule } from "@cortex/policy-validator";

function makeRule(options?: { checkDefaultExport?: boolean; checkTestRelativeImport?: boolean; checkBarrelExport?: boolean }) {
  const ruleDef = createRule(
    "export/convention",
    "import",
    "error",
    "导出规范检查",
    "EXPORT_CONVENTION",
    { fixSuggestion: "使用命名导出替代 export default" },
  );
  return new ExportRule(ruleDef, options);
}

describe("ExportRule", () => {
  // ── 合规代码 ──

  it("should pass for named exports", async () => {
    const rule = makeRule();
    const result = await rule.validate("test.ts", "export function myFunc() {}");
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it("should pass for non-TS files", async () => {
    const rule = makeRule();
    const result = await rule.validate("test.json", "{}");
    expect(result).toBeNull();
  });

  it("should pass for barrel index.ts with export default", async () => {
    const rule = makeRule({ checkDefaultExport: true });
    const result = await rule.validate("src/index.ts", "export default {};");
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true); // barrel files are exempt
  });

  // ── export default 检查 ──

  it("should fail for export default in non-barrel file", async () => {
    const rule = makeRule({ checkDefaultExport: true, checkTestRelativeImport: false, checkBarrelExport: false });
    const result = await rule.validate("src/helper.ts", "export default class Helper {}");
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain("export default");
  });

  // ── 测试文件相对导入检查 ──

  it("should fail for test file with ../src/ relative import", async () => {
    const rule = makeRule({ checkTestRelativeImport: true, checkDefaultExport: false, checkBarrelExport: false });
    const code = `
import { something } from "../src/helper";
import { other } from "@cortex/shared";
`;
    const result = await rule.validate("tests/helper.test.ts", code);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain("../src/");
  });

  it("should pass for test file with package imports", async () => {
    const rule = makeRule({ checkTestRelativeImport: true, checkDefaultExport: false, checkBarrelExport: false });
    const code = `
import { something } from "@cortex/shared";
import { RuleEngine } from "@cortex/policy-validator";
`;
    const result = await rule.validate("tests/helper.test.ts", code);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  // ── 配置选项 ──

  it("should skip default export check when disabled", async () => {
    const rule = makeRule({ checkDefaultExport: false, checkTestRelativeImport: false, checkBarrelExport: false });
    const result = await rule.validate("src/helper.ts", "export default class Helper {}");
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it("should skip test relative import check when disabled", async () => {
    const rule = makeRule({ checkTestRelativeImport: false, checkDefaultExport: false, checkBarrelExport: false });
    const result = await rule.validate("tests/test.ts", `import { x } from "../src/x"`);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  // ── 构造函数注入验证 ──

  it("should store injected options", () => {
    const ruleDef = createRule("export/convention", "import", "error", "test", "T");
    const rule = new ExportRule(ruleDef, {
      checkDefaultExport: true,
      checkTestRelativeImport: false,
      checkBarrelExport: false,
    });
    expect(rule.name).toBe("ExportRule");
    expect(rule.ruleId).toBe("export/convention");
  });
});
