/**
 * DocRegistry —— 文档治理注册中心。
 *
 * DocRegistry 是治理层文档管理的核心——与 MemoryStore 同构，
 * 管理治理文档的完整生命周期（draft → active → archived → deprecated）。
 *
 * @design 与 MemoryStore 的对应
 * - register()  ← write()         : 创建文档，初始状态 draft，自动决定落盘路径
 * - promote()   ← confirmWrite()  : draft → active（正史门槛：reviewers 含 "human"）
 * - archive()   ← archive()       : active → archived
 * - deprecate()                   : 任意状态 → deprecated
 * - list()      ← read()/query()  : 按 status/type/committeeType 查询
 *
 * @contract 调用者说"是什么"，DocRegistry 决定"放哪"和"什么状态"
 *   调用者不指定路径——路径由 DocRegistry 根据 type + title 自动计算。
 *   调用者只负责 content 的正确性。
 *
 * @usedBy
 * - DocGovernAgent（凝光）→ register({ type: "audit", committeeType: "standing" })
 * - roundtable CLI → register({ type: "consensus" | "attribution" })
 * - 自审视 CLI → register({ type: "self-examination" })
 *
 * @since v2.7 — 横向解耦：从 @cortex/engine 迁入 @cortex/governance
 * @moved-from @cortex/engine/src/registry/doc-registry.ts
 */

import type {
  IFileSystemAdapter,
  DocInput,
  DocEntry,
  DocStatus,
  DocRegistryIndex,
} from "@cortex/shared";

/** DocRegistry JSON 索引文件路径（相对于 workspace root） */
const INDEX_PATH = "doc-govern/doc-registry.json";

/** 文档类型 → 落盘目录的映射 */
const PATH_TEMPLATES: Record<string, string> = {
  audit: "docs/auditing",
  consensus: "doc-govern/consensus",
  attribution: "doc-govern/attribution",
  review: "test-output/reviews",
  "self-examination": "test-output/self-examination-soft",
  architecture: "docs/architecture",
};

/**
 * DocRegistry —— 治理文档注册中心。
 *
 * 和 MemoryStore 一样：调用者不指定路径，只描述"是什么"。
 * 生命周期也和记忆四态对齐：draft → active → archived → deprecated。
 */
export class DocRegistry {
  private fs: IFileSystemAdapter;
  private workspaceRoot: string;
  private index: DocRegistryIndex;
  private pathTemplates: Record<string, string>;
  private _loaded = false;
  /** R11-13：init 发现 formatVersion 高于代码/索引损坏——保存前备份原文件 */
  private _unsupportedVersion = false;

  constructor(
    fs: IFileSystemAdapter,
    workspaceRoot: string,
    pathTemplates?: Record<string, string>,
  ) {
    this.fs = fs;
    this.workspaceRoot = workspaceRoot;
    this.index = { formatVersion: 1, entries: {} };
    this.pathTemplates = pathTemplates ?? PATH_TEMPLATES;
  }

  // ── 索引持久化 ──────────────────────────────

  /** 从磁盘加载索引（首次使用时调用） */
  async init(): Promise<void> {
    const indexPath = this._indexPath();
    if (await this.fs.exists(indexPath)) {
      try {
        const raw = await this.fs.readFile(indexPath);
        const parsed = JSON.parse(raw);
        // R11-13：formatVersion 门控——更新版本拒绝静默清空（新版本写、旧代码读——全部文档从注册表“消失”）
        if (parsed.formatVersion === 1 && parsed.entries) {
          this.index = parsed;
        } else if (typeof parsed.formatVersion === "number" && parsed.formatVersion > 1) {
          process.stderr.write(
            `[doc-registry] 索引 formatVersion ${parsed.formatVersion} 高于代码支持的 1——拒绝静默清空（覆盖写入前将备份原文件）\n`,
          );
          this.index = { formatVersion: 1, entries: {} };
          this._unsupportedVersion = true;
        }
      } catch {
        // 索引文件损坏 → 空索引，不阻塞启动
        this.index = { formatVersion: 1, entries: {} };
        this._unsupportedVersion = true;
      }
    }
    this._loaded = true;
  }

  /** 将索引写回磁盘 */
  private async _saveIndex(): Promise<void> {
    const indexPath = this._indexPath();
    await this.fs.mkdir(this.fs.resolve(this.workspaceRoot, "doc-govern"));
    // R11-13：覆盖前备份（读→写 .bak——防损坏/降级时数据永久丢失；首次写或无原文件时跳过）
    if (this._unsupportedVersion || (await this.fs.exists(indexPath))) {
      try {
        const prev = await this.fs.readFile(indexPath);
        await this.fs.writeFile(`${indexPath}.bak`, prev);
      } catch { /* 原文件不存在或不可读——无需备份 */ }
    }
    await this.fs.writeFile(indexPath, JSON.stringify(this.index, null, 2) + "\n");
    this._unsupportedVersion = false;
  }

  private _indexPath(): string {
    return this.fs.resolve(this.workspaceRoot, INDEX_PATH);
  }

  /** 确保已加载索引 */
  private _ensureLoaded(): void {
    if (!this._loaded)
      throw new Error("DocRegistry.init() must be called before use");
  }

  // ── ID 与路径计算 ───────────────────────────

