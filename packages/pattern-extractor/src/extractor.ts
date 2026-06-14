// ============================================================
// @cortex/pattern-extractor — PatternExtractor 接口定义
//
// @file-overview
// 定义 PatternExtractor 统一接口及其依赖的类型体系。
// 所有模式提取策略（AST / 正则 / 启发式）均实现此接口。
// 消费方（Registry / Pipeline）面向接口编程，不感知具体策略。
//
// 设计原则（承袭 skill-kit 分层四件套 + 接口契约优先 P02）：
// - 接口层零依赖：类型定义不引用任何运行时模块
// - Result 判别联合 P04：ExtractionResult 为 success/false 联合，
//   TypeScript 自动收窄类型，无需运行时类型守卫
// - 泛型接口：提取器可接受任意输入类型（string / AST 节点 / 文件列表）
// - 枚举零值语义：PatternKind 使用字符串值，JSON 序列化友好
//
// @contract 接口稳定性承诺
// - PatternExtractor 接口新增方法时必须提供默认实现（默认抛 NotSupportedError）
// - 枚举成员只增不删，禁止修改已有成员的字符串值
// - ExtractionResult 的 success/false 联合不可改为布尔字段（保持 P04 判别联合契约）
// ============================================================

// ─── PatternKind — 模式种类枚举 ────────────────────────────

/**
 * PatternKind —— 模式种类枚举。
 *
 * 每个种类的语义决定了提取策略侧重和后续消费方式：
 * - structural:     代码结构模式（类层次、模块划分、接口组织）
 * - behavioral:     行为模式（算法步骤、状态流转、事件响应）
 * - architectural:  架构模式（分层、微服务、事件驱动架构风格）
 * - dataflow:       数据流模式（管线、变换、聚合、扇入/扇出）
 * - documentation:  文档规范模式（注释风格、API 文档结构、README 约定）
 * - naming:         命名约定模式（文件命名、变量命名、目录组织）
 *
 * @example
 * ```typescript
 * const kind = PatternKind.Structural;
 * // → "structural"
 * ```
 */
export enum PatternKind {
  Structural     = "structural",
  Behavioral     = "behavioral",
  Architectural  = "architectural",
  Dataflow       = "dataflow",
  Documentation  = "documentation",
  Naming         = "naming",
}

// ─── PatternBody — 模式体 ──────────────────────────────────

/**
 * PatternBody —— 模式体，包含具体规则和示例。
 *
 * 三种形态（由 kind 决定侧重）：
 *   - structural:    rules 为结构约束，examples 为正反例
 *   - behavioral:    rules 为步骤序列，examples 为调用链
 *   - architectural: rules 为架构决策，examples 为拓扑示意
 */
export interface PatternBody {
  /** 规则/约束列表 */
  rules: string[];

  /** 正反例（可选） */
  examples?: PatternExample[];

  /** 模式模板代码（可选） */
  template?: string;
}

// ─── PatternExample — 模式示例 ─────────────────────────────

/**
 * PatternExample —— 模式的正反例。
 *
 * @usedBy PatternBody.examples
 */
export interface PatternExample {
  /** 示例代码或描述 */
  code: string;

  /** 是否推荐（true=正例，false=反例） */
  isPositive: boolean;

  /** 说明——解释为何此例是正面或反面 */
  description?: string;
}

// ─── PatternElement — 模式要素 ─────────────────────────────

/**
 * PatternElement —— 模式体中的关键要素。
 *
 * 用于快速索引和相似度比较，类似 AST 的轻量节点。
 * IPatternMerger 实现中基于此计算 Jaccard 相似度。
 */
export interface PatternElement {
  /** 要素名（如 "interface", "class", "function", "import"） */
  name: string;

  /** 要素类型（如 "declaration", "expression", "statement"） */
  type: string;

  /** 要素的签名或值（如函数签名、接口名） */
  signature?: string;

  /** 是否为核心要素（true=主要素，参与相似度计算） */
  isPrimary: boolean;
}

// ─── PatternDefinition — 标准化模式定义 ────────────────────

/**
 * PatternDefinition —— 提取出的标准化模式定义。
 *
 * 设计原则（承袭 SkillTemplate 的设计宪法）：
 * - 模式是"可参考"而非"可执行"——消费方（LoopAgent / MetaAgent）
 *   决定如何使用该模式
 * - 可靠性来自评价累加（weight + usageCount），而非二值判断
 * - 每种模式由 source / sourceSpan 定位到源码位置，可溯源验证
 *
 * @usedBy PatternExtractor → ExtractionResult → Pipeline → SkillRegistry.convertToSkill()
 */
