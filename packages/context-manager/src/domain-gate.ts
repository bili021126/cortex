// ============================================================
// @cortex/context-manager/src/domain-gate —— C 层域门控
//
// DomainGateController 是 MemoryWorldModel 的 C 层组件：
// 只激活相关域，不相关域完全不参与检索。
// Phase 5 骨架版，后续接 AuditTrail + MetricCounter。
// ============================================================

/**
 * 域门控控制器。
 * 维护当前活跃域集合，判断 MemoryEntry 是否允许通过。
 */
export class DomainGateController {
  private activeDomains: Set<string> = new Set(["engineering"]);

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
   * 获取当前活跃域列表（快照）。
   */
  getActiveDomains(): string[] {
    return [...this.activeDomains];
  }
}
