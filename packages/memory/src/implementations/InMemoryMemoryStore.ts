// ============================================================
// @cortex/memory — InMemoryMemoryStore 纯内存实现
//
// 基于 Map<string, MemoryEntry> 的纯内存 MemoryStore 实现。
// 适用于测试、临时会话和无需持久化的场景。
//
// @design 特性
//   - 所有数据存储在 Map 中，无外部依赖
//   - 支持事务（基于操作日志的快照机制）
//   - 支持两阶段提交（Pending → Active / Obliterated）
//   - 支持关联链路管理
//   - 线程安全说明：Node.js 单线程模型下 Map 操作是安全的
//
// @extends TransactionalMemoryStore 同时实现 IMemoryStore 和事务接口
// ============================================================

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
} from "../errors/MemoryStoreError.js";
import { generateId, shortId } from "../_utils.js";

// ── 工具函数 ──────────────────────────────────

/** 递归冻结对象及其所有嵌套属性 */
function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      deepFreeze((obj as Record<string, unknown>)[key]);
    }
  }
  return obj;
}

// ── 内部类型 ──────────────────────────────────

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

// ── 默认值常量 ───────────────────────────────

const DEFAULT_TRANSACTION_TIMEOUT_MS = 30_000; // 30 秒
const DEFAULT_PENDING_ID_PREFIX = "pending_";

/**
 * InMemoryMemoryStore —— 基于 Map 的纯内存 MemoryStore 实现。
 *
 * 同时实现 IMemoryStore（只读）和 TransactionalMemoryStore（读写+事务）。
 *
 * @example
 * ```typescript
 * const store = new InMemoryMemoryStore();
 * await store.init(":memory:");
 *
 * // 写入
 * const id = await store.write({
 *   kind: "Insight",
 *   summary: "示例",
 *   semantic_gist: "示例语义精华",
 *   source: { agentType: "Alhaitham", taskId: "task-001" },
 *   content_blob: { key: "value" },
 * });
 *
 * // 读取
 * const entry = await store.get(id);
 * ```
 */
export class InMemoryMemoryStore implements IMemoryStore, TransactionalMemoryStore {
  // ── 存储后端 ──
  /** 主存储：ID → MemoryEntry */
  private readonly _entries: Map<string, MemoryEntry> = new Map();

  /** 关联链路：sourceId → MemoryLink[] */
  private readonly _links: Map<string, MemoryLink[]> = new Map();

  /** Pending 条目：ID → PendingEntry */
  private readonly _pendingEntries: Map<string, PendingEntry> = new Map();

  // ── 事务 ──
  /** 活动事务：transactionId → InternalTransaction */
  private readonly _transactions: Map<string, InternalTransaction> = new Map();

  /** 事务超时毫秒数 */
  private _transactionTimeoutMs: number = DEFAULT_TRANSACTION_TIMEOUT_MS;

  // ── 会话 ──
  /** 当前会话 ID */
  private _sessionId: string | undefined;

  /** 前置写入钩子 */
  private _preWriteHook: ((input: MemoryWriteInput) => MemoryWriteInput) | undefined;

  // ── 状态 ──
  private _isInitialized = false;

  // ── IMemoryStore 实现 ──────────────────────

  get isReady(): boolean {
    return this._isInitialized;
  }

  get size(): number {
    return this._entries.size;
  }

  get isPersisted(): boolean {
    return false;
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    this._ensureInitialized();
    const entry = this._entries.get(id);
    if (!entry) return undefined;

    // 返回不可变快照
    return structuredClone(entry) as MemoryEntry;
  }