export interface PatternDefinition {
  /** 唯一标识（建议格式：`{extractor-name}-{sha1-of-name}`） */
  id: string;

  /** 模式种类 */
  kind: PatternKind;

  /** 人类可读名称（≤ 120 字符） */
  name: string;

  /** 详细描述（Markdown 格式，支持代码块） */
  description: string;

  /** 触发标签——与 @cortex/shared Tag 兼容的双向映射 */
  tags: string[];

  /** 编程语言（如 "typescript"、"python"、"markdown"），"*" 表示通用 */
  language: string;

  /** 置信度 0–1——提取策略自评的可靠程度 */
  confidence: number;

  /** 模式来源——文件路径或文本片段标识 */
  source: string;

  /**
   * 源码定位（起始行、结束行、列）——可选。
   * 用于溯源验证和编辑器跳转。
   */
  sourceSpan?: {
    /** 起始行号（从 1 开始） */
    startLine: number;
    /** 结束行号（从 1 开始，包含） */
    endLine: number;
    /** 起始列号（从 1 开始，可选） */
    startColumn?: number;
    /** 结束列号（从 1 开始，可选） */
    endColumn?: number;
  };

  /** 模式体——结构化内容（JSON 可序列化） */
  body: PatternBody;

  /** 模式体中的关键要素列表——用于索引和相似度比较 */
  elements: PatternElement[];

  /** 关联的外部引用（其他模式 ID 或资源 URL） */
  references?: string[];

  /** 提取器名称——溯源用 */
  extractor: string;

  /** 提取时间戳（Unix 毫秒，Date.now()） */
  extractedAt: number;

  /** 累计引用次数（运行时动态追踪，由消费方维护） */
  usageCount: number;

  /** 评价权重——类似 SkillTemplate.weight，越高越可靠 */
  weight: number;
}

// ─── ExtractionContext — 提取上下文 ────────────────────────

/**
 * ExtractionContext —— 提取操作的运行时上下文。
 *
 * 设计原则（与 PipelineCtx / DispatchCtx 同族）：
 * - 配置字段为只读语义，由调用方在创建时注入
 * - 可变状态（metadata）在管线推进中逐步填充
 *
 * @usedBy PatternExtractorPipeline.run()
 *
 * @example
 * ```typescript
 * const ctx: ExtractionContext = {
 *   filePaths: ["src/core/scheduler.ts"],
 *   language: "typescript",
 *   targetKinds: [PatternKind.Structural],
 *   minConfidence: 0.6,
 *   enableMerge: true,
 *   maxResults: 20,
 * };
 * ```
 */
export interface ExtractionContext {
  /** 工作区根目录（用于解析相对路径） */
  workspaceRoot?: string;

  /** 本次提取的源文件路径列表 */
  filePaths: string[];

  /** 目标语言（可选，自动检测；"*" 表示通用） */
  language?: string;

  /** 目标模式种类（可选，缺省提取全部种类） */
  targetKinds?: PatternKind[];

  /** 最小置信度阈值（0–1，低于此值的模式被过滤） */
  minConfidence?: number;

  /** 是否启用去重归并（默认 true） */
  enableMerge?: boolean;

  /** 最大返回模式数（默认 100） */
  maxResults?: number;

  /** 调用方注入的元数据（管线阶段间共享） */
  metadata?: Record<string, unknown>;
}

// ─── ExtractionResult — 提取结果判别联合 ────────────────────

/**
 * ExtractionResult —— 提取操作的结果。
 *
 * 采用 Result 判别联合（P04 模式），与 package.json 同级宪法：
 * - success: true  → patterns 为模式列表
 * - success: false → error 为错误信息，patterns 为空数组
 * - diagnostics 始终存在，记录警告/调试信息
 *
 * TypeScript 自动收窄：
 * ```typescript
 * const result: ExtractionResult = extractor.extract(input);
 * if (result.success) {
 *   // result.patterns — 已收窄为 PatternDefinition[]
 *   // result.error   — 不存在（编译错误）
 * } else {
 *   // result.error   — 存在
 *   // result.patterns — []（编译错误）
 * }
 * ```
 */
