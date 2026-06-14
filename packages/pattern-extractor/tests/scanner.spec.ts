// @ci: unit
// ============================================================
// @cortex/pattern-extractor — scanner.ts 单元测试
//
// 覆盖范围：
// - PatternScanner 接口结构（name, supportedLanguages, supportedKinds, description,
//   scan(), canScan()）
// - ScanOptions 接口默认值与配置
// - ScanResult 判别联合（success / failure 分支）
// - ScanSummary 接口统计字段
// - ScanDiagnostic 接口严重级别与字段
// - DEFAULT_SCAN_OPTIONS / DEFAULT_SCANNER_NAME / DEFAULT_SCANNER_DESCRIPTION 常量
// - 边界情况：空输入、全字段配置、类型收窄
// ============================================================

import { describe, it, expect } from "vitest";
import {
  type PatternScanner,
  type ScanOptions,
  type ScanResult,
  type ScanSummary,
  type ScanDiagnostic,
  DEFAULT_SCAN_OPTIONS,
  DEFAULT_SCANNER_NAME,
  DEFAULT_SCANNER_DESCRIPTION,
} from "../src/scanner.js";
import { PatternKind } from "../src/pattern.js";
import type { PatternDefinition } from "../src/extractor.js";

// ============================================================
// §1 PatternScanner 接口
// ============================================================

describe("PatternScanner 接口（结构验证）", () => {
  it("应定义必需的结构化属性", () => {
    const scanner: PatternScanner = {
      name: "test-scanner",
      supportedLanguages: ["typescript", "javascript"],
      supportedKinds: [PatternKind.Structural, PatternKind.Behavioral],
      description: "测试扫描器",
      scan: async () => ({
        success: true,
        patterns: [],
        summary: {
          totalFiles: 0,
          filesScanned: 0,
          filesFailed: 0,
          rawPatterns: 0,
          totalPatterns: 0,
          kindsFound: [],
          kindDistribution: {},
          extractorsUsed: 0,
          extractorNames: [],
          durationMs: 0,
          maxConfidence: 0,
          avgConfidence: 0,
        },
        diagnostics: [],
        durationMs: 0,
      }),
      canScan: () => true,
    };

    expect(scanner.name).toBe("test-scanner");
    expect(scanner.supportedLanguages).toContain("typescript");
    expect(scanner.supportedKinds).toHaveLength(2);
    expect(typeof scanner.description).toBe("string");
  });

  it("scan 应返回 Promise<ScanResult>", async () => {
    const scanner: PatternScanner = {
      name: "async-test",
      supportedLanguages: ["*"],
      supportedKinds: [PatternKind.Structural],
      description: "异步测试",
      scan: async (_input: string | string[]) => ({
        success: true,
        patterns: [],
        summary: {
          totalFiles: 0,
          filesScanned: 0,
          filesFailed: 0,
          rawPatterns: 0,
          totalPatterns: 0,
          kindsFound: [],
          kindDistribution: {},
          extractorsUsed: 0,
          extractorNames: [],
          durationMs: 0,
          maxConfidence: 0,
          avgConfidence: 0,
        },
        diagnostics: [],
        durationMs: 0,
      }),
      canScan: () => true,
    };

    const result = await scanner.scan("test.ts");
    expect(result.success).toBe(true);
  });

  it("scan 应接受字符串数组输入", async () => {
    const scanner: PatternScanner = {
      name: "batch-scanner",
      supportedLanguages: ["*"],
      supportedKinds: [PatternKind.Structural],
      description: "批量扫描",
      scan: async (input: string | string[]) => {
        const files = Array.isArray(input) ? input : [input];
        return {
          success: true,
          patterns: [],
          summary: {
            totalFiles: files.length,
            filesScanned: files.length,
            filesFailed: 0,
            rawPatterns: 0,
            totalPatterns: 0,
            kindsFound: [],
            kindDistribution: {},
            extractorsUsed: 0,
            extractorNames: [],
            durationMs: 0,
            maxConfidence: 0,
            avgConfidence: 0,
          },
          diagnostics: [],
          durationMs: 0,
        };
      },
      canScan: () => true,
    };

    const result = await scanner.scan(["a.ts", "b.ts", "c.ts"]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.summary.totalFiles).toBe(3);
    }
  });

  it("canScan 应支持可选的 kind 参数", () => {
    const scanner: PatternScanner = {
      name: "selective-scanner",
      supportedLanguages: ["typescript"],
      supportedKinds: [PatternKind.Structural, PatternKind.Naming],
      description: "选择性扫描器",
      scan: async () => ({
        success: true,
        patterns: [],
        summary: {
          totalFiles: 0,
          filesScanned: 0,
          filesFailed: 0,
          rawPatterns: 0,
          totalPatterns: 0,
          kindsFound: [],
          kindDistribution: {},
          extractorsUsed: 0,
          extractorNames: [],
          durationMs: 0,
          maxConfidence: 0,
          avgConfidence: 0,
        },
        diagnostics: [],
        durationMs: 0,
      }),
      canScan: (language: string, kind?: PatternKind) => {
        if (!language) return false;
        if (!kind) return scanner.supportedLanguages.includes(language);
        return (
          scanner.supportedLanguages.includes(language) &&
          scanner.supportedKinds.includes(kind)
        );
      },
    };

    // 仅语言匹配
    expect(scanner.canScan("typescript")).toBe(true);
    expect(scanner.canScan("python")).toBe(false);

    // 语言 + 种类匹配
    expect(scanner.canScan("typescript", PatternKind.Structural)).toBe(true);
    expect(scanner.canScan("typescript", PatternKind.Naming)).toBe(true);

    // 语言匹配但种类不匹配
    expect(scanner.canScan("typescript", PatternKind.Behavioral)).toBe(false);
  });

  it("scan 在失败时应返回 error 信息和空 patterns", async () => {
    const scanner: PatternScanner = {
      name: "failing-scanner",
      supportedLanguages: ["*"],
      supportedKinds: [PatternKind.Structural],
      description: "总是失败的扫描器",
      scan: async () => ({
        success: false,
        patterns: [],
        summary: {
          totalFiles: 1,
          filesScanned: 0,
          filesFailed: 1,
          rawPatterns: 0,
          totalPatterns: 0,
          kindsFound: [],
          kindDistribution: {},
          extractorsUsed: 0,
          extractorNames: [],
          durationMs: 5,
          maxConfidence: 0,
          avgConfidence: 0,
        },
        diagnostics: [{ severity: "error", message: "扫描失败", source: "failing-scanner", timestamp: Date.now() }],
        durationMs: 5,
        error: "无法读取文件: test.ts",
      }),
      canScan: () => true,
    };

    const result = await scanner.scan("test.ts");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("无法读取文件");
      expect(result.patterns).toEqual([]);
      expect(result.summary.filesFailed).toBe(1);
    }
  });
});

