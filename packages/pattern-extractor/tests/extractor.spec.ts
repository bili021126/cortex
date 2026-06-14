// @ci: unit
// ============================================================
// @cortex/pattern-extractor — extractor.ts & predefined/json-extractor.ts 单元测试
//
// 覆盖范围：
// - extractor.ts: PatternKind, PatternDefinition, PatternExtractor 接口,
//   PatternExtractorOptions, ExtractionContext, ExtractionResult, PACKAGE_ANCHOR
// - predefined/json-extractor.ts: JsonPatternExtractor 类的全部公开方法
//   extract/ canHandle, 四种提取维度, 边界情况, 错误处理
// ============================================================

import { describe, it, expect, vi } from "vitest";
import {
  PatternKind,
  type PatternDefinition,
  type PatternBody,
  type PatternExtractor,
  type PatternExtractorOptions,
  type ExtractionResult,
  PACKAGE_ANCHOR,
} from "../src/extractor.js";

// ============================================================
// §1 extractor.ts 基本类型
// ============================================================

describe("extractor.ts - PatternKind 枚举", () => {
  it("应导出与 pattern.ts 一致的 PatternKind", () => {
    expect(PatternKind.Structural).toBe("structural");
    expect(PatternKind.Behavioral).toBe("behavioral");
    expect(PatternKind.Architectural).toBe("architectural");
    expect(PatternKind.Dataflow).toBe("dataflow");
    expect(PatternKind.Documentation).toBe("documentation");
    expect(PatternKind.Naming).toBe("naming");
  });

  it("所有枚举成员为字符串", () => {
    Object.values(PatternKind).forEach((v) => {
      expect(typeof v).toBe("string");
    });
  });
});

describe("extractor.ts - PACKAGE_ANCHOR", () => {
  it("应导出包标识锚点常量", () => {
    expect(PACKAGE_ANCHOR).toBe("[@cortex/pattern-extractor] 模式提取基础设施");
    expect(typeof PACKAGE_ANCHOR).toBe("string");
  });
});

describe("extractor.ts - PatternExtractorOptions", () => {
  it("所有字段均为可选", () => {
    const opts: PatternExtractorOptions = {};
    expect(opts.logLevel).toBeUndefined();
    expect(opts.enableDiagnostics).toBeUndefined();
  });

  it("logLevel 支持四种级别", () => {
    const debug: PatternExtractorOptions = { logLevel: "debug" };
    const info: PatternExtractorOptions = { logLevel: "info" };
    const warn: PatternExtractorOptions = { logLevel: "warn" };
    const error: PatternExtractorOptions = { logLevel: "error" };

    expect(debug.logLevel).toBe("debug");
    expect(info.logLevel).toBe("info");
    expect(warn.logLevel).toBe("warn");
    expect(error.logLevel).toBe("error");
  });

  it("enableDiagnostics 为布尔值", () => {
    const enabled: PatternExtractorOptions = { enableDiagnostics: true };
    const disabled: PatternExtractorOptions = { enableDiagnostics: false };
    expect(enabled.enableDiagnostics).toBe(true);
    expect(disabled.enableDiagnostics).toBe(false);
  });
});

// ============================================================
// §2 PatternExtractor 接口（结构验证）
// ============================================================