  /** 计算文档 ID：{date}-{type}-{slug} */
  private _computeId(input: DocInput): string {
    const date = new Date().toISOString().slice(0, 10); // "2026-05-15"
    const slug = input.title
      .replace(/[^\w\u4e00-\u9fff-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)
      || "untitled";
    return `${date}-${input.type}-${slug}`;
  }

  /** 计算文档落盘路径 */
  private _computePath(input: DocInput, id: string): string {
    const dir = this.pathTemplates[input.type] ?? "doc-govern";
    const safeName = input.title
      .replace(/[/\\:*?"<>|]/g, "-")
      .slice(0, 60)
      || id;
    return `${dir}/${safeName}.md`;
  }

  // ── 公共 API ────────────────────────────────

  /**
   * 注册一份文档。
   * 自动计算路径、写入磁盘（含 frontmatter）、更新索引。
   * 初始状态 = "draft"。
   */
  async register(input: DocInput): Promise<DocEntry> {
    this._ensureLoaded();

    const id = this._computeId(input);
    const filePath = this._computePath(input, id);
    const now = Date.now();

    const entry: DocEntry = {
      ...input,
      id,
      status: "draft",
      filePath,
      reviewedBy: [],
      registeredAt: now,
      promotedAt: null,
    };

    // 构造 frontmatter
    const fm: string[] = [
      "---",
      `title: "${input.title}"`,
      `type: ${input.type}`,
      `status: draft`,
      `id: "${id}"`,
      `authors: [${input.authors.map((a: string) => `"${a}"`).join(", ")}]`,
      `registeredAt: "${new Date(now).toISOString()}"`,
    ];
    if (input.committeeType) fm.push(`committeeType: "${input.committeeType}"`);
    if (input.triggerSource) fm.push(`triggerSource: "${input.triggerSource}"`);
    if (input.constitutionVersion) fm.push(`constitutionVersion: "${input.constitutionVersion}"`);
    fm.push("---", "", input.content);

    // 写入磁盘
    const fullPath = this.fs.resolve(this.workspaceRoot, filePath);
    await this.fs.writeFile(fullPath, fm.join("\n"));

    // 更新索引
    this.index.entries[id] = entry;
    await this._saveIndex();

    return entry;
  }

  /**
   * 将文档从 draft 晋升为 active（正史）。
   * 正史门槛：reviewers 必须非空。
   */
  async promote(id: string, reviewers: string[]): Promise<DocEntry> {
    this._ensureLoaded();

    const entry = this.index.entries[id];
    if (!entry) throw new Error(`DocEntry not found: ${id}`);
    if (entry.status !== "draft") {
      throw new Error(`Cannot promote from status "${entry.status}": ${id}`);
    }
    if (reviewers.length === 0) {
      throw new Error(`promote() 需要至少一个审批者: ${id}`);
    }

    const now = Date.now();
    entry.status = "active";
    entry.reviewedBy = reviewers;
    entry.promotedAt = now;

    // 更新磁盘文件的 frontmatter
    const fullPath = this.fs.resolve(this.workspaceRoot, entry.filePath);
    if (await this.fs.exists(fullPath)) {
      let content = await this.fs.readFile(fullPath);
      content = content.replace(/^status: draft$/m, "status: active");
      content += `\nreviewedBy: [${reviewers.map((r) => `"${r}"`).join(", ")}]`;
      content += `\npromotedAt: "${new Date(now).toISOString()}"`;
      await this.fs.writeFile(fullPath, content);
    }

    this.index.entries[id] = entry;
    await this._saveIndex();

    return entry;
  }

  /** 归档文档（active → archived） */
  async archive(id: string): Promise<DocEntry> {
    this._ensureLoaded();

    const entry = this.index.entries[id];
    if (!entry) throw new Error(`DocEntry not found: ${id}`);
    if (entry.status !== "active") {
      throw new Error(`Cannot archive from status "${entry.status}": ${id}`);
    }

    entry.status = "archived";
    this.index.entries[id] = entry;
    await this._saveIndex();
    return entry;
  }

  /** 废弃文档（任意状态 → deprecated） */
  async deprecate(id: string): Promise<DocEntry> {
    this._ensureLoaded();

    const entry = this.index.entries[id];
    if (!entry) throw new Error(`DocEntry not found: ${id}`);

    entry.status = "deprecated";
    this.index.entries[id] = entry;
    await this._saveIndex();
    return entry;
  }

  // ── 查询 ────────────────────────────────────

  /** 按条件列出文档条目 */
  list(filter?: {
    status?: DocStatus;
    type?: string;
    committeeType?: string;
  }): DocEntry[] {
    this._ensureLoaded();

    let entries = Object.values(this.index.entries);
    if (filter?.status) entries = entries.filter((e: DocEntry) => e.status === filter.status);
    if (filter?.type) entries = entries.filter((e: DocEntry) => e.type === filter.type);
    if (filter?.committeeType) entries = entries.filter((e: DocEntry) => e.committeeType === filter.committeeType);
    return entries;
  }

  /** 按 ID 获取单条 */
  get(id: string): DocEntry | undefined {
    this._ensureLoaded();
    return this.index.entries[id];
  }

  /** 注册条目总数 */
  get size(): number {
    this._ensureLoaded();
    return Object.keys(this.index.entries).length;
  }
}
