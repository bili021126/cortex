// ============================================================
// @cortex/pattern-extractor — 模式定义（Pattern 接口与相关类型）
//
// 本文件是 @cortex/pattern-extractor 的类型中枢，定义所有与
// "模式"相关的数据结构、接口和枚举。遵循"接口契约优先"原则
// （P02），所有公开 API 均附带完整 JSDoc，零 any 类型，零非空断言。
//
// 设计宪法：
//   - 模式是"可参考"而非"可执行"——消费方（LoopAgent / MetaAgent）
//     决定如何使用该模式
//   - 可靠性来自评价累加（weight + usageCount），而非二值判断
//   - 每种模式由 sourceSpan 定位到源码位置，可溯源验证
//   - 所有类型均为纯数据描述，不包含运行时逻辑
//
// @layer 接口层（Interface Layer）
// @dependency 零依赖（纯 TypeScript 类型定义）
// ============================================================

// ============================================================
// §1 模式种类枚举
// ============================================================

/**
 * PatternKind —— 模式种类枚举，定义提取出的模式所属的语义范畴。
 *
 * 每个种类的语义决定了提取策略侧重和后续消费方式：
 * - {structural}: 代码结构模式（类层次、模块划分、接口组织）
 * - {behavioral}: 行为模式（算法步骤、状态流转、事件响应）
 * - {architectural}: 架构模式（分层、微服务、事件驱动架构风格）
 * - {dataflow}: 数据流模式（管线、变换、聚合、扇入/扇出）
 * - {documentation}: 文档规范模式（注释风格、API 文档结构、README 约定）
 * - {naming}: 命名约定模式（文件命名、变量命名、目录组织）
 */
export enum PatternKind {
  /** 代码结构模式——类层次、模块划分、接口组织 */
  Structural = "structural",

  /** 行为模式——算法步骤、状态流转、事件响应 */
  Behavioral = "behavioral",

  /** 架构模式——分层、微服务、事件驱动架构风格 */
  Architectural = "architectural",

  /** 数据流模式——管线、变换、聚合、扇入/扇出 */
  Dataflow = "dataflow",

  /** 文档规范模式——注释风格、API 文档结构、README 约定 */
  Documentation = "documentation",

  /** 命名约定模式——文件命名、变量命名、目录组织 */
  Naming = "naming",
}

// ============================================================
// §2 模式核心数据结构
// ============================================================

/**
 * Pattern —— 提取出的标准化模式定义。
 *
 * 代表一个可复用的代码或架构模式，由提取器从输入中识别并结构化产出。
 * 消费方（LoopAgent / MetaAgent）通过 Pattern 了解项目中存在的设计惯例、
 * 代码结构组织方式、命名约定等，从而在后续开发中参照使用。
 *
 * 设计继承自 SkillTemplate 的设计宪法：
 * - 模式是"可参考"而非"可执行"
 * - 可靠性来自评价累加（weight + usageCount），而非二值判断
 * - 每种模式由 sourceSpan 定位到源码位置，可溯源验证
 *
 * @example
 * ```typescript
 * const pattern: Pattern = {
 *   id: "p-001",
 *   kind: PatternKind.Structural,
 *   name: "Agent Interface 模式",
 *   description: "所有 Agent 均定义 readonly 属性和 execute 方法",
 *   tags: ["interface", "typescript", "agent"],
 *   language: "typescript",
 *   confidence: 0.92,
 *   source: "src/core/agent.ts",
 *   sourceSpan: { startLine: 10, endLine: 35 },
 *   body: {
 *     rules: [
 *       "Agent 接口应包含 readonly type 属性",
 *       "Agent 接口应定义 execute 方法",
 *     ],
 *     examples: [
 *       {
 *         code: "export interface Agent {\n  readonly type: AgentType;\n  execute(): Promise<void>;\n}",
 *         isPositive: true,
 *         description: "标准 Agent 接口定义",
 *       },
 *     ],
 *   },
 *   elements: [
 *     { name: "Agent", type: "interface", signature: "export interface Agent", isPrimary: true },
 *   ],
 *   extractor: "ast-extractor",
 *   extractedAt: Date.now(),
 *   usageCount: 0,
 *   weight: 10,
 * };
 * ```
 */
