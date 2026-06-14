// ============================================================
// @cortex/pattern-extractor — 公开 API Barrel 导出
//
// 本文件是 @cortex/pattern-extractor 包的单一入口点 (barrel)，
// 从各内部模块重新导出所有公开 API。
//
// 消费者应通过此入口导入：
// ```
// import { PatternScanner, PatternExtractor, PatternKind } from "@cortex/pattern-extractor";
// ```
//
// @design 导出策略
//   pattern.ts 是本包的类型中枢（"接口层"），涵盖模式核心数据结构、
//   提取器接口、校验器、归并器、管线阶段等全部类型定义。
//   extractor.ts 补充定义了 PatternExtractor 统一接口及 PatternDefinition 类型。
//   scanner.ts 提供面向消费层的 PatternScanner 扫描契约。
//
//   当 pattern.ts 与 extractor.ts 存在同名导出时（如 PatternKind、PatternBody 等），
//   以 pattern.ts 为规范来源 (canonical source)，extractor.ts 仅导出其独有符号。
//
// @maintenance
//   在任一子模块添加新的公开符号后，请同步在本文件追加导出语句。
//   若新符号与现有模块同名，需在此处显式处理重名以避免冲突。
//
// @since 0.1.0
// ============================================================

// ─── 扫描器接口（scanner.ts）────────────────────────────────
//
// 面向消费层的模式扫描契约。
// 提供 scan() / canScan() 高级异步 API，内蕴多提取器编排。
// 所有符号在此全部重新导出，无命名冲突。

/**
 * 模式扫描器统一接口。
 * 提供对文件和文本进行模式扫描的高级异步 API。
 * 与 {@link import("./pattern.js").IPatternExtractor} 互补：
 *   - IPatternExtractor：面向实现层的单次提取契约（同步）
 *   - PatternScanner：面向消费层的扫描契约（异步，内蕴编排）
 *
 * @typeParam TOptions - 扫描器专有配置类型（默认 {@link ScanOptions}）
 */
export type { PatternScanner } from "./scanner.js";

/**
 * 扫描配置选项。
 * 控制扫描行为的全部可调参数。各字段均有合理默认值。
 */
export type { ScanOptions } from "./scanner.js";

/**
 * 扫描操作的结果判别联合。
 * TypeScript 自动收窄类型：`result.success === true` → `result.patterns` 可安全访问。
 */
export type { ScanResult } from "./scanner.js";

/**
 * 扫描操作的汇总统计。
 * 提供扫描过程的量化概览（文件数、模式数、耗时等）。
 */
export type { ScanSummary } from "./scanner.js";

/**
 * 扫描过程中的诊断信息。
 * 记录扫描中产生的 info / warning / error 消息。
 */
export type { ScanDiagnostic } from "./scanner.js";

/**
 * 默认扫描配置常量。
 * 消费方未在 ScanOptions 中显式指定的字段使用此默认值。
 */
export { DEFAULT_SCAN_OPTIONS } from "./scanner.js";

/**
 * 默认扫描器名称回退值。
 */
export { DEFAULT_SCANNER_NAME } from "./scanner.js";

/**
 * 默认扫描器描述回退值。
 */
export { DEFAULT_SCANNER_DESCRIPTION } from "./scanner.js";

// ─── 模式定义类型中枢（pattern.ts）──────────────────────────
//
// 本包的类型中枢。定义所有与"模式"相关的数据结构、接口和枚举。
// 包括核心类型（Pattern、PatternKind、PatternBody）、
// 提取器接口（IPatternExtractor）、校验器（IPatternValidator）、
// 归并器（IPatternMerger）、管线阶段（IPipelineStage）、
// 以及各提取器变体的专有配置选项。
//
// 注意：extractor.ts 也定义了同名类型（PatternKind、PatternBody 等），
// 本 barrel 以 pattern.ts 为规范来源，extractor.ts 中同名的类型
// 被视为按需导入的补充定义，不在此处重复导出以避免冲突。

