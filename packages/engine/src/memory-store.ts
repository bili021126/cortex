import type {
  MemoryEntry,
  MemoryLink,
  MemoryQuery,
  MemoryType,
  AgentType,
} from "@cortex/shared";
import { MemoryState, LinkType, PipelinePriority } from "@cortex/shared";
import type { PipelineObserver } from "./pipeline-observer.js";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** MemoryEntry 构造参数（id/createdAt/lastAccessedAt 自动生成） */
export interface MemoryWriteInput {
  memoryType: MemoryType;
  content: Record<string, unknown>;
  summary: string;
  agentType: AgentType;
  creatorId: string;
  weight?: number;
  createdAt?: number;
  projectFingerprint?: string;
  metadata?: Record<string, unknown>;
  isPrivate?: boolean;
}

/**
 * MemoryStore —— 内存级记忆存储 + sql.js 持久化。
 *
 * 接口完全兼容议题四 Schema。
 *
 * - 不调 init()：纯内存（向后兼容，测试用）
 * - 调 init(dbPath)：SQLite 持久化，write-through，重启不丢
 *
 * 30 天 TTL：标记但不真删。read() 自动过滤过期 ACTIVE 记忆。
 */
export class MemoryStore {
  private memories = new Map<string, MemoryEntry>();
  private links = new Map<string, MemoryLink[]>();

  // ── SQLite 持久化 ──────────────────────────
  private _SQL?: SqlJsStatic;
  private _db?: Database;
  private _dbPath?: string;
  private _persistEnabled = false;

  // ── 防抖写盘：避免每次变更都立即写盘 ──
  private _dirty = false;
  private _flushing = false; // 并发守卫：防止两个 _saveDb 实例同时执行
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _flushDebounceMs = 200;

  // ── 可观测性 ──
  private _observer?: PipelineObserver;

  // ── 生命周期状态机 ──
  // active: 正常运行；closing: close() 已调用，拒绝新写入；closed: _db 已释放
  private _lifecycle: "active" | "closing" | "closed" = "active";

  constructor(observer?: PipelineObserver) {
    this._observer = observer;
  }

  /**
   * 启用 SQLite 持久化。
   * 如果 dbPath 文件已存在则加载，否则创建新库并初始化表结构。
   * 不调用则纯内存运行。
   */
  async init(dbPath: string): Promise<void> {
    this._dbPath = dbPath;
    this._SQL = await initSqlJs();

    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(dbPath)) {
      const buf = fs.readFileSync(dbPath);
      this._db = new this._SQL.Database(buf);
    } else {
      this._db = new this._SQL.Database();
    }

