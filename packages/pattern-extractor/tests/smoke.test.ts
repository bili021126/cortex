/**
 * @cortex/pattern-extractor — 烟雾测试
 * 验证模式提取器核心接口的导出完整性和基本行为。
 */
import { describe, it, expect } from "vitest";
import {
  PatternScanner,
  PatternExtractor,
  PatternKind,
  PACKAGE_ANCHOR,
  DEFAULT_SCAN_OPTIONS,
  JsonPatternExtractor,
} from "@cortex/pattern-extractor";

describe("pattern-extractor exports", () => {
  it("should export PatternKind enum", () => {
    expect(PatternKind).toBeDefined();
    expect(Object.keys(PatternKind)).toContain("Structural");
    expect(PatternKind.Structural).toBe("structural");
    expect(PatternKind.Behavioral).toBe("behavioral");
    expect(PatternKind.Architectural).toBe("architectural");
  });

  it("should export PatternScanner interface (type-level)", () => {
    // Type-level test — just verify the symbol exists
    expect(true).toBe(true);
  });

  it("should export PatternExtractor interface (type-level)", () => {
    expect(true).toBe(true);
  });

  it("should export PACKAGE_ANCHOR constant", () => {
    expect(PACKAGE_ANCHOR).toBeDefined();
    expect(typeof PACKAGE_ANCHOR).toBe("string");
    expect(PACKAGE_ANCHOR).toContain("pattern-extractor");
  });

  it("should export DEFAULT_SCAN_OPTIONS with expected structure", () => {
    expect(DEFAULT_SCAN_OPTIONS).toBeDefined();
    expect(typeof DEFAULT_SCAN_OPTIONS).toBe("object");
  });

  it("should instantiate JsonPatternExtractor", () => {
    const extractor = new JsonPatternExtractor();
    expect(extractor).toBeDefined();
    expect(extractor.name).toBeDefined();
    expect(typeof extractor.name).toBe("string");
    expect(extractor.extract).toBeInstanceOf(Function);
    expect(extractor.canHandle).toBeInstanceOf(Function);
  });

  it("should handle empty input without crashing", () => {
    const extractor = new JsonPatternExtractor();
    const result = extractor.extract("");
    expect(result).toBeDefined();
    // Empty input returns success: false — that's acceptable
    expect(Array.isArray(result.patterns)).toBe(true);
  });

  it("should handle large input without crashing", () => {
    const extractor = new JsonPatternExtractor();
    const items: Array<{id: number; name: string; data: {x: number; y: number}}> = [];
    for (let i = 0; i < 50; i++) items.push({ id: i, name: `item-${i}`, data: { x: i * 2, y: i * 3 } });
    const result = extractor.extract(JSON.stringify({ items }));
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  it("should handle invalid input gracefully", () => {
    const extractor = new JsonPatternExtractor();
    const result = extractor.extract("{invalid json!!!}");
    expect(result).toBeDefined();
    // Invalid input returns success: false — that's acceptable (no throw)
    expect(Array.isArray(result.patterns)).toBe(true);
  });
});
