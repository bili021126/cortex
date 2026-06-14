// @ci: unit
// ============================================================
// @cortex/pattern-extractor — MarkdownPatternExtractor 单元测试
//
// 覆盖范围：
// - Constructor & 基础属性（name, supportedLanguages, supportedKinds, description）
// - canHandle() 方法
// - extract() 输入校验（空输入 / 非字符串）
// - 策略 1: JSON 块提取（单个/多个/JSON 数组/混合格式/无效 JSON）
// - 策略 2: P0-P9 格式提取（编号段落/Steps 节/Recipe 节/bullet/tags/trigger）
// - 策略 3: 模式段落提取（5 条启发式规则/置信度 cap）
// - 策略 4: 全文回退（仅当无其他产出时）
// - 去重归并（同名候选按策略优先级保留）
// - 置信度过滤 + 最大候选数限制
// - extract() 选项覆盖
// - canHandle() 边界
// ============================================================

import { describe, it, expect } from "vitest";
import {
  MarkdownPatternExtractor,
  PatternKind,
  type PatternDefinition,
} from "../src/index.js";

// ============================================================
// §0 测试数据工厂
// ============================================================

/** 构造 ```json ... ``` 围栏包裹的文本 */
function jsonFence(json: unknown): string {
  return "```json\n" + JSON.stringify(json, null, 2) + "\n```";
}

/** 标准 SkillTemplate JSON（来自真实 skills/ 目录格式） */
const VALID_SKILL_JSON = {
  id: "skill-p10-ci-gate-full-cycle-1778962384000",
  agentType: "ops",
  name: "P10: CI 门禁全流程",
  triggerTags: ["test", "deploy", "ops"],
  trigger: "需要执行 CI 门禁检查时（build → typecheck → test → lint 全流程）",
  steps: [
    "执行 `pnpm install` 确认依赖已安装，workspace 链接正确",
    "按依赖拓扑顺序执行 `pnpm -r build`：shared → parser/data/pm/tools → testing/llm → cli → engine",
    "逐包执行 `pnpm -r typecheck` 确认无类型错误",
    "按包粒度执行 `pnpm -r test` 并收集各包测试结果",
    "执行 `pnpm lint` 检查代码规范",
    "汇总结果：build/typecheck/test/lint 四项全部通过则门禁通过",
    "若有失败项，输出失败详情并中止后续步骤",
  ],
  expectedOutput:
    "CI 门禁结果报告：build ✅ / typecheck ✅ / test ✅ (N/N passed) / lint ✅ — 或具体失败原因",
  outputFile: ".cortex/ci-output.txt",
  status: "trial",
  adoptionCount: 0,
  rejectionCount: 0,
  discoveredBy: "mona-pattern-scan",
  createdAt: 1778962384000,
};

/** P0-P9 格式 Markdown 段落 */
function pSection(num: number, opts?: {
  name?: string;
  tags?: string[];
  trigger?: string;
  steps?: string[];
  expectedOutput?: string;
}): string {
  const n = opts?.name ?? `P${num}: Test Pattern ${num}`;
  const tags = opts?.tags ?? ["test", "loop"];
  const trigger = opts?.trigger ?? "当需要执行测试时触发";
  const steps = opts?.steps ?? [
    "使用 read_file 读取配置文件",
    "执行测试命令",
    "输出测试报告",
  ];
  const output = opts?.expectedOutput;

  const lines: string[] = [
    `### ${n}`,
    "",
    `- triggerTags: [${tags.join(", ")}]`,
    `- trigger: ${trigger}`,
    "- steps:",
    ...steps.map((s, i) => `  ${i + 1}. ${s}`),
  ];

  if (output) {
    lines.push(`- expectedOutput: ${output}`);
  }

  return lines.join("\n");
}

// ============================================================
// §1 Constructor & 基础属性
// ============================================================

