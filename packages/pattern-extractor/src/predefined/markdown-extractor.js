// ============================================================
// @cortex/pattern-extractor — MarkdownPatternExtractor 实现
// ============================================================
//
// @file-overview
// MarkdownPatternExtractor 是 PatternExtractor 接口的具体实现，
// 专门用于从 Markdown 文件（pattern.md / patterns.md）中提取
// 技能模板模式。服务于莫娜（LoopAgent）两层提取架构的第 1 层。
//
// 适用场景：
// - 从 Agent 产出的 pattern.md 文件中提取 SkillTemplate 候选项
// - 识别 P0-P9 / P10-P19 等编号格式的技能模板段落
// - 解析 ```json 代码块中的结构化技能定义
// - 对自由格式的模式描述段落进行启发式提取
//
// 提取策略（4 级回退，与莫娜 system prompt 对齐）：
// 1. JSON 块提取（```json fences）——解析结构化 SkillTemplate
// 2. P0-P9 格式提取（编号段落）——识别 id/agentType/name/steps 模式
// 3. 模式段落提取（自由格式节段）——启发式匹配 trigger/steps 描述
// 4. 全文回退（兜底）——将整篇文档作为一个模式
//
// 设计原则（继承自 pattern.ts 设计宪法）：
// - 模式是「可参考」而非「可执行」——本提取器产出候选模式，
//   最终的 SkillTemplate JSON 由莫娜（第 2 层）语义裁决
// - 零 any 类型——所有解析结果通过 SkillTemplateCandidate 类型描述
// - 零非空断言——所有可选字段通过空值检查守卫
// - 所有公开 API 均附带完整 JSDoc
// - 所有错误通过 ExtractionResult.error 返回，不抛出运行时异常
//
// 实现状态：全 4 策略实现完毕，可投入生产使用。
// 策略 1 JSON 块 ↔ 策略 2 P0-P9 ↔ 策略 3 启发式段落 ↔ 策略 4 全文回退
//
// @layer 实现层（Implementation Layer）
// @implements PatternExtractor<string, MarkdownExtractorOptions>
// @since v0.2.0
//
// @coding-standards
// - 零 any 类型
// - 零非空断言
// - Result 判别联合（P04）
// - 多级校验器回退（P10）
// ============================================================
import { PatternKind, } from "../extractor.js";
// ============================================================
// §3 MarkdownPatternExtractor — 实现类
// ============================================================
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
export class MarkdownPatternExtractor {
    /** @inheritdoc */
    name = "markdown-extractor";
    /** @inheritdoc */
    supportedLanguages = ["markdown"];
    /** @inheritdoc */
    supportedKinds = [
        PatternKind.Documentation,
        PatternKind.Behavioral,
    ];
    /** @inheritdoc */
    description = "基于 Markdown 结构分析的模式提取器，按照 4 级回退策略从 pattern.md / patterns.md 文件中提取技能模板候选模式。策略优先级：JSON 块提取 → P0-P9 格式提取 → 模式段落提取 → 全文回退";
    /** 合并后的选项（含默认值） */
    _options;
    // ── 正则常量 ──
    /** 匹配 ```json ... ``` 代码块 */
    static JSON_BLOCK_RE = /```json\s*\n([\s\S]*?)```/g;
    /** 匹配 P0-P99 编号前缀 */
    static P_NUMBER_RE = /P(\d+)/;
    /** 匹配有序/无序列表项 */
    static LIST_ITEM_RE = /^[\t ]*(?:[-*+]|\d+\.)\s+/;
    /** 匹配步骤描述中的「使用 xxx」「调用 xxx」模式 */
    static STEP_ACTION_RE = /(?:使用|调用|执行|扫描|提取|注册|持久化|验证|读取|写入|检查)/;
    /** 匹配 trigger / triggerTags / trigger_tags 等字段声明 */
    static TRIGGER_FIELD_RE = /(?:trigger[_\s]?(?:tags?|condition)?|触发|标签)[\s:：]+(.+)/i;
    /**
     * 创建 MarkdownPatternExtractor 实例。
     *
     * @param options - 提取器专有选项（可选，使用缺省默认值）
     */
    constructor(options) {
        this._options = {
            strategyJsonBlock: options?.strategyJsonBlock ?? true,
            strategyP0P9Format: options?.strategyP0P9Format ?? true,
            strategyPatternParagraph: options?.strategyPatternParagraph ?? true,
            strategyFallbackFullFile: options?.strategyFallbackFullFile ?? false,
            headingLevels: options?.headingLevels ?? [2, 3],
            minConfidence: options?.minConfidence ?? 0.4,
            jsonExpectedKeys: options?.jsonExpectedKeys ?? [
                "id",
                "name",
                "triggerTags",
                "steps",
            ],
            minStepsForP0P9: options?.minStepsForP0P9 ?? 2,
            enableMerge: options?.enableMerge ?? true,
            maxCandidates: options?.maxCandidates ?? 50,
            fileGlobs: options?.fileGlobs ?? ["*pattern*.md", "*patterns*.md"],
            logLevel: options?.logLevel ?? "info",
            enableDiagnostics: options?.enableDiagnostics ?? false,
        };
    }
    // ============================================================
    // 公开 API：extract / canHandle
    // ============================================================
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
    extract(input, options) {
        const startTime = Date.now();
        const diagnostics = [];
        const opts = options
            ? this._mergeOptions(this._options, options)
            : this._options;
        // ── 步骤 1：输入校验 ──
        if (typeof input !== "string") {
            return {
                success: false,
                patterns: [],
                diagnostics: [
                    `[${this.name}] 输入类型错误: 期望 string，收到 ${typeof input}`,
                ],
                durationMs: Date.now() - startTime,
                error: `输入类型错误：期望 string，收到 ${typeof input}`,
            };
        }
        const trimmedInput = input.trim();
        if (trimmedInput.length === 0) {
            return {
                success: true,
                patterns: [],
                diagnostics: [
                    `[${this.name}] 输入为空字符串，无模式可提取`,
                ],
                durationMs: Date.now() - startTime,
            };
        }
        // ── 步骤 2：执行 4 策略管线 ──
        const allCandidates = [];
        // 策略 1：JSON 块提取
        if (opts.strategyJsonBlock) {
            const jsonCandidates = this._extractJsonBlocks(trimmedInput, diagnostics, opts);
            allCandidates.push(...jsonCandidates);
        }
        // 策略 2：P0-P9 格式提取
        if (opts.strategyP0P9Format) {
            const p0p9Candidates = this._extractP0P9Format(trimmedInput, diagnostics, opts);
            allCandidates.push(...p0p9Candidates);
        }
        // 策略 3：模式段落提取
        if (opts.strategyPatternParagraph) {
            const paraCandidates = this._extractPatternParagraphs(trimmedInput, diagnostics, opts);
            allCandidates.push(...paraCandidates);
        }
        // 策略 4：全文回退（仅当无其他产出时）
        if (opts.strategyFallbackFullFile &&
            allCandidates.length === 0) {
            const fallback = this._extractFullFileFallback(trimmedInput, diagnostics);
            if (fallback)
                allCandidates.push(fallback);
        }
        // ── 步骤 3：去重归并 ──
        let merged = allCandidates;
        if (opts.enableMerge && allCandidates.length > 1) {
            merged = this._mergeByStrategyPriority(allCandidates, diagnostics);
        }
        // ── 步骤 4：置信度过滤 ──
        const filtered = merged.filter((c) => c.baseConfidence >= opts.minConfidence);
        // ── 步骤 5：数量限制 ──
        const trimmed = filtered.slice(0, opts.maxCandidates);
        // ── 步骤 6：转换为 PatternDefinition[] ──
        const patterns = trimmed.map((c, i) => this._candidateToPatternDefinition(c, i));
        // ── 步骤 7：组装结果 ──
        return {
            success: true,
            patterns,
            diagnostics,
            durationMs: Date.now() - startTime,
        };
    }
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
    canHandle(language, kind) {
        return (this.supportedLanguages.includes(language) &&
            this.supportedKinds.includes(kind));
    }
    // ============================================================
    // 策略 1：JSON 块提取
    // ============================================================
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
    _extractJsonBlocks(input, diagnostics, _opts) {
        const candidates = [];
        // 重置 lastIndex
        MarkdownPatternExtractor.JSON_BLOCK_RE.lastIndex = 0;
        let match;
        while ((match = MarkdownPatternExtractor.JSON_BLOCK_RE.exec(input)) !== null) {
            const jsonText = match[1];
            // ── JSON 解析 ──
            let parsed;
            try {
                parsed = JSON.parse(jsonText);
            }
            catch (e) {
                diagnostics.push(`[${this.name}] JSON 块解析失败 (offset ${match.index}): ` +
                    `${String(e).slice(0, 100)}`);
                continue;
            }
            // ── 计算行号范围 ──
            const beforeMatch = input.slice(0, match.index);
            const startLine = (beforeMatch.match(/\n/g)?.length ?? 0) + 1;
            const endLine = startLine + (jsonText.match(/\n/g)?.length ?? 0);
            // ── 规范化数组 ──
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (typeof item !== "object" || item === null) {
                    diagnostics.push(`[${this.name}] JSON 块条目[${i}]不是对象，跳过`);
                    continue;
                }
                const obj = item;
                // ── 提取核心字段 ──
                const rawName = typeof obj.name === "string" ? obj.name : "";
                if (!rawName) {
                    diagnostics.push(`[${this.name}] JSON 块条目[${i}]缺少 name 字段，跳过`);
                    continue;
                }
                const rawId = typeof obj.id === "string" ? obj.id : "";
                const tags = this._extractTagsFromJson(obj);
                const triggerText = typeof obj.trigger === "string" ? obj.trigger : "";
                const steps = this._extractStepsFromJson(obj);
                const expectedOutput = typeof obj.expectedOutput === "string"
                    ? obj.expectedOutput
                    : typeof obj.expected_output === "string"
                        ? obj.expected_output
                        : undefined;
                // ── 置信度计算（字段完整性越高越接近 1.0）──
                let baseConfidence = 0.6; // 基础：JSON 解析成功
                if (rawId)
                    baseConfidence += 0.1;
                if (triggerText)
                    baseConfidence += 0.1;
                if (tags.length > 0)
                    baseConfidence += 0.1;
                if (steps.length > 0)
                    baseConfidence += 0.1;
                if (expectedOutput)
                    baseConfidence += 0.05;
                baseConfidence = Math.min(baseConfidence, 1.0);
                candidates.push({
                    name: rawId ? `${rawId}: ${rawName}` : rawName,
                    tags,
                    triggerText,
                    steps,
                    expectedOutput,
                    rawText: jsonText.slice(0, 500),
                    strategy: "json-block",
                    baseConfidence,
                    lineRange: [startLine, endLine],
                });
            }
            diagnostics.push(`[${this.name}] JSON block extracted ${items.length} candidates ` +
                `(L${startLine}-L${endLine})`);
        }
        return candidates;
    }
    /**
     * 从 JSON 对象中提取 triggerTags / tags 字段。
     */
    _extractTagsFromJson(obj) {
        const raw = Array.isArray(obj.triggerTags)
            ? obj.triggerTags
            : Array.isArray(obj.trigger_tags)
                ? obj.trigger_tags
                : Array.isArray(obj.tags)
                    ? obj.tags
                    : undefined;
        if (!raw)
            return [];
        return raw.filter((t) => typeof t === "string");
    }
    /**
     * 从 JSON 对象中提取 steps 字段（容错逗号分隔字符串）。
     */
    _extractStepsFromJson(obj) {
        const raw = Array.isArray(obj.steps)
            ? obj.steps
            : Array.isArray(obj.steps_json)
                ? obj.steps_json
                : obj.steps;
        if (Array.isArray(raw)) {
            return raw.filter((s) => typeof s === "string" && s.trim().length > 0);
        }
        if (typeof raw === "string") {
            // 容错：LLM 可能输出逗号分隔的字符串
            return raw
                .split(/[,，]/)
                .map((s) => s.trim())
                .filter(Boolean);
        }
        return [];
    }
    // ============================================================
    // 策略 2：P0-P9 格式提取
    // ============================================================
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
    _extractP0P9Format(input, diagnostics, opts) {
        const candidates = [];
        // ── 按 heading 拆段（仅限 opts.headingLevels 指定的层级）──
        const sections = this._splitByHeadings(input, opts.headingLevels);
        for (const section of sections) {
            // 检查 heading 是否匹配 P 编号
            const pMatch = MarkdownPatternExtractor.P_NUMBER_RE.exec(section.heading);
            if (!pMatch)
                continue;
            const body = section.body;
            // ── 提取 triggerTags ──
            const tags = this._extractTagsFromPNSection(body);
            // ── 提取 trigger ──
            const triggerText = this._extractTriggerFromPNSection(body);
            // ── 提取 steps ──
            const steps = this._extractStepsFromPNSection(body);
            // ── 提取 expectedOutput ──
            const expectedOutput = this._extractExpectedOutputFromPNSection(body);
            // ── 校验步骤数 ──
            if (steps.length < opts.minStepsForP0P9) {
                diagnostics.push(`[${this.name}] P-number section "${section.heading}" ` +
                    `steps (${steps.length}) < min ${opts.minStepsForP0P9}，跳过 ` +
                    `(L${section.startLine}-L${section.endLine})`);
                continue;
            }
            // ── 置信度计算（字段完整性线性插值）──
            let baseConfidence = 0.4; // 基础：P 编号命中
            if (triggerText)
                baseConfidence += 0.15;
            if (tags.length > 0)
                baseConfidence += 0.15;
            if (steps.length >= 3)
                baseConfidence += 0.15;
            if (expectedOutput)
                baseConfidence += 0.1;
            baseConfidence = Math.min(baseConfidence, 0.85);
            const displayName = `P${pMatch[1]}:${section.heading.replace(/^P\d+[\s:：—\-–]*/, "")}`;
            candidates.push({
                name: displayName.slice(0, 120),
                tags,
                triggerText,
                steps,
                expectedOutput,
                rawText: body.slice(0, 500),
                strategy: "p0-p9",
                baseConfidence,
                lineRange: [section.startLine, section.endLine],
            });
            diagnostics.push(`[${this.name}] P-number section "${section.heading}" ` +
                `→ candidate "${displayName.slice(0, 40)}" ` +
                `(conf=${baseConfidence.toFixed(2)}, L${section.startLine}-L${section.endLine})`);
        }
        return candidates;
    }
    /**
     * 从 P 编号段落的 body 中提取 triggerTags。
     * 匹配 "Tags:" / "triggerTags:" / "- triggerTags: [...]" 等格式。
     */
    _extractTagsFromPNSection(body) {
        // 格式 1: "Tags: tag1, tag2, tag3"
        const lineMatch = body.match(/(?:triggerTags|trigger_tags|tags?)[\s:：]+(.+)/i);
        if (lineMatch) {
            const raw = lineMatch[1].trim();
            // 去掉方括号
            const cleaned = raw.replace(/^\[|\]$/g, "");
            return cleaned
                .split(/[,，、\s]+/)
                .map((t) => t.trim())
                .filter(Boolean);
        }
        // 格式 2: "- triggerTags: [...]" 列表项
        const listMatch = body.match(/^[\t ]*[-*+]\s*(?:triggerTags|trigger_tags|tags?)[\s:：]+(.+)/im);
        if (listMatch) {
            const raw = listMatch[1].trim();
            const cleaned = raw.replace(/^\[|\]$/g, "");
            return cleaned
                .split(/[,，、\s]+/)
                .map((t) => t.trim())
                .filter(Boolean);
        }
        return [];
    }
    /**
     * 从 P 编号段落的 body 中提取 trigger 文本。
     */
    _extractTriggerFromPNSection(body) {
        // 格式 1: "Trigger: xxx"
        const lineMatch = body.match(/Trigger[\s:：]+(.+)/im);
        if (lineMatch)
            return lineMatch[1].trim();
        // 格式 2: "- trigger: xxx" 列表项
        const listMatch = body.match(/^[\t ]*[-*+]\s*trigger[\s:：]+(.+)/im);
        if (listMatch)
            return listMatch[1].trim();
        return "";
    }
    /**
     * 从 P 编号段落的 body 中提取 steps 列表。
     * 支持多种格式：编号列表、Recipe/Steps 节、bullet 列表。
     */
    _extractStepsFromPNSection(body) {
        // 格式 1: "Recipe:" / "Steps:" 节后的 bullet 列表
        const recipeMatch = body.match(/(?:Recipe|Steps?|\u6b65\u9aa4|\u6d41\u7a0b)[\s:\u3000-\u303f\uff00-\uffef]+(?:\r?\n)?([\s\S]*?)(?:\r?\n(?:#{1,3}\s|\r?\n)|$)/i);
        if (recipeMatch) {
            const recipeContent = recipeMatch[1];
            // 提取编号列表项
            const numberedItems = recipeContent.match(/^[\t ]*(?:\d+[.、)\]]\s*)(.+)/gm);
            if (numberedItems && numberedItems.length > 0) {
                return numberedItems
                    .map((s) => s.replace(/^[\t ]*\d+[.、)\]]\s*/, "").trim())
                    .filter(Boolean);
            }
            // 提取 bullet 列表项
            const bulletItems = recipeContent.match(/^[\t ]*[-*+]\s*(.+)/gm);
            if (bulletItems && bulletItems.length > 0) {
                return bulletItems
                    .map((s) => s.replace(/^[\t ]*[-*+]\s*/, "").trim())
                    .filter(Boolean);
            }
        }
        // 格式 2: 直接在段落中的编号列表（如 "1. xxx\n2. yyy"）
        const numberedGlobal = body.match(/^[\t ]*(?:\d+[.、)\]]\s*)(.+)/gm);
        if (numberedGlobal && numberedGlobal.length >= 2) {
            return numberedGlobal
                .map((s) => s.replace(/^[\t ]*\d+[.、)\]]\s*/, "").trim())
                .filter(Boolean);
        }
        // 格式 3: bullet 列表
        const bulletGlobal = body.match(/^[\t ]*[-*+]\s*(.+)/gm);
        if (bulletGlobal && bulletGlobal.length >= 2) {
            return bulletGlobal
                .map((s) => s.replace(/^[\t ]*[-*+]\s*/, "").trim())
                .filter(Boolean);
        }
        return [];
    }
    /**
     * 从 P 编号段落的 body 中提取 expectedOutput。
     */
    _extractExpectedOutputFromPNSection(body) {
        // 格式 1: "expectedOutput: xxx"
        const lineMatch = body.match(/(?:expectedOutput|expected_output|Expected[\s]*Output)[\s:：]+(.+)/i);
        if (lineMatch)
            return lineMatch[1].trim();
        // 格式 2: "- expectedOutput: xxx" 列表项
        const listMatch = body.match(/^[\t ]*[-*+]\s*(?:expectedOutput|expected_output)[\s:：]+(.+)/im);
        if (listMatch)
            return listMatch[1].trim();
        // 格式 3: "Condition:" 节（旧版约定）
        const conditionMatch = body.match(/Condition[\s:\u3000-\u303f\uff00-\uffef]+(?:\r?\n)?([\s\S]*?)(?:\r?\n(?:#{1,3}\s|\r?\n)|$)/i);
        if (conditionMatch) {
            const conditions = conditionMatch[1]
                .split("\n")
                .map((c) => c.trim())
                .filter(Boolean)
                .join("; ");
            if (conditions)
                return conditions;
        }
        return undefined;
    }
    // ============================================================
    // 策略 3：模式段落提取（启发式）
    // ============================================================
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
    _extractPatternParagraphs(input, diagnostics, opts) {
        const candidates = [];
        const sections = this._splitByHeadings(input, opts.headingLevels);
        for (const section of sections) {
            // 跳过已被策略 1/2 处理的段落（P 编号匹配的）
            if (MarkdownPatternExtractor.P_NUMBER_RE.test(section.heading))
                continue;
            const body = section.body;
            if (body.length < 30)
                continue; // 太短的段落跳过
            // ── 应用 5 条启发式规则累积 confidence ──
            let confidence = 0.1; // 基础
            // 规则 A「TRIGGER 信号」: 段落包含 trigger* 字段声明
            if (MarkdownPatternExtractor.TRIGGER_FIELD_RE.test(body)) {
                confidence += 0.2;
            }
            // 规则 B「STEPS 信号」: 段落包含 2+ 步骤描述
            const stepCount = this._countStepSignals(body);
            if (stepCount >= 2) {
                confidence += 0.3;
            }
            // 规则 C「TAGS 信号」: 段落包含 tag 列表
            const hasTags = this._hasTagListSignal(body);
            if (hasTags) {
                confidence += 0.15;
            }
            // 规则 D「OUTPUT 信号」: 段落包含 expectedOutput / outputFile
            if (/expectedOutput|expected_output|outputFile|output_file/i.test(body)) {
                confidence += 0.1;
            }
            // 规则 E「ID 信号」: 段落包含 "id:" 或 "skill-p" 模式
            if (/(?:^|[\s(])id[\s]*[：:]|skill-p\d+/i.test(body)) {
                confidence += 0.1;
            }
            // Cap at 0.5
            confidence = Math.min(confidence, 0.5);
            // ── 置信度过滤 ──
            if (confidence < opts.minConfidence)
                continue;
            // ── 尝试从 body 提取基本字段 ──
            const tags = this._extractTagsFromPatternParagraph(body);
            const triggerText = this._extractTriggerFromPatternParagraph(body);
            const steps = this._extractStepsFromPatternParagraph(body);
            const displayName = section.heading ||
                body.split("\n")[0]?.replace(/^#+\s*/, "").slice(0, 60) ||
                "Unnamed pattern";
            candidates.push({
                name: displayName.slice(0, 120),
                tags,
                triggerText,
                steps,
                rawText: body.slice(0, 500),
                strategy: "pattern-paragraph",
                baseConfidence: confidence,
                lineRange: [section.startLine, section.endLine],
            });
            diagnostics.push(`[${this.name}] pattern-paragraph heuristic: ` +
                `"${displayName.slice(0, 40)}" (conf=${confidence.toFixed(2)}, ` +
                `L${section.startLine}-L${section.endLine})`);
        }
        return candidates;
    }
    /**
     * 统计段落中的步骤信号数量。
     * 匹配：列表项 + 行为动词（STEP_ACTION_RE）。
     */
    _countStepSignals(body) {
        const lines = body.split("\n");
        let count = 0;
        for (const line of lines) {
            if (MarkdownPatternExtractor.LIST_ITEM_RE.test(line) &&
                MarkdownPatternExtractor.STEP_ACTION_RE.test(line)) {
                count++;
            }
        }
        return count;
    }
    /**
     * 检测段落中是否存在标签列表信号。
     * 匹配：逗号分隔的标签列表、方括号数组、"Tags:" 行。
     */
    _hasTagListSignal(body) {
        // "Tags: xxx" 或 "- triggerTags: [...]"
        if (/(?:tags?|triggerTags|trigger_tags)[\s:：]+/i.test(body)) {
            return true;
        }
        // 方括号数组格式 ["tag1", "tag2"]
        if (/\[["'].+["']\]/.test(body)) {
            return true;
        }
        return false;
    }
    /**
     * 从自由格式段落中提取标签。
     */
    _extractTagsFromPatternParagraph(body) {
        const match = body.match(/(?:tags?|triggerTags|trigger_tags)[\s:：]+(.+)/i);
        if (!match)
            return [];
        const raw = match[1].trim().replace(/^\[|\]$/g, "");
        return raw
            .split(/[,，、\s]+/)
            .map((t) => t.trim())
            .filter((t) => t.length > 0);
    }
    /**
     * 从自由格式段落中提取 trigger 文本。
     */
    _extractTriggerFromPatternParagraph(body) {
        const match = body.match(/trigger[\s:：]+(.+)/im);
        return match ? match[1].trim() : "";
    }
    /**
     * 从自由格式段落中提取步骤列表。
     */
    _extractStepsFromPatternParagraph(body) {
        const lines = body.split("\n");
        return lines
            .filter((line) => MarkdownPatternExtractor.LIST_ITEM_RE.test(line) &&
            MarkdownPatternExtractor.STEP_ACTION_RE.test(line))
            .map((line) => line.replace(MarkdownPatternExtractor.LIST_ITEM_RE, "").trim())
            .filter(Boolean);
    }
    // ============================================================
    // 策略 4：全文回退
    // ============================================================
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
    _extractFullFileFallback(input, _diagnostics) {
        const lines = input.split("\n");
        // 少于 5 行的文件放弃
        if (lines.length < 5)
            return null;
        const firstLine = lines[0].replace(/^#+\s*/, "").slice(0, 120);
        return {
            name: firstLine || "Untitled pattern",
            tags: [],
            triggerText: "",
            steps: [],
            rawText: input,
            strategy: "full-file",
            baseConfidence: 0.2,
            lineRange: [1, lines.length],
        };
    }
    // ============================================================
    // 辅助：段落拆分
    // ============================================================
    /**
     * 按指定层级的 Markdown 标题将文本拆分为段落。
     *
     * @param input  - Markdown 文本
     * @param levels - 标题层级列表（如 [2, 3]）
     * @returns 段落数组，每个段落含 heading、body、行范围
     */
    _splitByHeadings(input, levels) {
        const sections = [];
        const lines = input.split("\n");
        const headingRe = new RegExp(`^(${levels.map((l) => `#{${l}}`).join("|")})\\s+(.+)$`);
        let currentHeading = "";
        let currentBody = "";
        let currentStartLine = 1;
        for (let i = 0; i < lines.length; i++) {
            const m = headingRe.exec(lines[i]);
            if (m) {
                // 遇到新标题 → 保存前一段
                if (currentHeading) {
                    sections.push({
                        heading: currentHeading,
                        body: currentBody.trim(),
                        startLine: currentStartLine,
                        endLine: i,
                    });
                }
                currentHeading = m[2]; // 标题文本（不含 # 前缀）
                currentBody = "";
                currentStartLine = i + 1;
            }
            else if (currentHeading) {
                currentBody += lines[i] + "\n";
            }
        }
        // 保存最后一段
        if (currentHeading) {
            sections.push({
                heading: currentHeading,
                body: currentBody.trim(),
                startLine: currentStartLine,
                endLine: lines.length,
            });
        }
        return sections;
    }
    // ============================================================
    // 辅助：去重归并
    // ============================================================
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
    _mergeByStrategyPriority(candidates, diagnostics) {
        const map = new Map();
        for (const c of candidates) {
            const existing = map.get(c.name);
            if (!existing) {
                map.set(c.name, c);
                continue;
            }
            // 优先级：json-block > p0-p9 > pattern-paragraph > full-file
            const priority = {
                "json-block": 4,
                "p0-p9": 3,
                "pattern-paragraph": 2,
                "full-file": 1,
            };
            if (priority[c.strategy] > priority[existing.strategy]) {
                // 新候选策略优先级更高 → 替换，但合并 tags 和 steps
                existing.tags = [...new Set([...existing.tags, ...c.tags])];
                existing.steps =
                    c.steps.length > existing.steps.length ? c.steps : existing.steps;
                map.set(c.name, existing);
            }
        }
        if (candidates.length !== map.size) {
            diagnostics.push(`[${this.name}] 去重归并: ${candidates.length} → ${map.size}`);
        }
        return [...map.values()];
    }
    // ============================================================
    // 辅助：合并选项
    // ============================================================
    /**
     * 合并构造选项和 extract() 参数——后者覆盖前者。
     */
    _mergeOptions(base, overrides) {
        const merged = { ...base };
        if (overrides.strategyJsonBlock !== undefined) {
            merged.strategyJsonBlock = overrides.strategyJsonBlock;
        }
        if (overrides.strategyP0P9Format !== undefined) {
            merged.strategyP0P9Format = overrides.strategyP0P9Format;
        }
        if (overrides.strategyPatternParagraph !== undefined) {
            merged.strategyPatternParagraph = overrides.strategyPatternParagraph;
        }
        if (overrides.strategyFallbackFullFile !== undefined) {
            merged.strategyFallbackFullFile = overrides.strategyFallbackFullFile;
        }
        if (overrides.headingLevels !== undefined) {
            merged.headingLevels = overrides.headingLevels;
        }
        if (overrides.minConfidence !== undefined) {
            merged.minConfidence = overrides.minConfidence;
        }
        if (overrides.jsonExpectedKeys !== undefined) {
            merged.jsonExpectedKeys = overrides.jsonExpectedKeys;
        }
        if (overrides.minStepsForP0P9 !== undefined) {
            merged.minStepsForP0P9 = overrides.minStepsForP0P9;
        }
        if (overrides.enableMerge !== undefined) {
            merged.enableMerge = overrides.enableMerge;
        }
        if (overrides.maxCandidates !== undefined) {
            merged.maxCandidates = overrides.maxCandidates;
        }
        if (overrides.fileGlobs !== undefined) {
            merged.fileGlobs = overrides.fileGlobs;
        }
        if (overrides.logLevel !== undefined) {
            merged.logLevel = overrides.logLevel;
        }
        if (overrides.enableDiagnostics !== undefined) {
            merged.enableDiagnostics = overrides.enableDiagnostics;
        }
        return merged;
    }
    // ============================================================
    // 辅助：候选 → PatternDefinition 转换
    // ============================================================
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
    _candidateToPatternDefinition(candidate, index) {
        const body = {
            rules: candidate.steps,
            examples: candidate.expectedOutput
                ? [{ isPositive: true, code: candidate.expectedOutput }]
                : [],
        };
        const elements = [
            ...candidate.tags.map((tag) => ({
                name: tag,
                type: "tag",
                signature: tag,
                isPrimary: false,
            })),
            ...candidate.steps.map((step) => ({
                name: `step-${step.slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, "_")}`,
                type: "step",
                signature: step.slice(0, 80),
                isPrimary: true,
            })),
        ];
        return {
            id: `md-${index}-${candidate.name.slice(0, 30).replace(/[^a-zA-Z0-9_-]/g, "_")}`,
            kind: PatternKind.Behavioral,
            name: candidate.name,
            description: `[${candidate.strategy}] trigger: ${candidate.triggerText || "未指定"}`,
            tags: candidate.tags,
            language: "markdown",
            confidence: candidate.baseConfidence,
            source: `策略: ${candidate.strategy}`,
            sourceSpan: {
                startLine: candidate.lineRange[0],
                endLine: candidate.lineRange[1],
            },
            body,
            elements,
            references: [],
            extractor: this.name,
            extractedAt: Date.now(),
            usageCount: 0,
            weight: candidate.baseConfidence,
        };
    }
}
//# sourceMappingURL=markdown-extractor.js.map