// ============================================================
// §2 ScanOptions 接口
// ============================================================

describe("ScanOptions", () => {
  it("所有字段均为可选", () => {
    const opts: ScanOptions = {};
    expect(opts.language).toBeUndefined();
    expect(opts.targetKinds).toBeUndefined();
    expect(opts.minConfidence).toBeUndefined();
    expect(opts.enableMerge).toBeUndefined();
    expect(opts.mergeThreshold).toBeUndefined();
    expect(opts.maxResults).toBeUndefined();
    expect(opts.includeSummary).toBeUndefined();
    expect(opts.verbose).toBeUndefined();
    expect(opts.workspaceRoot).toBeUndefined();
    expect(opts.metadata).toBeUndefined();
  });

  it("应能设置所有字段", () => {
    const opts: ScanOptions = {
      language: "typescript",
      targetKinds: [PatternKind.Structural, PatternKind.Behavioral],
      minConfidence: 0.6,
      enableMerge: true,
      mergeThreshold: 0.85,
      maxResults: 50,
      includeSummary: true,
      verbose: true,
      workspaceRoot: "/home/project",
      metadata: { session: "abc-123" },
    };

    expect(opts.language).toBe("typescript");
    expect(opts.targetKinds).toHaveLength(2);
    expect(opts.minConfidence).toBe(0.6);
    expect(opts.enableMerge).toBe(true);
    expect(opts.mergeThreshold).toBe(0.85);
    expect(opts.maxResults).toBe(50);
    expect(opts.includeSummary).toBe(true);
    expect(opts.verbose).toBe(true);
    expect(opts.workspaceRoot).toBe("/home/project");
    expect(opts.metadata!.session).toBe("abc-123");
  });

  it("minConfidence 应为 0–1 范围的数值", () => {
    const opts: ScanOptions = { minConfidence: 0.5 };
    expect(opts.minConfidence).toBeGreaterThanOrEqual(0);
    expect(opts.minConfidence).toBeLessThanOrEqual(1);
  });

  it("mergeThreshold 应为 0–1 范围的数值", () => {
    const opts: ScanOptions = { mergeThreshold: 0.9 };
    expect(opts.mergeThreshold).toBeGreaterThanOrEqual(0);
    expect(opts.mergeThreshold).toBeLessThanOrEqual(1);
  });

  it("targetKinds 可设置为部分种类", () => {
    const partial: ScanOptions = { targetKinds: [PatternKind.Naming] };
    expect(partial.targetKinds).toEqual([PatternKind.Naming]);
  });

  it("targetKinds 可设置为全部种类", () => {
    const all: ScanOptions = {
      targetKinds: Object.values(PatternKind),
    };
    expect(all.targetKinds).toHaveLength(6);
  });

  it("metadata 可携带任意键值对", () => {
    const opts: ScanOptions = {
      metadata: {
        str: "hello",
        num: 42,
        bool: true,
        nested: { key: "value" },
      },
    };
    expect(opts.metadata!.str).toBe("hello");
    expect(opts.metadata!.num).toBe(42);
    expect(opts.metadata!.bool).toBe(true);
  });
});

