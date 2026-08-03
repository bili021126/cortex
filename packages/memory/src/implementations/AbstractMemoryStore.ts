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

import { MEMORY_VALID_TRANSITIONS, PipelineEventType, PipelinePriority, type MemoryEntry, type MemoryWriteInput, type MemoryQuery, type MemoryLink, type SemanticState, type LinkType, type ReadMode, type IPipelineObserver, type MaintainReport } from "@cortex/shared";
import type { IMemoryStore } from "../interfaces/MemoryStore.js";
import type { TransactionalMemoryStore, TransactionContext, TransactionIsolation, TransactionResult, TransactionLinkOp } from "../interfaces/TransactionalMemoryStore.js";
import { MemoryStoreError, MemoryStoreErrorCode, MemoryValidationError, TransactionError } from "../errors/MemoryStoreError.js";
import { generateId, shortId } from "../_utils.js";
import * as crypto from "node:crypto";

// ══════════════════════════════════════════════════════════════
// Constants & Interfaces
// ══════════════════════════════════════════════════════════════

/** Default transaction timeout in milliseconds (30 seconds). */
const TMO = 30_000;

/** Pending 条目 TTL——超过 24h 未 commit 视为放弃，由 maintain() 清理（清单2）。 */
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/** CSA 热度统计低频落盘间隔（毫秒）——避免每次 read 都写盘（P2）。 */
const CSA_FLUSH_INTERVAL_MS = 5_000;

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

  /** content_hash → id 二级索引（Core-3 T4：内容去重 O(1) 查询）。
   *  与 _entries 同步维护——所有条目增删必须经 _indexPut/_indexDel；空 content_hash 不入索引。 */
  private readonly _hashIndex = new Map<string, string>();

  /** 所有关联链路的索引（sourceId → MemoryLink[]） */
  protected readonly _links = new Map<string, MemoryLink[]>();

  /** 两阶段提交中处于 Pending 状态的条目（id → PendingEntry） */
  protected readonly _pendingEntries = new Map<string, PendingEntry>();

  /** 已湮灭条目 ID 集合——obliterate 成功后条目已从 _entries 移除，
   *  靠此集合维持幂等（重复湮灭同一 ID 返回 true）。湮灭为永久操作，只增不减。 */
  protected readonly _obliteratedIds = new Set<string>();

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

  /** CSA 热度统计上次落盘时间戳（低频节流用，P2） */
  private _lastCsaFlushAt = 0;

  // ══════════════════════════════════════════════
  // Constructor
  // ══════════════════════════════════════════════

  constructor(
      private readonly _be: MemoryStoreBackend,
      private readonly _observer?: IPipelineObserver,
    ) {}

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
    this._indexPut(id, e);
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

  // ══════════════════════════════
  // Content-Hash Index (Core-3 T4)
  // ══════════════════════════════

  /**
   * 写入/覆盖条目——同步维护 _entries 与 _hashIndex。
   * content_hash 变更时清除指向本 id 的旧映射；空 content_hash 不入索引（避免空串碰撞）。
   */
  protected _indexPut(id: string, entry: MemoryEntry): void {
    const prev = this._entries.get(id);
    if (prev?.content_hash && prev.content_hash !== entry.content_hash
        && this._hashIndex.get(prev.content_hash) === id) {
      this._hashIndex.delete(prev.content_hash);
    }
    this._entries.set(id, entry);
    if (entry.content_hash) {
      this._hashIndex.set(entry.content_hash, id);
    }
  }

  /** 删除条目——同步移除内容哈希索引（仅当索引确实指向本 id）。 */
  protected _indexDel(id: string): void {
    const prev = this._entries.get(id);
    if (prev?.content_hash && this._hashIndex.get(prev.content_hash) === id) {
      this._hashIndex.delete(prev.content_hash);
    }
    this._entries.delete(id);
  }

  /**
   * 按内容哈希 O(1) 查找记忆 ID（Core-3 T4）。
   * 带防御性一致性校验：命中后确认条目仍在且哈希一致，漂移则清理并按未命中处理。
   */
  findByContentHash(contentHash: string): string | undefined {
    if (!contentHash) return undefined;
    const id = this._hashIndex.get(contentHash);
    if (id === undefined) return undefined;
    const entry = this._entries.get(id);
    if (entry?.content_hash === contentHash) return id;
    this._hashIndex.delete(contentHash);
    return undefined;
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

    if (q.timeRange) {
      const tr = q.timeRange;
      r = r.filter(e => e.createdAt >= tr.start && e.createdAt <= tr.end);
    }

    if (q.agentTypes?.length) {
      const agentTypes = q.agentTypes;
      r = r.filter(e => agentTypes.includes(e.source.agentType));
    }

    if (q.metadataFilter) {
      const mf = q.metadataFilter;
      r = r.filter(e =>
        Object.entries(mf).every(([k, v]) => (e.content_blob as Record<string, unknown>)[k] === v),
      );
    }

    // R12-C5：domainGate 实现——allow 白名单（空=全部）/ block 黑名单（命中排除）；未声明 domain 视为 general
    if (q.domainGate) {
      const { allow, block } = q.domainGate;
      r = r.filter(e => {
        const d = e.domain ?? "general";
        if (block?.includes(d)) return false;
        if (allow && allow.length > 0 && !allow.includes(d)) return false;
        return true;
      });
    }

    if (q.bfsDepth && q.bfsDepth > 0)
      r = this._bfs(r, q.bfsDepth, q.bfsMaxNodes);

    r.sort((a, b) => b.weight !== a.weight ? b.weight - a.weight : b.createdAt - a.createdAt);

    if (q.limit && q.limit > 0)
      r = r.slice(0, q.limit);

    if (m === "CSA") {
      const n = Date.now();
      const touched: MemoryEntry[] = [];
      for (const e of r) {
        const s = this._entries.get(e.id);
        if (s) {
          s.accessCount = (s.accessCount ?? 0) + 1;
          s.lastAccessedAt = n;
          touched.push(s);
        }
      }
      // 低频落盘热度统计（≥5s 间隔才写盘），失败上报不阻塞读取（P2）
      if (touched.length > 0 && n - this._lastCsaFlushAt >= CSA_FLUSH_INTERVAL_MS) {
        this._lastCsaFlushAt = n;
        for (const s of touched) this._firePersist(s);
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
      // id 去 pending_ 前缀——与 commitMemory/rollback 期望的干净 ID 一致（P1-7）
      r.push(this._bp(id.replace(/^pending_/, ""), p));
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
    try {
      await this._be.load(this);
    } catch (err) {
      // 半初始化防护：load 失败时清空已注入的条目/链路，保证重试 init 干净（P2）
      this._entries.clear();
      this._hashIndex.clear();
      this._links.clear();
      throw err;
    }
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
      if (e && e.sessionId === this._sid && e.semantic_state === "Active") {
        if (this.cas(e.id, "Active", "Archived")) c++;
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
    try {
      await this._be.flushAll(this._entries, this._links);
    } catch (err) {
      this._observer?.emit({ type: PipelineEventType.MemoryFlushSkipped, priority: PipelinePriority.HIGH, payload: { source: "flushAll", detail: String(err).slice(0, 200) }, timestamp: Date.now() });
      throw err;
    }
  }

  /**
   * 关闭存储后端，释放所有资源。
   * 关闭前会尝试将数据刷入持久化层。
   */
  async close() {
    if (this._init)
      await this._be.flushAll(this._entries, this._links);

    this._entries.clear();
    this._hashIndex.clear();
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
      domain: f.domain,
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

    // R8-01 fix: 先 persist 再 index——persist 失败时不在内存中留下幽灵条目
    try {
      await this._be.persist(e);
      this._indexPut(id, e);
    } catch (err) {
      this._observer?.emit({ type: PipelineEventType.MemoryPersistFailed, priority: PipelinePriority.HIGH, payload: { operation: "persist", error: String(err).slice(0, 200) }, timestamp: Date.now() });
      throw err;
    }
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
    // 与 write() 对齐：先持久化成功再更新内存索引，失败不污染内存（P1-2）
    try {
      await this._be.persist(e);
      this._indexPut(id, { ...e });
    } catch (err) {
      this._observer?.emit({ type: PipelineEventType.MemoryPersistFailed, priority: PipelinePriority.HIGH, payload: { operation: "set", error: String(err).slice(0, 200) }, timestamp: Date.now() });
      throw err;
    }
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

    // 先 remove 成功（非 ENOENT 错误会抛出）再删内存，防止内存已删而持久化残留（P1-4）
    await this._be.remove(id);

    this._indexDel(id);
    this._links.delete(id);

    for (const [, ls] of this._links) {
      const f = ls.filter(l => l.targetId !== id && l.sourceId !== id);
      ls.length = 0;
      ls.push(...f);
    }

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
    const succeeded: string[] = [];
    const failed: { index: number; error: string }[] = [];
    for (let idx = 0; idx < is.length; idx++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const id = await this.write(is[idx]!);
        succeeded.push(id);
      } catch (err) {
        failed.push({ index: idx, error: String(err).slice(0, 200) });
      }
    }
    if (failed.length > 0) {
      this._observer?.emit({
        type: PipelineEventType.ErrorReported,
        priority: PipelinePriority.HIGH,
        payload: {
          source: "MemoryStore.writeMany",
          severity: "degraded",
          error: `${failed.length}/${is.length} items failed`,
          hint: JSON.stringify({ succeeded, failed }),
        },
        timestamp: Date.now(),
      });
    }
    return succeeded;
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
    // 状态转换白名单校验（引用 shared 中的单一事实来源）
    if (!MEMORY_VALID_TRANSITIONS[e]?.has(n)) return false;
    x.semantic_state = n;
    // 状态迁移落盘：cas 是同步 API，fire-and-forget persist（P1-6）
    this._firePersist(x);
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
    return this.cas(id, "Active", "Archived");
  }

  /**
   * 湮灭指定记忆条目（任意状态 → Obliterated）。
   *
   * @param id - 记忆条目 ID
   * @returns 是否成功湮灭
   */
  obliterate(id: string) {
    this._ei();
    // 幂等：已湮灭（含已从 _entries 移除的）直接返回 true
    if (this._obliteratedIds.has(id)) return true;
    const e = this._entries.get(id);
    if (!e) return false;
    // 幂等：已是 Obliterated 直接返回 true
    if (e.semantic_state === "Obliterated") return true;
    // 允许其他状态 → Obliterated（FSM 白名单校验由 cas 内部执行）
    const ok = this.cas(id, e.semantic_state as SemanticState, "Obliterated");
    if (ok) {
      this._indexDel(id);
      this._links.delete(id);
      this._obliteratedIds.add(id);
      // 湮灭持久化：删除文件 + 刷新索引（P0-1）。
      // obliterate 为同步 API（接口约束），无法 await——fire-and-forget 落盘并上报失败。
      this._fireRemove(id);
    }
    return ok;
  }

  /** freeze —— 冻结记忆，语义等同于 archive（映射到 Archived 状态），幂等 */
  freeze(id: string): boolean {
    return this.archive(id);
  }

  /** maintain —— 维护扫描：清理过期 Pending 条目（TTL 兑底，清单2），其余由子类扩展 */
  maintain(): MaintainReport {
    const report: MaintainReport = { archived: 0, obliterated: 0, orphanedLinks: 0 };
    const n = Date.now();
    let expiredPending = 0;
    for (const [id, p] of this._pendingEntries) {
      // 超时未 commit 的 Pending 条目视为放弃，移除防泄漏
      if (n - p.createdAt > PENDING_TTL_MS) {
        this._pendingEntries.delete(id);
        expiredPending++;
      }
    }
    if (expiredPending > 0) report.skipped = `expired pending: ${expiredPending}`;
    return report;
  }

  // ══════════════════════════════════════════════
  // Pending Operations (Two-Phase Commit)
  // ══════════════════════════════════════════════

  /**
   * 写入一条 Pending 状态的记忆（两阶段提交第一阶段）。
   * 条目不会立即对 read() 可见，需 commitMemory() 后激活。
   *
   * @param i - 记忆写入输入
   * @returns Pending 条目 ID（commitMemory/rollback 时使用此 ID）
   * @throws {MemoryValidationError} 输入校验失败
   * @fix H-06 — 返回的 ID 不含 pending_ 前缀，前缀仅用于内部 pending map
   */
  writePending(i: MemoryWriteInput) {
    this._ei();
    this._vw(i);

    // 对齐 write()：应用 preWriteHook 门禁 + 注入 sessionId + 生成 content_hash（清单5/P1-8）
    const f = this._ah(i);
    const ch = f.content_hash ?? this._hashOf(f);
    // 去重检查：内容已存在的 Active 条目直接返回其 ID，不再重复 pending（清单5）
    const dup = ch ? this.findByContentHash(ch) : undefined;
    if (dup && this._entries.has(dup)) return dup;

    const cleanId = generateId();
    this._pendingEntries.set("pending_" + cleanId, {
      input: { ...f, sessionId: f.sessionId ?? this._sid, content_hash: ch },
      createdAt: Date.now(),
    });
    return cleanId;
  }

  /**
   * 提交一条 Pending 记忆，将其转为 Active 状态的 MemoryEntry。
   *
   * @param mid - Pending 记忆条目 ID
   * @returns 是否成功提交（条目不存在时返回 false）
   */
  commitMemory(mid: string) {
    this._ei();

    const p = this._pendingEntries.get("pending_" + mid);
    if (!p) return false;

    // FSM guard: 校验 pending→active 合法性
    const transitionOk = MEMORY_VALID_TRANSITIONS["Pending"]?.has("Active") ?? false;
    if (!transitionOk) return false;

    // 去重检查：内容已存在于 Active 索引（非本 pending）时拒绝提交，对齐 write 去重语义（清单5）
    const ch = p.input.content_hash ?? this._hashOf(p.input);
    if (ch) {
      const dup = this.findByContentHash(ch);
      if (dup && dup !== mid && this._entries.has(dup)) {
        this._pendingEntries.delete("pending_" + mid);
        return false;
      }
    }

    const n = Date.now();
    const e: MemoryEntry = {
      id: mid,
      source: p.input.source,
      domain: p.input.domain,
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

    this._pendingEntries.delete("pending_" + mid);

    // 内存索引同步放入——commitMemory 是同步 API，commit→read 必须立即一致（内存即真相源）。
    // 持久化作为耐久性备份异步进行；失败时恢复 pending 状态可重试，不再静默吞错（P1-3）。
    this._indexPut(mid, e);
    if (this._be && typeof this._be.persist === "function") {
      const persistTimeout = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("persist timeout")), 3000),
      );
      Promise.race([
        (this._be.persist(e) as Promise<void>),
        persistTimeout,
      ]).catch((err) => {
        // 持久化失败：恢复 pending 状态以便下次 commitMemory 重试（P1-3）
        this._pendingEntries.set("pending_" + mid, p);
        if (typeof process !== "undefined") {
          process.stderr.write(`[memory] commitMemory persist failed: ${err instanceof Error ? err.message : String(err)}\n`);
        }
        this._observer?.emit({ type: PipelineEventType.MemoryPersistFailed, priority: PipelinePriority.HIGH, payload: { operation: "commitMemory", error: String(err).slice(0, 200) }, timestamp: Date.now() });
      });
    }

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
   * @param mid - Pending 记忆条目 ID（writePending 返回的干净 ID）
   * @returns 是否成功回滚
   */
  private _rp(mid: string) {
    this._ei();
    if (!this._pendingEntries.has("pending_" + mid))
      return false;
    this._pendingEntries.delete("pending_" + mid);
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

    if (this._pendingEntries.has("pending_" + mid)) {
      this._pendingEntries.delete("pending_" + mid);
      return true;
    }

    const e = this._entries.get(mid);
    if (e?.semantic_state === "Active") {
      return this.cas(mid, "Active", "Archived");
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

    // 关联落盘：link 是同步 API，fire-and-forget flushLinks（P2）
    if (this._be && typeof this._be.flushLinks === "function") {
      Promise.resolve()
        .then(() => this._be.flushLinks(this._links))
        .catch((err) => {
          if (typeof process !== "undefined") {
            process.stderr.write(`[memory] link flushLinks failed: ${err instanceof Error ? err.message : String(err)}\n`);
          }
          this._observer?.emit({ type: PipelineEventType.MemoryFlushSkipped, priority: PipelinePriority.HIGH, payload: { source: "MemoryStore.link", detail: String(err).slice(0, 200) }, timestamp: Date.now() });
        });
    }

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

    // 生成 content_hash——commit 走 write() 时使用，对齐 memory-store write 的 hash 逻辑（清单7）
    const w = { ...i };
    if (!w.content_hash) w.content_hash = this._hashOf(w);
    x.pendingWrites.push(w);
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

    const committedIds: string[] = [];
    const committedLinks: Array<{ id: string; sourceId: string; targetId: string; linkType: LinkType }> = [];

    try {
      const ids: string[] = [];

      for (const w of x.pendingWrites) {
        const id = await this.write(w);
        ids.push(id);
        committedIds.push(id);
      }

      for (const l of x.pendingLinks)
        if (l.action === "link") {
          const lk = this.link(l.sourceId, l.targetId, l.linkType, l.weight);
          if (lk) committedLinks.push({ id: lk.id, sourceId: lk.sourceId, targetId: lk.targetId, linkType: lk.linkType });
        }

      if (x.pendingLinks.length > 0) {
        await this._be.flushLinks(this._links);
        await this._be.flushIndex(this._entries);
      }

      x.status = "committed";
      this._transactions.delete(x.id);

      return {
        success: true,
        data: ids,
        affectedCount: ids.length + x.pendingLinks.length,
      };
    } catch (err) {
      // 补偿回滚：撤销已写入的条目和关联链路，防止部分提交
      for (const cid of committedIds) {
        try { await this._be.remove(cid); this._indexDel(cid); } catch (rollbackErr) {
          this._observer?.emit({
            type: PipelineEventType.ErrorReported,
            priority: PipelinePriority.HIGH,
            payload: {
              source: "MemoryStore._commit",
              severity: "degraded",
              error: `回滚删除失败: ${String(rollbackErr).slice(0, 200)}`,
              hint: `committedId=${cid}`,
            },
            timestamp: Date.now(),
          });
        }
      }
      for (const cl of committedLinks) {
        const ls = this._links.get(cl.sourceId);
        if (ls) {
          // 按 id 精确匹配删除（同一 source+type 可能存在多条边）
          const idx = ls.findIndex(l => l.id === cl.id);
          if (idx >= 0) ls.splice(idx, 1);
        }
      }
      // 补偿后落盘：把内存中的回滚状态同步到持久化层（P1-5）
      try {
        await this._be.flushIndex(this._entries);
        await this._be.flushLinks(this._links);
      } catch (flushErr) {
        this._observer?.emit({
          type: PipelineEventType.ErrorReported,
          priority: PipelinePriority.HIGH,
          payload: {
            source: "MemoryStore._commit",
            severity: "degraded",
            error: `事务补偿后落盘失败: ${String(flushErr).slice(0, 200)}`,
            hint: `txnId=${x.id}`,
          },
          timestamp: Date.now(),
        });
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
   * 清理已超时的 active 事务（标记 rolledback），以及已死亡的 error 事务（防泄漏，清单6）。
   */
  private _pe() {
    const n = Date.now();
    for (const [id, t] of this._transactions) {
      if (n > t.timeoutAt && t.status === "active") {
        t.status = "rolledback";
        this._transactions.delete(id);
      } else if (t.status === "error") {
        // commit 失败后事务已死亡，清理时直接删除防泄漏
        this._transactions.delete(id);
      }
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
      semantic_state: "Pending",
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
   * _hashOf — 生成内容哈希（SHA256）。
   * 与 memory-store 适配层 write 的 hash 逻辑对齐（summary + content_blob）。
   *
   * @param i - 记忆写入输入
   * @returns SHA256 十六进制摘要，失败时返回空串
   */
  private _hashOf(i: MemoryWriteInput): string {
    try {
      return crypto.createHash("sha256").update(i.summary + JSON.stringify(i.content_blob)).digest("hex");
    } catch {
      return "";
    }
  }

  /**
   * _firePersist — fire-and-forget 持久化单条目。
   * 用于同步 API（cas/archive/read-CSA）的状态变更落盘，失败上报不抛出。
   *
   * @param entry - 待持久化的记忆条目
   */
  private _firePersist(entry: MemoryEntry): void {
    if (this._be && typeof this._be.persist === "function") {
      Promise.resolve()
        .then(() => this._be.persist(entry))
        .catch((err) => {
          if (typeof process !== "undefined") {
            process.stderr.write(`[memory] persist failed: ${err instanceof Error ? err.message : String(err)}\n`);
          }
          this._observer?.emit({ type: PipelineEventType.MemoryPersistFailed, priority: PipelinePriority.HIGH, payload: { operation: "cas", error: String(err).slice(0, 200) }, timestamp: Date.now() });
        });
    }
  }

  /**
   * _fireRemove — fire-and-forget 湮灭持久化（P0-1）。
   * 删除条目文件并刷新索引/链路，失败上报不抛出。
   *
   * @param id - 待湮灭的记忆条目 ID
   */
  private _fireRemove(id: string): void {
    if (this._be && typeof this._be.remove === "function") {
      Promise.resolve()
        .then(async () => {
          await this._be.remove(id);
          await this._be.flushIndex(this._entries);
          await this._be.flushLinks(this._links);
        })
        .catch((err) => {
          if (typeof process !== "undefined") {
            process.stderr.write(`[memory] obliterate persist failed: ${err instanceof Error ? err.message : String(err)}\n`);
          }
          this._observer?.emit({
            type: PipelineEventType.ErrorReported,
            priority: PipelinePriority.HIGH,
            payload: {
              source: "MemoryStore.obliterate",
              severity: "degraded",
              error: String(err).slice(0, 200),
              hint: `memoryId=${id}`,
            },
            timestamp: Date.now(),
          });
        });
    }
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
