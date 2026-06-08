/**
 * @cortex/policy-validator — PolicyRule 策略规则接口定义
 *
 * 提供 PolicyRule 接口及其相关帮助函数。
 * 依据 coding-standards.md：
 *   - §13.4 interface 优先：对象形状优先使用 interface
 *   - §13.3 readonly 优先：共享数据加 readonly
 *   - §13.1 ISP：一个 interface 只描述一个角色
 */

import type { PolicyRule, PolicyDomain, RuleSeverity } from "./types.js";

// ============================================================
// 规则创建辅助函数
// ============================================================

/**
 * 创建一条 PolicyRule 的便捷工厂函数。
 *
 * @param id - 规则唯一标识
 * @param domain - 策略域
 * @param severity - 严重级别
 * @param description - 规则描述
 * @param code - 错误码
 * @param overrides - 可选覆盖字段
 * @returns PolicyRule 对象
 */
export function createRule(
  id: string,
  domain: PolicyDomain,
  severity: RuleSeverity,
  description: string,
  code: string,
  overrides?: Partial<Pick<PolicyRule, "detail" | "tags" | "filePattern" | "targetAgentTypes" | "standardRef" | "fixSuggestion">>,
): PolicyRule {
  return {
    id,
    domain,
    severity,
    description,
    code,
    tags: overrides?.tags ?? [],
    detail: overrides?.detail,
    filePattern: overrides?.filePattern,
    targetAgentTypes: overrides?.targetAgentTypes,
    standardRef: overrides?.standardRef,
    fixSuggestion: overrides?.fixSuggestion,
  } satisfies PolicyRule;
}

/**
 * 检查两条规则是否 ID 相同（用于去重判断）。
 */
export function isSameRule(a: PolicyRule, b: PolicyRule): boolean {
  return a.id === b.id;
}

/**
 * 按严重级别排序规则（error > warning > info）。
 */
export function sortRulesBySeverity(rules: readonly PolicyRule[]): PolicyRule[] {
  const severityOrder: Record<RuleSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  return [...rules].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}
