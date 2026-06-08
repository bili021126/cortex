/**
 * @cortex/policy-validator — 核心类型定义
 *
 * 定义 PolicyRule、PolicyReport 等核心类型。
 * 依据 coding-standards.md：
 *   - §13.3 readonly 优先：共享数据加 readonly
 *   - §13.4 interface 优先：对象形状用 interface
 *   - §13.2 Discriminated Union：多种事件用 type 字段窄化
 */

// ============================================================
// 规则严重级别 & 策略域
// ============================================================

/**
 * 规则严重级别——映射到 ReversibilityLevel 语义。
 *
 * - info:    提示性，不阻断（对应 L0）
 * - warning: 建议修改，不阻断 CI（对应 L1）
 * - error:   必须修改，阻断 CI（对应 L2/L3）
 */
export type RuleSeverity = "info" | "warning" | "error";

/**
 * 策略域——规则的领域分类。
 * 每个域对应 coding-standards.md 的一章或一组相关规则。
 */
export type PolicyDomain =
  | "exception"        // §一 异常处理
  | "declaration"      // §二 变量声明
  | "async"            // §三 异步规范
  | "import"           // §四 + §十二 导入路径
  | "console"          // §五 控制台输出
  | "style"            // §六 + §十 代码风格
  | "hardcoded"        // §七 硬编码禁令
  | "prompts"          // §八 提示词管理
  | "architecture"     // §九 架构设计原则
  | "function"         // §十一 函数设计
  | "interface"        // §十三 接口与类型设计
  | "pattern";         // §十四 设计模式约定

// ============================================================
// PolicyRule — 单条策略规则
// ============================================================

/**
 * 单条策略规则——原子校验单元。
 *
 * @design-rule 接口隔离原则（§13.1）
 *   此接口只描述"规则是什么"，不描述"规则怎么执行"。
 *
 * @design-rule readonly 优先（§13.3）
 *   所有字段不可变——规则一经注册，其定义不应被运行时修改。
 */
export interface PolicyRule {
  /** 规则唯一标识（如 "style/no-non-null-assertion"） */
  readonly id: string;

  /** 规则所属策略域 */
  readonly domain: PolicyDomain;

  /** 规则严重级别 */
  readonly severity: RuleSeverity;

  /** 规则简短描述（一条语句） */
  readonly description: string;

  /** 规则详细说明（可包含编码规范原文引用） */
  readonly detail?: string;

  /** 错误码（如 "NO_NON_NULL_ASSERTION"） */
  readonly code: string;

  /** 标签列表（与 @cortex/shared Tag 体系一致） */
  readonly tags: readonly string[];

  /** 适用的文件 glob 模式（如 "**\/*.ts"） */
  readonly filePattern?: string;

  /** 适用的 AgentType 列表（为空则适用于所有 Agent） */
  readonly targetAgentTypes?: readonly string[];

  /** coding-standards.md 章节引用（如 "§10.1"） */
  readonly standardRef?: string;

  /** 修复建议（可选） */
  readonly fixSuggestion?: string;
}

// ============================================================
// PolicyRuleResult — 单条规则的校验结果
// ============================================================

/**
 * 校验结果项——单条规则的执行结果。
 */
export interface PolicyRuleResult {
  /** 规则 ID */
  readonly ruleId: string;

  /** 规则严重级别 */
  readonly severity: RuleSeverity;

  /** 是否通过 */
  readonly passed: boolean;

  /** 错误信息（passed === false 时设置） */
  readonly message?: string;

  /** 错误码 */
  readonly code: string;

  /** 文件路径（规则触发的源文件） */
  readonly filePath?: string;

  /** 行号（规则触发的源代码位置） */
  readonly line?: number;

  /** 列号（规则触发的源代码位置） */
  readonly column?: number;

  /** 修复建议 */
  readonly fixSuggestion?: string;

  /** 规则元数据引用 */
  readonly rule: PolicyRule;
}

// ============================================================
// PolicyReport — 校验报告
// ============================================================

/**
 * 校验报告——RuleEngine 执行的完整输出。
 *
 * @design-rule 三等报告（参照 SkillJsonValidationResult 模式）
 *   errors: 阻断性问题（severity === "error" 且 passed === false）
 *   warnings: 建议性问题（severity === "warning" 且 passed === false）
 *   infos: 提示性信息（severity === "info" 或 pass 的结果摘要）
 *   valid: errors.length === 0
 */