/**
 * 模式种类枚举。
 * 定义提取出的模式所属的语义范畴：structural、behavioral、
 * architectural、dataflow、documentation、naming。
 */
export { PatternKind } from "./pattern.js";

/**
 * 提取出的标准化模式定义（完整版）。
 * 代表一个可复用的代码或架构模式，包含 id、kind、body、elements
 * 等全部字段，通过 sourceSpan 可溯源到源码位置。
 */
export type { Pattern } from "./pattern.js";

/**
 * 源码位置定位。
 * 记录模式在源文件中的精确行范围（startLine / endLine），
 * 可选列定位（startColumn / endColumn），用于溯源验证。
 */
export type { SourceSpan } from "./pattern.js";

/**
 * 模式体，包含具体规则和示例。
 * 三种形态（由 kind 决定侧重）：
 * - structural: rules 为结构约束，examples 为正反例
 * - behavioral: rules 为步骤序列，examples 为调用链
 * - architectural: rules 为架构决策，examples 为拓扑示意
 */
export type { PatternBody } from "./pattern.js";

/**
 * 模式的示例，分正例和反例。
 * - 正例（isPositive: true）：推荐的做法
 * - 反例（isPositive: false）：不推荐的做法
 */
export type { PatternExample } from "./pattern.js";

/**
 * 模式体中的关键要素。
 * 用于快速索引和相似度比较（Jaccard 相似度计算）。
 * 每个 element 代表模式中的一个重要组成单元。
 */
export type { PatternElement } from "./pattern.js";

/**
 * 模式提取器统一接口（基于 Pattern 类型）。
 * 所有提取策略（AST / 正则 / 启发式）均实现此接口。
 * 消费方（Registry / Pipeline）面向接口编程。
 *
 * @typeParam TInput - 提取器接受的输入类型（默认 string）
 * @typeParam TOptions - 提取器专有配置类型
 */
export type { IPatternExtractor } from "./pattern.js";

/**
 * 提取操作的运行时上下文。
 * 配置字段为只读语义，由调用方在创建时注入；
 * 可变状态（metadata）在管线推进中逐步填充。
 */
export type { ExtractionContext } from "./pattern.js";

/**
 * 提取操作的 Result 判别联合（基于 Pattern 类型）。
 * - success: true → patterns 为 Pattern[] 列表
 * - success: false → error 为错误信息，patterns 为空
 */
export type { ExtractionResult } from "./pattern.js";

/**
 * 模式校验器接口。
 * 实现多级校验策略：结构校验 → 语义校验 → 引用校验 → 置信度校验。
 */
export type { IPatternValidator } from "./pattern.js";

/**
 * 校验结果。
 * - valid: 是否通过校验
 * - errors: 错误列表（存在任一 error 即不通过）
 * - warnings: 警告列表（不影响 valid 标志）
 */
export type { ValidationResult } from "./pattern.js";

/**
 * 校验错误条目。
 * 记录单个字段的校验失败信息，含严重程度区分（error / warning）。
 */
export type { ValidationError } from "./pattern.js";

/**
 * 模式归并器接口。
 * 基于 name、tags、elements 计算 Jaccard 相似度，
 * 高于阈值的模式自动合并，保留高 confidence 版本。
 */
export type { IPatternMerger } from "./pattern.js";

/**
 * 模式提取管线中的一个可插拔阶段。
 * 与 IDispatchStep / IStep 同构设计（P08 管线执行器模式）。
 */
export type { IPipelineStage } from "./pattern.js";

/**
 * 管线阶段的上下文。
 * patterns 数组在阶段间逐步传递和变换，
 * diagnostics 累积各阶段的诊断信息。
 */
export type { PipelineStageContext } from "./pattern.js";

/**
 * AST 提取器专有选项。
 * 控制基于 AST 语义分析的模式提取行为。
 */