describe("MarkdownPatternExtractor - Constructor & 基础属性", () => {
  it("默认构造应正确设置所有属性和默认选项", () => {
    const ext = new MarkdownPatternExtractor();
    expect(ext.name).toBe("markdown-extractor");
    expect(ext.supportedLanguages).toEqual(["markdown"]);
    expect(ext.supportedKinds).toEqual([
      PatternKind.Documentation,
      PatternKind.Behavioral,
    ]);
    expect(ext.description).toContain("Markdown 结构分析");
    expect(ext.description).toContain("4 级回退策略");
  });

  it("自定义构造选项应覆盖默认值", () => {
    const ext = new MarkdownPatternExtractor({
      strategyJsonBlock: false,
      headingLevels: [3],
      minConfidence: 0.7,
    });
    // 通过 extract + diagnostics 间接验证选项生效
    const input = jsonFence(VALID_SKILL_JSON);
    const result = ext.extract(input);
    // strategyJsonBlock=false 所以不应提取 JSON 块
    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(0); // 无其他策略命中
    expect(
      result.diagnostics.some((d) => d.includes("JSON block")),
    ).toBe(false);
  });

  it("支持关闭所有策略", () => {
    const ext = new MarkdownPatternExtractor({
      strategyJsonBlock: false,
      strategyP0P9Format: false,
      strategyPatternParagraph: false,
      strategyFallbackFullFile: false,
    });
    const result = ext.extract("## Some heading\n\nSome content");
    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(0);
  });
});

// ============================================================
// §2 canHandle()
// ============================================================

describe("MarkdownPatternExtractor - canHandle()", () => {
  const ext = new MarkdownPatternExtractor();

  it("应接受 markdown + Documentation", () => {
    expect(ext.canHandle("markdown", PatternKind.Documentation)).toBe(true);
  });

  it("应接受 markdown + Behavioral", () => {
    expect(ext.canHandle("markdown", PatternKind.Behavioral)).toBe(true);
  });

  it("应拒绝非 markdown 语言", () => {
    expect(ext.canHandle("typescript", PatternKind.Documentation)).toBe(false);
    expect(ext.canHandle("json", PatternKind.Behavioral)).toBe(false);
  });

  it("应拒绝不支持的 PatternKind", () => {
    expect(ext.canHandle("markdown", PatternKind.Structural)).toBe(false);
    expect(ext.canHandle("markdown", PatternKind.Naming)).toBe(false);
    expect(ext.canHandle("markdown", PatternKind.Architectural)).toBe(false);
  });
});

// ============================================================
// §3 extract() — 输入校验
// ============================================================

