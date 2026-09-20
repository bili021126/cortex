// ============================================================
// @cortex/memory — SqliteMigrations 独立迁移定义
//
// 与 SqliteStorageBackend 解耦的迁移管线：
//   - 每个迁移为 { version, name, up } 声明式条目
//   - PRAGMA user_version 记录当前 schema 版本
//   - migrate() 按序执行未应用迁移，逐条事务包裹
//
// @design 结构类型（duck typing）：迁移只依赖 prepare/exec/pragma
//   三个方法，不绑定 better-sqlite3 类型——保持动态加载降级能力。
// ============================================================

/** 迁移执行所需的数据库最小接口（结构类型，兼容 better-sqlite3） */
export interface MigratableDb {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): void;
  pragma(sql: string): unknown;
}

/** 单条迁移定义 */
export interface SqliteMigration {
  /** schema 版本号（单调递增，写入 PRAGMA user_version） */
  version: number;
  /** 迁移名称（日志/诊断用） */
  name: string;
  /** 迁移执行体——同步执行（better-sqlite3 为同步 API） */
  up(db: MigratableDb): void;
}

/**
 * 全量迁移清单——只允许追加，禁止修改已发布版本（防再漂移机制）。
 *
 * v1（初始）：
 *   - memories：记忆条目主表（MemoryEntry 全字段映射）
 *   - memory_links：关联链路表（source_id + target_id + link_type 复合主键）
 *   - memories_fts：FTS5 全文索引（独立表，rowid 与 memories.rowid 人工对应）
 *   - 检索辅助索引（kind / created_at / links.target_id）
 *
 * @note 为何不用 external content 模式：external content 的 'delete' 命令
 *   对索引中不存在的 rowid 会报 SQLITE_CORRUPT_VTAB（实测），且 rowid 查询
 *   会透传 content 表导致无法探测索引存在性。独立表 DELETE 幂等零风险。
 */
