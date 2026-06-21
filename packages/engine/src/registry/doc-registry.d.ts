import type { IFileSystemAdapter, DocInput, DocEntry, DocStatus } from "@cortex/shared";
/**
 * DocRegistry —— 治理文档注册中心。
 *
 * 和 MemoryStore 一样：调用者不指定路径，只描述"是什么"。
 * 生命周期也和记忆四态对齐：draft → active → archived → deprecated。
 *
 * @example
 * ```typescript
 * const registry = new DocRegistry(fs, workspaceRoot);
 *
 * // Agent 产出审计报告
 * const entry = await registry.register({
 *   type: "audit",
 *   title: "2026-05-15 合规审计",
 *   content: "# 合规审计\n...",
 *   authors: ["凝光"],
 *   committeeType: "standing",
 * });
 * // → 自动写入 docs/auditing/2026-05-15-合规审计.md，状态 draft
 *
 * // 人类审批后晋升正史
 * await registry.promote(entry.id, ["human", "cortex"]);
 * // → 状态变为 active，frontmatter 更新为 reviewed
 *
 * // 查询正史
 * const active = registry.list({ status: "active", type: "audit" });
 * ```
 */
export declare class DocRegistry {
    private fs;
    private workspaceRoot;
    private index;
    private pathTemplates;
    private _loaded;
    constructor(fs: IFileSystemAdapter, workspaceRoot: string, pathTemplates?: Record<string, string>);
    /** 从磁盘加载索引（首次使用时调用） */
    init(): Promise<void>;
    /** 将索引写回磁盘 */
    private _saveIndex;
    private _indexPath;
    /** 确保已加载索引 */
    private _ensureLoaded;
    /** 计算文档 ID：{date}-{type}-{slug} */
    private _computeId;
    /** 计算文档落盘路径 */
    private _computePath;
    /**
     * 注册一份文档。
     * 自动计算路径、写入磁盘（含 frontmatter）、更新索引。
     * 初始状态 = "draft"。
     */
    register(input: DocInput): Promise<DocEntry>;
    /**
     * 将文档从 draft 晋升为 active（正史）。
     * 正史门槛：reviewers 必须非空。
     */
    promote(id: string, reviewers: string[]): Promise<DocEntry>;
    /** 归档文档（active → archived） */
    archive(id: string): Promise<DocEntry>;
    /** 废弃文档（任意状态 → deprecated） */
    deprecate(id: string): Promise<DocEntry>;
    /** 按条件列出文档条目 */
    list(filter?: {
        status?: DocStatus;
        type?: string;
        committeeType?: string;
    }): DocEntry[];
    /** 按 ID 获取单条 */
    get(id: string): DocEntry | undefined;
    /** 注册条目总数 */
    get size(): number;
}
//# sourceMappingURL=doc-registry.d.ts.map