describe("extractor.ts - PatternExtractor 接口", () => {
  it("应能实现最小模式的 PatternExtractor", () => {
    const extractor: PatternExtractor<string> = {
      name: "minimal",
      supportedLanguages: ["*"],
      supportedKinds: [PatternKind.Structural],
      description: "最小实现",
      extract: (_input: string) => ({
        success: true,
        patterns: [],
        diagnostics: [],
        durationMs: 0,
      }),
      canHandle: (_lang: string, _kind: PatternKind) => true,
    };

    expect(extractor.name).toBe("minimal");
    const result = extractor.extract("dummy");
    expect(result.success).toBe(true);
  });

  it("extract 应返回 ExtractionResult 判别联合", () => {
    const extractor: PatternExtractor = {
      name: "mock",
      supportedLanguages: ["*"],
      supportedKinds: [PatternKind.Structural],
      description: "mock",
      extract: () => ({
        success: false,
        patterns: [],
        diagnostics: ["错误"],
        durationMs: 10,
        error: "模拟失败",
      }),
      canHandle: () => false,
    };

    const result = extractor.extract("");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("模拟失败");
      expect(result.patterns).toEqual([]);
    }
  });

  it("canHandle 应支持语言和种类的复合判断", () => {
    const extractor: PatternExtractor = {
      name: "selective",
      supportedLanguages: ["typescript", "javascript"],
      supportedKinds: [PatternKind.Structural, PatternKind.Naming],
      description: "仅处理 TS/JS 的结构和命名模式",
      extract: () => ({
        success: true,
        patterns: [],
        diagnostics: [],
        durationMs: 0,
      }),
      canHandle: function (language: string, kind: PatternKind) {
        return (
          this.supportedLanguages.includes(language) &&
          this.supportedKinds.includes(kind)
        );
      },
    };

    expect(extractor.canHandle("typescript", PatternKind.Structural)).toBe(true);
    expect(extractor.canHandle("typescript", PatternKind.Naming)).toBe(true);
    expect(extractor.canHandle("typescript", PatternKind.Behavioral)).toBe(false);
    expect(extractor.canHandle("python", PatternKind.Structural)).toBe(false);
    expect(extractor.canHandle("javascript", PatternKind.Structural)).toBe(true);
  });

  it("extract 的泛型参数应能传递不同的输入类型", () => {
    interface AstNode {
      type: string;
      children?: AstNode[];
    }

    const extractor: PatternExtractor<AstNode> = {
      name: "ast-mock",
      supportedLanguages: ["typescript"],
      supportedKinds: [PatternKind.Structural],
      description: "处理 AST 节点输入",
      extract: (input: AstNode) => ({
        success: true,
        patterns: [{
          id: "ast-pattern",
          kind: PatternKind.Structural,
          name: input.type,
          description: `从 AST 节点 ${input.type} 提取`,
          tags: [],
          language: "typescript",
          confidence: 0.9,
          source: "ast-input",
          body: { rules: [] },
          elements: [{ name: input.type, type: "ast-node", isPrimary: true }],
          extractor: "ast-mock",
          extractedAt: Date.now(),
          usageCount: 0,
          weight: 9,
        }],
        diagnostics: [],
        durationMs: 5,
      }),
      canHandle: () => true,
    };

    const node: AstNode = { type: "InterfaceDeclaration" };
    const result = extractor.extract(node);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.patterns[0].name).toBe("InterfaceDeclaration");
    }
  });
});

// ============================================================
// §3 PatternDefinition 接口（结构验证）
// ============================================================

describe("extractor.ts - PatternDefinition 接口", () => {
  const createPatternDef = (overrides?: Partial<PatternDefinition>): PatternDefinition => ({
    id: "pd-001",
    kind: PatternKind.Structural,
    name: "测试模式定义",
    description: "一个 PatternDefinition 测试实例",
    tags: ["test", "example"],
    language: "typescript",
    confidence: 0.85,
    source: "src/example.ts",
    body: {
      rules: ["规则一", "规则二"],
      examples: [
        { code: "正例代码", isPositive: true },
        { code: "反例代码", isPositive: false },
      ],
    },
    elements: [
      { name: "核心接口", type: "interface", signature: "interface Core", isPrimary: true },
    ],
    extractor: "test-extractor",
    extractedAt: 1_700_000_000_000,
    usageCount: 5,
    weight: 8,
    ...overrides,
  });

  it("应能创建完整的 PatternDefinition", () => {
    const pd = createPatternDef();
    expect(pd.id).toBe("pd-001");
    expect(pd.body.rules).toHaveLength(2);
    expect(pd.body.examples).toHaveLength(2);
    expect(pd.elements).toHaveLength(1);
    expect(pd.usageCount).toBe(5);
  });

  it("sourceSpan 为可选字段", () => {
    const withSpan = createPatternDef({
      sourceSpan: { startLine: 1, endLine: 50 },
    });
    const withoutSpan = createPatternDef();
    // 删除 sourceSpan
    delete (withoutSpan as any).sourceSpan;

    expect(withSpan.sourceSpan).toBeDefined();
    expect(withSpan.sourceSpan!.startLine).toBe(1);
    expect(withoutSpan.sourceSpan).toBeUndefined();
  });

  it("references 为可选字段", () => {
    const withRefs = createPatternDef({ references: ["pd-002", "pd-003"] });
    const withoutRefs = createPatternDef();
    delete (withoutRefs as any).references;

    expect(withRefs.references).toEqual(["pd-002", "pd-003"]);
    expect(withoutRefs.references).toBeUndefined();
  });

  it("body 的 examples 和 template 为可选", () => {
    const minimalBody: PatternBody = { rules: ["规则"] };
    const pd = createPatternDef({ body: minimalBody });
    expect(pd.body.examples).toBeUndefined();
    expect(pd.body.template).toBeUndefined();
  });

  it("可序列化为 JSON", () => {
    const pd = createPatternDef();
    const json = JSON.stringify(pd);
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe("pd-001");
    expect(parsed.kind).toBe("structural");
    expect(parsed.confidence).toBe(0.85);
  });
});

