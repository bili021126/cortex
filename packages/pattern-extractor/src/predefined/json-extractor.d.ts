import { type PatternExtractor, PatternKind, type ExtractionResult, type PatternExtractorOptions } from "../extractor.js";
/**
 * JsonExtractorOptions —— JSON 提取器专有选项。
 *
 * 控制从 JSON 内容中提取哪些维度的模式。
 * 各开关默认均为 true，消费者可按需关闭不关注的维度以提升性能。
 *
 * @extends PatternExtractorOptions
 *
 * @example
 * ```typescript
 * const options: JsonExtractorOptions = {
 *   extractNamingPatterns: true,
 *   extractStructurePatterns: true,
 *   extractTypePatterns: false,
 *   extractArrayPatterns: false,
 *   minSampleSize: 5,
 *   enableDiagnostics: true,
 * };
 * ```
 */
/**
 * JsonExtractorOptions —— JSON 提取器专有选项。
 *
 * 控制从 JSON 内容中提取哪些维度的模式。
 * 各开关默认均为 true，消费者可按需关闭不关注的维度以提升性能。
 *
 * 使用交叉类型而非 interface，以确保满足
 * `Record<string, unknown>` 约束（P02 接口契约优先）。
 *
 * @example
 * ```typescript
 * const options: JsonExtractorOptions = {
 *   extractNamingPatterns: true,
 *   extractStructurePatterns: true,
 *   extractTypePatterns: false,
 *   extractArrayPatterns: false,
 *   minSampleSize: 5,
 *   enableDiagnostics: true,
 * };
 * ```
 */
export type JsonExtractorOptions = PatternExtractorOptions & Record<string, unknown> & {
    /**
     * 是否提取键命名约定模式（默认 true）。
     * 当为 true 时，分析 JSON 对象键的命名风格分布（camelCase / snake_case 等），
     * 产出 naming 种类的 PatternDefinition。
     */
    extractNamingPatterns?: boolean;
    /**
     * 是否提取结构深度模式（默认 true）。
     * 当为 true 时，分析 JSON 对象的嵌套深度分布，
     * 产出 structural 种类的 PatternDefinition。
     */
    extractStructurePatterns?: boolean;
    /**
     * 是否提取属性类型分布模式（默认 true）。
     * 当为 true 时，分析 JSON 属性值的类型分布（string / number / boolean 等），
     * 产出 structural 种类的 PatternDefinition。
     */
    extractTypePatterns?: boolean;
    /**
     * 是否提取数组元素同质性模式（默认 true）。
     * 当为 true 时，分析 JSON 数组内部元素类型的一致性，
     * 产出 structural 种类的 PatternDefinition。
     */
    extractArrayPatterns?: boolean;
    /**
     * 最小样本数（默认 3）。
     * 统计模式的置信度受样本量影响：
     * - 样本量 ≥ minSampleSize：置信度基于统计显著性计算
     * - 样本量 < minSampleSize：置信度打折，附加诊断警告
     */
    minSampleSize?: number;
};
/**
 * JsonValue —— JSON 合法值类型的递归联合。
 *
 * 用于替代 `any` 类型安全地描述 JSON 解析结果。
 * 支持 JSON 规范的全部六种值类型：
 * - 基本类型：string / number / boolean / null
 * - 复合类型：JsonObject（键值对） / JsonArray（有序列表）
 *
 * @example
 * ```typescript
 * const value: JsonValue = { name: "hello", count: 42, tags: ["a", "b"] };
 * ```
 */
export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
/**
 * JsonObject —— JSON 对象类型。
 *
 * 键为 string，值为 JsonValue 联合类型。
 * 通过索引签名避免使用 `any`。
 */
export interface JsonObject {
    [key: string]: JsonValue;
}
/**
 * JsonArray —— JSON 数组类型。
 *
 * 元素类型为 JsonValue 联合。
 */
export interface JsonArray extends Array<JsonValue> {
}
/**
 * JsonPatternExtractor —— 基于 JSON 结构分析的模式提取器。
 *
 * 专门用于从 JSON 内容中提取结构模式和命名约定模式。
 * 通过递归遍历 JSON 树，统计键命名风格、嵌套深度、属性类型分布
 * 和数组元素同质性等特征，产出标准化的 PatternDefinition。
 *
 * **支持的提取维度**（可通过 {@link JsonExtractorOptions} 控制）：
 * - 命名约定模式（Naming）：检测 camelCase / snake_case / PascalCase / kebab-case 分布
 * - 结构深度模式（Structural）：分析嵌套深度和对象属性分布
 * - 类型分布模式（Structural）：分析属性值类型的分布特征
 * - 数组同质性模式（Structural）：分析数组元素类型的一致性
 *
 * **置信度计算**：
 * - 基础置信度 0.3，根据样本量和统计显著性递增
 * - 最大置信度 0.95（命名模式）/ 0.9（其他模式）
 * - 样本量不足时返回 undefined（不产出该模式）
 *
 * @implements PatternExtractor<string, JsonExtractorOptions>
 *
 * @example
 * ```typescript
 * const extractor = new JsonPatternExtractor();
 *
 * const result = extractor.extract(`{
 *   "userName": "alice",
 *   "emailAddress": "alice@example.com",
 *   "isActive": true,
 *   "profileData": {
 *     "firstName": "Alice",
 *     "lastName": "Smith",
 *     "age": 30
 *   }
 * }`);
 *
 * if (result.success) {
 *   for (const pattern of result.patterns) {
 *     console.log(`[${pattern.kind}] ${pattern.name}`);
 *     // → [naming] JSON 键命名约定：camelCase
 *     // → [structural] JSON 结构深度模式（最大深度 2）
 *     // → [structural] JSON 属性类型分布（string 主导）
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // 按需关闭某些分析维度以提升性能
 * const extractor = new JsonPatternExtractor({
 *   extractArrayPatterns: false,
 *   extractTypePatterns: false,
 * });
 * ```
 */
