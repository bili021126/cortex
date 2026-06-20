import { LogLevel, LOG_LEVEL_PRIORITY } from "./log-level.js";
import type { LogEntry, LoggerOptions } from "./types.js";
import type { Transport } from "./transport.js";
export class Logger {
  readonly name: string;
  private readonly _transports: readonly Transport[];
  private readonly _globalMeta?: Record<string,unknown>;
  private _minLevel: LogLevel;
  constructor(name: string, transports: readonly Transport[], globalMeta?: Record<string,unknown>, options?: LoggerOptions) {
    this.name = name;
    this._transports = transports;
    this._globalMeta = globalMeta;
    this._minLevel = options?.minLevel ?? LogLevel.Info;
  }
  debug(msg: string, meta?: Record<string,unknown>) { this._log(LogLevel.Debug, msg, meta); }
  info(msg: string, meta?: Record<string,unknown>) { this._log(LogLevel.Info, msg, meta); }
  warn(msg: string, meta?: Record<string,unknown>) { this._log(LogLevel.Warn, msg, meta); }
  error(msg: string, meta?: Record<string,unknown>, error?: Error) { this._log(LogLevel.Error, msg, meta, error); }
  fatal(msg: string, meta?: Record<string,unknown>, error?: Error) { this._log(LogLevel.Fatal, msg, meta, error); }
  private _log(level: LogLevel, message: string, meta?: Record<string,unknown>, error?: Error) {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this._minLevel]) return;
    const entry: LogEntry = { timestamp: Date.now(), level, loggerName: this.name, message, meta: this._mergeMeta(meta), error };
    for (const t of this._transports) { t.write(entry).catch(() => {}); }
  }
  private _mergeMeta(meta?: Record<string,unknown>): Record<string,unknown>|undefined {
    if (!this._globalMeta) return meta;
    if (!meta) return this._globalMeta;
    return { ...this._globalMeta, ...meta };
  }
}