  peek(id: string): Readonly<MemoryEntry> | undefined {
    this._ensureInitialized();
    const entry = this._entries.get(id);
    if (!entry) return undefined;
    // 返回深冻结快照——防止外部意外修改导致 CAS 竞态
    return deepFreeze(structuredClone(entry)) as Readonly<MemoryEntry>;
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

    // 按类别过滤
    if (query.kind) {
      results = results.filter(e => e.kind === query.kind);
    }

    // 按关键词过滤
    if (query.keywords && query.keywords.length > 0) {
      const lowerKeywords = query.keywords.map(k => k.toLowerCase());
      results = results.filter(entry => {
        const summary = entry.summary.toLowerCase();
        const gist = entry.semantic_gist.toLowerCase();
        return lowerKeywords.some(kw => summary.includes(kw) || gist.includes(kw));
      });
    }

    // 按时间范围过滤
    if (query.timeRange) {
      const timeRange = query.timeRange;
      results = results.filter(entry => {
        return entry.createdAt >= timeRange.start
          && entry.createdAt <= timeRange.end;
      });
    }

    // 按 agentTypes 过滤
    if (query.agentTypes && query.agentTypes.length > 0) {
      const agentTypes = query.agentTypes;
      results = results.filter(entry =>
        agentTypes.includes(entry.source.agentType),
      );
    }

    // 按 metadata 过滤
    if (query.metadataFilter) {
      const metadataFilter = query.metadataFilter;
      results = results.filter(entry => {
        return Object.entries(metadataFilter).every(([key, value]) => {
          return (entry.content_blob as Record<string, unknown>)[key] === value;
        });
      });
    }

    // BFS 图展开
    if (query.bfsDepth && query.bfsDepth > 0) {
      results = this._bfsExpand(results, query.bfsDepth, query.bfsMaxNodes);
    }

    // 排序：按权重降序，权重相同时按创建时间降序
    results.sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return b.createdAt - a.createdAt;
    });

    // 限制数量
    if (query.limit && query.limit > 0) {
      results = results.slice(0, query.limit);
    }

    // CSA 模式追踪访问热度
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
      const entry = this._buildPendingEntry(id, pending);
      results.push(entry);
    }
    return results;
  }

  hasPending(): boolean {
    this._ensureInitialized();
    return this._pendingEntries.size > 0;
  }

  async init(_dbPath: string): Promise<void> {
    if (this._isInitialized) {
      return;
    }
    // 纯内存实现忽略 dbPath
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

    // 归档当前会话的 Active 记忆
    for (const entry of this._entries.values()) {
      if (entry.sessionId === this._sessionId && entry.semantic_state === "Active") {
        entry.semantic_state = "Archived";
        affectedCount++;
      }
    }

    // 湮灭当前会话的 Pending 记忆
    for (const [id, pending] of this._pendingEntries) {
      if (pending.input.sessionId === this._sessionId) {
        this._pendingEntries.delete(id);
        affectedCount++;
      }
    }

    this._sessionId = undefined;
    return affectedCount;
  }

  async flush(): Promise<void> {
    // 纯内存实现无需刷写
    this._ensureInitialized();
  }

  async close(): Promise<void> {
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
    return id;
  }

  async set(id: string, entry: MemoryEntry): Promise<void> {
    this._ensureInitialized();
    this._entries.set(id, { ...entry });
  }

  async delete(id: string): Promise<boolean> {
    this._ensureInitialized();
    if (!this._entries.has(id)) {
      return false;
    }
    this._entries.delete(id);

    // 同时清理相关链路
    this._links.delete(id);
    for (const [, links] of this._links) {
      const filtered = links.filter(l => l.targetId !== id && l.sourceId !== id);
      if (filtered.length !== links.length) {
        // 由于是引用类型，直接修改数组
        links.length = 0;
        links.push(...filtered);
      }
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
    // Obliterated 是终态——不允许 CAS 转移出此状态
    if (entry.semantic_state === "Obliterated") return false;
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
   * 由于 TypeScript 不支持两个同名不同参数的方法共存于运行时，
   * 因此在运行时根据参数类型分发到内部实现。
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

    // 检查源和目标是否存在
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

    // 返回占位 ID（commit 时生成真实 ID）
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

    // 事务内返回占位
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

    // 事务内读取与普通读取相同（ReadCommitted 级别）
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
      // 批量写入所有挂起的记忆
      const committedIds: string[] = [];
      for (const writeInput of internal.pendingWrites) {
        const id = await this.write(writeInput);
        committedIds.push(id);
      }

      // 批量写入所有挂起的关联
      for (const linkOp of internal.pendingLinks) {
        if (linkOp.action === "link") {
          this.link(linkOp.sourceId, linkOp.targetId, linkOp.linkType, linkOp.weight);
        }
        // unlink 操作在内存模型中暂为 noop
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

    // 清理挂起数据
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

    // 清理超时事务
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
        "Memory store is not initialized. Call init() first.",
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

    // 检查超时
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
   * 从 PendingEntry 构建 MemoryEntry（用于 getPending）。
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
   * 从内部事务记录构建公开的 TransactionContext。
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
