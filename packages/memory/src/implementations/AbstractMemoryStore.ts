// ============================================================
// @cortex/memory — AbstractMemoryStore
//
// 记忆存储的抽象基类，同时实现 IMemoryStore（只读）和
// TransactionalMemoryStore（事务写入）两个接口。
//
// 所有具体后端（InMemory、FileBased 等）均继承此类，
// 仅需实现 MemoryStoreBackend 接口即可完成持久化策略注入。
//
// @design 分层架构
//   1. AbstractMemoryStore：共享逻辑（~400 行）
//   2. MemoryStoreBackend：持久化策略接口
//   3. 具体子类：注入后端 + 可选覆写
//
// @sections
//   - Constants & Interfaces
//   - MemoryStoreBackend
//   - AbstractMemoryStore
//     - Fields & Constructor
//     - Internal Loading Methods
//     - Getters
//     - Read Operations
//     - Lifecycle
//     - Write Operations
//     - State Transitions
//     - Pending Operations
//     - Link Operations
//     - Transaction Operations
//     - Private Helpers
// ============================================================

import type { MemoryEntry, MemoryWriteInput, MemoryQuery, MemoryLink, SemanticState, LinkType, ReadMode } from "@cortex/shared";
import type { IMemoryStore } from "../interfaces/MemoryStore.js";
import type { TransactionalMemoryStore, TransactionContext, TransactionIsolation, TransactionResult, TransactionLinkOp } from "../interfaces/TransactionalMemoryStore.js";
import { MemoryStoreError, MemoryStoreErrorCode, MemoryValidationError, TransactionError } from "../errors/MemoryStoreError.js";
import { generateId, shortId } from "../_utils.js";

// ══════════════════════════════════════════════════════════════
// Constants & Interfaces
// ══════════════════════════════════════════════════════════════

/** Default transaction timeout in milliseconds (30 seconds). */
const TMO = 30_000;

/**
 * PendingEntry — 两阶段提交中处于 Pending 状态的记忆条目内部记录。
 *
 * 在 writePending() 时创建，commitMemory() 时转为 MemoryEntry，
 * rollback/cancel 时从 _pendingEntries 中移除。
 */
interface PendingEntry {
  /** 用户提交的原始写入输入 */
  input: MemoryWriteInput;
  /** Pending 条目创建时间戳（Unix 毫秒） */
  createdAt: number;
}

/**
 * InternalTransaction — 事务的内部状态记录。
 *
 * 存储于 _transactions Map 中，在 beginTransaction 时创建，
 * commit/rollback 时删除。包含事务的所有挂起操作日志。
 */
interface InternalTransaction {
  /** 全局唯一事务 ID（格式：txn_<shortId>） */
  id: string;
  /** 事务隔离级别 */
  isolation: TransactionIsolation;
  /** 事务当前状态 */
  status: "active" | "committed" | "rolledback" | "error";
  /** 事务开始时间戳（Unix 毫秒） */
  startedAt: number;
  /** 事务超时时间戳（Unix 毫秒） */
  timeoutAt: number;
  /** 挂起的写入操作列表，commit 时批量执行 */
  pendingWrites: MemoryWriteInput[];
  /** 挂起的关联操作列表，commit 时批量执行 */
  pendingLinks: TransactionLinkOp[];
  /** 用户自定义元数据（如调用链追踪 ID） */
  metadata?: Record<string, unknown>;
}

// ══════════════════════════════════════════════════════════════
// MemoryStoreBackend — 持久化策略接口
// ══════════════════════════════════════════════════════════════

/**
 * MemoryStoreBackend — 存储后端的持久化策略接口。
 *
 * 具体实现（FileBackend 等）通过构造函数注入 AbstractMemoryStore，
 * 负责将内存中的条目和关联同步到持久化介质。
 */
export interface MemoryStoreBackend {
  init(dbPath: string): Promise<void>;
  load(store: AbstractMemoryStore): Promise<void>;
  persist(entry: MemoryEntry): Promise<void>;
  remove(id: string): Promise<void>;
  flushIndex(entries: Map<string, MemoryEntry>): Promise<void>;
  flushLinks(links: Map<string, MemoryLink[]>): Promise<void>;
  flushAll(entries: Map<string, MemoryEntry>, links: Map<string, MemoryLink[]>): Promise<void>;
}

// ══════════════════════════════════════════════════════════════
// AbstractMemoryStore
// ══════════════════════════════════════════════════════════════