// ============================================================
// §3 ScanResult 判别联合
// ============================================================

describe("ScanResult 判别联合", () => {
  const createSamplePattern = (): PatternDefinition => ({
    id: "p-sample",
    kind: PatternKind.Structural,
    name: "样本模式",
    description: "一个样本模式",
    tags: ["sample"],
    language: "typescript",
    confidence: 0.9,
    source: "sample.ts",
    body: { rules: ["规则"] },
    elements: [{ name: "Sample", type: "interface", isPrimary: true }],
    extractor: "test-extractor",
    extractedAt: Date.now(),
    usageCount: 0,
    weight: 9,
  });

  const createSampleSummary = (overrides?: Partial<ScanSummary>): ScanSummary => ({
    totalFiles: 1,
    filesScanned: 1,
    filesFailed: 0,
    rawPatterns: 1,
    totalPatterns: 1,
    kindsFound: [PatternKind.Structural],
    kindDistribution: { structural: 1 },
    extractorsUsed: 1,
    extractorNames: ["test-extractor"],
    durationMs: 10,
    maxConfidence: 0.9,
    avgConfidence: 0.9,
    ...overrides,
  });

  it("成功时 success 为 true，含 patterns 和 summary", () => {
    const result: ScanResult = {
      success: true,
      patterns: [createSamplePattern()],
      summary: createSampleSummary(),
      diagnostics: [],
      durationMs: 10,
    };

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0].id).toBe("p-sample");
      expect(result.summary.totalPatterns).toBe(1);
      expect(result.durationMs).toBe(10);
    }
  });

  it("失败时 success 为 false，含 error 和可选的 partialPatterns", () => {
    const result: ScanResult = {
      success: false,
      patterns: [],
      partialPatterns: [createSamplePattern()],
      summary: createSampleSummary({ totalFiles: 2, filesFailed: 1, filesScanned: 1 }),
      diagnostics: [{ severity: "error", message: "文件读取失败", source: "fs", timestamp: Date.now() }],
      durationMs: 50,
      error: "部分文件无法读取",
    };

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("部分文件无法读取");
      expect(result.patterns).toEqual([]);
      expect(result.partialPatterns).toBeDefined();
      expect(result.partialPatterns).toHaveLength(1);
      expect(result.summary.filesFailed).toBe(1);
    }
  });

  it("空的扫描结果（无模式）仍为 success: true", () => {
    const result: ScanResult = {
      success: true,
      patterns: [],
      summary: createSampleSummary({ totalPatterns: 0, rawPatterns: 0 }),
      diagnostics: [{ severity: "info", message: "未发现模式", source: "scanner", timestamp: Date.now() }],
      durationMs: 2,
    };

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.patterns).toEqual([]);
      expect(result.summary.totalPatterns).toBe(0);
    }
  });

  it("success: true 时 error 不应存在", () => {
    const result: ScanResult = {
      success: true,
      patterns: [],
      summary: createSampleSummary(),
      diagnostics: [],
      durationMs: 0,
    };

    expect(result.success).toBe(true);
    expect((result as any).error).toBeUndefined();
  });

  it("success: false 时 patterns 应为空数组", () => {
    const result: ScanResult = {
      success: false,
      patterns: [],
      summary: createSampleSummary(),
      diagnostics: [],
      durationMs: 0,
      error: "错误",
    };
    expect(result.patterns).toEqual([]);
  });
});