export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    name: "init-memories-schema",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          domain TEXT NOT NULL DEFAULT 'general',
          session_id TEXT,
          kind TEXT NOT NULL,
          is_fact INTEGER NOT NULL DEFAULT 1,
          summary TEXT NOT NULL,
          semantic_gist TEXT NOT NULL,
          content_blob TEXT NOT NULL,
          semantic_state TEXT NOT NULL,
          weight REAL NOT NULL DEFAULT 0,
          access_count INTEGER NOT NULL DEFAULT 0,
          last_accessed_at INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          content_hash TEXT NOT NULL DEFAULT '',
          expires_at INTEGER,
          embedding TEXT,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memory_links (
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          link_type TEXT NOT NULL,
          weight REAL NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (source_id, target_id, link_type)
        );
        CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
        CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
        CREATE INDEX IF NOT EXISTS idx_links_target ON memory_links(target_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          summary,
          semantic_gist,
          content_blob,
          tokenize = 'trigram'
        );
      `);
    },
  },
  {
    version: 2,
    name: "add-session-id-column",
    up(db) {
      // 修复：session_id 是后加入 v1 建表语句的，但 v1 用 CREATE TABLE IF NOT EXISTS——
      // 对已存在的老 memories 表不会补列（迁移又 append-only 不可改 v1），
      // 导致 daemon 写记忆时 INSERT ... session_id 报 "table memories has no column named session_id"。
      // 这里检测列是否存在，缺失则 ALTER 补上（幂等，新库无副作用）。
      const cols = db.pragma("table_info(memories)") as Array<{ name?: string }> | undefined;
      const hasCol = Array.isArray(cols) && cols.some((c) => c?.name === "session_id");
      if (!hasCol) {
        db.exec("ALTER TABLE memories ADD COLUMN session_id TEXT");
      }
    },
  },
  {
    version: 3,
    name: "ensure-all-memory-columns",
    up(db) {
      // 更彻底的 schema 漂移修复：老库（早于当前 v1 定义）可能缺多列（is_fact/domain/
      // semantic_state/updated_at/…），逐列检测缺失则 ALTER 补上（可空，代码写入时总会赋值）。
      // 覆盖 v2 只补 session_id 的不足——修复 daemon POST /memory 报 "no column named is_fact" 等。
      const cols = new Set(
        (db.pragma("table_info(memories)") as Array<{ name?: string }> | undefined ?? []).map((c) => c?.name),
      );
      const ensure: ReadonlyArray<readonly [string, string]> = [
        ["domain", "TEXT"],
        ["session_id", "TEXT"],
        ["is_fact", "INTEGER"],
        ["semantic_state", "TEXT"],
        ["weight", "REAL"],
        ["access_count", "INTEGER"],
        ["last_accessed_at", "INTEGER"],
        ["content_hash", "TEXT"],
        ["expires_at", "INTEGER"],
        ["embedding", "TEXT"],
        ["updated_at", "INTEGER"],
      ];
      for (const [name, type] of ensure) {
        if (!cols.has(name)) db.exec(`ALTER TABLE memories ADD COLUMN ${name} ${type}`);
      }
    },
  },
  {
    version: 4,
    name: "rebuild-memories-to-canonical-schema",
    up(db) {
      // 早期 memory 数据模型（memory_type/content/agent_type/creator_id/state/is_private/sub_type）
      // 与当前 MemoryEntry 模型不兼容，且 legacy 列 NOT NULL 无默认 → 当前 INSERT 不填 → daemon 写记忆 500。
      // 检测：若仍存在 legacy `memory_type` 列则重建为规范表并尽力映射历史行（幂等：规范库直接跳过）。
      const cols = new Set(
        ((db.pragma("table_info(memories)") as Array<{ name?: string }> | undefined) ?? []).map((c) => c?.name),
      );
      if (!cols.has("memory_type")) return; // 已是规范 schema，无需重建

      db.exec(`
        CREATE TABLE memories__canonical (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL DEFAULT '{}',
          domain TEXT NOT NULL DEFAULT 'general',
          session_id TEXT,
          kind TEXT NOT NULL DEFAULT 'TaskLog',
          is_fact INTEGER NOT NULL DEFAULT 1,
          summary TEXT NOT NULL DEFAULT '',
          semantic_gist TEXT NOT NULL DEFAULT '',
          content_blob TEXT NOT NULL DEFAULT '',
          semantic_state TEXT NOT NULL DEFAULT 'Active',
          weight REAL NOT NULL DEFAULT 0,
          access_count INTEGER NOT NULL DEFAULT 0,
          last_accessed_at INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT 0,
          content_hash TEXT NOT NULL DEFAULT '',
          expires_at INTEGER,
          embedding TEXT,
          updated_at INTEGER NOT NULL DEFAULT 0
        );
      `);
      db.exec(`
        INSERT INTO memories__canonical
          (id, source, domain, kind, summary, semantic_gist, content_blob, semantic_state, weight, access_count, last_accessed_at, created_at, embedding, updated_at)
        SELECT
          id,
          json_object('agentType', COALESCE(NULLIF(agent_type,''),'butler'), 'taskId', COALESCE(creator_id,'')),
          COALESCE(NULLIF(domain,''),'general'),
          COALESCE(NULLIF(kind,''), NULLIF(memory_type,''), 'TaskLog'),
          COALESCE(NULLIF(summary,''), substr(COALESCE(content,''),1,200), ''),
          COALESCE(semantic_gist, ''),
          CASE WHEN content_blob IS NOT NULL AND content_blob <> '' THEN content_blob
               ELSE json_object('legacy_content', COALESCE(content, '')) END,
          COALESCE(NULLIF(semantic_state,''),
                   CASE WHEN upper(state)='ACTIVE' THEN 'Active' WHEN upper(state)='ARCHIVED' THEN 'Archived' ELSE 'Active' END,
                   'Active'),
          COALESCE(weight, 0),
          COALESCE(access_count, 0),
          COALESCE(last_accessed_at, 0),
          COALESCE(created_at, 0),
          embedding,
          COALESCE(updated_at, created_at, 0)
        FROM memories;
      `);
      db.exec(`DROP TABLE memories;`);
      db.exec(`ALTER TABLE memories__canonical RENAME TO memories;`);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
        CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
      `);
    },
  },
  {
    version: 5,
    name: "rebuild-memories-fts",
    up(db) {
      // 承接 v4：老库的 memories_fts（FTS5）也是旧列集（无 content_blob）→ persist 写 FTS 报
      // "table memories_fts has no column named content_blob"。重建为规范列并从 memories 回填。
      // 幂等：已是规范（含 content_blob）则跳过。
      const ftsCols = new Set(
        ((db.pragma("table_info(memories_fts)") as Array<{ name?: string }> | undefined) ?? []).map((c) => c?.name),
      );
      if (ftsCols.has("content_blob")) return;
      db.exec(`DROP TABLE IF EXISTS memories_fts;`);
      db.exec(`CREATE VIRTUAL TABLE memories_fts USING fts5(summary, semantic_gist, content_blob, tokenize = 'trigram');`);
      db.exec(`INSERT INTO memories_fts(rowid, summary, semantic_gist, content_blob)
        SELECT rowid, summary, semantic_gist, content_blob FROM memories;`);
    },
  },
];

/** 当前最新 schema 版本——migrate 目标 */
export const SQLITE_SCHEMA_VERSION = SQLITE_MIGRATIONS[SQLITE_MIGRATIONS.length - 1]?.version ?? 0;

/**
 * 读取 pragma 数值（better-sqlite3 返回 [{name: value}] 数组形态）
 */
function pragmaNumber(db: MigratableDb, name: string): number {
  const v = db.pragma(name);
  if (Array.isArray(v)) {
    const first = v[0] as Record<string, unknown> | undefined;
    return Number(first?.[name] ?? 0) || 0;
  }
  return Number(v) || 0;
}

/**
 * 应用迁移：读取 user_version，按序执行未应用的迁移。
 * 每条迁移在独立事务中执行，失败即回滚并抛出。
 */
export function migrateSqlite(db: MigratableDb): void {
  const current = pragmaNumber(db, "user_version");
  const pending = SQLITE_MIGRATIONS.filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    db.exec("BEGIN");
    try {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(
        `[sqlite-migrations] 迁移 v${migration.version}（${migration.name}）失败: ` +
        `${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
}