export type ExtractionResult =
  | {
      /** 提取成功 */
      success: true;
      /** 提取出的模式列表 */
      patterns: PatternDefinition[];
      /** 诊断信息（警告、调试日志） */
      diagnostics: string[];
      /** 提取耗时（毫秒） */
      durationMs: number;
    }
  | {
      /** 提取失败 */
      success: false;
      /** 失败时模式列表为空 */
      patterns: [];
      /** 诊断信息（错误详情、上下文） */
      diagnostics: string[];
      /** 提取耗时（毫秒） */
      durationMs: number;
      /** 错误描述 */
      error: string;
    };

// ─── PatternExtractor — 提取器统一接口 ─────────────────────

/**
 * PatternExtractor —— 模式提取器统一接口。
 *
 * 所有提取策略（AST / 正则 / 启发式）均实现此接口，消费方
 * （Registry / Pipeline）面向接口编程，不感知具体策略实现。
 *
 * 三种内置提取变体：
 *   1. AstPatternExtractor    — 高精度，基于 AST 语义分析
 *   2. RegexPatternExtractor  — 快速扫描，基于正则匹配
 *   3. HeuristicPatternExtractor — 启发式规则，基于统计命名约定
 *
 * @typeParam TInput   - 提取器接受的输入类型（默认 string）
 * @typeParam TOptions - 提取器专有配置类型（默认 Record<string, unknown>）
 *
 * @example
 * ```typescript
 * class MyExtractor implements PatternExtractor<string, MyOptions> {
 *   readonly name = "my-extractor";
 *   readonly supportedLanguages = ["typescript"];
 *   readonly supportedKinds = [PatternKind.Structural];
 *   readonly description = "我的自定义提取器";
 *
 *   extract(input: string, options?: MyOptions): ExtractionResult {
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
export interface PatternExtractor<
  TInput = string,
  TOptions extends Record<string, unknown> = Record<string, unknown>,
> {
  /** 提取器唯一标识（字母数字 + 连词符，如 "ast-extractor"） */
  readonly name: string;

  /** 支持的语言列表（"*" 表示通用，可处理任意语言） */
  readonly supportedLanguages: string[];

  /** 支持的模式种类列表 */
  readonly supportedKinds: PatternKind[];

  /** 提取器的人类可读描述 */
  readonly description: string;

  /**
   * 从输入中提取模式。
   *
   * 实现约定：
   * - 不得抛出运行时异常——所有错误通过 ExtractionResult.error 返回
   * - 至少返回一个有效的 ExtractionResult（空结果也是 success: true, patterns: []）
   * - diagnostics 用于记录非致命警告和调试信息
   * - durationMs 由实现者自行计时，应包含完整的提取流程耗时
   *
   * @param input   - 输入内容（文件内容、代码片段、文本）
   * @param options - 提取器专有选项（按需传递，实现者自行解构）
   * @returns ExtractionResult — 判别联合，TypeScript 自动收窄
   */
  extract(input: TInput, options?: TOptions): ExtractionResult;

  /**
   * 判断该提取器能否处理指定语言和模式种类。
   *
   * 默认实现可简化为：
   * ```typescript
   * canHandle(language: string, kind: PatternKind): boolean {
   *   return this.supportedLanguages.includes(language)
   *       && this.supportedKinds.includes(kind);
   * }
   * ```
   *
   * @param language - 编程语言（如 "typescript"、"python"、"markdown"）
   * @param kind     - 模式种类
   * @returns true 表示该提取器能处理该语言+种类的组合
   */
  canHandle(language: string, kind: PatternKind): boolean;
}

// ─── PatternExtractorOptions — 提取器通用选项基类 ──────────

/**
 * PatternExtractorOptions —— 提取器通用选项基类。
 *
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
export interface PatternExtractorOptions {
  /** 日志级别（"debug" | "info" | "warn" | "error"，默认 "info"） */
  logLevel?: "debug" | "info" | "warn" | "error";

  /** 是否启用诊断追踪（默认 false） */
  enableDiagnostics?: boolean;
}

// ─── 包锚点 ────────────────────────────────────────────────

/**
 * PACKAGE_ANCHOR —— 包身份锚点。
 *
 * 用于运行时自检和版本标识。
 * 消费方可通过检查此常量确认包已正确加载。
 */
export const PACKAGE_ANCHOR = "[@cortex/pattern-extractor] 模式提取基础设施";