// ============================================================
// §4 ScanSummary 接口
// ============================================================

describe("ScanSummary", () => {
  it("应包含所有统计字段", () => {
    const summary: ScanSummary = {
      totalFiles: 10,
      filesScanned: 9,
      filesFailed: 1,
      rawPatterns: 25,
      totalPatterns: 15,
      kindsFound: [PatternKind.Structural, PatternKind.Naming],
      kindDistribution: { structural: 10, naming: 5 },
      extractorsUsed: 2,
      extractorNames: ["ast-extractor", "regex-extractor"],
      durationMs: 120,
      maxConfidence: 0.95,
      avgConfidence: 0.72,
    };

    expect(summary.totalFiles).toBe(10);
    expect(summary.filesScanned).toBe(9);
    expect(summary.filesFailed).toBe(1);
    expect(summary.rawPatterns).toBe(25);
    expect(summary.totalPatterns).toBe(15);
    expect(summary.kindsFound).toHaveLength(2);
    expect(summary.kindDistribution.structural).toBe(10);
    expect(summary.kindDistribution.naming).toBe(5);
    expect(summary.extractorsUsed).toBe(2);
    expect(summary.extractorNames).toContain("ast-extractor");
    expect(summary.durationMs).toBe(120);
    expect(summary.maxConfidence).toBe(0.95);
    expect(summary.avgConfidence).toBe(0.72);
  });

  it("kindDistribution 使用 Partial Record 可为某些种类缺失", () => {
    const summary: ScanSummary = {
      totalFiles: 1,
      filesScanned: 1,
      filesFailed: 0,
      rawPatterns: 1,
      totalPatterns: 1,
      kindsFound: [PatternKind.Structural],
      kindDistribution: { structural: 1 },
      extractorsUsed: 1,
      extractorNames: ["test"],
      durationMs: 5,
      maxConfidence: 0.8,
      avgConfidence: 0.8,
    };

    expect(summary.kindDistribution.structural).toBe(1);
    expect(summary.kindDistribution.behavioral).toBeUndefined();
  });

  it("无模式时的统计应使用 0 值", () => {
    const summary: ScanSummary = {
      totalFiles: 0,
      filesScanned: 0,
      filesFailed: 0,
      rawPatterns: 0,
      totalPatterns: 0,
      kindsFound: [],
      kindDistribution: {},
      extractorsUsed: 0,
      extractorNames: [],
      durationMs: 0,
      maxConfidence: 0,
      avgConfidence: 0,
    };

    expect(summary.totalPatterns).toBe(0);
    expect(summary.maxConfidence).toBe(0);
    expect(summary.avgConfidence).toBe(0);
    expect(summary.extractorNames).toEqual([]);
  });

  it("文件全部失败的场景", () => {
    const summary: ScanSummary = {
      totalFiles: 3,
      filesScanned: 0,
      filesFailed: 3,
      rawPatterns: 0,
      totalPatterns: 0,
      kindsFound: [],
      kindDistribution: {},
      extractorsUsed: 0,
      extractorNames: [],
      durationMs: 10,
      maxConfidence: 0,
      avgConfidence: 0,
    };

    expect(summary.filesFailed).toBe(3);
    expect(summary.filesScanned).toBe(0);
  });
});

// ============================================================
// §5 ScanDiagnostic 接口
// ============================================================