/**
 * AbstractMemoryStore — 记忆存储的抽象基类。
 *
 * 实现 IMemoryStore（只读）和 TransactionalMemoryStore（事务写入）
 * 的全部方法，通过构造函数注入 MemoryStoreBackend 实现持久化策略。
 *
 * 具体子类只需提供后端实例，即可得到完整的记忆存储能力。
 */
export abstract class AbstractMemoryStore implements IMemoryStore, TransactionalMemoryStore {

  // ══════════════════════════════════════════════
  // Fields
  // ══════════════════════════════════════════════

  /** 所有记忆条目的主索引（id → MemoryEntry） */
  protected readonly _entries = new Map<string, MemoryEntry>();

  /** 所有关联链路的索引（sourceId → MemoryLink[]） */
  protected readonly _links = new Map<string, MemoryLink[]>();

  /** 两阶段提交中处于 Pending 状态的条目（id → PendingEntry） */
  protected readonly _pendingEntries = new Map<string, PendingEntry>();

  /** 所有事务的内部状态（id → InternalTransaction） */
  protected readonly _transactions = new Map<string, InternalTransaction>();

  /** 事务超时时间（毫秒），默认 30 秒 */
  private _ttmo = TMO;

  /** 当前会话 ID */
  private _sid: string | undefined;

  /** 写入前置钩子函数 */
  private _hook: ((i: MemoryWriteInput) => MemoryWriteInput) | undefined;

  /** 存储是否已初始化 */
  private _init = false;

  // ══════════════════════════════════════════════
  // Constructor
  // ══════════════════════════════════════════════

  constructor(private readonly _be: MemoryStoreBackend) {}

  // ══════════════════════════════════════════════
  // Internal Loading Methods
  // ══════════════════════════════════════════════

  /**
   * 由后端 load() 调用，将反序列化的条目注入内存索引。
   *
   * @param id - 记忆条目 ID
   * @param e - 反序列化后的记忆条目
   */
  _loadEntry(id: string, e: MemoryEntry) {
    this._entries.set(id, e);
  }

  /**
   * 由后端 load() 调用，将反序列化的关联链路注入内存索引。
   *
   * @param sid - 源记忆 ID
   * @param l - 关联链路数组
   */
  _loadLinks(sid: string, l: MemoryLink[]) {
    this._links.set(sid, l);
  }

  // ══════════════════════════════════════════════
  // Getters
  // ══════════════════════════════════════════════

  /** 存储是否已初始化并可用。 */
  get isReady() {
    return this._init;
  }

  /** 当前存储中的记忆条目数量。 */
  get size() {
    return this._entries.size;
  }

  /** 存储是否具有持久化能力（基类默认 false）。 */
  get isPersisted() {
    return false;
  }

  /** 当前运行会话的 ID。 */
  get sessionId() {
    return this._sid;
  }

  // ══════════════════════════════════════════════
  // Read Operations
  // ══════════════════════════════════════════════

  /**
   * 按 ID 获取记忆条目的只读快照（深拷贝）。
   *
   * @param id - 记忆条目的唯一标识
   * @returns 记忆条目的深拷贝副本，若不存在则返回 undefined
   */
  async get(id: string) {
    this._ei();
    const e = this._entries.get(id);
    return e ? structuredClone(e) as MemoryEntry : undefined;
  }

  /**
   * 按 ID 获取记忆条目的内部引用（不创建副本）。
   * 调用方不应修改返回的对象。
   *
   * @param id - 记忆条目的唯一标识
   * @returns 记忆条目的内部引用，若不存在则返回 undefined
   */
  peek(id: string) {
    this._ei();
    return this._entries.get(id);
  }

  /**
   * 检查指定 ID 的记忆条目是否存在。
   *
   * @param id - 记忆条目的唯一标识
   * @returns 是否存在该条目
   */
  has(id: string) {
    this._ei();
    return this._entries.has(id);
  }

  /**
   * 同步获取所有记忆条目的快照数组。
   * 用于维护扫描（maintain）、去重等需要全量遍历的场景。
   *
   * @returns 所有记忆条目的数组
   */
  getAllEntries() {
    this._ei();
    return Array.from(this._entries.values());
  }

