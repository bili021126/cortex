// ============================================================
// @cortex/telemetry — AuditTrail 审计跟踪
//
// JSONL 追加写入，每次 record* 调用追加一行。
// queryBySpan 按 spanId 扫描行匹配。
// Phase 0 低频写入，不批量缓冲，简单为主。
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";

// ─── 审计条目类型 ─────────────────────────────────

export interface AuditEntryBase {
  /** 审计条目唯一 ID */
  id: string;
  /** 时间戳（ms） */
  timestamp: number;
  /** 关联的 spanId（可选——通话/配置/场景/启动/系统） */
  spanId?: string;
}

export interface ConfigOverrideEntry extends AuditEntryBase {
  type: "config_override";
  key: string;
  source: string;
  oldValue: string;
  newValue: string;
}

export interface ConfigReloadEntry extends AuditEntryBase {
  type: "config_reload";
  watchPath: string;
  changedKeys: string[];
}

export interface ConfigViolationEntry extends AuditEntryBase {
  type: "config_violation";
  schemaName: string;
  errors: string[];
}

export interface DomainFilterEntry extends AuditEntryBase {
  type: "domain_filter";
  query: string;
  allowed: string[];
  blocked: string[];
  stats: { total: number; allowedCount: number; blockedCount: number };
}

export interface DegradationEntry extends AuditEntryBase {
  type: "degradation";
  source: string;
  level: string;
  errorType: string;
}

export interface RecordConfigOverrideOptions {
  key: string;
  source: string;
  oldValue: string;
  newValue: string;
}

export interface RecordDomainFilterOptions {
  query: string;
  allowed: string[];
  blocked: string[];
  stats: { total: number; allowedCount: number; blockedCount: number };
}

export type AuditEntry =
  | ConfigOverrideEntry
  | ConfigReloadEntry
  | ConfigViolationEntry
  | DomainFilterEntry
  | DegradationEntry;

// ─── AuditTrail ─────────────────────────────────────

export class AuditTrail {
  private readonly logPath: string;
  private readonly fd: number;
  private _closed = false;

  /**
   * @param logDir 日志目录，默认取 `.cortex/logs`（相对于 process.cwd()）
   */
  constructor(logDir?: string) {
    const resolvedDir = logDir ?? path.join(process.cwd(), ".cortex", "logs");
    if (!fs.existsSync(resolvedDir)) {
      fs.mkdirSync(resolvedDir, { recursive: true });
    }
    this.logPath = path.join(resolvedDir, "audit.jsonl");
    // append 模式打开文件描述符
    this.fd = fs.openSync(this.logPath, "a");
  }

  // ── record* 方法 ──────────────────────────

  recordConfigOverride(options: RecordConfigOverrideOptions): void {
    const entry: ConfigOverrideEntry = {
      id: this._nextId(),
      timestamp: Date.now(),
      type: "config_override",
      key: options.key,
      source: options.source,
      oldValue: String(options.oldValue),
      newValue: String(options.newValue),
    };
    this._append(entry);
  }

  recordConfigReload(watchPath: string, changedKeys: string[]): void {
    const entry: ConfigReloadEntry = {
      id: this._nextId(),
      timestamp: Date.now(),
      type: "config_reload",
      watchPath,
      changedKeys,
    };
    this._append(entry);
  }

  recordConfigViolation(schemaName: string, errors: string[]): void {
    const entry: ConfigViolationEntry = {
      id: this._nextId(),
      timestamp: Date.now(),
      type: "config_violation",
      schemaName,
      errors,
    };
    this._append(entry);
  }

  recordDomainFilter(options: RecordDomainFilterOptions): void {
    const entry: DomainFilterEntry = {
      id: this._nextId(),
      timestamp: Date.now(),
      type: "domain_filter",
      query: options.query,
      allowed: options.allowed,
      blocked: options.blocked,
      stats: options.stats,
    };
    this._append(entry);
  }

  recordDegradation(source: string, level: string, errorType: string): void {
    const entry: DegradationEntry = {
      id: this._nextId(),
      timestamp: Date.now(),
      type: "degradation",
      source,
      level,
      errorType,
    };
    this._append(entry);
  }

  // ── 查询 ──────────────────────────────────

  /**
   * 按 spanId 扫描文件，返回所有匹配的审计条目。
   * 线性扫描——Phase 0 低频使用，可接受。
   */
  queryBySpan(spanId: string): AuditEntry[] {
    if (!fs.existsSync(this.logPath)) return [];

    const content = fs.readFileSync(this.logPath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const results: AuditEntry[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as AuditEntry;
        if (entry.spanId === spanId) {
          results.push(entry);
        }
      } catch {
        // 损坏的行跳过
        continue;
      }
    }

    return results;
  }

  // ── flush ─────────────────────────────────

  /**
   * 调用 fs.fsync 确保写入。
   */
  flush(): void {
    if (this._closed) return;
    try {
      fs.fsyncSync(this.fd);
    } catch {
      // Phase 0 静默失败
    }
  }

  /**
   * 关闭文件描述符。
   */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    try {
      fs.closeSync(this.fd);
    } catch {
      // 静默
    }
  }

  // ── 私有 ──────────────────────────────────

  private _nextId(): string {
    return `aud-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private _append(entry: AuditEntry): void {
    if (this._closed) return;
    const line = JSON.stringify(entry) + "\n";
    try {
      fs.writeSync(this.fd, line);
    } catch (err) { process.stderr.write(`[AuditTrail] write failed: ${String(err)}\n`); }
  }
}