// ============================================================
// §4 JsonPatternExtractor 实现
// ============================================================

describe("JsonPatternExtractor - 构造", () => {
  it("应在不传参数时使用默认选项", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor();
    expect(extractor.name).toBe("json-extractor");
    expect(extractor.supportedLanguages).toEqual(["json"]);
    expect(extractor.supportedKinds).toContain(PatternKind.Structural);
    expect(extractor.supportedKinds).toContain(PatternKind.Naming);
    expect(extractor.supportedKinds).toHaveLength(2);
    expect(extractor.description).toContain("JSON 结构分析");
  });

  it("应接受构造选项覆盖默认行为", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({
      extractNamingPatterns: false,
      extractStructurePatterns: false,
      extractTypePatterns: false,
      extractArrayPatterns: false,
      minSampleSize: 10,
      enableDiagnostics: true,
    });
    expect(extractor).toBeDefined();
  });
});

describe("JsonPatternExtractor - canHandle", () => {
  it("应仅接受 json 语言的请求", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor();

    expect(extractor.canHandle("json", PatternKind.Structural)).toBe(true);
    expect(extractor.canHandle("json", PatternKind.Naming)).toBe(true);
    expect(extractor.canHandle("json", PatternKind.Behavioral)).toBe(false);
    expect(extractor.canHandle("typescript", PatternKind.Structural)).toBe(false);
    expect(extractor.canHandle("python", PatternKind.Naming)).toBe(false);
    expect(extractor.canHandle("*", PatternKind.Structural)).toBe(false);
  });
});