describe("ScanDiagnostic", () => {
  it("应包含 severity、message、source、timestamp", () => {
    const diag: ScanDiagnostic = {
      severity: "warning",
      message: "文件为空，跳过",
      source: "scanner",
      timestamp: 1_700_000_000_000,
    };

    expect(diag.severity).toBe("warning");
    expect(diag.message).toBe("文件为空，跳过");
    expect(diag.source).toBe("scanner");
    expect(diag.timestamp).toBe(1_700_000_000_000);
  });

  it("支持三种严重级别", () => {
    const info: ScanDiagnostic = { severity: "info", message: "信息", source: "s", timestamp: 0 };
    const warning: ScanDiagnostic = { severity: "warning", message: "警告", source: "s", timestamp: 0 };
    const error: ScanDiagnostic = { severity: "error", message: "错误", source: "s", timestamp: 0 };

    expect(info.severity).toBe("info");
    expect(warning.severity).toBe("warning");
    expect(error.severity).toBe("error");
  });

  it("filePath、patternId、code、stack 为可选字段", () => {
    const minimal: ScanDiagnostic = {
      severity: "info",
      message: "test",
      source: "s",
      timestamp: 0,
    };
    expect(minimal.filePath).toBeUndefined();
    expect(minimal.patternId).toBeUndefined();
    expect(minimal.code).toBeUndefined();
    expect(minimal.stack).toBeUndefined();

    const full: ScanDiagnostic = {
      severity: "error",
      message: "解析失败",
      source: "ast-extractor",
      timestamp: 1000,
      filePath: "src/test.ts",
      patternId: "p-001",
      code: "PARSE_ERROR",
      stack: "Error: ...",
    };
    expect(full.filePath).toBe("src/test.ts");
    expect(full.patternId).toBe("p-001");
    expect(full.code).toBe("PARSE_ERROR");
    expect(full.stack).toContain("Error");
  });

  it("timestamp 应为数值类型（Unix 毫秒）", () => {
    const diag: ScanDiagnostic = {
      severity: "info",
      message: "诊断信息",
      source: "test",
      timestamp: Date.now(),
    };
    expect(typeof diag.timestamp).toBe("number");
    expect(diag.timestamp).toBeGreaterThan(0);
  });
});

// ============================================================
// §6 默认常量
// ============================================================

describe("DEFAULT_SCAN_OPTIONS", () => {
  it("应包含所有必需字段的默认值", () => {
    expect(DEFAULT_SCAN_OPTIONS.minConfidence).toBe(0);
    expect(DEFAULT_SCAN_OPTIONS.enableMerge).toBe(true);
    expect(DEFAULT_SCAN_OPTIONS.mergeThreshold).toBe(0.8);
    expect(DEFAULT_SCAN_OPTIONS.maxResults).toBe(100);
    expect(DEFAULT_SCAN_OPTIONS.includeSummary).toBe(true);
    expect(DEFAULT_SCAN_OPTIONS.verbose).toBe(false);
  });

  it("应为只读对象（Object.freeze）", () => {
    // 尝试修改应静默失败（非严格模式）或抛出 TypeError（严格模式）
    expect(Object.isFrozen(DEFAULT_SCAN_OPTIONS)).toBe(true);
  });

  it("应为 Readonly<ScanOptions> 类型", () => {
    // 类型验证：不应包含 undefined 的字段
    const opts: Readonly<ScanOptions> = DEFAULT_SCAN_OPTIONS;
    expect(opts.minConfidence).toBeDefined();
  });

  it("默认值符合合理预期", () => {
    expect(DEFAULT_SCAN_OPTIONS.minConfidence).toBe(0); // 不过滤
    expect(DEFAULT_SCAN_OPTIONS.enableMerge).toBe(true); // 默认去重
    expect(DEFAULT_SCAN_OPTIONS.mergeThreshold).toBe(0.8); // 80% 相似度归并
    expect(DEFAULT_SCAN_OPTIONS.maxResults).toBe(100); // 最多返回 100 条
    expect(DEFAULT_SCAN_OPTIONS.includeSummary).toBe(true); // 包含摘要
    expect(DEFAULT_SCAN_OPTIONS.verbose).toBe(false); // 不输出详细诊断
  });
});

describe("DEFAULT_SCANNER_NAME", () => {
  it("应为 'default-scanner'", () => {
    expect(DEFAULT_SCANNER_NAME).toBe("default-scanner");
  });

  it("应为字符串", () => {
    expect(typeof DEFAULT_SCANNER_NAME).toBe("string");
  });
});

describe("DEFAULT_SCANNER_DESCRIPTION", () => {
  it("应包含主要技术关键词", () => {
    expect(DEFAULT_SCANNER_DESCRIPTION).toContain("模式扫描器");
    expect(DEFAULT_SCANNER_DESCRIPTION).toContain("AST");
    expect(DEFAULT_SCANNER_DESCRIPTION).toContain("正则");
    expect(DEFAULT_SCANNER_DESCRIPTION).toContain("启发式");
  });

  it("应为非空字符串", () => {
    expect(DEFAULT_SCANNER_DESCRIPTION.length).toBeGreaterThan(0);
  });
});

// ============================================================
// §7 边界情况
// ============================================================

