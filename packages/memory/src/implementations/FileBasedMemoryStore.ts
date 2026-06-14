// ============================================================
// @cortex/memory — FileBasedMemoryStore JSON 文件持久化实现
//
// 基于 JSON 文件的轻量级持久化 MemoryStore 实现。
// 所有数据以 JSON 格式写入磁盘，适用于单进程轻量级场景。
//
// @design 特性
//   - 数据以 JSON 文件形式持久化到磁盘
//   - 每次 write/flush 时刷写（write-through 策略）
//   - 启动时从文件加载数据
//   - 支持事务（基于内存操作日志 + 原子文件写入）
//   - 线程安全：Node.js 单线程 + 文件锁语义（无并发写入）
//
// @file-format files/{uuid}.json
//   每条记忆存储为独立文件，避免单文件过大。
//   同时维护 index.json 作为索引。
//
// @implements TransactionalMemoryStore
// ============================================================

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type {
  MemoryEntry,
  MemoryWriteInput,
  MemoryQuery,
  MemoryLink,
  SemanticState,
  LinkType,
  ReadMode,
} from "@cortex/shared";
import type { IMemoryStore } from "../interfaces/MemoryStore.js";
import type {
  TransactionalMemoryStore,
  TransactionContext,
  TransactionIsolation,
  TransactionResult,
  TransactionLinkOp,
} from "../interfaces/TransactionalMemoryStore.js";
import {
  MemoryStoreError,
  MemoryStoreErrorCode,
  MemoryValidationError,
  TransactionError,
  PersistenceError,
} from "../errors/MemoryStoreError.js";

// ── 内部类型 ──────────────────────────────────

/**
 * JSON 索引文件格式。
 */
interface IndexFile {
  version: number;
  updatedAt: number;
  entries: Record<string, EntryIndex>;
}

/**
 * 索引条目。
 */
interface EntryIndex {
  id: string;
  kind: string;
  summary: string;
  semantic_state: string;
  createdAt: number;
  weight: number;
}

/**
 * 序列化的记忆条目（文件格式）。
 */
interface SerializedMemoryEntry extends Omit<MemoryEntry, "content_blob"> {
  content_blob: Record<string, unknown>;
}

/**
 * 序列化的关联链路文件。
 */
interface LinksFile {
  version: number;
  updatedAt: number;
  links: Record<string, SerializedMemoryLink[]>;
}

interface SerializedMemoryLink extends Omit<MemoryLink, "linkType"> {
  linkType: string;
}

// ── UUID 生成 ─────────────────────────────────
import { generateId, shortId } from "../_utils.js";

// ── 常量 ──────────────────────────────────────

const DEFAULT_TRANSACTION_TIMEOUT_MS = 30_000;
const DEFAULT_PENDING_ID_PREFIX = "pending_";
const INDEX_FILE_NAME = "index.json";
const LINKS_FILE_NAME = "links.json";
const STORAGE_VERSION = 1;

/**
 * FileBasedMemoryStore —— 基于 JSON 文件持久化的 MemoryStore 实现。
 *
 * 数据以 JSON 文件形式存储在指定目录中：
 * - index.json: 索引文件（内存加速读取）
 * - links.json: 关联链路文件
 * - entries/: 每条记忆的 JSON 文件（按 ID 命名）
 *
 * @example
 * ```typescript
 * const store = new FileBasedMemoryStore({ dbPath: "./memory-data" });
 * await store.init("./memory-data");
 *
 * const id = await store.write({
 *   kind: "Insight",
 *   summary: "示例",
 *   semantic_gist: "示例语义",
 *   source: { agentType: "Alhaitham", taskId: "task-001" },
 *   content_blob: { key: "value" },
 * });
 * ```
 */
export class FileBasedMemoryStore implements IMemoryStore, TransactionalMemoryStore {
  // ── 配置 ──
  private readonly _options: FileBasedMemoryStoreOptions;

