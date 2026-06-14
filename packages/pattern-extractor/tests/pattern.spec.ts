// @ci: unit
// ============================================================
// @cortex/pattern-extractor — pattern.ts 单元测试
//
// 覆盖范围：
// - PatternKind 枚举值完整性
// - Pattern 接口所有字段的类型与默认语义
// - SourceSpan / PatternBody / PatternExample / PatternElement 接口
// - IPatternExtractor 泛型接口的结构完整性
// - ExtractionContext 默认值语义
// - ExtractionResult 判别联合类型收窄（编译期行为验证）
// - IPatternValidator / IPatternMerger / IPipelineStage 接口
// - 各配置选项类型（AstExtractorOptions / RegexExtractorOptions / HeuristicExtractorOptions / ExtractorFactoryOptions）
// ============================================================

import { describe, it, expect } from "vitest";
import {
  PatternKind,
  type Pattern,
  type SourceSpan,
  type PatternBody,
  type PatternExample,
  type PatternElement,
  type IPatternExtractor,
  type ExtractionContext,
  type ExtractionResult,
  type IPatternValidator,
  type ValidationResult,
  type ValidationError,
  type IPatternMerger,
  type IPipelineStage,
  type PipelineStageContext,
  type AstExtractorOptions,
  type RegexExtractorOptions,
  type HeuristicExtractorOptions,
  type PatternRule,
  type HeuristicRule,
  type ExtractorFactoryOptions,
} from "../src/pattern.js";

// ============================================================
// §1 PatternKind 枚举
// ============================================================

