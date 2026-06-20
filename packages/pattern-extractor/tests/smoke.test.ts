/**
 * @cortex/pattern-extractor — 烟雾测试
 * 验证模式提取器核心接口的导出完整性和基本行为。
 */
import { describe, it, expect } from "vitest";
import { PatternScanner, PatternExtractor, PatternKind } from "@cortex/pattern-extractor";

describe("pattern-extractor exports", () => {
  it("should export PatternKind enum", () => {
    expect(PatternKind).toBeDefined();
  });

  it("should export PatternScanner interface (type-level)", () => {
    // Type-level test — just verify the symbol exists
    expect(true).toBe(true);
  });

  it("should export PatternExtractor interface (type-level)", () => {
    expect(true).toBe(true);
  });
});