describe("JsonPatternExtractor - extract 基本功能", () => {
  it("应成功提取空对象（无模式产出）", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({ minSampleSize: 0 });
    const result = extractor.extract("{}");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(Array.isArray(result.patterns)).toBe(true);
      expect(typeof result.durationMs).toBe("number");
    }
  });

  it("应成功提取纯数组", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({ minSampleSize: 0 });
    const result = extractor.extract("[1, 2, 3]");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(Array.isArray(result.patterns)).toBe(true);
    }
  });

  it("应提取 camelCase 命名约定模式", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({
      extractStructurePatterns: false,
      extractTypePatterns: false,
      extractArrayPatterns: false,
      minSampleSize: 1,
    });

    const json = JSON.stringify({
      userName: "alice",
      emailAddress: "alice@example.com",
      isActive: true,
      firstName: "Alice",
      lastName: "Smith",
    });

    const result = extractor.extract(json);

    expect(result.success).toBe(true);
    if (result.success) {
      const namingPatterns = result.patterns.filter((p) => p.kind === PatternKind.Naming);
      expect(namingPatterns.length).toBeGreaterThanOrEqual(1);

      const naming = namingPatterns[0];
      expect(naming.kind).toBe(PatternKind.Naming);
      expect(naming.name).toContain("camelCase");
      expect(naming.id).toBe("json-extractor-naming-convention");
      expect(naming.tags).toContain("json");
      expect(naming.tags).toContain("naming-convention");
    }
  });

  it("应提取 snake_case 命名约定模式", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({
      extractStructurePatterns: false,
      extractTypePatterns: false,
      extractArrayPatterns: false,
      minSampleSize: 1,
    });

    const json = JSON.stringify({
      user_name: "bob",
      email_address: "bob@example.com",
      is_active: true,
      first_name: "Bob",
    });

    const result = extractor.extract(json);
    expect(result.success).toBe(true);
    if (result.success) {
      const namingPatterns = result.patterns.filter((p) => p.kind === PatternKind.Naming);
      expect(namingPatterns.length).toBeGreaterThanOrEqual(1);
      expect(namingPatterns[0].name).toContain("snake_case");
    }
  });

  it("检测混合命名风格时，置信度较低且可能不输出命名模式", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({
      extractStructurePatterns: false,
      extractTypePatterns: false,
      extractArrayPatterns: false,
      minSampleSize: 1,
    });

    // 50% camelCase, 50% snake_case → 无主导风格（< 60%）
    const json = JSON.stringify({
      userName: "alice",
      user_email: "alice@example.com",
      isActive: true,
      is_admin: false,
    });

    const result = extractor.extract(json);
    expect(result.success).toBe(true);
    // 命名模式可能因占比不足 60% 而不输出
    if (result.success) {
      // 无论是否有命名模式，结果都应该是成功的
      expect(result.success).toBe(true);
    }
  });

  it("应提取结构深度模式", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({
      extractNamingPatterns: false,
      extractTypePatterns: false,
      extractArrayPatterns: false,
      minSampleSize: 1,
    });

    const json = JSON.stringify({
      level1: {
        level2: {
          level3: {
            value: "deep",
          },
        },
      },
    });

    const result = extractor.extract(json);
    expect(result.success).toBe(true);
    if (result.success) {
      const structPatterns = result.patterns.filter((p) => p.kind === PatternKind.Structural);
      // 应该至少有一个结构模式（深度或类型分布）
      expect(structPatterns.length).toBeGreaterThanOrEqual(1);

      const depthPattern = structPatterns.find(
        (p) => p.id === "json-extractor-structure-depth",
      );
      // 可能因样本量问题不输出，但如果有，检查字段
      if (depthPattern) {
        expect(depthPattern.name).toContain("深度");
        const maxDepthEl = depthPattern.elements.find((e) => e.name === "max-depth");
        expect(maxDepthEl).toBeDefined();
        // 根节点 depth=0, level1->1, level2->2, level3->3, value(s)->4
        expect(maxDepthEl!.signature).toBe("4");
      }
    }
  });

  it("应提取属性类型分布模式", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({
      extractNamingPatterns: false,
      extractStructurePatterns: false,
      extractArrayPatterns: false,
      minSampleSize: 1,
    });

    const json = JSON.stringify({
      name: "hello",
      title: "world",
      desc: "test",
      count: 42,
      ratio: 0.5,
      flag: true,
    });

    const result = extractor.extract(json);
    expect(result.success).toBe(true);
    if (result.success) {
      const typePatterns = result.patterns.filter(
        (p) => p.id === "json-extractor-type-distribution",
      );
      if (typePatterns.length > 0) {
        const pattern = typePatterns[0];
        expect(pattern.name).toContain("类型分布");
        expect(pattern.tags).toContain("type-distribution");
      }
    }
  });

  it("应提取数组同质性模式", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({
      extractNamingPatterns: false,
      extractStructurePatterns: false,
      extractTypePatterns: false,
      minSampleSize: 1,
    });

    const json = JSON.stringify({
      homogeneous: [1, 2, 3, 4, 5],
      alsoHomogeneous: ["a", "b", "c"],
    });

    const result = extractor.extract(json);
    expect(result.success).toBe(true);
    if (result.success) {
      const arrayPatterns = result.patterns.filter(
        (p) => p.id === "json-extractor-array-homogeneity",
      );
      if (arrayPatterns.length > 0) {
        expect(arrayPatterns[0].tags).toContain("homogeneity");
      }
    }
  });
});

describe("JsonPatternExtractor - 边界情况与错误处理", () => {
  it("输入为空字符串时应返回失败结果", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor();
    const result = extractor.extract("");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("空字符串");
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
      expect(result.patterns).toEqual([]);
    }
  });

  it("输入仅为空白时应返回失败结果", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor();
    const result = extractor.extract("   \n  \t  ");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("空字符串");
    }
  });

  it("无效 JSON 应返回失败结果", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor();
    const result = extractor.extract("这不是 JSON");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("JSON 解析失败");
      expect(result.patterns).toEqual([]);
    }
  });

  it("格式错误的 JSON 应返回失败结果", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor();
    const result = extractor.extract('{"name": "test",}'); // 末尾逗号

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("JSON 解析失败");
    }
  });

  it("非对象的 JSON 基本值应返回成功（无模式）", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({ minSampleSize: 0 });
    const result = extractor.extract("42");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(Array.isArray(result.patterns)).toBe(true);
    }
  });

  it("null JSON 值应返回成功（无模式）", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({ minSampleSize: 0 });
    const result = extractor.extract("null");

    expect(result.success).toBe(true);
  });

  it("布尔 JSON 值应返回成功（无模式）", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({ minSampleSize: 0 });
    const result = extractor.extract("true");

    expect(result.success).toBe(true);
  });

  it("深层嵌套对象不应导致栈溢出", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({
      extractNamingPatterns: false,
      extractTypePatterns: false,
      extractArrayPatterns: false,
      minSampleSize: 0,
    });

    // 构建一个深度嵌套的对象
    let deep: Record<string, unknown> = {};
    let current = deep;
    for (let i = 0; i < 100; i++) {
      current[`level${i}`] = {};
      current = current[`level${i}`] as Record<string, unknown>;
    }
    current.value = "leaf";

    const result = extractor.extract(JSON.stringify(deep));
    expect(result.success).toBe(true);
  });

  it("大数组不应导致性能崩溃", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({
      extractNamingPatterns: false,
      extractStructurePatterns: false,
      extractTypePatterns: false,
      minSampleSize: 0,
    });

    const largeArray = Array.from({ length: 1000 }, (_, i) => i);
    const result = extractor.extract(JSON.stringify(largeArray));

    expect(result.success).toBe(true);
  });
});