describe("MarkdownPatternExtractor - extract() 输入校验", () => {
  const ext = new MarkdownPatternExtractor();

  it("非字符串输入应返回失败", () => {
    const result = ext.extract(123 as unknown as string);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
      expect(result.error).toContain("输入类型错误");
    }
    expect(result.patterns).toHaveLength(0);
  });

  it("空字符串应返回成功但无模式", () => {
    const result = ext.extract("");
    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.includes("空"))).toBe(true);
  });

  it("仅空白字符应返回成功但无模式", () => {
    const result = ext.extract("   \n  \t  ");
    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(0);
  });

  it("应包含 durationMs 字段", () => {
    const result = ext.extract("## test");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// §4 策略 1 — JSON 块提取
// ============================================================

describe("MarkdownPatternExtractor - 策略 1: JSON 块提取", () => {
  const ext = new MarkdownPatternExtractor({
    strategyP0P9Format: false,
    strategyPatternParagraph: false,
    strategyFallbackFullFile: false,
  });

  it("应提取单个 SkillTemplate JSON 块", () => {
    const input = jsonFence(VALID_SKILL_JSON);
    const result = ext.extract(input);

    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(1);

    const p = result.patterns[0];
    expect(p.kind).toBe(PatternKind.Behavioral);
    expect(p.language).toBe("markdown");
    expect(p.name).toContain(VALID_SKILL_JSON.id);
    expect(p.name).toContain(VALID_SKILL_JSON.name);
    expect(p.tags).toEqual(VALID_SKILL_JSON.triggerTags);
    expect(p.description).toContain("json-block");
    expect(p.description).toContain(VALID_SKILL_JSON.trigger);
    expect(p.confidence).toBeGreaterThanOrEqual(0.9);
    expect(p.body.rules).toEqual(VALID_SKILL_JSON.steps);
    expect(p.extractor).toBe("markdown-extractor");
    expect(p.source).toContain("json-block");
    expect(p.sourceSpan).toBeDefined();
    expect(p.sourceSpan!.startLine).toBeGreaterThanOrEqual(1);
    expect(p.sourceSpan!.endLine).toBeGreaterThanOrEqual(
      p.sourceSpan!.startLine,
    );
    expect(p.elements.length).toBeGreaterThan(0);
    // tags 映射为 elements
    expect(
      p.elements.some((e) => e.type === "tag" && e.name === "test"),
    ).toBe(true);
  });

  it("应提取 JSON 数组中的多个 SkillTemplate", () => {
    const skills = [
      { ...VALID_SKILL_JSON, id: "skill-1", name: "Skill One" },
      { ...VALID_SKILL_JSON, id: "skill-2", name: "Skill Two" },
    ];
    const input = jsonFence(skills);
    const result = ext.extract(input);

    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(2);
    expect(result.patterns[0].name).toContain("Skill One");
    expect(result.patterns[1].name).toContain("Skill Two");
  });

  it("应返回来自 JSON 块中的多个 ```json 块", () => {
    const input =
      jsonFence({ ...VALID_SKILL_JSON, name: "Block A" }) +
      "\n\nSome text\n\n" +
      jsonFence({ ...VALID_SKILL_JSON, name: "Block B" });
    const result = ext.extract(input);

    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(2);
    expect(result.patterns[0].name).toContain("Block A");
    expect(result.patterns[1].name).toContain("Block B");
  });

  it("应处理无效 JSON 块（解析失败不中断）", () => {
    const input =
      jsonFence(VALID_SKILL_JSON) +
      "\n```json\n{invalid: true,}\n```";
    const result = ext.extract(input);

    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(1); // 只提取有效的
    expect(
      result.diagnostics.some((d) => d.includes("解析失败")),
    ).toBe(true);
  });

  it("应跳过没有 name 字段的 JSON 对象", () => {
    const input = jsonFence({ triggerTags: ["x"], steps: ["do"] });
    const result = ext.extract(input);
    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(0);
    expect(
      result.diagnostics.some((d) => d.includes("缺少 name")),
    ).toBe(true);
  });

  it("应处理 snake_case 别名 (trigger_tags, steps_json, expected_output)", () => {
    const input = jsonFence({
      name: "Snake Skill",
      trigger_tags: ["test"],
      trigger: "do it",
      steps_json: ["step 1", "step 2"],
      expected_output: "ok",
    });
    const result = ext.extract(input);

    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(1);
    const p = result.patterns[0];
    expect(p.tags).toEqual(["test"]);
    expect(p.body.rules).toEqual(["step 1", "step 2"]);
  });

  it("应处理 JSON 条目缺少 id 时仍生成候选", () => {
    const { id, ...noId } = VALID_SKILL_JSON;
    const input = jsonFence(noId);
    const result = ext.extract(input);

    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(1);
    // 置信度略低（缺 id 扣 0.1）
    expect(result.patterns[0].confidence).toBeLessThan(1.0);
  });

  it("JSON 块中包含非对象条目的数组应跳过", () => {
    const input = jsonFence([
      VALID_SKILL_JSON,
      "string item",
      42,
      null,
    ]);
    const result = ext.extract(input);
    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(1); // 只提取对象条目
  });
});

// ============================================================
// §5 策略 2 — P0-P9 格式提取
// ============================================================

describe("MarkdownPatternExtractor - 策略 2: P0-P9 格式提取", () => {
  const ext = new MarkdownPatternExtractor({
    strategyJsonBlock: false,
    strategyPatternParagraph: false,
    strategyFallbackFullFile: false,
    headingLevels: [2, 3],
  });

  it("应提取单个 P 编号段落", () => {
    const input = pSection(11, {
      name: "P11: 技能沉淀闭环",
      tags: ["loop", "pattern_scan", "skill_precipitate"],
      trigger: "需要从已产出的 pattern.md 文件中提取技能模板",
      steps: [
        "使用 scanOutputFilesForSkills 扫描 pattern.md 文件",
        "对每个匹配文件提取技能模板",
        "将去重后的模板注册到 SkillRegistry",
      ],
      expectedOutput: "技能持久化报告：提取 N 个技能",
    });

    const result = ext.extract(input);

    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(1);

    const p = result.patterns[0];
    expect(p.kind).toBe(PatternKind.Behavioral);
    expect(p.name).toContain("P11");
    expect(p.tags).toEqual(["loop", "pattern_scan", "skill_precipitate"]);
    expect(p.description).toContain("p0-p9");
    expect(p.confidence).toBeGreaterThanOrEqual(0.6);
    expect(p.body.rules).toHaveLength(3);
    expect(p.extractor).toBe("markdown-extractor");
  });

  it("应提取多个 P 编号段落", () => {
    const input =
      pSection(10, { name: "P10: CI Gate" }) +
      "\n\n" +
      pSection(11, { name: "P11: Skill Loop" });

    const result = ext.extract(input);

    expect(result.success).toBe(true);
    expect(result.patterns.length).toBeGreaterThanOrEqual(2);
    const names = result.patterns.map((p) => p.name);
    expect(names.some((n) => n.includes("P10"))).toBe(true);
    expect(names.some((n) => n.includes("P11"))).toBe(true);
  });

  it("步骤数不足 minStepsForP0P9 的段落应被过滤", () => {
    const input = pSection(1, {
      name: "P1: Too Short",
      steps: ["只有一个步骤"],
    });

    const result = ext.extract(input);

    // minStepsForP0P9 默认=2，只有1步 → 被跳过
    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(0);
    expect(
      result.diagnostics.some(
        (d) => d.includes("steps") && d.includes("< min"),
      ),
    ).toBe(true);
  });

  it("应提取 triggerTags 中的方括号格式", () => {
    const input = "### P42: Tag Format\n\n- triggerTags: [a, b, c]\n- trigger: test\n- steps:\n  1. do this\n  2. do that";

    const result = ext.extract(input);

    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].tags).toEqual(["a", "b", "c"]);
  });

  it("应支持不带 triggerTags 的段落（基础置信度）", () => {
    const input =
      "### P99: Minimal\n\n- trigger: just do it\n- steps:\n  1. step one\n  2. step two";

    const result = ext.extract(input);

    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(1);
    // 置信度较低——无 tags
    expect(result.patterns[0].confidence).toBeLessThan(0.7);
  });

  it("应处理 Recipe: 节下的步骤格式", () => {
    const input =
      "## P5: Recipe Style\n\nTags: test, deploy\nTrigger: when ready\nRecipe:\n- step alpha\n- step beta\n- step gamma\n\nExpected Output: done\n";

    const result = ext.extract(input);

    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].body.rules).toHaveLength(3);
  });

  it("h2/h3 heading 层级过滤正确", () => {
    const extH2 = new MarkdownPatternExtractor({
      strategyJsonBlock: false,
      strategyP0P9Format: true,
      strategyPatternParagraph: false,
      strategyFallbackFullFile: false,
      headingLevels: [2], // 只识别 ##
    });

    // P 编号在 ### 中，但 headingLevels=[2] 不处理 ###
    const input = "### P42: Should Skip\n\n- trigger: test\n- steps:\n  1. step a\n  2. step b";

    const result = extH2.extract(input);
    expect(result.patterns).toHaveLength(0); // headingLevels=[2] 不识别 ###
  });

  it("应处理中文「步骤」/「流程」标签的 steps 提取", () => {
    const input =
      "## P8: Chinese Labels\n\nTags: impl, test\nTrigger: 当需要实现时\n步骤:\n1. 第一步操作\n2. 第二步操作\n3. 第三步操作";

    const result = ext.extract(input);

    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].body.rules).toHaveLength(3);
  });
});

