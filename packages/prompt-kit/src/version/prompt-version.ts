/**
 * @cortex/prompt-kit — Prompt 版本管理
 *
 * 记录和管理 prompt 模板的版本变更。
 * 支持版本历史记录、版本回退和差异对比。
 *
 * @see DESIGN.md §3.6 PromptVersion
 */

import type { VersionRecord, VersionDiff, PromptTemplate } from "../types.js";

/**
 * PotVersion —— 版本管理器。
 *
 * 版本记录可持久化到 JSON 文件或 MemoryStore。
 * Core-1 阶段：内存存储。
 * Core-2：接入 MemoryStore 持久化。
 */
export class PromptVersion {
  /** templateId → 版本记录列表（最新在前） */
  private history: Map<string, VersionRecord[]> = new Map();
  /** templateId → 版本快照 */
  private snapshots: Map<string, Map<string, PromptTemplate>> = new Map();

  /**
   * 获取模板版本历史。
   */
  getHistory(templateId: string): VersionRecord[] {
    return this.history.get(templateId) ?? [];
  }

  /**
   * 获取指定版本的模板快照。
   */
  getVersion(templateId: string, version: string): Promise<PromptTemplate | null> {
    const templateVersions = this.snapshots.get(templateId);
    if (!templateVersions) return Promise.resolve(null);
    return Promise.resolve(templateVersions.get(version) ?? null);
  }

  /**
   * 记录版本变更。
   * 会自动保存当前模板的快照。
   */
  recordChange(
    record: VersionRecord,
    currentTemplate?: PromptTemplate,
  ): void {
    // 追加到历史
    const records = this.history.get(record.templateId) ?? [];
    records.unshift(record); // 最新在前
    this.history.set(record.templateId, records);

    // 保存快照
    if (currentTemplate) {
      const templateVersions = this.snapshots.get(record.templateId) ?? new Map();
      templateVersions.set(record.version, currentTemplate);
      this.snapshots.set(record.templateId, templateVersions);
    }
  }

  /**
   * 对比两个版本的差异。
   */
  diff(templateId: string, fromVersion: string, toVersion: string): VersionDiff {
    const templateVersions = this.snapshots.get(templateId);
    if (!templateVersions) {
      return {
        templateId,
        from: fromVersion,
        to: toVersion,
        additions: [],
        removals: [],
        modifications: [],
      };
    }

    const from = templateVersions.get(fromVersion);
    const to = templateVersions.get(toVersion);

    if (!from || !to) {
      return {
        templateId,
        from: fromVersion,
        to: toVersion,
        additions: [],
        removals: [],
        modifications: [],
        // 标记缺失版本
        ...(!from ? { _note: `版本 ${fromVersion} 无快照` } : {}),
        ...(!to ? { _note: `版本 ${toVersion} 无快照` } : {}),
      };
    }

    return this.computeDiff(from, to, fromVersion, toVersion);
  }

  /**
   * 计算两个模板版本的差异。
   */
  private computeDiff(
    from: PromptTemplate,
    to: PromptTemplate,
    fromVersion: string,
    toVersion: string,
  ): VersionDiff {
    const fromBlockMap = new Map(from.blocks.map((b) => [b.id, b]));
    const toBlockMap = new Map(to.blocks.map((b) => [b.id, b]));

    const fromIds = new Set(from.blocks.map((b) => b.id));
    const toIds = new Set(to.blocks.map((b) => b.id));

    const additions = [...toIds].filter((id) => !fromIds.has(id));
    const removals = [...fromIds].filter((id) => !toIds.has(id));
    const common = [...fromIds].filter((id) => toIds.has(id));

    const modifications: VersionDiff["modifications"] = [];
    for (const id of common) {
      const fromBlock = fromBlockMap.get(id);
      const toBlock = toBlockMap.get(id);
      if (!fromBlock || !toBlock) continue;

      if (fromBlock.content !== toBlock.content || fromBlock.priority !== toBlock.priority) {
        modifications.push({
          blockId: id,
          type: fromBlock.type,
          before: fromBlock.content,
          after: toBlock.content,
        });
      }
    }

    return {
      templateId: from.id,
      from: fromVersion,
      to: toVersion,
      additions,
      removals,
      modifications,
    };
  }
}