export interface Pattern {
  /** 唯一标识，格式建议为 "p-{uuid}" 或 "p-{递增数字}" */
  id: string;

  /** 模式种类，决定语义范畴 */
  kind: PatternKind;

  /** 人类可读名称，如 "Agent Interface 模式" */
  name: string;

  /** 详细描述，说明该模式的核心内容和适用场景 */
  description: string;

  /** 触发标签——与 @cortex/shared 的 Tag 类型兼容，用于标签匹配和发现 */
  tags: string[];

  /** 编程语言（如 "typescript"、"python"、"markdown"），提取时自动检测或手动指定 */
  language: string;

  /**
   * 置信度 0–1，提取策略自评的可靠程度。
   * AST 提取器通常产出 0.8–1.0，正则提取器 0.5–0.8，启发式提取器 0.3–0.7。
   */
  confidence: number;

  /** 模式来源——文件路径或文本片段标识，用于溯源 */
  source: string;

  /** 源码定位——可选，记录模式在源文件中的行范围 */
  sourceSpan?: SourceSpan;

  /** 模式体——结构化内容，包含规则、示例和可选模板，需 JSON 可序列化 */
  body: PatternBody;

  /** 模式体中的关键要素列表，用于快速索引和相似度比较 */
  elements: PatternElement[];

  /** 关联的外部引用列表——其他模式 ID 或资源 URL，可选 */
  references?: string[];

  /** 提取器名称，用于溯源哪个提取器产出了该模式 */
  extractor: string;

  /** 提取时间戳（ms），记录模式被提取的时刻 */
  extractedAt: number;

  /** 累计引用次数，运行时由消费方动态追踪 */
  usageCount: number;

  /**
   * 评价权重，类似 SkillTemplate.weight。
   * 初始值由提取器设定，消费方可根据评价回流累加调整。
   */
  weight: number;
}

/**
 * SourceSpan —— 源码位置定位。
 *
 * 记录模式在源文件中的精确行范围，用于溯源验证。
 * startColumn 和 endColumn 为可选字段，仅在需要精确列定位时填入。
 */
export interface SourceSpan {
  /** 起始行号（从 1 开始） */
  startLine: number;

  /** 结束行号（从 1 开始） */
  endLine: number;

  /** 起始列号（从 1 开始，可选） */
  startColumn?: number;

  /** 结束列号（从 1 开始，可选） */
  endColumn?: number;
}

// ============================================================
// §3 模式体子类型
// ============================================================

/**
 * PatternBody —— 模式体，包含具体规则和示例。
 *
 * 三种形态（由 kind 决定侧重）：
 * - structural: rules 为结构约束，examples 为正反例
 * - behavioral: rules 为步骤序列，examples 为调用链
 * - architectural: rules 为架构决策，examples 为拓扑示意
 * - dataflow: rules 为数据变换规则，examples 为流图
 * - documentation: rules 为文档规范，examples 为合规/不合规文档片段
 * - naming: rules 为命名约定，examples 为符合/不符合的命名示例
 */
export interface PatternBody {
  /** 规则/约束列表，描述该模式需要遵守的具体规则 */
  rules: string[];

  /** 正反例列表——可选，提供具体示例帮助理解模式 */
  examples?: PatternExample[];

  /** 模式模板代码——可选，可直接复制使用的代码骨架 */
  template?: string;
}

/**
 * PatternExample —— 模式的示例，分正例和反例。
 *
 * - 正例（isPositive: true）：推荐的做法，展示模式正确应用方式
 * - 反例（isPositive: false）：不推荐的做法，展示常见错误
 */
export interface PatternExample {
  /** 示例代码或描述文本 */
  code: string;

  /** 是否为推荐的正例（true=正例，false=反例） */
  isPositive: boolean;

  /** 示例说明——可选，解释该示例为什么是正例或反例 */
  description?: string;
}

