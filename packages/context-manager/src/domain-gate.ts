// ============================================================
// @cortex/context-manager/src/domain-gate —— C 层域门控
//
// DomainGateController 是 MemoryWorldModel 的 C 层组件：
// 只激活相关域，不相关域完全不参与检索。
//
// S2-7：filterEntries 提供生产批量过滤入口；注入 AuditTrail 后
// 过滤结果记入 audit.jsonl（domain_filter 条目）。未注入时仅过滤不审计
// ——骨架期不造假信号。
// ============================================================

import type { AuditTrail } from "@cortex/telemetry";

/**
 * 域门控控制器。
 * 维护当前活跃域集合，判断 MemoryEntry 是否允许通过。
 */
export class DomainGateController {
  private activeDomains: Set<string> = new Set(["engineering"]);
  /** 可选审计后端（S2-7）——注入后过滤事件落 audit.jsonl */
  private auditTrail?: AuditTrail;

  /**
   * 注入审计后端（可选）。
   * @param auditTrail - 共享 AuditTrail 实例（bootstrap 创建）
   */
  setAuditTrail(auditTrail: AuditTrail): void {
    this.auditTrail = auditTrail;
  }

  /**
   * 设置当前活跃域。
   * @param allow 允许的 domain 名称列表
   */
  setActiveDomains(allow: string[]): void {
    this.activeDomains = new Set(allow);
  }

  /**
   * 判断 entry 是否属于活跃域。
   * @param entry 记忆条目（或含 domain 的对象）
   * @returns true 当 entry.domain（或 'general'）在活跃域中
   */
  isAllowed(entry: { domain?: string }): boolean {
    return this.activeDomains.has(entry.domain ?? 'general');
  }

  /**
   * 批量过滤记忆条目（生产入口，S2-7）。
   *
   * 返回允许通过的条目；注入 AuditTrail 时记录一次
   * domain_filter 审计（allowed/blocked 域 + 计数）。
   *
   * @param entries 待过滤的记忆条目（含 domain 字段）
   * @returns 允许通过的条目子集
   */
  filterEntries<T extends { domain?: string }>(entries: T[]): T[] {
    const allowed: T[] = [];
    const blockedCountByDomain = new Map<string, number>();
    for (const entry of entries) {
      const domain = entry.domain ?? 'general';
      if (this.activeDomains.has(domain)) {
        allowed.push(entry);
      } else {
        blockedCountByDomain.set(domain, (blockedCountByDomain.get(domain) ?? 0) + 1);
      }
    }
    this.auditTrail?.recordDomainFilter({
      query: "*",
      allowed: [...this.activeDomains],
      blocked: [...blockedCountByDomain.keys()],
      stats: {
        total: entries.length,
        allowedCount: allowed.length,
        blockedCount: entries.length - allowed.length,
      },
    });
    return allowed;
  }

  /**
   * 获取当前活跃域列表（快照）。
   */
  getActiveDomains(): string[] {
    return [...this.activeDomains];
  }
}