  // ── 存储路径 ──
  private _basePath = "";
  private _entriesDir = "";
  private _indexPath = "";
  private _linksPath = "";

  // ── 运行时数据 ──
  private readonly _entries: Map<string, MemoryEntry> = new Map();
  private readonly _links: Map<string, MemoryLink[]> = new Map();
  private readonly _pendingEntries: Map<string, PendingEntry> = new Map();
  private readonly _transactions: Map<string, InternalTransaction> = new Map();

  // ── 事务 ──
  private _transactionTimeoutMs: number = DEFAULT_TRANSACTION_TIMEOUT_MS;
  private _sessionId: string | undefined;
  private _preWriteHook: ((input: MemoryWriteInput) => MemoryWriteInput) | undefined;
  private _isInitialized = false;

  constructor(options?: FileBasedMemoryStoreOptions) {
    this._options = {
      autoFlush: true,
      prettyPrint: false,
      ...options,
    };
  }

  // ── IMemoryStore 实现 ──────────────────────

  get isReady(): boolean {
    return this._isInitialized;
  }

  get size(): number {
    return this._entries.size;
  }

  get isPersisted(): boolean {
    return true;
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    this._ensureInitialized();
    const entry = this._entries.get(id);
    if (!entry) return undefined;
    return structuredClone(entry) as MemoryEntry;
  }

  peek(id: string): Readonly<MemoryEntry> | undefined {
    this._ensureInitialized();
    return this._entries.get(id);
  }

  has(id: string): boolean {
    this._ensureInitialized();
    return this._entries.has(id);
  }

  getAllEntries(): MemoryEntry[] {
    this._ensureInitialized();
    return Array.from(this._entries.values());
  }