/**
 * PatternElement —— 模式体中的关键要素。
 *
 * 用于快速索引和相似度比较，类似 AST 的轻量节点。
 * 每个 element 代表模式中的一个重要组成单元，如某个接口、类或函数。
 */
export interface PatternElement {
  /** 要素名称（如 "interface"、"class"、"function"、"import"） */
  name: string;

  /** 要素类型（如 "interface"、"class"、"function"、"type-alias"） */
  type: string;

  /** 要素的签名或值——可选，如函数签名、接口完整声明 */
  signature?: string;

  /** 是否为核心要素——true 表示该要素是模式的核心组成 */
  isPrimary: boolean;
}

// ============================================================
// §4 提取器接口
// ============================================================

/**
 * IPatternExtractor —— 模式提取器统一接口。
 *
 * 所有提取策略（AST / 正则 / 启发式）均实现此接口。
 * 消费方（Registry / Pipeline）面向接口编程，不感知具体策略实现。
 *
 * @typeParam TInput - 提取器接受的输入类型，默认 string（源码文本）
 * @typeParam TOptions - 提取器专有配置类型，默认 Record<string, unknown>
 */
export interface IPatternExtractor<
  TInput = string,
  TOptions extends Record<string, string | number | boolean | object> = Record<
    string,
    string | number | boolean | object
  >,
> {
  /** 提取器唯一标识名称 */
  readonly name: string;

  /** 支持的语言列表（"*" 表示通用，支持所有语言） */
  readonly supportedLanguages: string[];

  /** 支持的模式种类列表 */
  readonly supportedKinds: PatternKind[];

  /** 提取器的描述信息 */
  readonly description: string;

  /**
   * 从输入中提取模式。
   *
   * @param input - 输入内容（文件内容、代码片段或文本）
   * @param options - 提取器专有选项，类型由 TOptions 决定
   * @returns ExtractionResult 判别联合类型
   */
  extract(input: TInput, options?: TOptions): ExtractionResult;

  /**
   * 判断该提取器能否处理指定语言和模式种类。
   *
   * @param language - 编程语言名称
   * @param kind - 模式种类
   * @returns true 表示可以处理
   */
  canHandle(language: string, kind: PatternKind): boolean;
}

// ============================================================
// §5 提取上下文与结果
// ============================================================

/**
 * ExtractionContext —— 提取操作的运行时上下文。
 *
 * 类似 PluginContext / DispatchCtx 的设计原则：
 * - 只读字段由调用方在创建时注入
 * - 可变状态在管线推进中逐步填充
 * - 所有字段均为可选，提供合理的默认行为
 */
export interface ExtractionContext {
  /** 工作区根目录路径 */
  workspaceRoot?: string;

  /** 本次提取的源文件路径列表 */
  filePaths: string[];

  /** 目标语言（可选，不指定则自动检测或提取所有语言） */
  language?: string;

  /** 目标模式种类列表（可选，不指定则提取全部种类） */
  targetKinds?: PatternKind[];

  /** 最小置信度阈值 0–1，低于此值的模式被过滤（默认 0） */
  minConfidence?: number;

  /** 是否启用去重归并（默认 false） */
  enableMerge?: boolean;

  /** 最大返回模式数量（默认 100） */
  maxResults?: number;

  /** 调用方注入的元数据，用于跨阶段传递额外信息 */
  metadata?: Record<string, string | number | boolean>;
}

/**
 * ExtractionResult —— 提取操作的结果，采用 Result 判别联合类型。
 *
 * 设计遵循 P04 — Result 判别联合模式：
 * - success: true → 提取成功，携带 patterns 列表
 * - success: false → 提取失败，携带 error 信息
 * TypeScript 可通过 success 字段自动收窄类型。
 */
export type ExtractionResult =
  | {
      /** 提取成功 */
      success: true;

      /** 提取出的模式列表 */
      patterns: Pattern[];

      /** 诊断信息列表（警告、信息、统计等） */
      diagnostics: string[];

      /** 提取耗时（毫秒） */
      durationMs: number;
    }
  | {
      /** 提取失败 */
      success: false;

      /** 空数组——失败时无模式产出 */
      patterns: [];

      /** 诊断信息列表 */
      diagnostics: string[];

      /** 提取耗时（毫秒） */
      durationMs: number;

      /** 错误描述 */
      error: string;
    };