  /**
   * 按查询条件检索记忆条目。
   *
   * 支持按 kind、关键词、时间范围、agentType、metadata 过滤，
   * 可选 BFS 图遍历扩展结果集。结果按 weight 降序、createdAt 降序排列。
   *
   * @param q - 检索条件
   * @param m - 检索模式：CSA 模式下会更新 accessCount 和 lastAccessedAt
   * @returns 匹配的记忆条目深拷贝数组
   */
  async read(q: MemoryQuery, m?: ReadMode): Promise<MemoryEntry[]> {
    this._ei();

    let r = Array.from(this._entries.values());

    if (q.kind)
      r = r.filter(e => e.kind === q.kind);

    if (q.keywords?.length) {
      const lk = q.keywords.map(k => k.toLowerCase());
      r = r.filter(e =>
        lk.some(k =>
          e.summary.toLowerCase().includes(k) ||
          e.semantic_gist.toLowerCase().includes(k),
        ),
      );
    }

    if (q.timeRange)
      r = r.filter(e => e.createdAt >= q.timeRange.start && e.createdAt <= q.timeRange.end);

    if (q.agentTypes?.length)
      r = r.filter(e => q.agentTypes.includes(e.source.agentType));

    if (q.metadataFilter)
      r = r.filter(e =>
        Object.entries(q.metadataFilter).every(([k, v]) => (e.content_blob as Record<string, unknown>)[k] === v),
      );

    if (q.bfsDepth && q.bfsDepth > 0)
      r = this._bfs(r, q.bfsDepth, q.bfsMaxNodes);

    r.sort((a, b) => b.weight !== a.weight ? b.weight - a.weight : b.createdAt - a.createdAt);

    if (q.limit && q.limit > 0)
      r = r.slice(0, q.limit);

    if (m === "CSA") {
      const n = Date.now();
      for (const e of r) {
        const s = this._entries.get(e.id);
        if (s) {
          s.accessCount = (s.accessCount ?? 0) + 1;
          s.lastAccessedAt = n;
        }
      }
    }

    return r.map(e => structuredClone(e) as MemoryEntry);
  }

  /**
   * 获取指定源记忆的所有关联链路（深拷贝）。
   *
   * @param sid - 源记忆 ID
   * @returns 关联链路数组的深拷贝
   */
  getLinks(sid: string) {
    this._ei();
    return structuredClone(this._links.get(sid) ?? []) as MemoryLink[];
  }

  /**
   * 按会话 ID 查询该会话的所有记忆条目（深拷贝）。
   *
   * @param sid - 会话标识
   * @returns 该会话的记忆条目数组
   */
  getBySession(sid: string) {
    this._ei();
    const r: MemoryEntry[] = [];
    for (const e of this._entries.values())
      if (e.sessionId === sid)
        r.push(structuredClone(e) as MemoryEntry);
    return r;
  }

  /**
   * 获取所有处于 Pending 状态的记忆条目。
   *
   * @returns Pending 记忆条目数组
   */
  getPending() {
    this._ei();
    const r: MemoryEntry[] = [];
    for (const [id, p] of this._pendingEntries)
      r.push(this._bp(id, p));
    return r;
  }

  /**
   * 检查是否存在 Pending 状态的记忆条目。
   *
   * @returns 是否存在 Pending 条目
   */
  hasPending() {
    this._ei();
    return this._pendingEntries.size > 0;
  }

  // ══════════════════════════════════════════════
  // Lifecycle
  // ══════════════════════════════════════════════

  /**
   * 初始化存储后端。幂等——重复调用不会重新初始化。
   *
   * @param db - 数据库路径或连接字符串
   */
  async init(db: string) {
    if (this._init) return;
    await this._be.init(db);
    await this._be.load(this);
    this._init = true;
  }

  /**
   * 开始新会话。生成或接受外部传入的 sessionId，
   * 后续 write() 调用会自动注入此 sessionId。
   *
   * @param eid - 可选的外部传入 sessionId
   * @returns 当前会话 ID
   */
  beginSession(eid?: string) {
    this._ei();
    this._sid = eid ?? shortId();
    return this._sid;
  }

  /**
   * 终结当前会话。
   * 将该会话的所有 Active 记忆归档为 Archived，
   * 并移除该会话的所有 Pending 条目。
   *
   * @returns 受影响的条目数量
   */
  async endSession() {
    this._ei();
    let c = 0;

    for (const e of this._entries.values()) {
      if (e.sessionId === this._sid && e.semantic_state === "Active") {
        e.semantic_state = "Archived";
        c++;
      }
    }

    for (const [id, p] of this._pendingEntries) {
      if (p.input.sessionId === this._sid) {
        this._pendingEntries.delete(id);
        c++;
      }
    }

    if (c > 0)
      await this._be.flushIndex(this._entries);

    this._sid = undefined;
    return c;
  }