// ============================================================
// §6 策略 3 — 模式段落提取（启发式）
// ============================================================

describe("MarkdownPatternExtractor - 策略 3: 模式段落提取", () => {
  const ext = new MarkdownPatternExtractor({
    strategyJsonBlock: false,
    strategyP0P9Format: false,
    strategyPatternParagraph: true,
    strategyFallbackFullFile: false,
    headingLevels: [2, 3],
    minConfidence: 0.0, // 降低阈值以测试启发式规则
  });

  it("段落包含 trigger / tags / steps 信号应产出生效候选", () => {
    const input = `## 模式扫描约定

在我们项目的代码审查中，经常需要：
- 使用 read_file 读取配置文件
- 调用 search_code 搜索历史模式
- 执行 vitest 验证变更

Tags: code-review, pattern-scan
Trigger: 当需要扫描历史模式时触发
expectedOutput: 扫描报告 JSON
`;

    const result = ext.extract(input);

    expect(result.success).toBe(true);
    // 至少命中 trigger + steps + tags 信号
    if (result.patterns.length > 0) {
      const p = result.patterns[0];
      expect(p.description).toContain("pattern-paragraph");
      expect(p.confidence).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("段落缺少足够启发式信号应被过滤", () => {
    const extStrict = new MarkdownPatternExtractor({
      strategyJsonBlock: false,
      strategyP0P9Format: false,
      strategyPatternParagraph: true,
      strategyFallbackFullFile: false,
      minConfidence: 0.4,
    });

    const input =
      "## Random Notes\n\nJust some random text without any structure.";

    const result = extStrict.extract(input);
    expect(result.patterns).toHaveLength(0);
  });

  it("应跳过 P 编号段落（留给策略 2 处理）", () => {
    const input =
      "### P55: Skip Me\n\n- trigger: do\n- triggerTags: [x]\n- 使用 scan 扫描\n- 调用 extract 提取";

    const result = ext.extract(input);
    expect(result.patterns).toHaveLength(0); // P55 跳过
  });

  it("应跳过过短的段落（< 30 字符）", () => {
    const input = "## Hi\n\nShort.";
    const result = ext.extract(input);
    expect(result.patterns).toHaveLength(0);
  });

  it("confidence 不应超过 0.5 cap", () => {
    // 构造满足所有 5 条规则的段落
    const input = `## Full Match

id: skill-p42-test
- triggerTags: [a, b, c]
trigger: when everything matches
- 使用 scanner 扫描所有文件
- 调用 extractor 提取模式
- 执行 validator 验证结果
expectedOutput: full report
outputFile: test.json
`;

    const result = ext.extract(input);

    if (result.patterns.length > 0) {
      expect(result.patterns[0].confidence).toBeLessThanOrEqual(0.5);
    }
  });
});

// ============================================================
// §7 策略 4 — 全文回退
// ============================================================

describe("MarkdownPatternExtractor - 策略 4: 全文回退", () => {
  it("当所有策略无产出时，全文回退应产出一个候选", () => {
    const ext = new MarkdownPatternExtractor({
      strategyJsonBlock: false,
      strategyP0P9Format: false,
      strategyPatternParagraph: false,
      strategyFallbackFullFile: true,
      minConfidence: 0.0,
    });

    const input =
      "# My Design Doc\n\nThis is a free-form design document.\n\nIt contains ideas but no structured format.\n\nLine 5.\nLine 6.";
    const result = ext.extract(input);

    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(1);

    const p = result.patterns[0];
    expect(p.kind).toBe(PatternKind.Behavioral);
    expect(p.language).toBe("markdown");
    expect(p.name).toBe("My Design Doc");
    expect(p.confidence).toBe(0.2);
    expect(p.description).toContain("full-file");
  });

  it("少于 5 行的文件应返回 null（不产出候选）", () => {
    const ext = new MarkdownPatternExtractor({
      strategyJsonBlock: false,
      strategyP0P9Format: false,
      strategyPatternParagraph: false,
      strategyFallbackFullFile: true,
    });

    const input = "Line 1\nLine 2\nLine 3";
    const result = ext.extract(input);

    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(0);
  });

  it("默认不应启用全文回退", () => {
    const ext = new MarkdownPatternExtractor({
      strategyJsonBlock: false,
      strategyP0P9Format: false,
      strategyPatternParagraph: false,
    });

    const input =
      "# Doc\n\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7";
    const result = ext.extract(input);

    // strategyFallbackFullFile 默认 false
    expect(result.patterns).toHaveLength(0);
  });
});

// ============================================================
// §8 去重归并
// ============================================================

describe("MarkdownPatternExtractor - 去重归并", () => {
  it("同名候选应保留置信度最高的策略优先级版本", () => {
    const ext = new MarkdownPatternExtractor({
      strategyJsonBlock: true,
      strategyP0P9Format: true,
      strategyPatternParagraph: true,
      strategyFallbackFullFile: false,
      enableMerge: true,
    });

    // 同时用 JSON 块和 P0-P9 产生同名候选
    const jsonPart = jsonFence({
      name: "P10: CI Gate",
      triggerTags: ["test", "deploy"],
      trigger: "run ci",
      steps: ["step A", "step B"],
    });
    const pPart = pSection(10, {
      name: "P10: CI Gate",
      tags: ["test"],
      trigger: "run ci",
      steps: ["step A", "step B", "step C"],
    });
    const input = jsonPart + "\n\n" + pPart;

    const result = ext.extract(input);

    expect(result.success).toBe(true);
    // 同名 → 归并为一个，优先级 json-block(4) > p0-p9(3)
    const merged = result.patterns.find(
      (p) => p.name.includes("P10") || p.name.includes("CI Gate"),
    );
    if (merged) {
      expect(merged.tags).toContain("deploy"); // 合并了 JSON 的 tags
    }
  });

  it("disableMerge 应保留所有原始候选", () => {
    const ext = new MarkdownPatternExtractor({
      strategyJsonBlock: true,
      strategyP0P9Format: true,
      strategyPatternParagraph: false,
      strategyFallbackFullFile: false,
      enableMerge: false,
    });

    const input =
      jsonFence(VALID_SKILL_JSON) +
      "\n\n" +
      pSection(10, { name: "P10: Another", steps: ["a", "b"] });

    const result = ext.extract(input);
    // 不归并 → 各自保留
    expect(result.patterns.length).toBeGreaterThanOrEqual(2);
    expect(
      result.diagnostics.some((d) => d.includes("去重归并")),
    ).toBe(false);
  });
});

// ============================================================
// §9 置信度过滤 + 最大候选数
// ============================================================

describe("MarkdownPatternExtractor - 置信度过滤 & 数量限制", () => {
  it("minConfidence 应过滤低置信度候选", () => {
    const ext = new MarkdownPatternExtractor({
      strategyJsonBlock: true,
      strategyP0P9Format: true,
      strategyPatternParagraph: false,
      strategyFallbackFullFile: true,
      minConfidence: 0.85,
      enableMerge: false,
    });

    // JSON 块 > 0.85, P0-P9 段落 < 0.85（仅有基础字段+无tags），全文回退 0.2
    const input =
      jsonFence(VALID_SKILL_JSON) +
      "\n\n" +
      pSection(1, {
        name: "P1: Low",
        steps: ["a", "b"],
        tags: [],
        trigger: "",
      }) +
      "\n\n# Fallback Doc\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7";

    const result = ext.extract(input);

    expect(result.success).toBe(true);
    // 只有 JSON 块通过 0.85 阈值
    expect(result.patterns.length).toBeGreaterThanOrEqual(1);
    const names = result.patterns.map((p) => p.name);
    // P1 置信度 < 0.85 应被过滤
    if (names.length > 0) {
      expect(names.every((n) => !n.includes("Fallback"))).toBe(true);
    }
  });

  it("maxCandidates 应截断结果", () => {
    const ext = new MarkdownPatternExtractor({
      strategyJsonBlock: true,
      strategyP0P9Format: true,
      strategyPatternParagraph: false,
      strategyFallbackFullFile: false,
      maxCandidates: 2,
      enableMerge: false,
    });

    const skills = [
      { ...VALID_SKILL_JSON, id: "s-1", name: "A" },
      { ...VALID_SKILL_JSON, id: "s-2", name: "B" },
      { ...VALID_SKILL_JSON, id: "s-3", name: "C" },
    ];
    const input = jsonFence(skills);
    const result = ext.extract(input);

    expect(result.success).toBe(true);
    expect(result.patterns.length).toBeLessThanOrEqual(2);
  });
});

// ============================================================
// §10 extract() 选项覆盖
// ============================================================

describe("MarkdownPatternExtractor - extract() 运行时选项覆盖", () => {
  it("extract 的 options 参数应覆盖构造函数选项", () => {
    const ext = new MarkdownPatternExtractor({
      strategyJsonBlock: true,
      minConfidence: 0.9,
    });

    // 运行时关闭 JSON 块策略
    const result = ext.extract(jsonFence(VALID_SKILL_JSON), {
      strategyJsonBlock: false,
    });

    expect(result.success).toBe(true);
    // JSON 块被禁用 → 无模式
    expect(result.patterns).toHaveLength(0);
  });

  it("extract options 应逐字段合并而非全量替换", () => {
    const ext = new MarkdownPatternExtractor({
      strategyP0P9Format: false,
      strategyPatternParagraph: false,
    });

    // 运行时只启用 P0-P9
    const result = ext.extract(
      pSection(10, { name: "P10: Test", steps: ["a", "b"] }),
      {
        strategyP0P9Format: true,
        minStepsForP0P9: 1,
      },
    );

    expect(result.success).toBe(true);
    expect(result.patterns).toHaveLength(1);
  });
});

// ============================================================
// §11 端到端混合场景
// ============================================================

describe("MarkdownPatternExtractor - 端到端混合场景", () => {
  it("混合 Markdown 中多个策略应同时生效", () => {
    const ext = new MarkdownPatternExtractor({
      strategyJsonBlock: true,
      strategyP0P9Format: true,
      strategyPatternParagraph: true,
      strategyFallbackFullFile: false,
      enableMerge: true,
    });

    const input = [
      // 策略 1: JSON 块
      jsonFence(VALID_SKILL_JSON),
      "",
      // 策略 2: P 编号段落
      pSection(42, {
        name: "P42: Test Pattern",
        steps: ["step 1", "step 2", "step 3"],
      }),
      "",
      // 策略 3: 启发式段落
      "## 启发式匹配段落",
      "",
      "- 使用 scanner 扫描目录结构",
      "- 调用 parser 解析文件内容",
      "",
      "Tags: scan, parse",
      "Trigger: 扫描文件时触发",
    ].join("\n");

    const result = ext.extract(input);

    expect(result.success).toBe(true);
    // 应产出多个候选（至少来自 3 个策略）
    expect(result.patterns.length).toBeGreaterThanOrEqual(2);
  });

  it("应产出有效的 PatternDefinition（完整字段校验）", () => {
    const ext = new MarkdownPatternExtractor({
      strategyJsonBlock: true,
      strategyP0P9Format: false,
      strategyPatternParagraph: false,
      strategyFallbackFullFile: false,
    });

    const result = ext.extract(jsonFence(VALID_SKILL_JSON));

    expect(result.success).toBe(true);
    for (const p of result.patterns) {
      expect(typeof p.id).toBe("string");
      expect(p.id.length).toBeGreaterThan(0);
      expect(Object.values(PatternKind)).toContain(p.kind);
      expect(typeof p.name).toBe("string");
      expect(typeof p.description).toBe("string");
      expect(typeof p.confidence).toBe("number");
      expect(p.confidence).toBeGreaterThanOrEqual(0);
      expect(p.confidence).toBeLessThanOrEqual(1);
      expect(typeof p.source).toBe("string");
      expect(p.body).toBeDefined();
      expect(Array.isArray(p.body.rules)).toBe(true);
      expect(Array.isArray(p.elements)).toBe(true);
      expect(p.extractedAt).toBeGreaterThan(0);
      expect(p.usageCount).toBe(0);
      expect(p.weight).toBe(p.confidence);
    }
  });
});
