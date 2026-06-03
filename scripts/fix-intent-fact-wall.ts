/**
 * 修复 intent-fact-wall.test.ts — 移除 subType 引用 + ensureSubType 测试块
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const filePath = join(import.meta.dirname!, "..", "packages", "engine", "tests", "intent-fact-wall.test.ts");
let c = readFileSync(filePath, "utf-8");

// 1. 移除内联 subType 引用
c = c.replace(/, subType: "Fact"/g, "");
c = c.replace(/, subType: "Intent"/g, "");
c = c.replace(/, subType: ""/g, "");
c = c.replace(/, subType: undefined/g, "");

// 2. 移除 ensureSubType 整个 describe 块
const ensureBlock = `  // ════════════════════════════════════════════════════════
  // ensureSubType —— 写前 subType 默认值注入
  // ════════════════════════════════════════════════════════

  describe("ensureSubType", () => {
    it("未指定 subType → 默认标记为 Fact", () => {
      const input = makeInput({ subType: undefined });
      const result = wall.ensureSubType(input);
      expect(result.subType).toBe("");
    });

    it("已指定 subType 为 Intent → 保持不变", () => {
      const input = makeInput({ subType: "" });
      const result = wall.ensureSubType(input);
      expect(result.subType).toBe("");
    });

    it("已指定 subType 为 Fact → 保持不变", () => {
      const input = makeInput({ subType: "" });
      const result = wall.ensureSubType(input);
      expect(result.subType).toBe("");
    });

    it("不修改原始输入对象（不可变语义）", () => {
      const input = makeInput({ subType: undefined });
      const result = wall.ensureSubType(input);
      expect(input.subType).toBeUndefined(); // 原始不变
      expect(result).not.toBe(input); // 返回新对象
    });

    it("已有 subType 时直接返回原始引用", () => {
      const input = makeInput({ subType: "" });
      const result = wall.ensureSubType(input);
      expect(result).toBe(input); // 无需修改时返回原引用（性能优化）
    });
  });`;

c = c.replace(ensureBlock, "");

writeFileSync(filePath, c, "utf-8");
console.log("Fixed intent-fact-wall.test.ts");
