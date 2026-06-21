import { type PatternExtractor, PatternKind, type ExtractionResult, type PatternExtractorOptions } from "../extractor.js";
/**
 * MarkdownExtractorOptions —— Markdown 提取器专有选项。
 *
 * 控制从 Markdown 文件中提取模式的行为和维度。
 * 各开关默认均为 true，消费者可按需关闭不关注的策略。
 *
 * @extends PatternExtractorOptions
 *
 * @example
 * ```typescript
 * const options: MarkdownExtractorOptions = {
 *   strategyJsonBlock: true,
 *   strategyP0P9Format: true,
 *   strategyPatternParagraph: true,
 *   strategyFallbackFullFile: false,
 *   headingLevels: [2, 3],
 *   minConfidence: 0.4,
 *   maxCandidates: 50,
 *   enableDiagnostics: true,
 * };
 * ```
 */
export type MarkdownExtractorOptions = PatternExtractorOptions & Record<string, unknown> & {
    /** 启用 JSON 代码块提取策略（默认 true） */
    strategyJsonBlock?: boolean;
    /** 启用 P0-P9 编号格式提取策略（默认 true） */
    strategyP0P9Format?: boolean;
    /** 启用模式段落提取策略（默认 true） */
    strategyPatternParagraph?: boolean;
    /** 启用全文回退策略——所有文件均产生一个候选（默认 false，仅无其他产出时启用） */
    strategyFallbackFullFile?: boolean;
    /** 考虑的标题层级（默认 [2, 3]——只解析 ## 和 ### 为段落边界） */
    headingLevels?: number[];
    /** 最小置信度阈值——低于此值的候选被过滤（默认 0.4） */
    minConfidence?: number;
    /** JSON 块中期望的顶层键白名单——不在白名单中的键被忽略（默认 ["id","name","triggerTags","steps"]） */
    jsonExpectedKeys?: string[];
    /** P0-P9 段落的最小步骤数——低于此值视为不完整（默认 2） */
    minStepsForP0P9?: number;
    /** 是否启用去重归并（默认 true） */
    enableMerge?: boolean;
    /** 最大返回候选数（默认 50） */
    maxCandidates?: number;
    /**
     * 目标文件名 glob 模式。
     * 用于在批量扫描时筛选目标文件。
     * 默认 ["*pattern*.md", "*patterns*.md"]。
     */
    fileGlobs?: string[];
};
/**
 * MarkdownPatternExtractor —— Markdown 模式提取器。
 *
 * 实现 PatternExtractor<string, MarkdownExtractorOptions> 接口，
 * 从 Markdown 文本中提取技能模板候选模式。
 *
 * **执行流程**（extract 方法内部）：
 * ```
 * 输入校验
 *   ↓
 * ┌─────────────────────────────────────────────────┐
 * │ 策略 1: JSON 块提取（strategyJsonBlock）         │
 * │   Regex: /```json\n([\s\S]*?)```/g             │
 * │   解析 JSON → 校验 SkillTemplate 字段 → 候选     │
 * ├─────────────────────────────────────────────────┤
 * │ 策略 2: P0-P9 格式提取（strategyP0P9Format）     │
 * │   按 ## / ### 分段                               │
 * │   Regex: /P\d+/ 匹配编号 + steps[] 提取          │
 * │   → 置信度 0.6–0.85                            │
 * ├─────────────────────────────────────────────────┤
 * │ 策略 3: 模式段落提取（strategyPatternParagraph） │
 * │   启发式匹配 trigger/steps/tags 关键字段          │
 * │   → 置信度 0.3–0.5                              │
 * ├─────────────────────────────────────────────────┤
 * │ 策略 4: 全文回退（strategyFallbackFullFile）     │
 * │   整篇文档作为一个候选                            │
 * │   → 置信度 0.2                                  │
 * └─────────────────────────────────────────────────┘
 *   ↓
 * 去重归并（id 唯一键 + Jaccard 相似度 > 0.8）
 *   ↓
 * 置信度过滤（minConfidence 阈值）
 *   ↓
 * 转换为 PatternDefinition[]
 *   ↓
 * 组装 ExtractionResult
 * ```
 *
 * @implements PatternExtractor<string, MarkdownExtractorOptions>
 *
 * @example
 * ```typescript
 * import { MarkdownPatternExtractor } from "@cortex/pattern-extractor";
 *
 * const extractor = new MarkdownPatternExtractor({
 *   strategyJsonBlock: true,
 *   strategyP0P9Format: true,
 *   minConfidence: 0.5,
 *   enableDiagnostics: true,
 * });
 *
 * const result = extractor.extract(markdownContent);
 *
 * if (result.success) {
 *   console.log(`提取到 ${result.patterns.length} 个候选模式`);
 * } else {
 *   console.error(`提取失败: ${result.error}`);
 * }
 * ```
 */