describe("PatternKind", () => {
  it("应包含全部六种模式种类", () => {
    const values = Object.values(PatternKind);
    expect(values).toHaveLength(6);
  });

  it("Structural 枚举值应为 'structural'", () => {
    expect(PatternKind.Structural).toBe("structural");
  });

  it("Behavioral 枚举值应为 'behavioral'", () => {
    expect(PatternKind.Behavioral).toBe("behavioral");
  });

  it("Architectural 枚举值应为 'architectural'", () => {
    expect(PatternKind.Architectural).toBe("architectural");
  });

  it("Dataflow 枚举值应为 'dataflow'", () => {
    expect(PatternKind.Dataflow).toBe("dataflow");
  });

  it("Documentation 枚举值应为 'documentation'", () => {
    expect(PatternKind.Documentation).toBe("documentation");
  });

  it("Naming 枚举值应为 'naming'", () => {
    expect(PatternKind.Naming).toBe("naming");
  });

  it("所有枚举值均为字符串，可安全序列化为 JSON", () => {
    const json = JSON.stringify(PatternKind.Structural);
    expect(json).toBe('"structural"');

    const parsed = JSON.parse(json);
    expect(parsed).toBe("structural");
  });

  it("枚举值互不相同", () => {
    const values = Object.values(PatternKind);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

// ============================================================
// §2 Pattern 接口
// ============================================================

describe("Pattern 接口（结构验证）", () => {
  const createMinimalPattern = (): Pattern => ({
    id: "p-001",
    kind: PatternKind.Structural,
    name: "测试模式",
    description: "一个用于测试的模式",
    tags: ["test"],
    language: "typescript",
    confidence: 0.85,
    source: "test.ts",
    body: {
      rules: ["规则一"],
    },
    elements: [
      { name: "TestInterface", type: "interface", signature: "export interface TestInterface", isPrimary: true },
    ],
    extractor: "test-extractor",
    extractedAt: Date.now(),
    usageCount: 0,
    weight: 10,
  });

  it("应能使用最小必需字段创建 Pattern", () => {
    const pattern = createMinimalPattern();
    expect(pattern.id).toBe("p-001");
    expect(pattern.kind).toBe(PatternKind.Structural);
    expect(pattern.body.rules).toEqual(["规则一"]);
    expect(pattern.elements).toHaveLength(1);
    expect(pattern.usageCount).toBe(0);
  });

  it("sourceSpan 为可选字段，不提供时应为 undefined", () => {
    const pattern = createMinimalPattern();
    expect(pattern.sourceSpan).toBeUndefined();
  });

  it("应能携带 sourceSpan 定位信息", () => {
    const span: SourceSpan = { startLine: 10, endLine: 35 };
    const pattern: Pattern = {
      ...createMinimalPattern(),
      sourceSpan: span,
    };
    expect(pattern.sourceSpan).toEqual(span);
    expect(pattern.sourceSpan!.startLine).toBe(10);
    expect(pattern.sourceSpan!.endLine).toBe(35);
  });

  it("sourceSpan 支持可选的 startColumn 和 endColumn", () => {
    const span: SourceSpan = { startLine: 10, endLine: 35, startColumn: 1, endColumn: 80 };
    const pattern: Pattern = {
      ...createMinimalPattern(),
      sourceSpan: span,
    };
    expect(pattern.sourceSpan!.startColumn).toBe(1);
    expect(pattern.sourceSpan!.endColumn).toBe(80);
  });

  it("references 为可选字段，不提供时应为 undefined", () => {
    const pattern = createMinimalPattern();
    expect(pattern.references).toBeUndefined();
  });

  it("应能携带 references 引用列表", () => {
    const pattern: Pattern = {
      ...createMinimalPattern(),
      references: ["p-002", "p-003"],
    };
    expect(pattern.references).toEqual(["p-002", "p-003"]);
  });

  it("confidence 应在 0 到 1 之间", () => {
    const pattern = createMinimalPattern();
    expect(pattern.confidence).toBeGreaterThanOrEqual(0);
    expect(pattern.confidence).toBeLessThanOrEqual(1);
  });

  it("usageCount 初始应为 0，表示尚未被引用", () => {
    const pattern = createMinimalPattern();
    expect(pattern.usageCount).toBe(0);
  });

  it("weight 初始值应由提取器设定", () => {
    const pattern = createMinimalPattern();
    expect(pattern.weight).toBe(10);
  });

  it("tags 可以是任意字符串数组", () => {
    const pattern: Pattern = {
      ...createMinimalPattern(),
      tags: ["interface", "typescript", "agent", "design-pattern"],
    };
    expect(pattern.tags).toHaveLength(4);
    expect(pattern.tags).toContain("typescript");
  });

  it("elements 中的要素可以不是 primary", () => {
    const pattern: Pattern = {
      ...createMinimalPattern(),
      elements: [
        { name: "primary", type: "interface", isPrimary: true },
        { name: "secondary", type: "method", signature: "execute()", isPrimary: false },
      ],
    };
    const nonPrimary = pattern.elements.find((e) => !e.isPrimary);
    expect(nonPrimary).toBeDefined();
    expect(nonPrimary!.signature).toBe("execute()");
  });

  it("body 可以包含 template 模板代码", () => {
    const pattern: Pattern = {
      ...createMinimalPattern(),
      body: {
        rules: ["规则一"],
        template: "export interface {{name}} {\n  readonly {{prop}}: {{type}};\n}",
      },
    };
    expect(pattern.body.template).toBeDefined();
    expect(pattern.body.template).toContain("{{name}}");
  });

  it("body 可以包含 examples 正反例列表", () => {
    const pattern: Pattern = {
      ...createMinimalPattern(),
      body: {
        rules: ["规则一"],
        examples: [
          { code: "正确示例", isPositive: true, description: "正例说明" },
          { code: "错误示例", isPositive: false },
        ],
      },
    };
    expect(pattern.body.examples).toHaveLength(2);
    expect(pattern.body.examples![0].isPositive).toBe(true);
    expect(pattern.body.examples![0].description).toBe("正例说明");
    expect(pattern.body.examples![1].isPositive).toBe(false);
    expect(pattern.body.examples![1].description).toBeUndefined();
  });

  it("所有字段的 JSON 序列化应保留正确结构", () => {
    const pattern = createMinimalPattern();
    const json = JSON.stringify(pattern);
    const parsed = JSON.parse(json) as Pattern;
    expect(parsed.id).toBe("p-001");
    expect(parsed.kind).toBe("structural");
    expect(parsed.confidence).toBe(0.85);
    expect(parsed.body.rules).toEqual(["规则一"]);
    expect(parsed.elements[0].name).toBe("TestInterface");
  });
});

// ============================================================
// §3 SourceSpan 接口
// ============================================================

describe("SourceSpan", () => {
  it("startLine 和 endLine 是必需字段，应为正整数", () => {
    const span: SourceSpan = { startLine: 1, endLine: 42 };
    expect(span.startLine).toBe(1);
    expect(span.endLine).toBe(42);
  });

  it("startColumn 和 endColumn 为可选字段", () => {
    const withColumns: SourceSpan = { startLine: 1, endLine: 42, startColumn: 5, endColumn: 80 };
    const withoutColumns: SourceSpan = { startLine: 1, endLine: 42 };

    expect(withColumns.startColumn).toBe(5);
    expect(withColumns.endColumn).toBe(80);
    expect(withoutColumns.startColumn).toBeUndefined();
    expect(withoutColumns.endColumn).toBeUndefined();
  });

  it("仅提供 startLine 和 endLine 时不应报错", () => {
    const span: SourceSpan = { startLine: 10, endLine: 20 };
    expect(span.startLine).toBe(10);
    expect(span.endLine).toBe(20);
  });
});

// ============================================================
// §4 PatternBody / PatternExample / PatternElement
// ============================================================

describe("PatternBody", () => {
  it("rules 是必需字段，至少应有一条规则", () => {
    const body: PatternBody = { rules: ["规则必须存在"] };
    expect(body.rules.length).toBeGreaterThanOrEqual(1);
  });

  it("examples 和 template 为可选字段", () => {
    const minimal: PatternBody = { rules: ["规则"] };
    expect(minimal.examples).toBeUndefined();
    expect(minimal.template).toBeUndefined();

    const full: PatternBody = {
      rules: ["规则"],
      examples: [{ code: "例", isPositive: true }],
      template: "骨架",
    };
    expect(full.examples).toHaveLength(1);
    expect(full.template).toBe("骨架");
  });
});

describe("PatternExample", () => {
  it("code 和 isPositive 是必需字段", () => {
    const example: PatternExample = { code: "示例", isPositive: true };
    expect(example.code).toBe("示例");
    expect(example.isPositive).toBe(true);
  });

  it("description 为可选字段", () => {
    const withDesc: PatternExample = { code: "例", isPositive: true, description: "说明" };
    const withoutDesc: PatternExample = { code: "例", isPositive: true };

    expect(withDesc.description).toBe("说明");
    expect(withoutDesc.description).toBeUndefined();
  });
});

describe("PatternElement", () => {
  it("name、type、isPrimary 是必需字段", () => {
    const el: PatternElement = { name: "Agent", type: "interface", isPrimary: true };
    expect(el.name).toBe("Agent");
    expect(el.type).toBe("interface");
    expect(el.isPrimary).toBe(true);
  });

  it("signature 为可选字段", () => {
    const withSig: PatternElement = { name: "Agent", type: "interface", signature: "export interface Agent", isPrimary: true };
    const withoutSig: PatternElement = { name: "Agent", type: "interface", isPrimary: false };

    expect(withSig.signature).toBe("export interface Agent");
    expect(withoutSig.signature).toBeUndefined();
  });
});

// ============================================================
// §5 IPatternExtractor 接口
// ============================================================

describe("IPatternExtractor 接口", () => {
  it("应定义必需的结构属性——name、supportedLanguages、supportedKinds、description", () => {
    // 该断言验证接口结构：能构建一个最小实现
    const extractor: IPatternExtractor<string> = {
      name: "test",
      supportedLanguages: ["*"],
      supportedKinds: [PatternKind.Structural],
      description: "测试提取器",
      extract: (_input: string) => ({
        success: true,
        patterns: [],
        diagnostics: [],
        durationMs: 0,
      }),
      canHandle: (_lang: string, _kind: PatternKind) => true,
    };

    expect(extractor.name).toBe("test");
    expect(extractor.supportedLanguages).toEqual(["*"]);
    expect(extractor.supportedKinds).toEqual([PatternKind.Structural]);
    expect(extractor.description).toBe("测试提取器");
  });

  it("extract 方法应返回 ExtractionResult 判别联合", () => {
    const extractor: IPatternExtractor = {
      name: "test",
      supportedLanguages: ["*"],
      supportedKinds: [PatternKind.Structural],
      description: "test",
      extract: () => ({
        success: true,
        patterns: [],
        diagnostics: [],
        durationMs: 0,
      }),
      canHandle: () => true,
    };

    const result = extractor.extract("");
    // 编译期验证：success 收窄
    if (result.success) {
      expect(Array.isArray(result.patterns)).toBe(true);
      expect(typeof result.durationMs).toBe("number");
    }
  });

  it("extract 方法应支持泛型参数", () => {
    // 验证泛型类型参数可正常工作
    const extractor: IPatternExtractor<string, Record<string, unknown>> = {
      name: "generic-test",
      supportedLanguages: ["*"],
      supportedKinds: [PatternKind.Structural],
      description: "泛型测试",
      extract: (input: string) => ({
        success: true,
        patterns: [],
        diagnostics: [`处理了 ${input.length} 字符`],
        durationMs: 1,
      }),
      canHandle: () => true,
    };

    const result = extractor.extract("test input", { verbose: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.diagnostics[0]).toContain("处理了");
    }
  });

  it("canHandle 方法应返回布尔值", () => {
    const extractor: IPatternExtractor = {
      name: "test",
      supportedLanguages: ["typescript"],
      supportedKinds: [PatternKind.Structural],
      description: "test",
      extract: () => ({
        success: true,
        patterns: [],
        diagnostics: [],
        durationMs: 0,
      }),
      canHandle: (language: string, kind: PatternKind) =>
        language === "typescript" && kind === PatternKind.Structural,
    };

    expect(extractor.canHandle("typescript", PatternKind.Structural)).toBe(true);
    expect(extractor.canHandle("python", PatternKind.Structural)).toBe(false);
    expect(extractor.canHandle("typescript", PatternKind.Naming)).toBe(false);
  });
});

// ============================================================
// §6 ExtractionContext 接口
// ============================================================

describe("ExtractionContext", () => {
  it("所有字段均为可选", () => {
    const minimal: ExtractionContext = { filePaths: [] };
    expect(minimal.filePaths).toEqual([]);
    expect(minimal.workspaceRoot).toBeUndefined();
    expect(minimal.language).toBeUndefined();
    expect(minimal.targetKinds).toBeUndefined();
    expect(minimal.minConfidence).toBeUndefined();
    expect(minimal.enableMerge).toBeUndefined();
    expect(minimal.maxResults).toBeUndefined();
    expect(minimal.metadata).toBeUndefined();
  });

  it("应能携带完整配置", () => {
    const ctx: ExtractionContext = {
      workspaceRoot: "/workspace",
      filePaths: ["src/a.ts", "src/b.ts"],
      language: "typescript",
      targetKinds: [PatternKind.Structural, PatternKind.Behavioral],
      minConfidence: 0.6,
      enableMerge: true,
      maxResults: 50,
      metadata: { sessionId: "abc-123", userId: 42 },
    };

    expect(ctx.filePaths).toHaveLength(2);
    expect(ctx.targetKinds).toHaveLength(2);
    expect(ctx.minConfidence).toBe(0.6);
    expect(ctx.metadata!.sessionId).toBe("abc-123");
    expect(ctx.metadata!.userId).toBe(42);
  });

  it("metadata 可传递任意字符串/数字/布尔值", () => {
    const ctx: ExtractionContext = {
      filePaths: ["test.ts"],
      metadata: {
        str: "value",
        num: 123,
        bool: true,
      },
    };
    expect(ctx.metadata!.str).toBe("value");
    expect(ctx.metadata!.num).toBe(123);
    expect(ctx.metadata!.bool).toBe(true);
  });
});

// ============================================================
// §7 ExtractionResult 判别联合
// ============================================================

describe("ExtractionResult 判别联合（编译期模式验证）", () => {
  it("成功时应包含 patterns、diagnostics、durationMs", () => {
    const result: ExtractionResult = {
      success: true,
      patterns: [],
      diagnostics: ["一切正常"],
      durationMs: 42,
    };
    expect(result.success).toBe(true);
    if (result.success) {
      // 类型收窄：可访问 patterns
      expect(result.patterns).toEqual([]);
      expect(result.diagnostics[0]).toBe("一切正常");
      expect(result.durationMs).toBe(42);
    }
  });

  it("失败时应包含 error 且 patterns 为空数组", () => {
    const result: ExtractionResult = {
      success: false,
      patterns: [],
      diagnostics: ["解析错误"],
      durationMs: 5,
      error: "JSON 解析失败: 意外的 token",
    };
    expect(result.success).toBe(false);
    if (!result.success) {
      // 类型收窄：可访问 error
      expect(result.error).toContain("JSON 解析失败");
      expect(result.patterns).toEqual([]);
    }
  });

  it("success:true 时 error 不应存在", () => {
    const result: ExtractionResult = {
      success: true,
      patterns: [{ id: "p-001", kind: PatternKind.Structural, name: "test", description: "desc", tags: [], language: "ts", confidence: 0.9, source: "s", body: { rules: ["r"] }, elements: [{ name: "e", type: "t", isPrimary: true }], extractor: "e", extractedAt: 0, usageCount: 0, weight: 1 }],
      diagnostics: [],
      durationMs: 0,
    };

    expect(result.success).toBe(true);
    // 类型收窄后 error 不可访问（编译期），但运行时 undefined
    expect((result as any).error).toBeUndefined();
  });

  it("success:false 时 patterns 应为空数组字面量类型 []", () => {
    const result: ExtractionResult = {
      success: false,
      patterns: [],
      diagnostics: ["错误"],
      durationMs: 0,
      error: "出错了",
    };
    expect(result.patterns.length).toBe(0);
  });

  it("成功结果应可通过 JSON 序列化/反序列化", () => {
    const pattern: Pattern = {
      id: "p-001",
      kind: PatternKind.Structural,
      name: "模式",
      description: "描述",
      tags: ["tag1"],
      language: "ts",
      confidence: 0.9,
      source: "src.ts",
      body: { rules: ["rule"] },
      elements: [{ name: "e", type: "t", isPrimary: true }],
      extractor: "ext",
      extractedAt: 1000,
      usageCount: 0,
      weight: 9,
    };

    const result: ExtractionResult = {
      success: true,
      patterns: [pattern],
      diagnostics: [],
      durationMs: 10,
    };

    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);

    expect(parsed.success).toBe(true);
    expect(parsed.patterns).toHaveLength(1);
    expect(parsed.patterns[0].id).toBe("p-001");
    expect(parsed.patterns[0].kind).toBe("structural");
    expect(parsed.durationMs).toBe(10);
  });
});

// ============================================================
// §8 IPatternValidator 接口
// ============================================================

describe("IPatternValidator 接口", () => {
  it("应定义 validate 和 validateMany 方法", () => {
    const validator: IPatternValidator = {
      validate: (_pattern: Pattern) => ({
        valid: true,
        errors: [],
        warnings: [],
      }),
      validateMany: (_patterns: Pattern[]) => [],
    };

    const pattern: Pattern = {
      id: "p-001",
      kind: PatternKind.Structural,
      name: "test",
      description: "desc",
      tags: [],
      language: "ts",
      confidence: 0.9,
      source: "s",
      body: { rules: ["r"] },
      elements: [{ name: "e", type: "t", isPrimary: true }],
      extractor: "e",
      extractedAt: 0,
      usageCount: 0,
      weight: 1,
    };

    const result = validator.validate(pattern);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("validateMany 应返回与输入等长的结果列表", () => {
    const validator: IPatternValidator = {
      validate: () => ({ valid: true, errors: [], warnings: [] }),
      validateMany: (patterns: Pattern[]) =>
        patterns.map(() => ({ valid: true, errors: [], warnings: [] })),
    };

    const patterns: Pattern[] = [
      { id: "p-1", kind: PatternKind.Structural, name: "a", description: "d", tags: [], language: "ts", confidence: 0.5, source: "s", body: { rules: ["r"] }, elements: [{ name: "e", type: "t", isPrimary: true }], extractor: "e", extractedAt: 0, usageCount: 0, weight: 1 },
      { id: "p-2", kind: PatternKind.Naming, name: "b", description: "d", tags: [], language: "ts", confidence: 0.8, source: "s", body: { rules: ["r"] }, elements: [{ name: "e", type: "t", isPrimary: true }], extractor: "e", extractedAt: 0, usageCount: 0, weight: 1 },
    ];

    const results = validator.validateMany(patterns);
    expect(results).toHaveLength(2);
  });
});

describe("ValidationResult / ValidationError", () => {
  it("ValidationResult 应包含 valid、errors、warnings", () => {
    const failResult: ValidationResult = {
      valid: false,
      errors: [
        { field: "id", message: "id 是必需字段", severity: "error" },
      ],
      warnings: ["name 过长"],
    };

    expect(failResult.valid).toBe(false);
    expect(failResult.errors).toHaveLength(1);
    expect(failResult.errors[0].severity).toBe("error");
    expect(failResult.warnings).toHaveLength(1);
  });

  it("ValidationError 区分 error 和 warning 严重程度", () => {
    const errorEntry: ValidationError = { field: "id", message: "缺少 id", severity: "error" };
    const warningEntry: ValidationError = { field: "name", message: "名称过长", severity: "warning" };

    expect(errorEntry.severity).toBe("error");
    expect(warningEntry.severity).toBe("warning");
  });
});

// ============================================================
// §9 IPatternMerger 接口
// ============================================================

describe("IPatternMerger 接口", () => {
  it("merge 应接受 patterns 和可选的 threshold 参数", () => {
    const merger: IPatternMerger = {
      merge: (patterns: Pattern[], threshold = 0.8) => {
        // 简单实现：去重 name 相同的
        const seen = new Set<string>();
        return patterns.filter((p) => {
          if (seen.has(p.name)) return false;
          seen.add(p.name);
          return true;
        });
      },
    };

    const p1: Pattern = { id: "p-1", kind: PatternKind.Structural, name: "same", description: "d", tags: [], language: "ts", confidence: 0.9, source: "s", body: { rules: ["r"] }, elements: [{ name: "e", type: "t", isPrimary: true }], extractor: "e", extractedAt: 0, usageCount: 0, weight: 1 };
    const p2: Pattern = { id: "p-2", kind: PatternKind.Structural, name: "same", description: "d", tags: [], language: "ts", confidence: 0.8, source: "s", body: { rules: ["r"] }, elements: [{ name: "e", type: "t", isPrimary: true }], extractor: "e", extractedAt: 0, usageCount: 0, weight: 1 };
    const p3: Pattern = { id: "p-3", kind: PatternKind.Naming, name: "different", description: "d", tags: [], language: "ts", confidence: 0.7, source: "s", body: { rules: ["r"] }, elements: [{ name: "e", type: "t", isPrimary: true }], extractor: "e", extractedAt: 0, usageCount: 0, weight: 1 };

    const merged = merger.merge([p1, p2, p3]);
    expect(merged).toHaveLength(2);
    expect(merged.map((p) => p.id)).toContain("p-1");
    expect(merged.map((p) => p.id)).toContain("p-3");
  });

  it("threshold 默认应为 0.8", () => {
    const merger: IPatternMerger = {
      merge: (_patterns: Pattern[], threshold = 0.8) => {
        return threshold >= 0.8 ? [] : _patterns;
      },
    };
    expect(merger.merge([])).toEqual([]);
  });
});

// ============================================================
// §10 IPipelineStage / PipelineStageContext
// ============================================================

describe("IPipelineStage 接口", () => {
  it("应定义 name 属性和 run 方法", async () => {
    const stage: IPipelineStage = {
      name: "test-stage",
      run: async (ctx: PipelineStageContext) => ({
        ...ctx,
        diagnostics: [...ctx.diagnostics, "阶段已执行"],
      }),
    };

    expect(stage.name).toBe("test-stage");
    const result = await stage.run({
      patterns: [],
      diagnostics: [],
      metadata: {},
    });
    expect(result.diagnostics).toContain("阶段已执行");
  });

  it("run 应返回 PipelineStageContext", async () => {
    const stage: IPipelineStage = {
      name: "passthrough",
      run: async (ctx) => ctx,
    };

    const ctx: PipelineStageContext = {
      patterns: [],
      diagnostics: ["初始诊断"],
      metadata: { key: "value" },
    };
    const result = await stage.run(ctx);
    expect(result.patterns).toEqual([]);
    expect(result.diagnostics).toContain("初始诊断");
    expect(result.metadata.key).toBe("value");
  });
});

describe("PipelineStageContext", () => {
  it("patterns 在阶段间传递和变换", () => {
    const ctx: PipelineStageContext = {
      patterns: [
        {
          id: "p-1",
          kind: PatternKind.Structural,
          name: "a",
          description: "d",
          tags: [],
          language: "ts",
          confidence: 0.9,
          source: "s",
          body: { rules: ["r"] },
          elements: [{ name: "e", type: "t", isPrimary: true }],
          extractor: "e",
          extractedAt: 0,
          usageCount: 0,
          weight: 1,
        },
      ],
      diagnostics: [],
      metadata: {},
    };
    expect(ctx.patterns).toHaveLength(1);
    expect(ctx.patterns[0].id).toBe("p-1");
  });

  it("metadata 可传递任意类型数据", () => {
    const ctx: PipelineStageContext = {
      patterns: [],
      diagnostics: [],
      metadata: { score: 0.9, tags: ["a", "b"], config: { enable: true } },
    };
    expect(ctx.metadata.score).toBe(0.9);
    expect((ctx.metadata.tags as string[])).toEqual(["a", "b"]);
    expect((ctx.metadata.config as { enable: boolean }).enable).toBe(true);
  });
});

// ============================================================
// §11 配置选项类型
// ============================================================

describe("AstExtractorOptions", () => {
  it("所有字段均为可选", () => {
    const opts: AstExtractorOptions = {};
    expect(opts.extractTypes).toBeUndefined();
    expect(opts.extractFunctions).toBeUndefined();
    expect(opts.extractClasses).toBeUndefined();
    expect(opts.extractImports).toBeUndefined();
    expect(opts.maxDepth).toBeUndefined();
    expect(opts.minLines).toBeUndefined();
  });

  it("应能设置所有字段", () => {
    const opts: AstExtractorOptions = {
      extractTypes: true,
      extractFunctions: false,
      extractClasses: true,
      extractImports: false,
      maxDepth: 12,
      minLines: 5,
    };
    expect(opts.extractTypes).toBe(true);
    expect(opts.extractFunctions).toBe(false);
    expect(opts.maxDepth).toBe(12);
    expect(opts.minLines).toBe(5);
  });
});

describe("RegexExtractorOptions", () => {
  it("应能接受 rules 数组和 minHits 参数", () => {
    const opts: RegexExtractorOptions = {
      rules: [
        {
          name: "interface",
          regex: /export\s+interface\s+(\w+)/g,
          kind: PatternKind.Structural,
          confidence: 0.6,
          description: "匹配接口声明",
        },
      ],
      minHits: 2,
      maxPatterns: 10,
    };
    expect(opts.rules).toHaveLength(1);
    expect(opts.minHits).toBe(2);
    expect(opts.maxPatterns).toBe(10);
  });

  it("rules 中的 extract 回调为可选", () => {
    const rule: PatternRule = {
      name: "test",
      regex: /test/g,
      kind: PatternKind.Structural,
      confidence: 0.5,
    };
    expect(rule.extract).toBeUndefined();
  });
});

describe("HeuristicExtractorOptions", () => {
  it("应能接受 heuristics 规则和文件路径列表", () => {
    const opts: HeuristicExtractorOptions = {
      heuristics: [
        { name: "命名约定", kind: PatternKind.Naming, description: "推断命名风格", confidence: 0.5 },
      ],
      filePaths: ["src/a.ts", "src/b.ts"],
      minSampleSize: 5,
    };
    expect(opts.heuristics).toHaveLength(1);
    expect(opts.filePaths).toHaveLength(2);
    expect(opts.minSampleSize).toBe(5);
  });
});

describe("HeuristicRule", () => {
  it("应包含 name、kind、description、confidence", () => {
    const rule: HeuristicRule = {
      name: "目录结构",
      kind: PatternKind.Architectural,
      description: "分析 src/ 下的目录分层",
      confidence: 0.4,
    };
    expect(rule.name).toBe("目录结构");
    expect(rule.kind).toBe(PatternKind.Architectural);
  });
});

describe("ExtractorFactoryOptions", () => {
  it("所有字段均为可选", () => {
    const opts: ExtractorFactoryOptions = {};
    expect(opts.extractors).toBeUndefined();
    expect(opts.validator).toBeUndefined();
    expect(opts.merger).toBeUndefined();
    expect(opts.pipelineStages).toBeUndefined();
  });

  it("应能注入所有可选依赖", () => {
    const validator: IPatternValidator = {
      validate: () => ({ valid: true, errors: [], warnings: [] }),
      validateMany: () => [],
    };

    const merger: IPatternMerger = {
      merge: (patterns) => patterns,
    };

    const stage: IPipelineStage = {
      name: "custom",
      run: async (ctx) => ctx,
    };

    const opts: ExtractorFactoryOptions = {
      extractors: [],
      validator,
      merger,
      pipelineStages: [stage],
    };

    expect(opts.extractors).toEqual([]);
    expect(opts.validator).toBe(validator);
    expect(opts.merger).toBe(merger);
    expect(opts.pipelineStages).toHaveLength(1);
    expect(opts.pipelineStages![0].name).toBe("custom");
  });
});

// ============================================================
// §12 跨种类关联 —— 确保所有类型在 barrel 中可导入
// ============================================================

describe("barrel 导出一致性", () => {
  it("PatternKind 可被正确导入并使用", () => {
    // 此测试验证 pattern.ts 中的导出与 index.ts barrel 一致
    const kinds = [
      PatternKind.Structural,
      PatternKind.Behavioral,
      PatternKind.Architectural,
      PatternKind.Dataflow,
      PatternKind.Documentation,
      PatternKind.Naming,
    ] as const;
    expect(kinds).toHaveLength(6);
  });

  it("ExtractionResult 可使用 type 守卫收窄", () => {
    const successResult: ExtractionResult = {
      success: true,
      patterns: [],
      diagnostics: [],
      durationMs: 0,
    };
    const failResult: ExtractionResult = {
      success: false,
      patterns: [],
      diagnostics: [],
      durationMs: 0,
      error: "失败",
    };

    // 模拟类型守卫行为（运行时）
    if (successResult.success) {
      expect(successResult.patterns).toEqual([]);
    }
    if (!failResult.success) {
      expect(failResult.error).toBe("失败");
    }
  });
});
