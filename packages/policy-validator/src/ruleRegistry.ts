/**
 * @cortex/policy-validator — RuleRegistry 规则注册表实现
 *
 * 提供基于 Map 的规则注册、筛选、查询、禁用/启用功能。
 * 依据 coding-standards.md：
 *   - §9.2 内部数据流向明细化：注册、筛选、查询路径显式独立
 *   - §13.1 ISP：RuleRegistry 只做规则管理，不做校验执行
 *   - §11.1 禁止 boolean trap：筛选条件使用命名选项对象
 */

import type { PolicyRule, PolicyDomain, RuleSeverity, RuleFilter } from "./types.js";

// ============================================================
// IRuleRegistry — 规则注册表接口
// ============================================================

/**
 * 规则注册表——规则的集中管理容器。
 *
 * @design-rule 接口隔离（§13.1）
 *   此接口只描述"规则怎么管理"，不涉及规则执行。
 *
 * @design-rule 单源真相
 *   所有注册的规则有且仅有一个来源——register/bulkRegister。
 *   规则一经注册，不可删除（但可 disable）。
 */
export interface IRuleRegistry {
  /** 注册单条规则 */
  register(rule: PolicyRule): void;

  /** 批量注册多条规则 */
  bulkRegister(rules: readonly PolicyRule[]): void;

  /** 按 ID 获取规则 */
  get(ruleId: string): PolicyRule | undefined;

  /** 按筛选条件查询规则 */
  query(filter?: RuleFilter): readonly PolicyRule[];

  /** 获取所有已注册且未禁用的规则 */
  getAll(): readonly PolicyRule[];

  /** 获取所有策略域 */
  getDomains(): readonly PolicyDomain[];

  /** 获取指定域下的规则数 */
  countByDomain(): Record<PolicyDomain, number>;

  /** 按严重级别计数 */
  countBySeverity(): Record<RuleSeverity, number>;

  /** 禁用规则（保留注册但跳过执行） */
  disable(ruleId: string): void;

  /** 启用规则 */
  enable(ruleId: string): void;

  /** 检查规则是否已禁用 */
  isDisabled(ruleId: string): boolean;

  /** 清空注册表 */
  clear(): void;

  /** 获取注册规则总数（包含已禁用的） */
  size(): number;
}

// ============================================================
// RuleRegistry — 实现类
// ============================================================

/**
 * RuleRegistry 实现——基于 Map 的规则注册表。
 *
 * @design-rule 内部数据流向明细化（§9.2）
 *   - register/bulkRegister：写入路径，单一入口
 *   - get/query：查询路径，不写状态
 *   - disable/enable：状态切换，有显式的开关记录
 */
export class RuleRegistry implements IRuleRegistry {
  private _rules: Map<string, PolicyRule>;
  private _disabled: Set<string>;

  constructor() {
    this._rules = new Map();
    this._disabled = new Set();
  }

  register(rule: PolicyRule): void {
    if (this._rules.has(rule.id)) {
      throw new Error(`Rule already registered: ${rule.id}`);
    }
    this._rules.set(rule.id, rule);
  }

  bulkRegister(rules: readonly PolicyRule[]): void {
    for (const rule of rules) {
      this.register(rule);
    }
  }

  get(ruleId: string): PolicyRule | undefined {
    return this._rules.get(ruleId);
  }

  query(filter?: RuleFilter): readonly PolicyRule[] {
    const results: PolicyRule[] = [];
    for (const rule of this._rules.values()) {
      if (this._disabled.has(rule.id)) {
        continue;
      }
      if (!this._matchesFilter(rule, filter)) {
        continue;
      }
      results.push(rule);
    }
    return results;
  }

  getAll(): readonly PolicyRule[] {
    return Array.from(this._rules.values())
      .filter(r => !this._disabled.has(r.id));
  }

  getDomains(): readonly PolicyDomain[] {
    const domains = new Set<PolicyDomain>();
    for (const rule of this._rules.values()) {
      domains.add(rule.domain);
    }
    return Array.from(domains);
  }

  countByDomain(): Record<PolicyDomain, number> {
    const counts: Partial<Record<PolicyDomain, number>> = {};
    for (const rule of this._rules.values()) {
      if (this._disabled.has(rule.id)) {
        continue;
      }
      const current = counts[rule.domain] ?? 0;
      counts[rule.domain] = current + 1;
    }
    return counts as Record<PolicyDomain, number>;
  }

  countBySeverity(): Record<RuleSeverity, number> {
    const counts: Record<RuleSeverity, number> = {
      info: 0,
      warning: 0,
      error: 0,
    };
    for (const rule of this._rules.values()) {
      if (this._disabled.has(rule.id)) {
        continue;
      }
      counts[rule.severity]++;
    }
    return counts;
  }

  disable(ruleId: string): void {
    this._disabled.add(ruleId);
  }

  enable(ruleId: string): void {
    this._disabled.delete(ruleId);
  }

  isDisabled(ruleId: string): boolean {
    return this._disabled.has(ruleId);
  }

  clear(): void {
    this._rules.clear();
    this._disabled.clear();
  }

  size(): number {
    return this._rules.size;
  }

  // ── 内部辅助 ──

  private _matchesFilter(
    rule: PolicyRule,
    filter?: RuleFilter,
  ): boolean {
    if (!filter) {
      return true;
    }

    // 按域筛选
    if (filter.domains && filter.domains.length > 0) {
      if (!filter.domains.includes(rule.domain)) {
        return false;
      }
    }

    // 按严重级别筛选
    if (filter.severities && filter.severities.length > 0) {
      if (!filter.severities.includes(rule.severity)) {
        return false;
      }
    }

    // 按标签筛选（任意匹配一个即可）
    if (filter.tags && filter.tags.length > 0) {
      if (!rule.tags.some(t => (filter.tags ?? []).includes(t))) {
        return false;
      }
    }

    // 按 AgentType 筛选
    if (filter.agentTypes && filter.agentTypes.length > 0) {
      if (!rule.targetAgentTypes?.some(t => (filter.agentTypes ?? []).includes(t))) {
        return false;
      }
    }

    // 按文件模式筛选
    if (filter.filePattern) {
      if (!rule.filePattern) {
        return false;
      }
      // 简单通配符匹配——实际实现应使用 minimatch 等库
      if (!simpleGlobMatch(rule.filePattern, filter.filePattern)) {
        return false;
      }
    }

    // 按规则 ID 精确指定
    if (filter.ruleIds && filter.ruleIds.length > 0) {
      if (!filter.ruleIds.includes(rule.id)) {
        return false;
      }
    }

    return true;
  }
}

/**
 * 简单的 glob 模式匹配（仅支持 * 通配符）。
 * 实际实现应使用 minimatch 或 micromatch 库。
 */
function simpleGlobMatch(pattern: string, target: string): boolean {
  // 将 glob 模式转换为正则
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".");
  try {
    return new RegExp(`^${regexStr}$`).test(target);
  } catch {
    return pattern === target;
  }
}