export interface PolicyReport {
  /** 是否完全通过（无 error 级别问题） */
  readonly valid: boolean;

  /** 错误列表（阻断性） */
  readonly errors: readonly PolicyRuleResult[];

  /** 警告列表（建议性） */
  readonly warnings: readonly PolicyRuleResult[];

  /** 信息列表（提示性 + 通过项摘要） */
  readonly infos: readonly PolicyRuleResult[];

  /** 所有结果（errors + warnings + infos 全量） */
  readonly results: readonly PolicyRuleResult[];

  /** 校验时间戳 */
  readonly timestamp: number;

  /** 校验耗时（ms） */
  readonly durationMs: number;

  /** 执行的规则数 */
  readonly totalRules: number;

  /** 通过规则数 */
  readonly passedRules: number;

  /** 失败规则数 */
  readonly failedRules: number;
}

// ============================================================
// RuleFilter — 规则筛选条件
// ============================================================

/**
 * 规则筛选条件——按需获取规则的查询对象。
 *
 * @design-rule 禁止 boolean trap（§11.1 原则三）
 *   所有筛选条件使用命名选项对象，而非布尔位置参数。
 */
export interface RuleFilter {
  /** 按策略域筛选 */
  readonly domains?: readonly PolicyDomain[];

  /** 按严重级别筛选 */
  readonly severities?: readonly RuleSeverity[];

  /** 按标签筛选（匹配任意一个即返回） */
  readonly tags?: readonly string[];

  /** 按 AgentType 筛选 */
  readonly agentTypes?: readonly string[];

  /** 按文件模式筛选（匹配的规则才会被返回） */
  readonly filePattern?: string;

  /** 按规则 ID 列表精确指定 */
  readonly ruleIds?: readonly string[];
}

// ============================================================
// PolicyEvent — 校验事件（Discriminated Union）
// ============================================================

/**
 * 校验事件——RuleEngine 生命周期的判别联合。
 *
 * @design-rule Discriminated Union（§13.2）
 *   多种事件类型通过 type 字段窄化 payload 类型。
 */
export type PolicyEvent =
  | { type: "engine-start"; payload: { totalRules: number; targetFiles: string[] } }
  | { type: "rule-start"; payload: { ruleId: string; filePath: string } }
  | { type: "rule-pass"; payload: { ruleId: string; filePath: string; durationMs: number } }
  | { type: "rule-fail"; payload: { ruleId: string; filePath: string; result: PolicyRuleResult } }
  | { type: "rule-error"; payload: { ruleId: string; filePath: string; error: string } }
  | { type: "engine-end"; payload: { report: PolicyReport } };

/**
 * 事件处理器签名。
 */
export type PolicyEventHandler = (event: PolicyEvent) => void;

// ============================================================
// RuleEngineConfig — 引擎配置
// ============================================================

/**
 * RuleEngine 配置。
 *
 * @design-rule 配置驱动开发（§七）
 *   所有可调参数从配置对象读取，禁止硬编码。
 */
export interface RuleEngineConfig {
  /** 规则超时（ms），默认 30_000 */
  readonly ruleTimeoutMs?: number;

  /** 最大并发校验文件数，默认 4 */
  readonly maxConcurrency?: number;

  /** 是否在第一个 error 时停止，默认 false */
  readonly failFast?: boolean;

  /** 是否启用缓存（AST 缓存），默认 true */
  readonly enableCache?: boolean;

  /** 输出详细日志，默认 false */
  readonly verbose?: boolean;

  /** 允许的最大错误数（超过则停止），默认 0 = 不限 */
  readonly maxErrors?: number;
}

// ============================================================
// RuleLoadOptions & RuleLoadStats
// ============================================================

/**
 * 规则加载选项。
 */
export interface RuleLoadOptions {
  /** 是否在加载前清除已注册规则，默认 false */
  readonly clearBeforeLoad?: boolean;

  /** 是否启用严格模式（遇到无效规则时抛错），默认 true */
  readonly strict?: boolean;

  /** 自定义规则源路径 */
  readonly customPath?: string;
}

/**
 * 加载统计。
 */
export interface RuleLoadStats {
  /** 加载的规则总数 */
  total: number;

  /** 按域统计 */
  byDomain: Record<PolicyDomain, number>;

  /** 按严重级别统计 */
  bySeverity: Record<RuleSeverity, number>;

  /** 无效规则数 */
  invalidCount: number;

  /** 加载耗时（ms） */
  durationMs: number;
}