// ============================================================
// §6 校验器接口
// ============================================================

/**
 * IPatternValidator —— 模式校验器接口。
 *
 * 负责校验 Pattern 的字段完整性和语义正确性。
 * 实现多级校验策略（P10 多级校验器模式）：
 * 1. 结构校验：必需字段存在、类型正确
 * 2. 语义校验：非空、合理长度、格式规范
 * 3. 引用校验：references 中的 ID 无自引用
 * 4. 置信度校验：[0, 1] 范围检查
 */
export interface IPatternValidator {
  /**
   * 校验单个模式。
   *
   * @param pattern - 待校验的模式
   * @returns ValidationResult 校验结果
   */
  validate(pattern: Pattern): ValidationResult;

  /**
   * 批量校验多个模式。
   *
   * @param patterns - 待校验的模式列表
   * @returns 每个模式对应的校验结果列表
   */
  validateMany(patterns: Pattern[]): ValidationResult[];
}

/**
 * ValidationResult —— 校验结果。
 *
 * - valid: 是否通过校验
 * - errors: 错误列表（存在任意 error 即不通过）
 * - warnings: 警告列表（不影响 valid 标志）
 */
export interface ValidationResult {
  /** 是否通过全部校验 */
  valid: boolean;

  /** 错误列表（存在至少一个 error 时 valid 为 false） */
  errors: ValidationError[];

  /** 警告列表（仅提示，不影响 valid 标志） */
  warnings: string[];
}

/**
 * ValidationError —— 校验错误条目。
 *
 * 记录单个字段的校验失败信息，包含严重程度区分。
 */
export interface ValidationError {
  /** 出错的字段路径（如 "id"、"confidence"、"body.rules"） */
  field: string;

  /** 错误描述 */
  message: string;

  /** 严重程度：error（阻断性）或 warning（提示性） */
  severity: "error" | "warning";
}

// ============================================================
// §7 归并器接口
// ============================================================

/**
 * IPatternMerger —— 模式归并器接口。
 *
 * 负责去重和相似度合并，基于 name、tags、elements 计算
 * Jaccard 相似度。相似度高于阈值的模式自动合并为一条，
 * 保留高 confidence 的 Pattern。
 */
export interface IPatternMerger {
  /**
   * 归并多个提取器的输出。
   * 相似度高于 threshold 的模式自动合并（保留高 confidence 的版本）。
   *
   * @param patterns - 待归并的模式列表
   * @param threshold - 相似度阈值 0–1，默认 0.8
   * @returns 归并后的模式列表
   */
  merge(patterns: Pattern[], threshold?: number): Pattern[];
}

// ============================================================
// §8 管线阶段接口
// ============================================================

/**
 * IPipelineStage —— 模式提取管线中的一个可插拔阶段。
 *
 * 与 IDispatchStep / IStep 同构设计（P08 管线执行器模式）。
 * 单阶段只做一件事，通过 PipelineStageContext 的 patterns 数组
 * 传递状态。阶段可对 patterns 进行过滤、转换、排序等操作。
 */
export interface IPipelineStage {
  /** 阶段名称——用于调试和日志 */
  readonly name: string;

  /**
   * 执行此阶段。
   *
   * @param ctx - 管线阶段上下文（含 patterns 数组和诊断信息）
   * @returns 更新后的上下文
   */
  run(ctx: PipelineStageContext): Promise<PipelineStageContext>;
}

/**
 * PipelineStageContext —— 管线阶段的上下文。
 *
 * patterns 数组在阶段间逐步传递和变换。
 * diagnostics 累积各阶段的诊断信息。
 * metadata 用于跨阶段传递额外的运行时数据。
 */
export interface PipelineStageContext {
  /** 当前的模式列表，在阶段间逐步传递和变换 */
  patterns: Pattern[];