  /**
   * 刷新所有条目和关联到持久化层。
   */
  async flush() {
    this._ei();
    await this._be.flushAll(this._entries, this._links);
  }

  /**
   * 关闭存储后端，释放所有资源。
   * 关闭前会尝试将数据刷入持久化层。
   */
  async close() {
    if (this._init)
      await this._be.flushAll(this._entries, this._links);

    this._entries.clear();
    this._links.clear();
    this._pendingEntries.clear();
    this._transactions.clear();
    this._init = false;
    this._sid = undefined;
  }

  // ══════════════════════════════════════════════
  // Write Operations
  // ══════════════════════════════════════════════

  /**
   * 写入一条新的记忆条目。
   * 自动生成 ID、设置时间戳、注入 sessionId，并通过后端持久化。
   *
   * @param i - 记忆写入输入
   * @returns 新创建的记忆条目 ID
   * @throws {MemoryValidationError} 输入校验失败
   */
  async write(i: MemoryWriteInput): Promise<string> {
    this._ei();
    this._vw(i);

    const f = this._ah(i);
    const id = generateId();
    const n = Date.now();

    const e: MemoryEntry = {
      id,
      source: f.source,
      sessionId: f.sessionId ?? this._sid,
      kind: f.kind,
      summary: f.summary,
      semantic_gist: f.semantic_gist,
      content_blob: f.content_blob as Record<string,unknown>,
      semantic_state: "Active",
      weight: f.weight ?? 1,
      accessCount: 0,
      lastAccessedAt: n,
      createdAt: f.createdAt ?? n,
      content_hash: f.content_hash ?? "",
      embedding: f.embedding,
      expires_at: f.expires_at,
    };

    this._entries.set(id, e);
    await this._be.persist(e);
    return id;
  }

  /**
   * 按 ID 设置/覆盖一条记忆条目（不做校验和钩子处理）。
   *
   * @param id - 记忆条目 ID
   * @param e - 记忆条目数据
   */
  async set(id: string, e: MemoryEntry) {
    this._ei();
    this._entries.set(id, { ...e });
    await this._be.persist(e);
  }

  /**
   * 按 ID 删除一条记忆条目及其所有关联链路。
   *
   * @param id - 记忆条目 ID
   * @returns 是否实际删除了条目
   */
  async delete(id: string) {
    this._ei();

    if (!this._entries.has(id))
      return false;

    this._entries.delete(id);
    this._links.delete(id);

    for (const [, ls] of this._links) {
      const f = ls.filter(l => l.targetId !== id && l.sourceId !== id);
      ls.length = 0;
      ls.push(...f);
    }

    await this._be.remove(id);
    return true;
  }

  /**
   * 批量写入多条记忆。
   * 无事务语义——部分成功时返回成功的 ID 列表。
   *
   * @param is - 记忆写入输入数组
   * @returns 成功写入的记忆 ID 列表
   */
  async writeMany(is: MemoryWriteInput[]) {
    this._ei();
    const ids: string[] = [];
    for (const i of is)
      ids.push(await this.write(i));
    return ids;
  }

  /**
   * 批量建立关联。
   *
   * @param ls - 关联操作数组
   * @returns 创建的 MemoryLink 数组（失败项为 null）
   */
  linkMany(ls: Array<{ sourceId: string; targetId: string; linkType: LinkType; weight?: number }>) {
    this._ei();
    return ls.map(l => this.link(l.sourceId, l.targetId, l.linkType, l.weight));
  }

  // ══════════════════════════════════════════════
  // State Transitions
  // ══════════════════════════════════════════════

  /**
   * 比较并交换（CAS）语义状态。
   * 仅当条目当前状态等于 expected 时才更新为 newState。
   *
   * @param id - 记忆条目 ID
   * @param e - 期望的当前状态
   * @param n - 目标新状态
   * @returns 是否成功更新
   */
  cas(id: string, e: SemanticState, n: SemanticState) {
    this._ei();
    const x = this._entries.get(id);
    if (!x || x.semantic_state === "Obliterated" || x.semantic_state !== e)
      return false;
    // 状态转换白名单校验（与 memory-store 的 VALID_TRANSITIONS 保持一致）
    const valid: Record<string, Set<string>> = {
      Pending: new Set(["Active", "Obliterated"]),
      Active: new Set(["Archived", "Obliterated", "Active"]),
      Archived: new Set(["Obliterated", "Archived"]),
      Obliterated: new Set(),
    };
    if (!valid[e]?.has(n)) return false;
    x.semantic_state = n;
    return true;
  }

