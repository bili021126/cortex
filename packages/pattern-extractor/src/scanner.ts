// ============================================================
// @cortex/pattern-extractor — Scanner 接口定义
//
// 定义 PatternScanner 接口，作为模式扫描的统一入口 API。
// 消费者（LoopAgent / CLI / AnalysisAgent）面向此接口编程，
// 通过 scan() 方法提交文件或文本输入，获取标准化模式提取结果，
// 无需感知底层 IPatternExtractor 策略选择、管线编排或注册表查询。
//
// @file-overview
// 本文件是 @cortex/pattern-extractor 的公开 API 入口之一，
// 与 types.ts 中的 IPatternExtractor 接口互补：
//   - IPatternExtractor: 面向实现层的单次提取契约（同步，粒度细）
//   - PatternScanner:    面向消费层的扫描契约（异步，粒度粗，内蕴编排）
//
// @module-convention 模块化铁律（昔涟 v2.6 入宪）
// 1. 本文件仅依赖 types.ts 中的类型定义，不依赖任何实现层或编排层模块。
// 2. PatternScanner 接口的实现类应位于 orchestration/ 或由 ExtractorFactory 构建。
// 3. 新增公开符号必须在本文件追加 export 语句。
// ============================================================

import type { PatternDefinition } from "./extractor.js";
import type { PatternKind } from "./pattern.js";

// ─── Scanner 接口 ──────────────────────────────────────────

/**
 * PatternScanner —— 模式扫描器统一接口。
 *
 * 提供对文件和文本进行模式扫描的高级异步 API。
 * 与 {@link IPatternExtractor} 的区别：
 *   - `IPatternExtractor`：面向实现层的单次提取契约，同步执行，粒度细
 *   - `PatternScanner`：面向消费层的扫描契约，异步执行，内蕴多提取器编排
 *
 * **典型使用流程**：
 * ```
 * Consumer (LoopAgent / CLI)
 *   └── scanner.scan(input, options)
 *         ├── ① 按 language + kinds 查询 Registry → 获取匹配的 IPatternExtractor[]
 *         ├── ② 依次调用 extract() → 收集原始 PatternDefinition[]
 *         ├── ③ Validate → Merge → Score → Filter（管线后处理）
 *         └── ④ 返回 ScanResult { patterns, summary, diagnostics }
 * ```
 *
 * **设计动机**：
 * - 消费方只需调用 `scan()` 一个方法，无需手动组合 Registry + Pipeline + Factory
 * - 支持文件路径、代码片段、目录等多种输入形态
 * - 异步返回 Promise，适合在 Agent 的 execute() 或 CLI 命令中直接 await
 * - 内蕴诊断收集，失败时仍可获取部分结果和错误信息（容错设计）
 *
 * @typeParam TOptions - 扫描器专有配置类型（默认 {@link ScanOptions}）
 *
 * @example
 * ```typescript
 * // 基本用法：扫描单个文件
 * const scanner: PatternScanner = factory.createScanner();
 * const result = await scanner.scan("src/core/scheduler.ts", {
 *   language: "typescript",
 *   targetKinds: [PatternKind.Structural, PatternKind.Behavioral],
 *   minConfidence: 0.5,
 * });
 *
 * if (result.success) {
 *   console.log(`发现 ${result.patterns.length} 个模式`);
 *   for (const p of result.patterns) {
 *     console.log(`  [${p.kind}] ${p.name} (置信度: ${p.confidence})`);
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // 批量扫描：传入多个文件路径
 * const result = await scanner.scan([
 *   "src/core/scheduler.ts",
 *   "src/core/task-board.ts",
 *   "src/core/executor.ts",
 * ], {
 *   language: "typescript",
 *   enableMerge: true,
 *   maxResults: 20,
 * });
 *
 * console.log(result.summary);
 * // → { totalFiles: 3, totalPatterns: 15, durationMs: 42 }
 * ```
 *
 * @usedBy LoopAgent.react-loop — Agent 在循环中调用 scan() 提取代码模式
 * @usedBy AnalysisAgent.execute — 分析 Agent 扫描项目架构特征
 * @usedBy CLI scan 命令 — 命令行直接调用扫描并输出报告
 *
 * @since 0.1.0
 */