  /** 累积的诊断信息列表 */
  diagnostics: string[];

  /** 跨阶段传递的元数据 */
  metadata: Record<string, unknown>;
}

// ============================================================
// §9 提取器配置类型
// ============================================================

/**
 * AstExtractorOptions —— AST 提取器专有选项。
 *
 * 控制基于 AST 语义分析的模式提取行为，决定提取哪些类型的
 * AST 节点作为模式来源。
 */
export interface AstExtractorOptions {
  /** 是否提取类型定义模式（接口、类型别名等），默认 true */
  extractTypes?: boolean;

  /** 是否提取函数模式（函数声明、箭头函数等），默认 true */
  extractFunctions?: boolean;

  /** 是否提取类模式（类声明、抽象类等），默认 true */
  extractClasses?: boolean;

  /** 是否提取导入模式（import 语句分布统计），默认 false */
  extractImports?: boolean;

  /** AST 最大遍历深度，默认 8 */
  maxDepth?: number;

  /** 最小模式体行数，短于此值的代码块不提取，默认 3 */
  minLines?: number;
}

/**
 * RegexExtractorOptions —— 正则提取器专有选项。
 *
 * 控制基于正则表达式快速扫描的模式提取行为。
 */
export interface RegexExtractorOptions {
  /** 预置规则列表 */
  rules?: PatternRule[];

  /** 最小命中次数，低于此数不输出模式，默认 1 */
  minHits?: number;

  /** 最大输出模式数量 */
  maxPatterns?: number;
}

/**
 * PatternRule —— 正则模式规则定义。
 *
 * 每条规则包含名称、匹配正则、模式种类和置信度。
 * 可选地提供 extract 回调从匹配结果中提取 PatternElement。
 */
export interface PatternRule {
  /** 模式名称 */
  name: string;

  /** 匹配正则表达式（应包含全局标志 g） */
  regex: RegExp;

  /** 模式种类 */
  kind: PatternKind;

  /** 命中时的基础置信度 0–1 */
  confidence: number;

  /**
   * 从正则匹配结果中提取 PatternElement 的回调函数。
   *
   * @param match - 正则执行匹配后的结果数组
   * @returns 提取出的模式要素，或 undefined 跳过此匹配
   */
  extract?: (match: RegExpExecArray) => PatternElement | undefined;

  /** 模式描述文本 */
  description?: string;
}

/**
 * HeuristicExtractorOptions —— 启发式提取器专有选项。
 *
 * 控制基于启发式规则的模式提取行为。
 */
export interface HeuristicExtractorOptions {
  /** 预置规则列表 */
  heuristics?: HeuristicRule[];

  /** 文件路径列表，用于目录结构和命名约定分析 */
  filePaths?: string[];

  /** 最小样本数，低于此数不输出统计模式，默认 3 */
  minSampleSize?: number;
}

/**
 * HeuristicRule —— 启发式规则定义。
 *
 * 描述一条基于命名约定、文件结构、目录布局等启发式判断的规则。
 */
export interface HeuristicRule {
  /** 规则名称 */
  name: string;

  /** 模式种类 */
  kind: PatternKind;

  /** 规则描述和判定逻辑说明 */
  description: string;

  /** 规则命中时的基础置信度 0–1 */
  confidence: number;
}

/**
 * ExtractorFactoryOptions —— 工厂配置选项。
 *
 * 用于 ExtractorFactory 的构造注入，配置提取器、校验器、
 * 归并器和自定义管线阶段。
 */
export interface ExtractorFactoryOptions {
  /** 注入的提取器列表（至少注入一个） */
  extractors?: IPatternExtractor[];

  /** 自定义校验器，默认使用 PatternValidator */
  validator?: IPatternValidator;

  /** 自定义归并器，默认使用 PatternMerger */
  merger?: IPatternMerger;

  /**
   * 自定义管线阶段列表。
   * 默认管线：Extract → Validate → Merge → Score → Filter。
   * 注入后将完全替换默认管线。
   */
  pipelineStages?: IPipelineStage[];
}