    this._createTables();
    this._loadFromDb();
    this._persistEnabled = true;
  }

  /** 持久化是否已启用 */
  get isPersisted(): boolean {
    return this._persistEnabled;
  }

  // ── 写入 ────────────────────────────────────────

  /** 写入一条记忆。返回生成的 id。 */
  write(input: MemoryWriteInput): string {
    if (this._lifecycle !== "active") {
      throw new Error(`MemoryStore 已关闭 (状态: ${this._lifecycle})，拒绝写入`);
    }
    const now = Date.now();
    const id = `mem-${crypto.randomUUID()}`;

    const entry: MemoryEntry = {
      id,
      memoryType: input.memoryType,
      state: MemoryState.Active,
      content: input.content,
      summary: input.summary,
      agentType: input.agentType,
      creatorId: input.creatorId,
      createdAt: input.createdAt ?? now,
      lastAccessedAt: now,
      accessCount: 0,
      weight: input.weight ?? 1.0,
      projectFingerprint: input.projectFingerprint,
      metadata: input.metadata,
      isPrivate: input.isPrivate ?? false,
    };

    this.memories.set(id, entry);

    if (this._persistEnabled && this._db) {
      try {
        this._safeDbRun(
          `INSERT INTO memories (id, memory_type, state, content, summary, agent_type, creator_id, created_at, last_accessed_at, access_count, weight, project_fingerprint, metadata, is_private)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.id,
            entry.memoryType,
            entry.state,
            JSON.stringify(entry.content),
            entry.summary,
            entry.agentType,
            entry.creatorId,
            entry.createdAt,
            entry.lastAccessedAt,
            entry.accessCount,
            entry.weight,
            entry.projectFingerprint ?? null,
            entry.metadata ? JSON.stringify(entry.metadata) : null,
            entry.isPrivate ? 1 : 0,
          ],
          "write",
        );
        this._scheduleFlush();
      } catch (e) {
        // 假阳性禁止原则：DB 失败回滚内存
        this.memories.delete(id);
        throw e;
      }
    }

    return id;
  }

  // ── 读取 ────────────────────────────────────────

  /**
   * 关键词检索 + BFS 图遍历。
   *
   * 持久化模式下走 SQL 主读（WHERE 过滤下推到 SQLite），
   * 纯内存模式退化为全量扫描。BFS 始终在 Map 上做。
   *
   * 流程：
   * 1. 关键词匹配 → 种子集（SQL LIKE 或 JS filter）
   * 2. BFS 沿关联边双向展开（入边 + 出边）
   * 3. 合并去重 → 权重降序 → limit 截断
   */
  read(query: MemoryQuery): MemoryEntry[] {
    const now = Date.now();

    // ── 阶段 1：获取候选集 ──
    let results: MemoryEntry[];
    if (this._persistEnabled && this._db) {
      results = this._sqlRead(query, now);
    } else {
      results = this._memScanRead(query, now);
    }

    // ── 阶段 2：BFS 图遍历（关联检索）──
    const bfsDepth = query.bfsDepth ?? 2;
    const bfsMaxNodes = query.bfsMaxNodes ?? 20;
    if (bfsDepth > 0 && results.length > 0) {
      results = this._bfsExpand(results, bfsDepth, bfsMaxNodes, query.linkTypes);
    }

    // ── 阶段 3：访问统计刷新 ──
    const trackAccess = query.trackAccess !== false;
    if (trackAccess) {
      for (const m of results) {
        m.accessCount++;
        m.lastAccessedAt = now;
      }
      if (this._persistEnabled && this._db && results.length > 0) {
        // 保存原始值，DB 失败时回滚
        const originalAccessCounts = new Map<string, number>();
        const originalLastAccessed = new Map<string, number>();
        for (const m of results) {
          originalAccessCounts.set(m.id, m.accessCount - 1); // 恢复为原始值
          originalLastAccessed.set(m.id, m.lastAccessedAt);
        }
        try {
          const stmt = this._db.prepare(
            "UPDATE memories SET access_count = ?, last_accessed_at = ? WHERE id = ?",
          );
          for (const m of results) {
            stmt.run([m.accessCount, m.lastAccessedAt, m.id]);
          }
          stmt.free();
          void this._scheduleFlush();
        } catch (e) {
          // 假阳性禁止原则：DB 失败回滚内存访问计数
          for (const m of results) {
            m.accessCount = originalAccessCounts.get(m.id) ?? m.accessCount;
            m.lastAccessedAt = originalLastAccessed.get(m.id) ?? m.lastAccessedAt;
          }
          if (this._observer) {
            this._observer.emit({
              type: "memory.db_write_failed",
              priority: PipelinePriority.CRITICAL,
              payload: { opName: "read.access_tracking", error: String(e).slice(0, 300) },
              timestamp: Date.now(),
              notificationType: "WARNING",
            });
          }
          // 不抛出——读取本身已成功，访问追踪是二级副作用
        }
      }
    }

    // ── 阶段 4：排序 + 限量 ──
    results.sort((a, b) => b.weight - a.weight);
    if (query.limit && query.limit > 0) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  // ── 关联 ────────────────────────────────────────

  /** 建立记忆间的关联边。幂等去重（同 source+target+linkType 只保留一条）。 */
  link(sourceId: string, targetId: string, linkType: LinkType, _creatorId: string): MemoryLink | null {
    const source = this.memories.get(sourceId);
    const target = this.memories.get(targetId);
    if (!source || !target) return null;
    // 湮灭态记忆不可建立新关联
    if (source.state === MemoryState.Obliterated || target.state === MemoryState.Obliterated) return null;

    let existing = this.links.get(sourceId);
    if (!existing) {
      existing = [];
      this.links.set(sourceId, existing);
    }

    // 幂等去重
    if (linkType !== LinkType.AccessedDuring) {
      if (existing.some((l) => l.targetId === targetId && l.linkType === linkType)) {
        return null;
      }
    }

    const now = Date.now();
    const link: MemoryLink = {
      id: `link-${crypto.randomUUID()}`,
      sourceId,
      targetId,
      linkType,
      weight: LINK_WEIGHTS[linkType] ?? 0.5,
      targetState: target.state,
      lastAccessedAt: now,
    };

    existing.push(link);

    if (this._persistEnabled && this._db) {
      try {
        this._safeDbRun(
          `INSERT INTO links (id, source_id, target_id, link_type, weight, target_state, last_accessed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [link.id, link.sourceId, link.targetId, link.linkType, link.weight, link.targetState, link.lastAccessedAt],
          "link",
        );
        this._scheduleFlush();
      } catch (e) {
        // 假阳性禁止原则：DB 失败回滚内存
        existing.pop();
        throw e;
      }
    }

    return link;
  }

  /** 获取某记忆的所有出边 */
  getLinks(sourceId: string): MemoryLink[] {
    return this.links.get(sourceId) ?? [];
  }

  // ── 四态状态机 ────────────────────────────────

  /** 存在性检查（轻量，不触发副作用） */
  has(memoryId: string): boolean {
    return this.memories.has(memoryId);
  }

  /**
   * 原子 CAS 状态变更。
   * 四态流转规则：
   *   Active → Archived → Frozen → Obliterated
   *   Active → Frozen（跳过 Archived）
   *   Active|Archived|Frozen → Obliterated（不可逆终点）
   * 禁止：Obliterated → 任何态、Frozen → Active、Archived → Active
   */
  cas(memoryId: string, expected: MemoryState, newState: MemoryState): boolean {
    const m = this.memories.get(memoryId);
    if (!m) return false;
    if (m.state !== expected) return false;

    // 流转合法性校验
    const valid = this._isValidTransition(m.state, newState);
    if (!valid) return false;

    m.state = newState;

    if (this._persistEnabled && this._db) {
      try {
        this._safeDbRun("UPDATE memories SET state = ? WHERE id = ?", [newState, memoryId], "cas");
        this._scheduleFlush();
      } catch (e) {
        // 假阳性禁止原则：DB 失败回滚内存
        m.state = expected;
        throw e;
      }
    }

    return true;
  }

  /** 归档：Active → Archived（CAS 保护） */
  archive(memoryId: string): boolean {
    return this.cas(memoryId, MemoryState.Active, MemoryState.Archived);
  }

  /** 冻结：Active|Archived → Frozen（CAS 保护，_isValidTransition 内部校验） */
  freeze(memoryId: string): boolean {
    const m = this.memories.get(memoryId);
    if (!m) return false;
    return this.cas(memoryId, m.state, MemoryState.Frozen);
  }

  /** 湮灭：无条件销毁指定记忆（任何态 → Obliterated，不可逆，不依赖 CAS expected 匹配） */
  obliterate(memoryId: string): boolean {
    const m = this.memories.get(memoryId);
    if (!m) return false;
    if (m.state === MemoryState.Obliterated) return true; // 已是终态，幂等

    if (!this._isValidTransition(m.state, MemoryState.Obliterated)) return false;

    const previousState = m.state;
    m.state = MemoryState.Obliterated;
    if (this._persistEnabled && this._db) {
      try {
        this._safeDbRun("UPDATE memories SET state = ? WHERE id = ?", [MemoryState.Obliterated, memoryId], "obliterate");
        this._scheduleFlush();
      } catch (e) {
        // 假阳性禁止原则：DB 失败回滚内存
        m.state = previousState;
        throw e;
      }
    }
    return true;
  }

  /**
   * 只读快照——返回冻结副本，禁止直接修改内部状态。
   * 仅测试/调试使用。业务代码走 read()。
   */
  peek(memoryId: string): Readonly<MemoryEntry> | undefined {
    const m = this.memories.get(memoryId);
    if (!m) return undefined;
    // 深拷贝 + 递归冻结：防止调用方修改嵌套对象（如 content.entities.push(...)），
    // 严守 Readonly<MemoryEntry> 契约。
    const copy = structuredClone(m) as MemoryEntry;
    // 递归冻结所有嵌套对象
    const deepFreeze = (obj: unknown): void => {
      if (obj === null || typeof obj !== "object") return;
      Object.freeze(obj);
      Object.values(obj as Record<string, unknown>).forEach(deepFreeze);
    };
    deepFreeze(copy);
    return copy;
  }

  /** 记忆总数 */
  get size(): number {
    return this.memories.size;
  }

  /**
   * 强制落盘所有未写入的变更，返回 Promise 供调用方 await。
   * 通常在关键路径（如 close()、Agent 执行完成后）调用。
   */
  async flush(): Promise<void> {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (this._dirty) {
      this._dirty = false;
      await this._saveDb();
    }
  }

  /** 关闭数据库连接。不再使用持久化时调用。 */
  async close(): Promise<void> {
    if (this._lifecycle !== "active") return;
    this._lifecycle = "closing";
    if (this._db) {
      // 先取消防抖定时器，防止 _scheduleFlush 在 flush 之后重新触发
      if (this._flushTimer) {
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
      }
      await this.flush();
      this._db.close();
      this._db = undefined;
      this._persistEnabled = false;
    }
    this._lifecycle = "closed";
  }

  // ── 内部：持久化 ──────────────────────────────

  /**
   * 安全的 DB 写入封装。
   *
   * 治理判例 NG-2026-0509-Persist-False-Positive（假阳性禁止原则）：
   * 持久化失败必须传播为操作失败，不得静默返回成功。
   * 调用方必须在 catch 块中回滚内存状态。
   */
  private _safeDbRun(sql: string, params: unknown[], opName: string): void {
    if (!this._db) return;
    try {
      this._db.run(sql, params as any);
    } catch (e) {
      if (this._observer) {
        this._observer.emit({
          type: "memory.db_write_failed",
          priority: PipelinePriority.CRITICAL,
          payload: { opName, sql: sql.slice(0, 80), error: String(e).slice(0, 300) },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      }
      throw e;
    }
  }

  /**
   * 标记脏数据，安排延迟写盘（防抖）。
   * 200ms 内的多次变更合并为一次写盘，减少 I/O 压力。
   * _flushing 守卫确保同一时刻最多一个 _saveDb 在执行，
   * 避免并发写盘导致旧快照覆盖新数据。
   */
  private _scheduleFlush(): void {
    if (this._lifecycle !== "active") return;
    this._dirty = true;
    if (this._flushing) return; // 正在刷盘中，当前实例完成后会自动重检 _dirty
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
    }
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._dirty = false;
      this._flushing = true;
      void this._saveDb().finally(() => {
        this._flushing = false;
        // 刷盘期间有新写入 → 重新安排，确保不丢数据
        if (this._dirty) this._scheduleFlush();
      });
    }, this._flushDebounceMs);
  }

  private _createTables(): void {
    if (!this._db) return;
    this._safeDbRun(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        memory_type TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'ACTIVE',
        content TEXT NOT NULL,
        summary TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        creator_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        weight REAL NOT NULL DEFAULT 1.0,
        project_fingerprint TEXT,
        metadata TEXT,
        is_private INTEGER NOT NULL DEFAULT 0
      )
    `, [], "create_tables.memories");
    this._safeDbRun(`
      CREATE TABLE IF NOT EXISTS links (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        link_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 0.5,
        target_state TEXT NOT NULL,
        last_accessed_at INTEGER NOT NULL
      )
    `, [], "create_tables.links");
    this._safeDbRun("CREATE INDEX IF NOT EXISTS idx_memories_state ON memories(state)", [], "create_tables.idx_state");
    this._safeDbRun("CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type)", [], "create_tables.idx_type");
    this._safeDbRun("CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id)", [], "create_tables.idx_source");
    this._safeDbRun("CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id)", [], "create_tables.idx_target");
    void this._scheduleFlush();
  }

  private _loadFromDb(): void {
    if (!this._db) return;

    // 加载记忆
    const memRows = this._db.exec("SELECT * FROM memories");
    if (memRows.length > 0) {
      const cols = memRows[0].columns;
      for (const row of memRows[0].values) {
        const raw: Record<string, unknown> = {};
        cols.forEach((c, i) => (raw[c] = row[i]));
        const entry = this._deserializeRow(raw);
        if (!entry) continue; // 跳过 JSON 损坏的行
        this.memories.set(entry.id, entry);
      }
    }

    // 加载关联
    const linkRows = this._db.exec("SELECT * FROM links");
    if (linkRows.length > 0) {
      const cols = linkRows[0].columns;
      for (const row of linkRows[0].values) {
        const raw: Record<string, unknown> = {};
        cols.forEach((c, i) => (raw[c] = row[i]));
        const link: MemoryLink = {
          id: raw.id as string,
          sourceId: raw.source_id as string,
          targetId: raw.target_id as string,
          linkType: raw.link_type as LinkType,
          weight: raw.weight as number,
          targetState: raw.target_state as MemoryState,
          lastAccessedAt: raw.last_accessed_at as number,
        };
        let existing = this.links.get(link.sourceId);
        if (!existing) {
          existing = [];
          this.links.set(link.sourceId, existing);
        }
        existing.push(link);
      }
    }
  }

  private async _saveDb(): Promise<void> {
    if (!this._db || !this._dbPath) return;

    // 指数退避重试：2 次，间隔 1s / 3s
    // 每次重试都重新导出最新快照，避免旧快照覆盖重试期间的新写入
    const retryDelays = [1000, 3000];
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      if (!this._db) return; // 守卫：close() 可能在重试等待期间释放了 _db
      try {
        const data = this._db.export();
        const buf = Buffer.from(data);
        fs.writeFileSync(this._dbPath, buf);
        return; // 成功，静默返回
      } catch (e) {
        lastError = e;
        if (attempt < retryDelays.length) {
          await new Promise<void>((r) => setTimeout(r, retryDelays[attempt]));
        }
      }
    }

    // 全部重试失败：通过 observer 上报，不静默吞错
    const errMsg = `[MemoryStore] _saveDb 磁盘写入失败（重试${retryDelays.length}次后仍失败）: ${String(lastError).slice(0, 300)}`;
    if (this._observer) {
      this._observer.emit({
        type: "memory.persist_failed",
        priority: PipelinePriority.CRITICAL,
        payload: { dbPath: this._dbPath, error: String(lastError), retries: retryDelays.length },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    } else {
      console.error(errMsg);
    }
  }

  // ── 内部：主读（SQL 查询 / 内存扫描）──────────

  /**
   * SQL 主读：将过滤条件下推到 SQLite WHERE 子句。
   * 关键词匹配用 LIKE，其余字段精确匹配。
   * 返回反序列化后的 MemoryEntry 数组。
   */
  private _sqlRead(query: MemoryQuery, now: number): MemoryEntry[] {
    if (!this._db) return [];

    const clauses: string[] = [];
    const params: (string | number)[] = [];

    // 状态
    if (query.states && query.states.length > 0) {
      clauses.push(`state IN (${query.states.map(() => "?").join(",")})`);
      params.push(...query.states);
    } else {
      clauses.push("state = ?");
      params.push(MemoryState.Active);
    }

    // 30 天窗口
    const cutoff = now - THIRTY_DAYS_MS;
    clauses.push("created_at > ?");
    params.push(cutoff);

    // 私密
    if (!query.includePrivate) {
      clauses.push("is_private = 0");
    }

    // 类型
    if (query.memoryTypes && query.memoryTypes.length > 0) {
      clauses.push(`memory_type IN (${query.memoryTypes.map(() => "?").join(",")})`);
      params.push(...query.memoryTypes);
    }

    // Agent 类型
    if (query.agentTypes && query.agentTypes.length > 0) {
      clauses.push(`agent_type IN (${query.agentTypes.map(() => "?").join(",")})`);
      params.push(...query.agentTypes);
    }

    // 时间范围
    if (query.timeRange) {
      clauses.push("created_at >= ? AND created_at <= ?");
      params.push(query.timeRange.start, query.timeRange.end);
    }

    // 关键词（summary LIKE + content LIKE）
    if (query.keywords && query.keywords.length > 0) {
      for (const kw of query.keywords) {
        clauses.push("(summary LIKE ? OR content LIKE ?)");
        params.push(`%${kw}%`, `%${kw}%`);
      }
    }

    const sql = `SELECT * FROM memories WHERE ${clauses.join(" AND ")} ORDER BY weight DESC`;

    try {
      const stmt = this._db.prepare(sql);
      stmt.bind(params);
      const rows: MemoryEntry[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        const entry = this._deserializeRow(row as Record<string, unknown>);
        if (entry) rows.push(entry);
      }
      stmt.free();
      // metadata 过滤（SQL 层不做 JSON 子串匹配）
      if (query.metadataFilter && Object.keys(query.metadataFilter).length > 0) {
        return rows.filter((m) => {
          if (!m.metadata) return false;
          return Object.entries(query.metadataFilter!).every(
            ([k, v]) => m.metadata![k] === v,
          );
        });
      }
      return rows;
    } catch (e) {
      // SQL 出错时退回内存扫描，通过 observer 上报退化事件
      if (this._observer) {
        this._observer.emit({
          type: "memory.sql_degraded",
          priority: PipelinePriority.HIGH,
          payload: { error: String(e).slice(0, 200) },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.warn(`[MemoryStore] SQL 查询退化至内存扫描: ${String(e).slice(0, 200)}`);
      }
      return this._memScanRead(query, now);
    }
  }

  /**
   * 内存扫描读取（无持久化时的回退方案）。
   * 全量扫描 Map → JS filter。
   */
  private _memScanRead(query: MemoryQuery, now: number): MemoryEntry[] {
    let results = Array.from(this.memories.values());

    if (query.states && query.states.length > 0) {
      results = results.filter((m) => query.states!.includes(m.state));
    } else {
      results = results.filter((m) => m.state === MemoryState.Active);
    }

    results = results.filter((m) => now - m.createdAt < THIRTY_DAYS_MS);

    if (!query.includePrivate) {
      results = results.filter((m) => !m.isPrivate);
    }

    if (query.memoryTypes && query.memoryTypes.length > 0) {
      results = results.filter((m) => query.memoryTypes!.includes(m.memoryType));
    }

    if (query.agentTypes && query.agentTypes.length > 0) {
      results = results.filter((m) => query.agentTypes!.includes(m.agentType));
    }

    if (query.timeRange) {
      results = results.filter(
        (m) => m.createdAt >= query.timeRange!.start && m.createdAt <= query.timeRange!.end,
      );
    }

    if (query.keywords && query.keywords.length > 0) {
      results = results.filter((m) => {
        const searchText = (m.summary + " " + JSON.stringify(m.content)).toLowerCase();
        return query.keywords!.every((kw) => searchText.includes(kw.toLowerCase()));
      });
    }

    if (query.metadataFilter && Object.keys(query.metadataFilter).length > 0) {
      results = results.filter((m) => {
        if (!m.metadata) return false;
        return Object.entries(query.metadataFilter!).every(
          ([k, v]) => m.metadata![k] === v,
        );
      });
    }

    return results;
  }

  /** 将 SQLite 行反序列化为 MemoryEntry */
  private _deserializeRow(raw: Record<string, unknown>): MemoryEntry | null {
    // 前置过滤：非 JSON 格式的纯文本字符串直接跳过，不进入 JSON.parse
    // 支持 JSON 对象 ({) 和数组 ([) 两种合法格式
    const contentStr = raw.content as string;
    if (typeof contentStr === 'string' && contentStr.trim().length > 0 && !contentStr.trimStart().startsWith('{') && !contentStr.trimStart().startsWith('[')) {
      if (this._observer) {
        this._observer.emit({
          type: "memory.deserialize_failed",
          priority: PipelinePriority.HIGH,
          payload: { id: raw.id, reason: "non-json content", preview: contentStr.slice(0, 100) },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.error(`[MemoryStore] 非 JSON 内容，跳过行 ${raw.id}: ${contentStr.slice(0, 100)}`);
      }
      return null;
    }

    try {
      return {
        id: raw.id as string,
        memoryType: raw.memory_type as MemoryType,
        state: raw.state as MemoryState,
        content: JSON.parse(raw.content as string),
        summary: raw.summary as string,
        agentType: raw.agent_type as AgentType,
        creatorId: raw.creator_id as string,
        createdAt: raw.created_at as number,
        lastAccessedAt: raw.last_accessed_at as number,
        accessCount: raw.access_count as number,
        weight: raw.weight as number,
        projectFingerprint: raw.project_fingerprint as string | undefined,
        metadata: raw.metadata ? JSON.parse(raw.metadata as string) : undefined,
        isPrivate: (raw.is_private as number) === 1,
      };
    } catch (e) {
      // JSON 损坏：跳过该行并上报，不崩溃整个 init()
      if (this._observer) {
        this._observer.emit({
          type: "memory.deserialize_failed",
          priority: PipelinePriority.HIGH,
          payload: { id: raw.id, error: String(e).slice(0, 200) },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      } else {
        console.error(`[MemoryStore] JSON 解析失败，跳过行 ${raw.id}: ${String(e).slice(0, 200)}`);
      }
      return null;
    }
  }

  // ── 内部：BFS 图遍历 ──────────────────────────

  /**
   * BFS 双向图遍历扩展种子集。
   * - 出边：种子记忆 → 关联目标
   * - 入边：谁关联了种子记忆
   * - 权重按深度衰减: weight * 0.7^depth
   * - bfsMaxNodes 硬上限防止图爆炸
   */
  private _bfsExpand(seeds: MemoryEntry[], maxDepth: number, maxNodes: number, linkTypes?: LinkType[]): MemoryEntry[] {
    const seedIds = new Set(seeds.map((m) => m.id));
    const visited = new Set(seedIds);
    const discovered = new Map<string, MemoryEntry>();

    // 构建反向邻接表（入边索引）
    const reverseAdj = this._buildReverseAdjacency();

    // BFS
    let frontier = [...seedIds];
    for (let depth = 1; depth <= maxDepth && visited.size < maxNodes; depth++) {
      const nextFrontier: string[] = [];
      const decay = Math.pow(0.7, depth);

      for (const id of frontier) {
        if (visited.size >= maxNodes) break;

        // 出边：当前记忆 → 目标
        const outLinks = this.links.get(id) ?? [];
        for (const link of outLinks) {
          if (visited.size >= maxNodes) break;
          // linkTypes 过滤：未指定时遍历所有边
          if (linkTypes && linkTypes.length > 0 && !linkTypes.includes(link.linkType)) continue;
          if (!visited.has(link.targetId)) {
            const target = this.memories.get(link.targetId);
            if (target && target.state !== MemoryState.Obliterated) {
              visited.add(link.targetId);
              nextFrontier.push(link.targetId);
              if (!seedIds.has(link.targetId)) {
                discovered.set(link.targetId, { ...target, weight: +(target.weight * decay).toFixed(4) });
              }
            }
          }
        }

        // 入边：谁关联了当前记忆
        const incoming = reverseAdj.get(id);
        if (incoming) {
          for (const sourceId of incoming) {
            if (visited.size >= maxNodes) break;
            if (!visited.has(sourceId)) {
              const source = this.memories.get(sourceId);
              if (source && source.state !== MemoryState.Obliterated) {
                visited.add(sourceId);
                nextFrontier.push(sourceId);
                if (!seedIds.has(sourceId)) {
                  discovered.set(sourceId, { ...source, weight: +(source.weight * decay).toFixed(4) });
                }
              }
            }
          }
        }
      }

      frontier = nextFrontier;
    }

    // 合并：种子 + BFS 发现
    const merged = [...seeds];
    for (const [id, entry] of discovered) {
      if (!seedIds.has(id)) {
        merged.push(entry);
      }
    }
    return merged;
  }

  /** 构建反向邻接表：targetId → Set<sourceId> */
  private _buildReverseAdjacency(): Map<string, Set<string>> {
    const rev = new Map<string, Set<string>>();
    for (const [sourceId, linkList] of this.links) {
      for (const link of linkList) {
        let targets = rev.get(link.targetId);
        if (!targets) {
          targets = new Set();
          rev.set(link.targetId, targets);
        }
        targets.add(sourceId);
      }
    }
    return rev;
  }

  // ── 内部校验 ──────────────────────────────────

  /** 四态流转合法性检查 */
  private _isValidTransition(from: MemoryState, to: MemoryState): boolean {
    if (from === MemoryState.Obliterated) return false;
    if (from !== MemoryState.Active && to === MemoryState.Active) return false;
    if (from === MemoryState.Frozen && to !== MemoryState.Obliterated) return false;
    return true;
  }
}

// ─── LinkType → 初始权重映射（议题四 3.3） ──────────

const LINK_WEIGHTS: Record<string, number> = {
  ACCESSED_DURING: 0.2,
  PRODUCED_BY: 0.5,
  DERIVED_FROM: 0.7,
  DEPENDS_ON: 0.9,
  REFACTORED_FROM: 0.8,
  CITED_IN_COMMITTEE: 0.7,
  CASCADE_TO: 1.0,
};