export declare class MarkdownPatternExtractor implements PatternExtractor<string, MarkdownExtractorOptions> {
    /** @inheritdoc */
    readonly name = "markdown-extractor";
    /** @inheritdoc */
    readonly supportedLanguages: string[];
    /** @inheritdoc */
    readonly supportedKinds: PatternKind[];
    /** @inheritdoc */
    readonly description = "\u57FA\u4E8E Markdown \u7ED3\u6784\u5206\u6790\u7684\u6A21\u5F0F\u63D0\u53D6\u5668\uFF0C\u6309\u7167 4 \u7EA7\u56DE\u9000\u7B56\u7565\u4ECE pattern.md / patterns.md \u6587\u4EF6\u4E2D\u63D0\u53D6\u6280\u80FD\u6A21\u677F\u5019\u9009\u6A21\u5F0F\u3002\u7B56\u7565\u4F18\u5148\u7EA7\uFF1AJSON \u5757\u63D0\u53D6 \u2192 P0-P9 \u683C\u5F0F\u63D0\u53D6 \u2192 \u6A21\u5F0F\u6BB5\u843D\u63D0\u53D6 \u2192 \u5168\u6587\u56DE\u9000";
    /** 合并后的选项（含默认值） */
    private readonly _options;
    /** 匹配 ```json ... ``` 代码块 */
    private static readonly JSON_BLOCK_RE;
    /** 匹配 P0-P99 编号前缀 */
    private static readonly P_NUMBER_RE;
    /** 匹配有序/无序列表项 */
    private static readonly LIST_ITEM_RE;
    /** 匹配步骤描述中的「使用 xxx」「调用 xxx」模式 */
    private static readonly STEP_ACTION_RE;
    /** 匹配 trigger / triggerTags / trigger_tags 等字段声明 */
    private static readonly TRIGGER_FIELD_RE;
    /**
     * 创建 MarkdownPatternExtractor 实例。
     *
     * @param options - 提取器专有选项（可选，使用缺省默认值）
     */
    constructor(options?: MarkdownExtractorOptions);
    /**
     * 从 Markdown 文本中提取模式。
     *
     * 按优先级执行 4 种策略，收集所有候选后进行去重归并，
     * 然后按置信度过滤，最后转换为 PatternDefinition[] 返回。
     *
     * @param input   - Markdown 文本内容
     * @param options - 覆盖构造选项中的参数（可选）
     * @returns ExtractionResult
     */
    extract(input: string, options?: MarkdownExtractorOptions): ExtractionResult;
    /**
     * 判断本提取器能否处理指定的语言和模式种类。
     *
     * MarkdownExtractor 仅支持 "markdown" 语言，
     * 模式种类仅支持 Documentation 和 Behavioral。
     *
     * @param language - 编程语言名称
     * @param kind     - 模式种类
     * @returns true 表示可以处理
     */
    canHandle(language: string, kind: PatternKind): boolean;
    /**
     * 策略 1 —— 从 Markdown 中提取 ```json 代码块并解析为 SkillTemplate。
     *
     * 这是最高置信度的策略——SkillTemplate 本身就是 JSON 格式，
     * 莫娜和一些 Agent 直接输出 ```json ... ``` 代码块。
     *
     * 实现路线：
     * 1. 用 JSON_BLOCK_RE 查找所有 ```json 块
     * 2. 对每个块尝试 JSON.parse
     * 3. 校验是否包含 SkillTemplate 关键字段（id/name/triggerTags/steps）
     * 4. 成功解析 → confidence = 0.9–1.0（字段完整性越高越接近 1.0）
     * 5. 解析失败 → 记录 diagnostic，不产出候选
     *
     * @param input       - Markdown 文本
     * @param diagnostics - 诊断信息累加器
     * @param opts        - 完整选项
     * @returns 候选列表
     */
    private _extractJsonBlocks;
    /**
     * 从 JSON 对象中提取 triggerTags / tags 字段。
     */
    private _extractTagsFromJson;
    /**
     * 从 JSON 对象中提取 steps 字段（容错逗号分隔字符串）。
     */
    private _extractStepsFromJson;
    /**
     * 策略 2 —— 识别 "P11: 技能沉淀闭环" 等编号格式的段落。
     *
     * 莫娜产出的 skill templates 常以 P 编号开头，格式固定：
     * ```
     * ### P11: 技能沉淀闭环 (Pattern → Memory → Registry)
     *
     * - triggerTags: [loop, pattern_scan, skill_precipitate]
     * - trigger: 需要从已产出的 pattern.md ...
     * - steps:
     *   1. 使用 scanOutputFilesForSkills 扫描 ...
     *   2. 调用 extractSkillsFromMarkdown ...
     * ```
     *
     * 实现路线：
     * 1. 按 heading（## / ###）将文档拆分为段落
     * 2. 过滤出标题匹配 P_NUMBER_RE 的段落
     * 3. 在段落体中提取 triggerTags（数组）、trigger 文本、steps（列表项）
     * 4. 校验 steps.length >= minStepsForP0P9
     * 5. confidence = 0.6–0.85（字段完整性线性插值）
     *    - 有 id/name/tags/steps → 0.85
     *    - 有 name/tags/steps → 0.6
     *    - 缺 tags → 0.4
     *
     * @param input       - Markdown 文本
     * @param diagnostics - 诊断信息累加器
     * @param opts        - 完整选项
     * @returns 候选列表
     */
    private _extractP0P9Format;
    /**
     * 从 P 编号段落的 body 中提取 triggerTags。
     * 匹配 "Tags:" / "triggerTags:" / "- triggerTags: [...]" 等格式。
     */
    private _extractTagsFromPNSection;
    /**
     * 从 P 编号段落的 body 中提取 trigger 文本。
     */
    private _extractTriggerFromPNSection;
    /**
     * 从 P 编号段落的 body 中提取 steps 列表。
     * 支持多种格式：编号列表、Recipe/Steps 节、bullet 列表。
     */
    private _extractStepsFromPNSection;
    /**
     * 从 P 编号段落的 body 中提取 expectedOutput。
     */
    private _extractExpectedOutputFromPNSection;
    /**
     * 策略 3 —— 对自由格式的 Markdown 段落进行启发式模式提取。
     *
     * 当段落不符合 JSON 或 P0-P9 格式时，采用启发式规则判断
     * 其是否包含技能模板的关键信号：
     *
     * 启发式规则（HeuristicRule 风格，参见 pattern.ts §9）：
     * - 规则 A「TRIGGER 信号」：段落包含 trigger* 字段声明 → confidence +0.2
     * - 规则 B「STEPS 信号」：段落包含 2+ 步骤描述（LIST_ITEM_RE + 行为动词）→ confidence +0.3
     * - 规则 C「TAGS 信号」：段落包含 tag 列表（逗号分隔或数组格式）→ confidence +0.15
     * - 规则 D「OUTPUT 信号」：段落包含 expectedOutput / outputFile → confidence +0.1
     * - 规则 E「ID 信号」：段落包含 "id:" 或 "skill-p" 模式 → confidence +0.1
     *
     * 基础 confidence = 0.1，累计后 cap 在 0.5。
     *
     * @param input       - Markdown 文本
     * @param diagnostics - 诊断信息累加器
     * @param opts        - 完整选项
     * @returns 候选列表
     */
    private _extractPatternParagraphs;
    /**
     * 统计段落中的步骤信号数量。
     * 匹配：列表项 + 行为动词（STEP_ACTION_RE）。
     */
    private _countStepSignals;
    /**
     * 检测段落中是否存在标签列表信号。
     * 匹配：逗号分隔的标签列表、方括号数组、"Tags:" 行。
     */
    private _hasTagListSignal;
    /**
     * 从自由格式段落中提取标签。
     */
    private _extractTagsFromPatternParagraph;
    /**
     * 从自由格式段落中提取 trigger 文本。
     */
    private _extractTriggerFromPatternParagraph;
    /**
     * 从自由格式段落中提取步骤列表。
     */
    private _extractStepsFromPatternParagraph;
    /**
     * 策略 4 —— 将整篇文档作为一个模式候选。
     *
     * 当日志文件有实质性内容但不符合任何结构化格式时启用。
     * confidence 固定为 0.2——这是最低质量的候选，
     * 但比完全丢弃要好——莫娜可以在第 2 层语义裁决中将其过滤。
     *
     * @param input       - Markdown 文本
     * @param diagnostics - 诊断信息累加器
     * @returns 候选（或 null——若文件过短）
     */
    private _extractFullFileFallback;
    /**
     * 按指定层级的 Markdown 标题将文本拆分为段落。
     *
     * @param input  - Markdown 文本
     * @param levels - 标题层级列表（如 [2, 3]）
     * @returns 段落数组，每个段落含 heading、body、行范围
     */
    private _splitByHeadings;
    /**
     * 按策略优先级去重归并——同名候选保留置信度最高的。
     *
     * 归并规则：
     * - JSON 块提取的候选优先于 P0-P9 格式的同名候选
     * - 同名候选合并 tags（取并集）
     * - 同名候选取更完整的 steps（更多的）
     *
     * @param candidates  - 所有候选
     * @param diagnostics - 诊断信息累加器
     * @returns 归并后的候选列表
     */
    private _mergeByStrategyPriority;
    /**
     * 合并构造选项和 extract() 参数——后者覆盖前者。
     */
    private _mergeOptions;
    /**
     * 将 SkillTemplateCandidate 转换为标准 PatternDefinition。
     *
     * 映射规则：
     * - id: `md-{index}` —— 因原始 SkillTemplate.id 可能跨文件重复
     * - kind: PatternKind.Behavioral（技能模板本质是行为模式）
     * - name: candidate.name
     * - description: `trigger: {triggerText}` — trigger 文本内联到描述
     * - tags: candidate.tags
     * - language: "markdown"
     * - confidence: candidate.baseConfidence
     * - source: `策略: {strategy}`
     * - sourceSpan: {startLine, endLine}
     * - body: { steps: string[], expectedOutput?: string }（结构化存储）
     * - elements: 从 tags 和 steps 提取 PatternElement[]
     * - extractor: "markdown-extractor"
     * - extractedAt: Date.now()
     * - usageCount: 0
     * - weight: candidate.baseConfidence（初始权重 = 置信度）
     *
     * @param candidate - 技能模板候选
     * @param index     - 在结果数组中的序号
     * @returns PatternDefinition
     */
    private _candidateToPatternDefinition;
}
//# sourceMappingURL=markdown-extractor.d.ts.map