  /**
   * 归档指定记忆条目（Active → Archived）。
   *
   * @param id - 记忆条目 ID
   * @returns 是否成功归档
   */
  archive(id: string) {
    this._ei();
    const e = this._entries.get(id);
    if (e?.semantic_state !== "Active")
      return false;
    e.semantic_state = "Archived";
    return true;
  }

  /**
   * 湮灭指定记忆条目（任意状态 → Obliterated）。
   *
   * @param id - 记忆条目 ID
   * @returns 是否成功湮灭
   */
  obliterate(id: string) {
    this._ei();
    const e = this._entries.get(id);
    if (!e) return false;
    e.semantic_state = "Obliterated";
    return true;
  }

  // ══════════════════════════════════════════════
  // Pending Operations (Two-Phase Commit)
  // ══════════════════════════════════════════════

  /**
   * 写入一条 Pending 状态的记忆（两阶段提交第一阶段）。
   * 条目不会立即对 read() 可见，需 commitMemory() 后激活。
   *
   * @param i - 记忆写入输入
   * @returns Pending 条目 ID（格式：pending_<generatedId>）
   * @throws {MemoryValidationError} 输入校验失败
   */
  writePending(i: MemoryWriteInput) {
    this._ei();
    this._vw(i);

    const id = "pending_" + generateId();
    this._pendingEntries.set(id, { input: { ...i }, createdAt: Date.now() });
    return id;
  }

  /**
   * 提交一条 Pending 记忆，将其转为 Active 状态的 MemoryEntry。
   *
   * @param mid - Pending 记忆条目 ID
   * @returns 是否成功提交（条目不存在时返回 false）
   */
  commitMemory(mid: string) {
    this._ei();

    const p = this._pendingEntries.get(mid);
    if (!p) return false;

    const n = Date.now();
    const e: MemoryEntry = {
      id: mid,
      source: p.input.source,
      sessionId: p.input.sessionId ?? this._sid,
      kind: p.input.kind,
      summary: p.input.summary,
      semantic_gist: p.input.semantic_gist,
      content_blob: p.input.content_blob as Record<string, unknown>,
      semantic_state: "Active",
      weight: p.input.weight ?? 1,
      accessCount: 0,
      lastAccessedAt: n,
      createdAt: p.input.createdAt ?? n,
      content_hash: p.input.content_hash ?? "",
      embedding: p.input.embedding,
      expires_at: p.input.expires_at,
    };

    this._entries.set(mid, e);
    this._pendingEntries.delete(mid);
    return true;
  }

  /**
   * 回滚操作（重载）。
   * - 传入 string：回滚一条 Pending 记忆
   * - 传入 TransactionContext：回滚一个事务
   */
  rollback(mid: string): Promise<boolean>;
  rollback(t: TransactionContext): Promise<TransactionResult<void>>;
  async rollback(mt: string | TransactionContext): Promise<boolean | TransactionResult<void>> {
    if (typeof mt === "string")
      return this._rp(mt);
    return await this._rt(mt);
  }

  /**
   * 回滚一条 Pending 记忆（从 _pendingEntries 中移除）。
   *
   * @param mid - Pending 记忆条目 ID
   * @returns 是否成功回滚
   */
  private _rp(mid: string) {
    this._ei();
    if (!this._pendingEntries.has(mid))
      return false;
    this._pendingEntries.delete(mid);
    return true;
  }

  /**
   * 统一取消一条记忆——自动判断状态。
   * - Pending 态：从 _pendingEntries 移除
   * - Active 态：归档为 Archived
   * - 其他/不存在：返回 false
   *
   * @param mid - 记忆条目 ID
   * @returns 是否成功取消
   */
  cancel(mid: string) {
    this._ei();

    if (this._pendingEntries.has(mid)) {
      this._pendingEntries.delete(mid);
      return true;
    }

    const e = this._entries.get(mid);
    if (e?.semantic_state === "Active") {
      e.semantic_state = "Archived";
      return true;
    }

    return false;
  }

  // ══════════════════════════════════════════════
  // Link Operations
  // ══════════════════════════════════════════════