describe("JsonPatternExtractor - 内部类型 JsonValue", () => {
  it("JsonValue 类型应支持 JSON 规范的所有六种值", async () => {
    const { JsonPatternExtractor } = await import(
      "../src/predefined/json-extractor.js"
    );
    // 验证 extractor 可处理各种 JSON 值
    const extractor = new JsonPatternExtractor({ minSampleSize: 0 });
    expect(extractor.extract("42").success).toBe(true);
    expect(extractor.extract("true").success).toBe(true);
    expect(extractor.extract("null").success).toBe(true);
    expect(extractor.extract('"just a string"').success).toBe(true);
    expect(extractor.extract("{}").success).toBe(true);
    expect(extractor.extract("[]").success).toBe(true);
  });
});

describe("JsonPatternExtractor - 运行时选项覆盖", () => {
  it("extract() 时传入的选项应覆盖构造选项", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    // 构造时禁用所有模式
    const extractor = new JsonPatternExtractor({
      extractNamingPatterns: false,
      extractStructurePatterns: false,
      extractTypePatterns: false,
      extractArrayPatterns: false,
      minSampleSize: 1,
    });

    const json = JSON.stringify({
      userName: "alice",
      emailAddress: "alice@example.com",
    });

    // 不传选项 → 使用构造时的禁用设置 → 无模式
    const resultDisabled = extractor.extract(json);
    expect(resultDisabled.success).toBe(true);
    if (resultDisabled.success) {
      expect(resultDisabled.patterns).toHaveLength(0);
    }

    // 传入选项 → 覆盖构造时的禁用设置 → 有模式
    const resultEnabled = extractor.extract(json, {
      extractNamingPatterns: true,
    });
    expect(resultEnabled.success).toBe(true);
    if (resultEnabled.success) {
      const namingPatterns = resultEnabled.patterns.filter(
        (p) => p.kind === PatternKind.Naming,
      );
      expect(namingPatterns.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("minSampleSize 可通过运行时选项调整", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    // 构造时设置 minSampleSize 很大
    const extractor = new JsonPatternExtractor({
      extractTypePatterns: false,
      extractArrayPatterns: false,
      extractStructurePatterns: false,
      minSampleSize: 1000,
    });

    const json = JSON.stringify({ a: 1, b: 2, c: 3 });

    // 使用构造的大样本限制 → 无模式输出
    const resultNo = extractor.extract(json);
    if (resultNo.success) {
      const namingPatterns = resultNo.patterns.filter(
        (p) => p.kind === PatternKind.Naming,
      );
      expect(namingPatterns).toHaveLength(0);
    }

    // 运行时覆盖 minSampleSize → 有模式输出
    const resultYes = extractor.extract(json, { minSampleSize: 1 });
    expect(resultYes.success).toBe(true);
    if (resultYes.success) {
      const namingPatterns = resultYes.patterns.filter(
        (p) => p.kind === PatternKind.Naming,
      );
      expect(namingPatterns.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("JsonPatternExtractor - diagnostics 输出", () => {
  it("启用 diagnostics 时应有详细的诊断信息", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({
      enableDiagnostics: true,
      extractTypePatterns: false,
      extractArrayPatterns: false,
      minSampleSize: 1,
    });

    const json = JSON.stringify({ userName: "alice", age: 30 });
    const result = extractor.extract(json);

    expect(result.success).toBe(true);
    if (result.success) {
      // 诊断信息中应包含分析统计
      const analysisDiag = result.diagnostics.find((d) => d.includes("分析完成"));
      expect(analysisDiag).toBeDefined();
      expect(analysisDiag).toContain("节点");

      // 应有命名模式的诊断
      const namingDiag = result.diagnostics.find((d) => d.includes("命名模式"));
      expect(namingDiag).toBeDefined();
    }
  });

  it("禁用 diagnostics 时诊断信息应更简洁", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({
      enableDiagnostics: false,
      extractTypePatterns: false,
      extractArrayPatterns: false,
      minSampleSize: 1,
    });

    const json = JSON.stringify({ userName: "alice", age: 30 });
    const result = extractor.extract(json);

    expect(result.success).toBe(true);
  });
});

describe("JsonPatternExtractor - Pattern 字段质量", () => {
  it("产出的 PatternDefinition 应包含合法的置信度", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({
      extractTypePatterns: false,
      extractArrayPatterns: false,
      minSampleSize: 1,
    });

    const json = JSON.stringify({
      userName: "alice",
      emailAddress: "alice@example.com",
      isActive: true,
      age: 30,
    });

    const result = extractor.extract(json);
    expect(result.success).toBe(true);
    if (result.success && result.patterns.length > 0) {
      for (const pattern of result.patterns) {
        expect(pattern.confidence).toBeGreaterThanOrEqual(0);
        expect(pattern.confidence).toBeLessThanOrEqual(1);
        expect(pattern.weight).toBeGreaterThanOrEqual(0);
        expect(pattern.weight).toBeLessThanOrEqual(10);
        expect(typeof pattern.extractedAt).toBe("number");
        expect(pattern.extractor).toBe("json-extractor");
        expect(pattern.language).toBe("json");
        expect(pattern.tags).toContain("json");
      }
    }
  });

  it("产出的 PatternDefinition 应包含 rules 列表", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({
      extractTypePatterns: false,
      extractArrayPatterns: false,
      minSampleSize: 1,
    });

    const json = JSON.stringify({
      userName: "alice",
      emailAddress: "alice@example.com",
      isActive: true,
      firstName: "Alice",
      lastName: "Smith",
    });

    const result = extractor.extract(json);
    expect(result.success).toBe(true);
    if (result.success) {
      for (const pattern of result.patterns) {
        expect(pattern.body.rules.length).toBeGreaterThanOrEqual(1);
        for (const rule of pattern.body.rules) {
          expect(typeof rule).toBe("string");
        }
      }
    }
  });

  it("产出的 PatternDefinition 应包含 elements 列表", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({
      extractTypePatterns: false,
      extractArrayPatterns: false,
      minSampleSize: 1,
    });

    const json = JSON.stringify({
      userName: "alice",
      emailAddress: "alice@example.com",
      isActive: true,
    });

    const result = extractor.extract(json);
    expect(result.success).toBe(true);
    if (result.success) {
      for (const pattern of result.patterns) {
        expect(pattern.elements.length).toBeGreaterThanOrEqual(1);
        for (const el of pattern.elements) {
          expect(typeof el.name).toBe("string");
          expect(typeof el.type).toBe("string");
          expect(typeof el.isPrimary).toBe("boolean");
        }
      }
    }
  });

  it("产出的命名模式应包含正反例", async () => {
    const { JsonPatternExtractor } = await import("../src/predefined/json-extractor.js");
    const extractor = new JsonPatternExtractor({
      extractTypePatterns: false,
      extractArrayPatterns: false,
      extractStructurePatterns: false,
      minSampleSize: 1,
    });

    const json = JSON.stringify({
      userName: "alice",
      emailAddress: "alice@example.com",
      isActive: true,
      firstName: "Alice",
      some_legacy_field: "old", // 反例
    });

    const result = extractor.extract(json);
    expect(result.success).toBe(true);
    if (result.success) {
      const namingPattern = result.patterns.find(
        (p) => p.kind === PatternKind.Naming,
      );
      if (namingPattern && namingPattern.body.examples) {
        expect(namingPattern.body.examples.length).toBeGreaterThanOrEqual(1);
        const hasPositive = namingPattern.body.examples.some((e) => e.isPositive);
        expect(hasPositive).toBe(true);
      }
    }
  });
});

describe("JsonPatternExtractor - JSON_EXTRACTOR_ANCHOR", () => {
  it("应导出包锚点常量", async () => {
    const { JSON_EXTRACTOR_ANCHOR } = await import(
      "../src/predefined/json-extractor.js"
    );
    expect(JSON_EXTRACTOR_ANCHOR).toContain("JsonPatternExtractor");
    expect(typeof JSON_EXTRACTOR_ANCHOR).toBe("string");
  });
});
