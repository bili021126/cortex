/**
 * @cortex/policy-validator — 策略校验器桶导出
 *
 * @module-convention（§四 barrel 铁律）
 * 1. 凡 src/ 下新增公开类型/函数，必须在本文件追加 export 行。
 * 2. 测试文件禁止 ../src/ 相对导入——只用 @cortex/policy-validator 包名导入。
 * 3. 收益：文件合并/拆分/重命名——只要 barrel 出口不变，所有引用方无感。
 *
 * ============================================================
 */

// ── 核心类型 ──
export type {
  PolicyRule,
  PolicyRuleResult,
  PolicyReport,
  RuleSeverity,
  PolicyDomain,
  RuleFilter,
  RuleEngineConfig,
  PolicyEvent,
  PolicyEventHandler,
  RuleLoadOptions,
  RuleLoadStats,
} from "./types.js";

// ── PolicyRule 工厂 ──
export { createRule, isSameRule, sortRulesBySeverity } from "./policyRule.js";

// ── RuleRegistry ──
export { RuleRegistry } from "./ruleRegistry.js";
export type { IRuleRegistry } from "./ruleRegistry.js";

// ── RuleEngine ──
export { RuleEngine } from "./ruleEngine.js";
export type { IRuleEngine, PolicyValidatorComponent } from "./ruleEngine.js";

// ── RuleLoader ──
export { RuleLoader, getBuiltinRules } from "./ruleLoader.js";
export type { IRuleLoader } from "./ruleLoader.js";

// ── 具体策略规则 ──
export { NamingConventionRule } from "./rules/naming-convention-rule.js";
export type { NamingConventionOptions } from "./rules/naming-convention-rule.js";
export { ExportRule } from "./rules/export-rule.js";
export type { ExportRuleOptions } from "./rules/export-rule.js";