  /**
   * 创建一条关联链路。
   * 源和目标都必须存在且未被 Obliterated。
   *
   * @param sid - 源记忆 ID
   * @param tid - 目标记忆 ID
   * @param lt - 关联类型
   * @param w - 可选权重（默认 1）
   * @returns 创建的 MemoryLink 深拷贝，若源或目标无效则返回 null
   */
  link(sid: string, tid: string, lt: LinkType, w?: number) {
    this._ei();

    if (!this._entries.has(sid) || !this._entries.has(tid))
      return null;

    const se = this._entries.get(sid);
    const te = this._entries.get(tid);

    if (!se || !te || se.semantic_state === "Obliterated" || te.semantic_state === "Obliterated")
      return null;

    const l: MemoryLink = {
      id: generateId(),
      sourceId: sid,
      targetId: tid,
      linkType: lt,
      weight: w ?? 1,
      targetState: te.semantic_state,
      lastAccessedAt: Date.now(),
    };

    const ex = this._links.get(sid) ?? [];
    ex.push(l);
    this._links.set(sid, ex);

    return structuredClone(l) as MemoryLink;
  }

  // ══════════════════════════════════════════════
  // Transaction Operations
  // ══════════════════════════════════════════════

  /**
   * 开启一个新事务。
   *
   * @param iso - 隔离级别（默认 ReadCommitted）
   * @param md - 可选元数据（如调用链追踪 ID）
   * @returns 事务上下文
   */
  async beginTransaction(iso: TransactionIsolation = "ReadCommitted", md?: Record<string, unknown>) {
    this._ei();

    const id = "txn_" + shortId();
    const n = Date.now();

    const t: InternalTransaction = {
      id,
      isolation: iso,
      status: "active",
      startedAt: n,
      timeoutAt: n + this._ttmo,
      pendingWrites: [],
      pendingLinks: [],
      metadata: md,
    };

    this._transactions.set(id, t);
    return this._bc(t);
  }

  /**
   * 在指定事务内写入一条记忆。
   * commit 前其他事务不可见（取决于隔离级别）。
   *
   * @param t - 事务上下文
   * @param i - 记忆写入输入
   * @returns 挂起写入的临时 ID
   * @throws {TransactionError} 事务不存在
   */
  async writeWithin(t: TransactionContext, i: MemoryWriteInput) {
    this._ei();
    this._va(t);
    this._vw(i);

    const x = this._transactions.get(t.id);
    if (!x)
      throw new TransactionError("Transaction not found", t.id);

    x.pendingWrites.push({ ...i });
    return "pending_" + (x.pendingWrites.length - 1) + "_" + shortId();
  }

  /**
   * 在指定事务内批量写入多条记忆。
   *
   * @param t - 事务上下文
   * @param is - 记忆写入输入数组
   * @returns 挂起写入的临时 ID 数组
   * @throws {TransactionError} 事务不存在
   */
  async writeManyWithin(t: TransactionContext, is: MemoryWriteInput[]) {
    this._ei();
    this._va(t);

    const ids: string[] = [];
    for (const i of is)
      ids.push(await this.writeWithin(t, i));
    return ids;
  }

  /**
   * 在指定事务内建立关联。
   *
   * @param t - 事务上下文
   * @param sid - 源记忆 ID
   * @param tid - 目标记忆 ID
   * @param lt - 关联类型
   * @param w - 可选权重
   * @returns 挂起关联的临时 MemoryLink
   * @throws {TransactionError} 事务不存在
   */
  async linkWithin(t: TransactionContext, sid: string, tid: string, lt: LinkType, w?: number) {
    this._ei();
    this._va(t);

    const x = this._transactions.get(t.id);
    if (!x)
      throw new TransactionError("Transaction not found", t.id);

    x.pendingLinks.push({ action: "link", sourceId: sid, targetId: tid, linkType: lt, weight: w });

    return {
      id: "pending_link_" + (x.pendingLinks.length - 1),
      sourceId: sid,
      targetId: tid,
      linkType: lt,
      weight: w ?? 1,
      targetState: "Active" as SemanticState,
      lastAccessedAt: Date.now(),
    };
  }

  /**
   * 在指定事务内批量建立关联。
   *
   * @param t - 事务上下文
   * @param ls - 关联操作数组
   * @returns 挂起关联的临时 MemoryLink 数组
   */
  async linkManyWithin(t: TransactionContext, ls: Array<{ sourceId: string; targetId: string; linkType: LinkType; weight?: number }>) {
    this._ei();
    this._va(t);

    const r: (MemoryLink | null)[] = [];
    for (const l of ls)
      r.push(await this.linkWithin(t, l.sourceId, l.targetId, l.linkType, l.weight));
    return r;
  }

  /**
   * 在指定事务内读取记忆（事务隔离的快照读）。
   * 当前实现委托给 read()。
   *
   * @param t - 事务上下文
   * @param q - 检索条件
   * @param m - 检索模式
   * @returns 匹配的记忆条目数组
   */
  async readWithin(t: TransactionContext, q: MemoryQuery, m?: ReadMode) {
    this._ei();
    this._va(t);
    return await this.read(q, m);
  }