export interface PatternScanner<TOptions extends ScanOptions = ScanOptions> {
  /** 扫描器唯一标识（如 "default-scanner", "ast-scanner"） */
  readonly name: string;

  /** 支持的语言列表（"*" 表示通用，可扫描任何语言） */
  readonly supportedLanguages: string[];

  /** 支持的模式种类列表（参见 {@link PatternKind}） */
  readonly supportedKinds: PatternKind[];

  /** 人类可读的扫描器描述 */
  readonly description: string;

  /**
   * 扫描文件或文本中的可复用模式。
   *
   * 主要执行流程：
   *   1. **解析输入**：将字符串或字符串数组解析为待扫描的源文件列表
   *   2. **匹配提取器**：根据 `options.language` 和 `options.targetKinds`
   *      从注册表中查询匹配的 IPatternExtractor
   *   3. **执行提取**：依次调用每个提取器的 `extract()` 方法收集原始模式
   *   4. **管线后处理**：Validate（校验）→ Merge（归并）→ Score（评分）→ Filter（过滤）
   *   5. **组装结果**：返回 {@link ScanResult}，含模式列表 + 摘要 + 诊断信息
   *
   * **错误处理策略**：
   * - 单个提取器失败 → 不阻断整体扫描，失败信息记录在 `diagnostics` 中
   * - 所有提取器均失败 → `success: false`，`error` 字段包含汇总信息
   * - 输入文件不存在或不可读 → 在 diagnostics 中记录，跳过该文件
   * - 管线阶段异常 → 降级跳过该阶段，保留前一阶段的结果
   *
   * @param input   - 扫描输入。接受以下形态：
   *   - 单个文件路径（如 `"src/core/scheduler.ts"`）
   *   - 多个文件路径（如 `["src/a.ts", "src/b.ts"]`）
   *   - 代码/文本片段（自动检测语言）
   *   - 目录路径（递归扫描，需实现类支持）
   * @param options - 扫描选项，覆盖默认行为。参见 {@link ScanOptions}
   * @returns 扫描结果 {@link ScanResult}（Promise 异步返回）
   *
   * @throws 不会抛出异常——所有错误通过 ScanResult.success + diagnostics 传递。
   *         仅在编程错误（如 null 输入）时抛出 TypeError。
   */
  scan(input: string | string[], options?: TOptions): Promise<ScanResult>;

  /**
   * 判断该扫描器能否处理指定语言（可选到模式种类）。
   *
   * 匹配规则（与 {@link IPatternExtractor.canHandle} 一致）：
   * - `supportedLanguages` 包含目标语言，或包含 `"*"`（通用）
   * - 若传入 `kind`，还需 `supportedKinds` 包含该种类
   *
   * @param language - 目标编程语言（如 `"typescript"`, `"python"`, `"markdown"`）
   * @param kind     - 可选的目标模式种类（如 {@link PatternKind.Structural}）
   * @returns `true` 如果该扫描器可以处理指定输入
   *
   * @example
   * ```typescript
   * scanner.canScan("typescript", PatternKind.Structural);
   * // → true（如果支持 TypeScript 结构模式）
   *
   * scanner.canScan("python");
   * // → true（如果支持 Python，或通用扫描器）
   * ```
   */
  canScan(language: string, kind?: PatternKind): boolean;
}

// ─── 扫描选项 ──────────────────────────────────────────────