  async read(query: MemoryQuery, mode?: ReadMode): Promise<MemoryEntry[]> {
    this._ensureInitialized();

    let results = Array.from(this._entries.values());

    if (query.kind) {
      results = results.filter(e => e.kind === query.kind);
    }

    if (query.keywords && query.keywords.length > 0) {
      const lowerKeywords = query.keywords.map(k => k.toLowerCase());
      results = results.filter(entry => {
        const summary = entry.summary.toLowerCase();
        const gist = entry.semantic_gist.toLowerCase();
        return lowerKeywords.some(kw => summary.includes(kw) || gist.includes(kw));
      });
    }

    if (query.timeRange) {
      const timeRange = query.timeRange;
      results = results.filter(entry => {
        return entry.createdAt >= timeRange.start
          && entry.createdAt <= timeRange.end;
      });
    }

    if (query.agentTypes && query.agentTypes.length > 0) {
      const agentTypes = query.agentTypes;
      results = results.filter(entry =>
        agentTypes.includes(entry.source.agentType),
      );
    }

    if (query.metadataFilter) {
      const metadataFilter = query.metadataFilter;
      results = results.filter(entry => {
        return Object.entries(metadataFilter).every(([key, value]) => {
          return (entry.content_blob as Record<string, unknown>)[key] === value;
        });
      });
    }

    if (query.bfsDepth && query.bfsDepth > 0) {
      results = this._bfsExpand(results, query.bfsDepth, query.bfsMaxNodes);
    }

    results.sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return b.createdAt - a.createdAt;
    });

    if (query.limit && query.limit > 0) {
      results = results.slice(0, query.limit);
    }

    if (mode === "CSA") {
      const now = Date.now();
      for (const entry of results) {
        const stored = this._entries.get(entry.id);
        if (stored) {
          stored.accessCount = (stored.accessCount ?? 0) + 1;
          stored.lastAccessedAt = now;
        }
      }
    }

    return results.map(e => structuredClone(e) as MemoryEntry);
  }

  getLinks(sourceId: string): MemoryLink[] {
    this._ensureInitialized();
    return structuredClone(this._links.get(sourceId) ?? []) as MemoryLink[];
  }

  getBySession(sessionId: string): MemoryEntry[] {
    this._ensureInitialized();
    const results: MemoryEntry[] = [];
    for (const entry of this._entries.values()) {
      if (entry.sessionId === sessionId) {
        results.push(structuredClone(entry) as MemoryEntry);
      }
    }
    return results;
  }

  getPending(): MemoryEntry[] {
    this._ensureInitialized();
    const results: MemoryEntry[] = [];
    for (const [id, pending] of this._pendingEntries) {
      results.push(this._buildPendingEntry(id, pending));
    }
    return results;
  }

  hasPending(): boolean {
    this._ensureInitialized();
    return this._pendingEntries.size > 0;
  }

  async init(dbPath: string): Promise<void> {
    if (this._isInitialized) return;

    this._basePath = path.resolve(dbPath);
    this._entriesDir = path.join(this._basePath, "entries");
    this._indexPath = path.join(this._basePath, INDEX_FILE_NAME);
    this._linksPath = path.join(this._basePath, LINKS_FILE_NAME);

    // 创建目录
    try {
      await fs.mkdir(this._entriesDir, { recursive: true });
    } catch (error) {
      throw new PersistenceError(
        `Failed to create storage directory: ${this._entriesDir}`,
        error instanceof Error ? error : undefined,
      );
    }

    // 加载现有数据
    await this._loadFromDisk();

    this._isInitialized = true;
  }

  beginSession(externalId?: string): string {
    this._ensureInitialized();
    this._sessionId = externalId ?? shortId();
    return this._sessionId;
  }

  async endSession(): Promise<number> {
    this._ensureInitialized();
    let affectedCount = 0;

    for (const entry of this._entries.values()) {
      if (entry.sessionId === this._sessionId && entry.semantic_state === "Active") {
        entry.semantic_state = "Archived";
        affectedCount++;
      }
    }

    for (const [id, pending] of this._pendingEntries) {
      if (pending.input.sessionId === this._sessionId) {
        this._pendingEntries.delete(id);
        affectedCount++;
      }
    }

    if (affectedCount > 0) {
      await this._flushIndex();
    }

    this._sessionId = undefined;
    return affectedCount;
  }

  async flush(): Promise<void> {
    this._ensureInitialized();
    await this._flushAll();
  }

  async close(): Promise<void> {
    if (this._isInitialized) {
      await this._flushAll();
    }
    this._entries.clear();
    this._links.clear();
    this._pendingEntries.clear();
    this._transactions.clear();
    this._isInitialized = false;
    this._sessionId = undefined;
  }

  // ── TransactionalMemoryStore 实现 ───────────

  async write(input: MemoryWriteInput): Promise<string> {
    this._ensureInitialized();
    this._validateWriteInput(input);

    const finalInput = this._applyPreWriteHook(input);
    const id = generateId();
    const now = Date.now();

    const entry: MemoryEntry = {
      id,
      source: finalInput.source,
      sessionId: finalInput.sessionId ?? this._sessionId,
      kind: finalInput.kind,
      summary: finalInput.summary,
      semantic_gist: finalInput.semantic_gist,
      content_blob: finalInput.content_blob as Record<string, unknown>,
      semantic_state: "Active",
      weight: finalInput.weight ?? 1.0,
      accessCount: 0,
      lastAccessedAt: now,
      createdAt: finalInput.createdAt ?? now,
      content_hash: finalInput.content_hash ?? "",
      embedding: finalInput.embedding,
      expires_at: finalInput.expires_at,
    };

    this._entries.set(id, entry);

    // 持久化
    await this._persistEntry(entry);
    if (this._options.autoFlush !== false) {
      await this._flushIndex();
    }

    return id;
  }

  async set(id: string, entry: MemoryEntry): Promise<void> {
    this._ensureInitialized();
    this._entries.set(id, { ...entry });
    await this._persistEntry(entry);
    if (this._options.autoFlush !== false) {
      await this._flushIndex();
    }
  }

  async delete(id: string): Promise<boolean> {
    this._ensureInitialized();
    if (!this._entries.has(id)) {
      return false;
    }

    this._entries.delete(id);
    this._links.delete(id);

    // 清理其他链路中的引用
    for (const [, links] of this._links) {
      const filtered = links.filter(l => l.targetId !== id && l.sourceId !== id);
      links.length = 0;
      links.push(...filtered);
    }

    // 删除文件
    try {
      await fs.unlink(path.join(this._entriesDir, `${id}.json`));
    } catch {
      // 文件可能不存在，忽略
    }

    if (this._options.autoFlush !== false) {
      await this._flushIndex();
      await this._flushLinks();
    }

    return true;
  }

  async writeMany(inputs: MemoryWriteInput[]): Promise<string[]> {
    this._ensureInitialized();
    const ids: string[] = [];
    for (const input of inputs) {
      const id = await this.write(input);
      ids.push(id);
    }
    return ids;
  }

  linkMany(links: Array<{
    sourceId: string;
    targetId: string;
    linkType: LinkType;
    weight?: number;
  }>): (MemoryLink | null)[] {
    this._ensureInitialized();
    return links.map(l => this.link(l.sourceId, l.targetId, l.linkType, l.weight));
  }

  cas(id: string, expected: SemanticState, newState: SemanticState): boolean {
    this._ensureInitialized();
    const entry = this._entries.get(id);
    if (!entry) return false;
    if (entry.semantic_state !== expected) return false;
    entry.semantic_state = newState;
    return true;
  }

  archive(id: string): boolean {
    this._ensureInitialized();
    const entry = this._entries.get(id);
    if (!entry) return false;
    if (entry.semantic_state !== "Active") return false;
    entry.semantic_state = "Archived";
    return true;
  }

  obliterate(id: string): boolean {
    this._ensureInitialized();
    const entry = this._entries.get(id);
    if (!entry) return false;
    entry.semantic_state = "Obliterated";
    return true;
  }

  writePending(input: MemoryWriteInput): string {
    this._ensureInitialized();
    this._validateWriteInput(input);

    const id = `${DEFAULT_PENDING_ID_PREFIX}${generateId()}`;
    const now = Date.now();

    this._pendingEntries.set(id, {
      input: { ...input },
      createdAt: now,
    });

    return id;
  }

  commitMemory(memoryId: string): boolean {
    this._ensureInitialized();
    const pending = this._pendingEntries.get(memoryId);
    if (!pending) return false;

    const now = Date.now();
    const entry: MemoryEntry = {
      id: memoryId,
      source: pending.input.source,
      sessionId: pending.input.sessionId ?? this._sessionId,
      kind: pending.input.kind,
      summary: pending.input.summary,
      semantic_gist: pending.input.semantic_gist,
      content_blob: pending.input.content_blob as Record<string, unknown>,
      semantic_state: "Active",
      weight: pending.input.weight ?? 1.0,
      accessCount: 0,
      lastAccessedAt: now,
      createdAt: pending.input.createdAt ?? now,
      content_hash: pending.input.content_hash ?? "",
      embedding: pending.input.embedding,
      expires_at: pending.input.expires_at,
    };

    this._entries.set(memoryId, entry);
    this._pendingEntries.delete(memoryId);
    return true;
  }

  /**
   * rollback —— 重载方法，支持 2PC 和事务两种调用签名。
   *
   * 统一返回 Promise 以避免 esbuild 转换时的方法重载冲突。
   */
  // ── 重载签名 ──
  rollback(memoryId: string): Promise<boolean>;
  rollback(txn: TransactionContext): Promise<TransactionResult<void>>;
  // ── 实现 ──
  async rollback(memoryIdOrTxn: string | TransactionContext): Promise<boolean | TransactionResult<void>> {
    if (typeof memoryIdOrTxn === "string") {
      return this._rollbackPendingEntry(memoryIdOrTxn);
    }
    return await this._rollbackTransaction(memoryIdOrTxn);
  }

  private _rollbackPendingEntry(memoryId: string): boolean {
    this._ensureInitialized();
    if (!this._pendingEntries.has(memoryId)) return false;
    this._pendingEntries.delete(memoryId);
    return true;
  }

  link(sourceId: string, targetId: string, linkType: LinkType, weight?: number): MemoryLink | null {
    this._ensureInitialized();

    if (!this._entries.has(sourceId) || !this._entries.has(targetId)) {
      return null;
    }

    const targetEntry = this._entries.get(targetId);
    if (!targetEntry) return null;

    const link: MemoryLink = {
      id: generateId(),
      sourceId,
      targetId,
      linkType,
      weight: weight ?? 1.0,
      targetState: targetEntry.semantic_state,
      lastAccessedAt: Date.now(),
    };

    const existing = this._links.get(sourceId) ?? [];
    existing.push(link);
    this._links.set(sourceId, existing);

    return structuredClone(link) as MemoryLink;
  }

  // ── 事务操作 ──

  async beginTransaction(isolation: TransactionIsolation = "ReadCommitted", metadata?: Record<string, unknown>): Promise<TransactionContext> {
    this._ensureInitialized();

    const id = `txn_${shortId()}`;
    const now = Date.now();

    const txn: InternalTransaction = {
      id,
      isolation,
      status: "active",
      startedAt: now,
      timeoutAt: now + this._transactionTimeoutMs,
      pendingWrites: [],
      pendingLinks: [],
      metadata,
    };

    this._transactions.set(id, txn);
    return this._buildTransactionContext(txn);
  }

  async writeWithin(txn: TransactionContext, input: MemoryWriteInput): Promise<string> {
    this._ensureInitialized();
    this._validateTransactionActive(txn);
    this._validateWriteInput(input);

    const internal = this._transactions.get(txn.id);
    if (!internal) {
      throw new TransactionError("Transaction not found", txn.id);
    }

    internal.pendingWrites.push({ ...input });
    return `pending_${internal.pendingWrites.length - 1}_${shortId()}`;
  }

  async writeManyWithin(txn: TransactionContext, inputs: MemoryWriteInput[]): Promise<string[]> {
    this._ensureInitialized();
    this._validateTransactionActive(txn);

    const ids: string[] = [];
    for (const input of inputs) {
      const id = await this.writeWithin(txn, input);
      ids.push(id);
    }
    return ids;
  }

  async linkWithin(txn: TransactionContext, sourceId: string, targetId: string, linkType: LinkType, weight?: number): Promise<MemoryLink | null> {
    this._ensureInitialized();
    this._validateTransactionActive(txn);

    const internal = this._transactions.get(txn.id);
    if (!internal) {
      throw new TransactionError("Transaction not found", txn.id);
    }

    internal.pendingLinks.push({
      action: "link",
      sourceId,
      targetId,
      linkType,
      weight,
    });

    return {
      id: `pending_link_${internal.pendingLinks.length - 1}`,
      sourceId,
      targetId,
      linkType,
      weight: weight ?? 1.0,
      targetState: "Active",
      lastAccessedAt: Date.now(),
    };
  }

  async linkManyWithin(txn: TransactionContext, links: Array<{
    sourceId: string;
    targetId: string;
    linkType: LinkType;
    weight?: number;
  }>): Promise<(MemoryLink | null)[]> {
    this._ensureInitialized();
    this._validateTransactionActive(txn);

    const results: (MemoryLink | null)[] = [];
    for (const link of links) {
      const result = await this.linkWithin(txn, link.sourceId, link.targetId, link.linkType, link.weight);
      results.push(result);
    }
    return results;
  }

  async readWithin(txn: TransactionContext, query: MemoryQuery, mode?: ReadMode): Promise<MemoryEntry[]> {
    this._ensureInitialized();
    this._validateTransactionActive(txn);
    return await this.read(query, mode);
  }

  async commit(txn: TransactionContext): Promise<TransactionResult<string[]>> {
    this._ensureInitialized();

    const internal = this._transactions.get(txn.id);
    if (!internal) {
      throw new TransactionError("Transaction not found", txn.id);
    }

    if (internal.status !== "active") {
      throw new TransactionError(
        `Transaction is already ${internal.status}, cannot commit`,
        txn.id,
      );
    }

    try {
      const committedIds: string[] = [];
      for (const writeInput of internal.pendingWrites) {
        const id = await this.write(writeInput);
        committedIds.push(id);
      }

      for (const linkOp of internal.pendingLinks) {
        if (linkOp.action === "link") {
          this.link(linkOp.sourceId, linkOp.targetId, linkOp.linkType, linkOp.weight);
        }
      }

      // 持久化链路变更
      if (internal.pendingLinks.length > 0) {
        await this._flushLinks();
      }

      internal.status = "committed";
      this._transactions.delete(internal.id);

      return {
        success: true,
        data: committedIds,
        affectedCount: committedIds.length + internal.pendingLinks.length,
      };
    } catch (error) {
      internal.status = "error";
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        affectedCount: 0,
      };
    }
  }

  private async _rollbackTransaction(txn: TransactionContext): Promise<TransactionResult<void>> {
    this._ensureInitialized();

    const internal = this._transactions.get(txn.id);
    if (!internal) {
      throw new TransactionError("Transaction not found", txn.id);
    }

    if (internal.status !== "active" && internal.status !== "error") {
      throw new TransactionError(
        `Transaction is already ${internal.status}, cannot rollback`,
        txn.id,
      );
    }

    internal.pendingWrites.length = 0;
    internal.pendingLinks.length = 0;
    internal.status = "rolledback";
    this._transactions.delete(internal.id);

    return {
      success: true,
      affectedCount: 0,
    };
  }

  getActiveTransactions(): TransactionContext[] {
    this._ensureInitialized();
    this._purgeExpiredTransactions();
    return Array.from(this._transactions.values())
      .filter(t => t.status === "active")
      .map(t => this._buildTransactionContext(t));
  }

  setTransactionTimeout(ms: number): void {
    this._transactionTimeoutMs = ms;
  }

  setPreWriteHook(hook: (input: MemoryWriteInput) => MemoryWriteInput): void {
    this._preWriteHook = hook;
  }

  // ── 内部方法 ──

  /**
   * 校验存储是否已初始化。
   */
  private _ensureInitialized(): void {
    if (!this._isInitialized) {
      throw new MemoryStoreError(
        MemoryStoreErrorCode.StoreNotInitialized,
        "FileBasedMemoryStore is not initialized. Call init() first.",
      );
    }
  }

  /**
   * 校验写入输入的有效性。
   */
  private _validateWriteInput(input: MemoryWriteInput): void {
    const invalidFields: string[] = [];

    if (!input.source) {
      invalidFields.push("source");
    }
    if (!input.kind) {
      invalidFields.push("kind");
    }
    if (!input.summary || input.summary.trim().length === 0) {
      invalidFields.push("summary");
    }
    if (!input.semantic_gist || input.semantic_gist.trim().length === 0) {
      invalidFields.push("semantic_gist");
    }
    if (!input.content_blob || typeof input.content_blob !== "object") {
      invalidFields.push("content_blob");
    }

    if (invalidFields.length > 0) {
      throw new MemoryValidationError(invalidFields);
    }
  }

  /**
   * 校验事务处于活跃状态。
   */
  private _validateTransactionActive(txn: TransactionContext): void {
    const internal = this._transactions.get(txn.id);
    if (!internal) {
      throw new TransactionError("Transaction not found or already completed", txn.id);
    }

    if (internal.status !== "active") {
      throw new TransactionError(
        `Transaction is ${internal.status}, expected active`,
        txn.id,
      );
    }

    if (Date.now() > internal.timeoutAt) {
      internal.status = "error";
      this._transactions.delete(internal.id);
      throw new TransactionError("Transaction timed out", txn.id);
    }
  }

  /**
   * 清理已过期的事务。
   */
  private _purgeExpiredTransactions(): void {
    const now = Date.now();
    for (const [id, txn] of this._transactions) {
      if (now > txn.timeoutAt && txn.status === "active") {
        txn.status = "rolledback";
        this._transactions.delete(id);
      }
    }
  }

  /**
   * 从磁盘加载数据。
   */
  private async _loadFromDisk(): Promise<void> {
    // 加载索引
    try {
      const indexData = await fs.readFile(this._indexPath, "utf-8");
      const index: IndexFile = JSON.parse(indexData);

      // 加载每条记忆
      for (const entryId of Object.keys(index.entries)) {
        const entryPath = path.join(this._entriesDir, `${entryId}.json`);
        try {
          const entryData = await fs.readFile(entryPath, "utf-8");
          const deserialized: SerializedMemoryEntry = JSON.parse(entryData);
          const entry = this._deserializeEntry(deserialized);
          this._entries.set(entry.id, entry);
        } catch {
          // 文件损坏或丢失，跳过
        }
      }
    } catch {
      // 索引文件不存在，空存储
    }

    // 加载链路
    try {
      const linksData = await fs.readFile(this._linksPath, "utf-8");
      const linksFile: LinksFile = JSON.parse(linksData);
      for (const [sourceId, serializedLinks] of Object.entries(linksFile.links)) {
        const links: MemoryLink[] = serializedLinks.map(l => ({
          ...l,
          linkType: l.linkType as LinkType,
        }));
        this._links.set(sourceId, links);
      }
    } catch {
      // 链路文件不存在
    }
  }

  /**
   * 持久化单条记忆到文件。
   */
  private async _persistEntry(entry: MemoryEntry): Promise<void> {
    const serialized: SerializedMemoryEntry = {
      ...entry,
      content_blob: entry.content_blob as Record<string, unknown>,
    };
    const filePath = path.join(this._entriesDir, `${entry.id}.json`);
    const json = JSON.stringify(serialized, null, this._options.prettyPrint ? 2 : undefined);
    await fs.writeFile(filePath, json, "utf-8");
  }

  /**
   * 刷写索引文件。
   */
  private async _flushIndex(): Promise<void> {
    const index: IndexFile = {
      version: STORAGE_VERSION,
      updatedAt: Date.now(),
      entries: {},
    };

    for (const [id, entry] of this._entries) {
      index.entries[id] = {
        id,
        kind: entry.kind,
        summary: entry.summary,
        semantic_state: entry.semantic_state,
        createdAt: entry.createdAt,
        weight: entry.weight,
      };
    }

    const json = JSON.stringify(index, null, this._options.prettyPrint ? 2 : undefined);
    await fs.writeFile(this._indexPath, json, "utf-8");
  }

  /**
   * 刷写链路文件。
   */
  private async _flushLinks(): Promise<void> {
    const linksFile: LinksFile = {
      version: STORAGE_VERSION,
      updatedAt: Date.now(),
      links: {},
    };

    for (const [sourceId, links] of this._links) {
      linksFile.links[sourceId] = links.map(l => ({
        ...l,
        linkType: l.linkType,
      }));
    }

    const json = JSON.stringify(linksFile, null, this._options.prettyPrint ? 2 : undefined);
    await fs.writeFile(this._linksPath, json, "utf-8");
  }

  /**
   * 全量刷写所有数据到磁盘。
   */
  private async _flushAll(): Promise<void> {
    // 持久化所有记忆条目
    for (const entry of this._entries.values()) {
      await this._persistEntry(entry);
    }

    await this._flushIndex();
    await this._flushLinks();
  }

  /**
   * 反序列化记忆条目。
   */
  private _deserializeEntry(serialized: SerializedMemoryEntry): MemoryEntry {
    const { content_blob, ...rest } = serialized;
    return {
      ...rest,
      content_blob: content_blob as unknown as Record<string, unknown>,
    };
  }

  /**
   * 从 PendingEntry 构建 MemoryEntry。
   */
  private _buildPendingEntry(id: string, pending: PendingEntry): MemoryEntry {
    return {
      id,
      source: pending.input.source,
      sessionId: pending.input.sessionId,
      kind: pending.input.kind,
      summary: pending.input.summary,
      semantic_gist: pending.input.semantic_gist,
      content_blob: pending.input.content_blob as Record<string, unknown>,
      semantic_state: "Active",
      weight: pending.input.weight ?? 1.0,
      accessCount: 0,
      lastAccessedAt: pending.createdAt,
      createdAt: pending.input.createdAt ?? pending.createdAt,
      content_hash: pending.input.content_hash ?? "",
      embedding: pending.input.embedding,
      expires_at: pending.input.expires_at,
      _pending: true,
    };
  }

  /**
   * 应用前置写入钩子。
   */
  private _applyPreWriteHook(input: MemoryWriteInput): MemoryWriteInput {
    if (this._preWriteHook) {
      return this._preWriteHook(input);
    }
    return input;
  }

  /**
   * 从内部事务记录构建 TransactionContext。
   */
  private _buildTransactionContext(internal: InternalTransaction): TransactionContext {
    return {
      id: internal.id,
      status: internal.status === "error" ? "rolledback" : internal.status,
      startedAt: internal.startedAt,
      isolation: internal.isolation,
      timeoutAt: internal.timeoutAt,
      pendingWrites: [...internal.pendingWrites],
      pendingLinks: [...internal.pendingLinks],
      metadata: internal.metadata ? { ...internal.metadata } : undefined,
    };
  }

  /**
   * BFS 图展开。
   */
  private _bfsExpand(entries: MemoryEntry[], depth: number, maxNodes?: number): MemoryEntry[] {
    const visited = new Set<string>(entries.map(e => e.id));
    const result = [...entries];
    let queue = entries.map(e => e.id);

    for (let d = 0; d < depth && queue.length > 0; d++) {
      const nextQueue: string[] = [];

      for (const sourceId of queue) {
        const links = this._links.get(sourceId) ?? [];
        for (const link of links) {
          if (!visited.has(link.targetId)) {
            visited.add(link.targetId);
            const target = this._entries.get(link.targetId);
            if (target) {
              result.push(target);
              nextQueue.push(link.targetId);
            }
          }
        }

        if (maxNodes && result.length >= maxNodes) {
          return result.slice(0, maxNodes);
        }
      }

      queue = nextQueue;
    }

    return result;
  }
}

// ── 公开类型 ──────────────────────────────────

/**
 * FileBasedMemoryStore 配置选项。
 */
export interface FileBasedMemoryStoreOptions {
  /** 是否自动刷写到磁盘（默认 true） */
  autoFlush?: boolean;
  /** JSON 文件是否使用 pretty print（默认 false） */
  prettyPrint?: boolean;
}

/**
 * 内部 Pending 条目记录。
 */
interface PendingEntry {
  input: MemoryWriteInput;
  createdAt: number;
}

/**
 * 内部事务记录。
 */
interface InternalTransaction {
  id: string;
  isolation: TransactionIsolation;
  status: "active" | "committed" | "rolledback" | "error";
  startedAt: number;
  timeoutAt: number;
  pendingWrites: MemoryWriteInput[];
  pendingLinks: TransactionLinkOp[];
  metadata?: Record<string, unknown>;
}