export type { AstExtractorOptions } from "./pattern.js";

/**
 * 正则提取器专有选项。
 * 控制基于正则表达式快速扫描的模式提取行为。
 */
export type { RegexExtractorOptions } from "./pattern.js";

/**
 * 正则模式规则定义。
 * 每条规则包含名称、匹配正则、模式种类和置信度。
 */
export type { PatternRule } from "./pattern.js";

/**
 * 启发式提取器专有选项。
 * 控制基于启发式规则的模式提取行为。
 */
export type { HeuristicExtractorOptions } from "./pattern.js";

/**
 * 启发式规则定义。
 * 描述一条基于命名约定、文件结构、目录布局等启发式判断的规则。
 */
export type { HeuristicRule } from "./pattern.js";

/**
 * 工厂配置选项。
 * 用于 ExtractorFactory 的构造注入，配置提取器、校验器、归并器和管线阶段。
 */
export type { ExtractorFactoryOptions } from "./pattern.js";

// ─── 提取器补充定义（extractor.ts 独有符号）─────────────────
//
// extractor.ts 定义了 PatternExtractor 统一接口（与 pattern.ts 的
// IPatternExtractor 互补但用途不同）及其关联类型。
// 以下仅导出 extractor.ts 中独有的公开符号。
// 同名类型（PatternKind、PatternBody 等）以 pattern.ts 为规范来源。

/**
 * 提取出的标准化模式定义（PatternExtractor 变体）。
 * 与 {@link Pattern} 类型相似但专用于 PatternExtractor 接口的返回。
 * 使用 PatternDefinition[] 替代 Pattern[]，定位为从提取到 Skill 转换
 * 的中间表示层。
 *
 * @usedBy PatternExtractor → ExtractionResult → Pipeline → SkillRegistry.convertToSkill()
 */
export type { PatternDefinition } from "./extractor.js";

/**
 * 模式提取器统一接口（基于 PatternDefinition 类型）。
 *
 * 所有提取策略（AST / 正则 / 启发式）均实现此接口。
 * 与 pattern.ts 中的 {@link IPatternExtractor} 相比，PatternExtractor
 * 的 ExtractionResult 基于 PatternDefinition（而非 Pattern），
 * 适用于从原始提取到 Skill 转换的中间场景。
 *
 * @typeParam TInput   - 提取器接受的输入类型（默认 string）
 * @typeParam TOptions - 提取器专有配置类型（默认 Record<string, unknown>）
 *
 * @example
 * ```typescript
 * class AstExtractor implements PatternExtractor<string, AstExtractorOptions> {
 *   readonly name = "ast-extractor";
 *   readonly supportedLanguages = ["typescript", "javascript"];
 *   readonly supportedKinds = [PatternKind.Structural, PatternKind.Behavioral];
 *   readonly description = "基于 AST 语义分析的高精度模式提取器";
 *
 *   extract(input: string, options?: AstExtractorOptions): ExtractionResult {
 *     // 实现提取逻辑...
 *   }
 *
 *   canHandle(language: string, kind: PatternKind): boolean {
 *     return this.supportedLanguages.includes(language)
 *         && this.supportedKinds.includes(kind);
 *   }
 * }
 * ```
 */
export type { PatternExtractor } from "./extractor.js";

/**
 * 提取器通用选项基类。
 * 所有提取器变体的选项应扩展此接口，保持一致的构造函数签名。
 *
 * @example
 * ```typescript
 * export interface AstExtractorOptions extends PatternExtractorOptions {
 *   extractTypes?: boolean;
 *   extractFunctions?: boolean;
 *   maxDepth?: number;
 * }
 * ```
 */
export type { PatternExtractorOptions } from "./extractor.js";

/**
 * 包身份锚点。
 * 用于运行时自检和版本标识。
 * 消费方可通过检查此常量确认包已正确加载。
 */
export { PACKAGE_ANCHOR } from "./extractor.js";

