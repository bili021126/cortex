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
