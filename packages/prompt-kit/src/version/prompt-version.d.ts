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
export declare class PromptVersion {
    /** templateId → 版本记录列表（最新在前） */
    private history;
    /** templateId → 版本快照 */
    private snapshots;
    /**
     * 获取模板版本历史。
     */
    getHistory(templateId: string): VersionRecord[];
    /**
     * 获取指定版本的模板快照。
     */
    getVersion(templateId: string, version: string): Promise<PromptTemplate | null>;
    /**
     * 记录版本变更。
     * 会自动保存当前模板的快照。
     */
    recordChange(record: VersionRecord, currentTemplate?: PromptTemplate): void;
    /**
     * 对比两个版本的差异。
     */
    diff(templateId: string, fromVersion: string, toVersion: string): VersionDiff;
    /**
     * 计算两个模板版本的差异。
     */
    private computeDiff;
}
//# sourceMappingURL=prompt-version.d.ts.map