describe("Scanner 边界情况", () => {
  it("scan 接受空字符串输入", async () => {
    const scanner: PatternScanner = {
      name: "empty-input",
      supportedLanguages: ["*"],
      supportedKinds: [PatternKind.Structural],
      description: "空输入测试",
      scan: async (input: string | string[]) => {
        const isEmpty = typeof input === "string" && input.length === 0;
        return {
          success: isEmpty ? false : true,
          patterns: [],
          summary: {
            totalFiles: typeof input === "string" ? 1 : input.length,
            filesScanned: isEmpty ? 0 : 1,
            filesFailed: isEmpty ? 1 : 0,
            rawPatterns: 0,
            totalPatterns: 0,
            kindsFound: [],
            kindDistribution: {},
            extractorsUsed: 0,
            extractorNames: [],
            durationMs: 0,
            maxConfidence: 0,
            avgConfidence: 0,
          },
          diagnostics: isEmpty
            ? [{ severity: "error", message: "输入为空", source: "scanner", timestamp: Date.now() }]
            : [],
          durationMs: 0,
          ...(isEmpty ? { error: "输入为空" } : {}),
        } as ScanResult;
      },
      canScan: () => true,
    };

    const emptyResult = await scanner.scan("");
    expect(emptyResult.success).toBe(false);

    const validResult = await scanner.scan("test.ts");
    expect(validResult.success).toBe(true);
  });

  it("scan 接受空数组输入", async () => {
    const scanner: PatternScanner = {
      name: "empty-array",
      supportedLanguages: ["*"],
      supportedKinds: [PatternKind.Structural],
      description: "空数组测试",
      scan: async (_input: string | string[]) => ({
        success: true,
        patterns: [],
        summary: {
          totalFiles: 0,
          filesScanned: 0,
          filesFailed: 0,
          rawPatterns: 0,
          totalPatterns: 0,
          kindsFound: [],
          kindDistribution: {},
          extractorsUsed: 0,
          extractorNames: [],
          durationMs: 0,
          maxConfidence: 0,
          avgConfidence: 0,
        },
        diagnostics: [{ severity: "info", message: "空输入列表", source: "scanner", timestamp: Date.now() }],
        durationMs: 0,
      }),
      canScan: () => true,
    };

    const result = await scanner.scan([]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.summary.totalFiles).toBe(0);
    }
  });

  it("supportLanguages 为 ['*'] 时 canScan 任意语言均返回 true", () => {
    const scanner: PatternScanner = {
      name: "universal",
      supportedLanguages: ["*"],
      supportedKinds: [PatternKind.Structural],
      description: "通用扫描器",
      scan: async () => ({
        success: true,
        patterns: [],
        summary: {
          totalFiles: 0,
          filesScanned: 0,
          filesFailed: 0,
          rawPatterns: 0,
          totalPatterns: 0,
          kindsFound: [],
          kindDistribution: {},
          extractorsUsed: 0,
          extractorNames: [],
          durationMs: 0,
          maxConfidence: 0,
          avgConfidence: 0,
        },
        diagnostics: [],
        durationMs: 0,
      }),
      canScan: (language: string, kind?: PatternKind) => {
        if (!kind) return true;
        return scanner.supportedKinds.includes(kind);
      },
    };

    expect(scanner.canScan("typescript")).toBe(true);
    expect(scanner.canScan("python")).toBe(true);
    expect(scanner.canScan("ruby", PatternKind.Structural)).toBe(true);
    expect(scanner.canScan("go", PatternKind.Behavioral)).toBe(false);
  });

  it("空的 supportedKinds 应导致 canScan 对任何种类返回 false", () => {
    const scanner: PatternScanner = {
      name: "no-kinds",
      supportedLanguages: ["*"],
      supportedKinds: [],
      description: "无种类支持",
      scan: async () => ({
        success: true,
        patterns: [],
        summary: {
          totalFiles: 0,
          filesScanned: 0,
          filesFailed: 0,
          rawPatterns: 0,
          totalPatterns: 0,
          kindsFound: [],
          kindDistribution: {},
          extractorsUsed: 0,
          extractorNames: [],
          durationMs: 0,
          maxConfidence: 0,
          avgConfidence: 0,
        },
        diagnostics: [],
        durationMs: 0,
      }),
      canScan: (_language: string, _kind?: PatternKind) => {
        return false;
      },
    };

    expect(scanner.canScan("typescript", PatternKind.Structural)).toBe(false);
    expect(scanner.canScan("typescript", PatternKind.Naming)).toBe(false);
  });
});