/**
 * ScanOptions —— 扫描配置选项。
 *
 * 控制扫描行为的全部可调参数。各字段均有合理默认值，
 * 消费方仅需设置与默认值不同的字段。
 *
 * **设计原则**：
 * - 所有字段均为可选（partial），消费方可按需覆盖
 * - 与 {@link ExtractionContext} 字段一一对应，
 *   但 ScanOptions 是消费层面向前端参数，ExtractionContext 是管线内部传递
 *
 * @example
 * ```typescript
 * const options: ScanOptions = {
 *   language: "typescript",
 *   targetKinds: [PatternKind.Structural],
 *   minConfidence: 0.6,
 *   enableMerge: true,
 *   maxResults: 50,
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface ScanOptions {
  /**
   * 目标编程语言。
   * 用于匹配注册表中对应语言的提取器。
   * 未设定时由实现类自动检测（基于文件扩展名或内容启发式）。
   *
   * @default undefined（自动检测）
   */
  language?: string;

  /**
   * 目标模式种类列表。
   * 仅提取指定种类的模式。未设定时提取所有种类。
   *
   * @default Object.values(PatternKind)（全部种类）
   */
  targetKinds?: PatternKind[];

  /**
   * 最小置信度阈值（0–1）。
   * 低于此阈值的模式将被过滤，不会出现在最终结果中。
   *
   * @default 0
   */
  minConfidence?: number;

  /**
   * 是否启用去重归并。
   * 启用后，相似度高于 threshold 的模式自动合并为一条。
   *
   * @default true
   */
  enableMerge?: boolean;

  /**
   * 归并相似度阈值（0–1）。
   * 仅当 `enableMerge === true` 时生效。
   * 基于 name + tags + elements 计算 Jaccard 相似度。
   *
   * @default 0.8
   */
  mergeThreshold?: number;

  /**
   * 最大返回模式数。
   * 超出此数量的模式按置信度排序后截断。
   *
   * @default 100
   */
  maxResults?: number;

  /**
   * 是否包含摘要统计信息。
   * 若为 true，ScanResult.summary 字段非 null。
   *
   * @default true
   */
  includeSummary?: boolean;

  /**
   * 是否包含详细诊断信息。
   * 若为 true，每个提取器和管线阶段的诊断信息均收集到 diagnostics 中。
   *
   * @default false
   */
  verbose?: boolean;

  /**
   * 工作区根目录路径。
   * 用于解析相对路径和定位项目配置文件。
   *
   * @default undefined（使用当前工作目录）
   */
  workspaceRoot?: string;

  /**
   * 调用方注入的自定义元数据。
   * 透传到管线各阶段，用于日志、追踪或自定义逻辑。
   *
   * @default undefined
   */
  metadata?: Record<string, unknown>;
}

// ─── 扫描结果 ──────────────────────────────────────────────

/**
 * ScanResult —— 扫描操作的结果（Promise 异步返回）。
 *
 * 采用 Result 判别联合（P04 模式），TypeScript 自动收窄类型：
 * - 成功时：`result.success === true`，`result.patterns` 为模式数组
 * - 失败时：`result.success === false`，`result.error` 包含错误信息
 *
 * 无论成功或失败，`diagnostics` 字段始终包含执行过程中的诊断信息。
 *
 * @example
 * ```typescript
 * // 类型收窄：先检查 success
 * const result = await scanner.scan("file.ts");
 *
 * if (result.success) {
 *   // TypeScript 自动收窄：result.patterns 可安全访问
 *   for (const pattern of result.patterns) {
 *     console.log(pattern.name, pattern.confidence);
 *   }
 * } else {
 *   // 收窄为失败分支：result.error 可安全访问
 *   console.error(`扫描失败: ${result.error}`);
 * }
 * ```
 *
 * @usedBy PatternScanner.scan() — 所有 scan() 调用的返回值
 *
 * @since 0.1.0
 */
export type ScanResult =
  | {
      /** 扫描是否成功 */
      success: true;
      /** 提取到的模式列表 */
      patterns: PatternDefinition[];
      /** 扫描摘要统计（当 options.includeSummary === true 时非 null） */
      summary: ScanSummary;
      /** 执行过程中的诊断信息（警告、错误记录等） */
      diagnostics: ScanDiagnostic[];
      /** 总耗时（毫秒） */
      durationMs: number;
    }
  | {
      success: false;
      /** 失败时 patterns 为空数组 */
      patterns: [];
      /** 部分成功时仍可提取到的模式（容错设计） */
      partialPatterns?: PatternDefinition[];
      summary: ScanSummary;
      diagnostics: ScanDiagnostic[];
      durationMs: number;
      /** 错误描述 */
      error: string;
    };

// ─── 扫描摘要 ──────────────────────────────────────────────

