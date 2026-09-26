// ============================================================
// @cortex/telemetry — AuditTrail 审计跟踪
//
// JSONL 追加写入，每次 record* 调用追加一行。
// queryBySpan 按 spanId 扫描行匹配。
// Phase 0 低频写入，不批量缓冲，简单为主。
//
// 幂等约定（仅 config_violation）：
//   config_violation 描述的是「配置当前处于什么状态」，不是「发生了一件什么事」。
//   同一 (schemaName, errors) 在同一个日志世代内只落盘一次；再次观测到同一状态不追加。
//   依据：跨字段校验警告是仓库配置的静态属性，不随运行变化。旧实现每次 bootstrap 无条件追加，
//   实测在 audit.jsonl 累积 882 条完全相同条目（单条约 1966 字节 ≈ 1.73 MB，占文件 68%）。
//   其余 record* 类型是事件（override/reload/degradation/domain_filter），保持逐次追加。
//   跨进程尽力而为：并发写入者可能各记一次，去重不做锁。
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

/**
 * config_violation 的内容签名——同一配置状态映射到同一签名。
 * 用 NUL/SOH 分隔以免字段内容被拼接歧义（config 文本里不会出现这两个控制字符）。
 */
function violationSignature(schemaName: string, errors: readonly string[]): string {
  return `${schemaName}\u0000${errors.join("\u0001")}`;
}

// ─── AuditTrail ─────────────────────────────────────

export class AuditTrail {
  private readonly logPath: string;
  private readonly fd: number;
  private _closed = false;
  /** 已落盘的 config_violation 签名缓存；null = 尚未从磁盘播种 */
  private _violationSignatures: Set<string> | null = null;

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

  /**
   * 落盘 config_violation 条目。
   *
   * **幂等**：同一 (schemaName, errors) 若已在当前 audit.jsonl 中出现过，则不再追加。
   * 配置违规是「状态」而非「事件」——重复观测同一状态不构成新信息，只把文件撑成大段重复。
   * 想要重新记录，先修复配置（errors 变化 → 签名变化 → 记一条新的）。
   */
  recordConfigViolation(schemaName: string, errors: string[]): void {
    const signature = violationSignature(schemaName, errors);
    const seen = this._loadViolationSignatures();
    if (seen.has(signature)) return;
    seen.add(signature);

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

  /**
   * 从磁盘播种已知 config_violation 签名（只读一次，之后走内存缓存）。
   * 损坏行跳过——与 queryBySpan 一致。
   */
  private _loadViolationSignatures(): Set<string> {
    if (this._violationSignatures !== null) return this._violationSignatures;

    const seen = new Set<string>();
    if (fs.existsSync(this.logPath)) {
      let content: string;
      try {
        content = fs.readFileSync(this.logPath, "utf-8");
      } catch {
        // 读失败则不播种：退化为「本次记录一次」，不阻塞写入
        this._violationSignatures = seen;
        return seen;
      }
      for (const line of content.split("\n")) {
        if (!line) continue;
        try {
          const entry = JSON.parse(line) as AuditEntry;
          if (entry.type === "config_violation") {
            seen.add(violationSignature(entry.schemaName, entry.errors));
          }
        } catch {
          continue;
        }
      }
    }

    this._violationSignatures = seen;
    return seen;
  }

  private _append(entry: AuditEntry): void {
    if (this._closed) return;
    const line = JSON.stringify(entry) + "\n";
    try {
      fs.writeSync(this.fd, line);
    } catch (err) { process.stderr.write(`[AuditTrail] write failed: ${String(err)}\n`); }
  }
}