  /**
   * 提交事务——将事务内所有挂起操作原子化执行。
   *
   * 处理流程：
   *   1. 校验事务状态（必须是 active）
   *   2. 逐个执行挂起的 write 操作
   *   3. 逐个执行挂起的 link 操作
   *   4. 刷新关联链路到持久化层
   *   5. 标记事务为 committed 并从 _transactions 中移除
   *
   * @param t - 事务上下文
   * @returns 提交结果（含写入的记忆 ID 列表）
   * @throws {TransactionError} 事务不存在或状态不是 active
   */
  async commit(t: TransactionContext): Promise<TransactionResult<string[]>> {
    this._ei();

    const x = this._transactions.get(t.id);
    if (!x)
      throw new TransactionError("Transaction not found", t.id);
    if (x.status !== "active")
      throw new TransactionError("Transaction is " + x.status, t.id);

    try {
      const ids: string[] = [];
      const committedIds: string[] = [];

      for (const w of x.pendingWrites) {
        const id = await this.write(w);
        ids.push(id);
        committedIds.push(id);
      }

      for (const l of x.pendingLinks)
        if (l.action === "link")
          this.link(l.sourceId, l.targetId, l.linkType, l.weight);

      if (x.pendingLinks.length > 0)
        await this._be.flushLinks(this._links);

      x.status = "committed";
      this._transactions.delete(x.id);

      return {
        success: true,
        data: ids,
        affectedCount: ids.length + x.pendingLinks.length,
      };
    } catch (err) {
      // 补偿回滚：撤销已写入的条目，防止部分提交
      for (const cid of committedIds) {
        try { await this._be.remove(cid); this._entries.delete(cid); } catch { /* ignore */ }
      }
      x.status = "error";
      return {
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
        affectedCount: 0,
      };
    }
  }

  /**
   * 回滚事务——撤销事务内所有挂起操作。
   *
   * @param t - 事务上下文
   * @returns 回滚结果
   * @throws {TransactionError} 事务不存在或状态不允许回滚
   */
  private async _rt(t: TransactionContext): Promise<TransactionResult<void>> {
    this._ei();

    const x = this._transactions.get(t.id);
    if (!x)
      throw new TransactionError("Transaction not found", t.id);
    if (x.status !== "active" && x.status !== "error")
      throw new TransactionError("Transaction is " + x.status, t.id);

    x.pendingWrites.length = 0;
    x.pendingLinks.length = 0;
    x.status = "rolledback";
    this._transactions.delete(x.id);

    return { success: true, affectedCount: 0 };
  }

  /**
   * 获取当前所有活动（未提交/未回滚）的事务列表。
   * 调用前会自动清理已超时的事务。
   *
   * @returns 活动事务的 TransactionContext 数组
   */
  getActiveTransactions() {
    this._ei();
    this._pe();
    return Array.from(this._transactions.values())
      .filter(t => t.status === "active")
      .map(t => this._bc(t));
  }

  /**
   * 设置事务超时时间（毫秒）。
   * 超过超时时间未 commit 的事务将在下次访问时自动回滚。
   *
   * @param ms - 超时毫秒数
   */
  setTransactionTimeout(ms: number) {
    this._ttmo = ms;
  }

  /**
   * 设置写入前置钩子。
   * 在每次 write() 前调用，可用于修改/增强输入数据。
   *
   * @param h - 前置钩子函数
   */
  setPreWriteHook(h: (i: MemoryWriteInput) => MemoryWriteInput) {
    this._hook = h;
  }

  // ══════════════════════════════════════════════
  // Private Helpers
  // ══════════════════════════════════════════════

  /**
   * _ei — Ensure Initialized.
   * 若存储未初始化则抛出 MemoryStoreError。
   *
   * @throws {MemoryStoreError} StoreNotInitialized
   */
  private _ei() {
    if (!this._init)
      throw new MemoryStoreError(MemoryStoreErrorCode.StoreNotInitialized, "Not initialized");
  }

  /**
   * _vw — Validate Write input.
   * 校验 MemoryWriteInput 的必填字段。
   *
   * @param i - 待校验的写入输入
   * @throws {MemoryValidationError} 缺少必填字段
   */
  private _vw(i: MemoryWriteInput) {
    const f: string[] = [];
    if (!i.source) f.push("source");
    if (!i.kind) f.push("kind");
    if (!i.summary?.trim()) f.push("summary");
    if (!i.semantic_gist?.trim()) f.push("semantic_gist");
    if (!i.content_blob || typeof i.content_blob !== "object") f.push("content_blob");
    if (f.length > 0)
      throw new MemoryValidationError(f);
  }