// ─── 预定义提取器（predefined/）──────────────────────────────
//
// 具体提取器实现，用于消费方直接实例化。
// 面向 PatternExtractor 接口编程——消费方不感知实现细节。

/**
 * JSON 模式提取器。
 * 从 JSON 内容中提取键命名约定、对象结构深度、
 * 属性类型分布和数组元素同质性等模式。
 *
 * @example
 * ```typescript
 * import { JsonPatternExtractor } from "@cortex/pattern-extractor";
 * const extractor = new JsonPatternExtractor();
 * const result = extractor.extract('{"name": "test"}');
 * ```
 */
export { JsonPatternExtractor } from "./predefined/json-extractor.js";

/**
 * JSON 提取器专有选项。
 * 控制从 JSON 内容中提取哪些维度的模式。
 */
export type { JsonExtractorOptions } from "./predefined/json-extractor.js";

/**
 * Markdown 模式提取器。
 * 从 Markdown 文件（pattern.md / patterns.md）中按照 4 级
 * 回退策略提取技能模板候选模式。
 *
 * 策略优先级：JSON 块提取 → P0-P9 格式提取 → 模式段落提取 → 全文回退
 *
 * @example
 * ```typescript
 * import { MarkdownPatternExtractor } from "@cortex/pattern-extractor";
 * const extractor = new MarkdownPatternExtractor({
 *   strategyJsonBlock: true,
 *   strategyP0P9Format: true,
 *   minConfidence: 0.5,
 * });
 * const result = extractor.extract(markdownContent);
 * ```
 */
export { MarkdownPatternExtractor } from "./predefined/markdown-extractor.js";

/**
 * Markdown 提取器专有选项。
 * 控制 4 策略开关、Markdown 解析参数、去重归并和文件匹配。
 */
export type { MarkdownExtractorOptions } from "./predefined/markdown-extractor.js";

// ============================================================
// 🏷️ 类型汇总索引
//
// 接口 / 类型别名：
//   PatternScanner       — 面向消费层的扫描契约（scanner.ts）
//   ScanOptions          — 扫描配置选项
//   ScanResult           — 扫描结果判别联合
//   ScanSummary          — 扫描汇总统计
//   ScanDiagnostic       — 扫描诊断信息
//
//   Pattern              — 标准化模式定义（pattern.ts 规范来源）
//   PatternKind          — 模式种类枚举
//   SourceSpan           — 源码位置定位
//   PatternBody          — 模式体
//   PatternExample       — 正反例
//   PatternElement       — 关键要素
//   IPatternExtractor    — 提取器接口（基于 Pattern）
//   ExtractionContext    — 提取上下文
//   ExtractionResult     — 提取结果判别联合（基于 Pattern）
//   IPatternValidator    — 校验器接口
//   ValidationResult     — 校验结果
//   ValidationError      — 校验错误
//   IPatternMerger       — 归并器接口
//   IPipelineStage       — 管线阶段接口
//   PipelineStageContext — 管线阶段上下文
//   AstExtractorOptions  — AST 提取器选项
//   RegexExtractorOptions — 正则提取器选项
//   PatternRule          — 正则模式规则
//   HeuristicExtractorOptions — 启发式提取器选项
//   HeuristicRule        — 启发式规则
//   ExtractorFactoryOptions   — 工厂配置选项
//
//   PatternDefinition    — 标准化模式定义（extractor.ts 变体）
//   PatternExtractor     — 提取器统一接口（基于 PatternDefinition）
//   PatternExtractorOptions   — 提取器通用选项基类
//
// 常量：
//   DEFAULT_SCAN_OPTIONS      — 默认扫描配置
//   DEFAULT_SCANNER_NAME      — 默认扫描器名称
//   DEFAULT_SCANNER_DESCRIPTION — 默认扫描器描述
//   PACKAGE_ANCHOR            — 包身份锚点
// ============================================================