/**
 * ScanSummary —— 扫描操作的汇总统计。
 *
 * 提供扫描过程的量化概览，供消费者快速了解扫描结果全貌。
 *
 * @example
 * ```typescript
 * // 快速查看扫描结果概要
 * console.log(`扫描了 ${summary.totalFiles} 个文件`);
 * console.log(`发现 ${summary.totalPatterns} 个模式`);
 * console.log(`涉及 ${summary.kindsFound.length} 种模式种类`);
 * console.log(`耗时 ${summary.durationMs}ms`);
 * console.log(`使用了 ${summary.extractorsUsed} 个提取器`);
 * ```
 *
 * @since 0.1.0
 */
export interface ScanSummary {
  /** 扫描的文件总数 */
  totalFiles: number;

  /** 成功读取的文件数 */
  filesScanned: number;

  /** 读取失败的文件数 */
  filesFailed: number;

  /** 提取到的原始模式总数（归并前） */
  rawPatterns: number;

  /** 最终返回的模式总数（归并+过滤后） */
  totalPatterns: number;

  /** 所涉模式种类列表 */
  kindsFound: PatternKind[];

  /** 各种类模式的数量分布 */
  kindDistribution: Partial<Record<PatternKind, number>>;

  /** 使用的提取器数量 */
  extractorsUsed: number;

  /** 使用的提取器名称列表 */
  extractorNames: string[];

  /** 总耗时（毫秒） */
  durationMs: number;

  /** 最高置信度（0–1） */
  maxConfidence: number;

  /** 平均置信度（0–1） */
  avgConfidence: number;
}

// ─── 扫描诊断 ──────────────────────────────────────────────

/**
 * ScanDiagnostic —— 扫描过程中的诊断信息。
 *
 * 记录扫描过程中产生的警告、错误和信息性消息。
 * 与 {@link ScanResult.diagnostics} 配合使用，帮助消费者诊断扫描问题。
 *
 * **严重级别**：
 * - `"info"`：正常操作信息（如 "使用了提取器 ast-extractor"）
 * - `"warning"`：可恢复的异常（如 "文件 file.ts 为空，跳过"）
 * - `"error"`：不可恢复的异常（如 "提取器 regex-extractor 抛出异常"）
 *
 * @example
 * ```typescript
 * for (const d of result.diagnostics) {
 *   switch (d.severity) {
 *     case "error":
 *       console.error(`[${d.source}] ${d.message}`);
 *       break;
 *     case "warning":
 *       console.warn(`[${d.source}] ${d.message}`);
 *       break;
 *     case "info":
 *       console.info(`[${d.source}] ${d.message}`);
 *       break;
 *   }
 * }
 * ```
 *
 * @since 0.1.0
 */
export interface ScanDiagnostic {
  /** 严重级别 */
  severity: "info" | "warning" | "error";

  /** 诊断消息 */
  message: string;

  /** 来源（提取器名、管线阶段名、或系统组件名） */
  source: string;

  /** 关联的文件路径（如适用） */
  filePath?: string;

  /** 关联的模式 ID（如适用） */
  patternId?: string;

  /** 时间戳 */
  timestamp: number;

  /** 可选的错误码（用于程序化处理） */
  code?: string;

  /** 可选的栈追踪（仅在 verbose 模式下填充） */
  stack?: string;
}

// ─── 扫描常量 ──────────────────────────────────────────────

/**
 * 默认扫描配置常量。
 *
 * 当消费方未在 ScanOptions 中显式指定某字段时，使用此常量中的默认值。
 *
 * @since 0.1.0
 */
export const DEFAULT_SCAN_OPTIONS: Readonly<ScanOptions> = Object.freeze({
  minConfidence: 0,
  enableMerge: true,
  mergeThreshold: 0.8,
  maxResults: 100,
  includeSummary: true,
  verbose: false,
}) as Readonly<ScanOptions>;

/**
 * 默认扫描器名称 —— 回退值。
 * 当实现类未提供自定义 name 时使用此默认值。
 *
 * @since 0.1.0
 */
export const DEFAULT_SCANNER_NAME = "default-scanner";

/**
 * 默认扫描器描述 —— 回退值。
 * 当实现类未提供自定义 description 时使用此默认值。
 *
 * @since 0.1.0
 */
export const DEFAULT_SCANNER_DESCRIPTION =
  "@cortex/pattern-extractor 默认模式扫描器，支持 AST / 正则 / 启发式三种提取策略的自动编排";