export declare class JsonPatternExtractor implements PatternExtractor<string, JsonExtractorOptions> {
    /** @inheritdoc */
    readonly name = "json-extractor";
    /** @inheritdoc */
    readonly supportedLanguages: string[];
    /** @inheritdoc */
    readonly supportedKinds: PatternKind[];
    /** @inheritdoc */
    readonly description = "\u57FA\u4E8E JSON \u7ED3\u6784\u5206\u6790\u7684\u6A21\u5F0F\u63D0\u53D6\u5668\uFF0C\u4ECE JSON \u5185\u5BB9\u4E2D\u63D0\u53D6\u952E\u547D\u540D\u7EA6\u5B9A\u3001\u5BF9\u8C61\u7ED3\u6784\u6DF1\u5EA6\u3001\u5C5E\u6027\u7C7B\u578B\u5206\u5E03\u548C\u6570\u7EC4\u5143\u7D20\u540C\u8D28\u6027\u7B49\u6A21\u5F0F";
    /** 合并后的选项（含默认值），使用 InternalOptions 独立类型避免泛型约束问题 */
    private readonly _options;
    /**
     * 创建 JsonPatternExtractor 实例。
     *
     * @param options - 提取器专有选项（可选，使用缺省默认值）
     *
     * @example
     * ```typescript
     * // 使用默认选项
     * const extractor = new JsonPatternExtractor();
     *
     * // 自定义选项
     * const extractor = new JsonPatternExtractor({
     *   extractNamingPatterns: true,
     *   extractStructurePatterns: true,
     *   extractTypePatterns: false,
     *   extractArrayPatterns: false,
     *   minSampleSize: 5,
     *   enableDiagnostics: true,
     * });
     * ```
     */
    constructor(options?: JsonExtractorOptions);
    /**
     * 从 JSON 字符串中提取模式。
     *
     * 执行流程：
     * 1. **输入校验**：检查输入是否为非空字符串
     * 2. **JSON 解析**：调用 JSON.parse 解析输入
     * 3. **结构分析**：递归遍历 JSON 树，收集统计信息
     * 4. **模式构建**：基于统计信息，按配置维度构建 PatternDefinition
     * 5. **结果组装**：返回 ExtractionResult（判别联合）
     *
     * **错误处理**：
     * - JSON 解析失败 → success: false，error 包含解析错误详情
     * - 输入为空或非 JSON → success: false，error 包含校验信息
     * - 空对象或空数组 → success: true，patterns: []（无模式可提取）
     * - 循环引用 → 自动检测并跳过，不导致 Stack Overflow
     *
     * @param input   - JSON 字符串（必须是合法的 JSON）
     * @param options - 提取器专有选项（可选，覆盖构造函数中传入的默认选项）
     * @returns ExtractionResult — 判别联合，TypeScript 自动收窄
     *
     * @example
     * ```typescript
     * const result = extractor.extract('{"name": "test", "value": 42}');
     *
     * if (result.success) {
     *   console.log(`发现 ${result.patterns.length} 个模式`);
     * } else {
     *   console.error(`提取失败: ${result.error}`);
     * }
     * ```
     */
    extract(input: string, options?: JsonExtractorOptions): ExtractionResult;
    /**
     * 判断该提取器能否处理指定语言和模式种类。
     *
     * JsonPatternExtractor 的处理能力：
     * - 语言：仅支持 "json"（严格匹配，不接受 "*" 通配）
     * - 种类：Structural（结构模式）和 Naming（命名模式）
     *
     * @param language - 目标编程语言
     * @param kind     - 目标模式种类
     * @returns true 当 language === "json" 且 kind 在 supportedKinds 中
     *
     * @example
     * ```typescript
     * extractor.canHandle("json", PatternKind.Structural);
     * // → true
     *
     * extractor.canHandle("typescript", PatternKind.Structural);
     * // → false（仅支持 json）
     * ```
     */
    canHandle(language: string, kind: PatternKind): boolean;
}
/**
 * JSON_EXTRACTOR_ANCHOR —— JsonPatternExtractor 包身份锚点。
 *
 * 用于运行时自检和版本标识。
 * 消费方可通过检查此常量确认 JsonPatternExtractor 已正确加载。
 */
export declare const JSON_EXTRACTOR_ANCHOR = "[@cortex/pattern-extractor] JsonPatternExtractor v0.1.0 \u2014 JSON \u7ED3\u6784\u6A21\u5F0F\u63D0\u53D6\u5668";
//# sourceMappingURL=json-extractor.d.ts.map