  /**
   * _va — Validate Active transaction.
   * 校验事务是否存在、是否处于 active 状态、是否已超时。
   * 超时的事务会被自动标记为 error 并从 _transactions 中移除。
   *
   * @param t - 事务上下文
   * @throws {TransactionError} 事务不存在、非 active 或已超时
   */
  protected _va(t: TransactionContext) {
    const x = this._transactions.get(t.id);
    if (!x)
      throw new TransactionError("Transaction not found or completed", t.id);
    if (x.status !== "active")
      throw new TransactionError("Transaction is " + x.status + ", expected active", t.id);
    if (Date.now() > x.timeoutAt) {
      x.status = "error";
      this._transactions.delete(x.id);
      throw new TransactionError("Transaction timed out", t.id);
    }
  }

  /**
   * _pe — Purge Expired transactions.
   * 清理所有已超时且仍处于 active 状态的事务，将其标记为 rolledback。
   */
  private _pe() {
    const n = Date.now();
    for (const [id, t] of this._transactions)
      if (n > t.timeoutAt && t.status === "active") {
        t.status = "rolledback";
        this._transactions.delete(id);
      }
  }

  /**
   * _bp — Build Pending entry.
   * 将 PendingEntry 内部记录转换为 MemoryEntry 格式（带 _pending 标记）。
   *
   * @param id - Pending 条目 ID
   * @param p - PendingEntry 内部记录
   * @returns 带 _pending 标记的 MemoryEntry
   */
  private _bp(id: string, p: PendingEntry): MemoryEntry {
    return {
      id,
      source: p.input.source,
      sessionId: p.input.sessionId,
      kind: p.input.kind,
      summary: p.input.summary,
      semantic_gist: p.input.semantic_gist,
      content_blob: p.input.content_blob as Record<string, unknown>,
      semantic_state: "Active",
      weight: p.input.weight ?? 1,
      accessCount: 0,
      lastAccessedAt: p.createdAt,
      createdAt: p.input.createdAt ?? p.createdAt,
      content_hash: p.input.content_hash ?? "",
      embedding: p.input.embedding,
      expires_at: p.input.expires_at,
      _pending: true,
    };
  }

  /**
   * _ah — Apply Hook.
   * 如果设置了 preWriteHook 则通过钩子处理输入，否则原样返回。
   *
   * @param i - 记忆写入输入
   * @returns 经钩子处理后的输入（或原输入）
   */
  private _ah(i: MemoryWriteInput) {
    return this._hook ? this._hook(i) : i;
  }

  /**
   * _bc — Build Context.
   * 将 InternalTransaction 转换为公开的 TransactionContext。
   * status 为 "error" 时映射为 "rolledback"。
   *
   * @param t - 内部事务记录
   * @returns 公开的事务上下文
   */
  private _bc(t: InternalTransaction): TransactionContext {
    return {
      id: t.id,
      status: t.status === "error" ? "rolledback" : t.status,
      startedAt: t.startedAt,
      isolation: t.isolation,
      timeoutAt: t.timeoutAt,
      pendingWrites: [...t.pendingWrites],
      pendingLinks: [...t.pendingLinks],
      metadata: t.metadata ? { ...t.metadata } : undefined,
    };
  }

  /**
   * _bfs — Breadth-First Search expansion.
   * 从初始结果集出发，沿关联链路做 BFS 扩展，最多扩展 d 层。
   *
   * @param e - 初始结果集
   * @param d - BFS 最大深度
   * @param m - 可选的最大节点数限制
   * @returns 扩展后的 MemoryEntry 数组
   */
  private _bfs(e: MemoryEntry[], d: number, m?: number) {
    const v = new Set(e.map(x => x.id));
    const r = [...e];
    let q = e.map(x => x.id);

    for (let i = 0; i < d && q.length > 0; i++) {
      const nq: string[] = [];

      for (const s of q) {
        for (const l of this._links.get(s) ?? []) {
          if (!v.has(l.targetId)) {
            v.add(l.targetId);
            const t = this._entries.get(l.targetId);
            if (t) {
              r.push(t);
              nq.push(l.targetId);
            }
          }
        }

        if (m && r.length >= m)
          return r.slice(0, m);
      }

      q = nq;
    }

    return r;
  }
}
