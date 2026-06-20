import type { LogEntry } from "./types.js";
import { LOG_LEVEL_LABELS } from "./log-level.js";
export interface Formatter { format(entry: LogEntry): string; }
export interface DefaultFormatterOptions { readonly color?: boolean; readonly showTimestamp?: boolean; }
export interface JsonFormatterOptions { readonly pretty?: boolean; }
export class DefaultFormatter implements Formatter {
  private readonly _color: boolean;
  private readonly _ts: boolean;
  constructor(o?: DefaultFormatterOptions) { this._color = o?.color !== false; this._ts = o?.showTimestamp !== false; }
  format(e: LogEntry): string {
    const ts = this._ts ? new Date(e.timestamp).toISOString()+' ' : '';
    const lvl = this._color ? LOG_LEVEL_LABELS[e.level] : LOG_LEVEL_LABELS[e.level];
    const meta = e.meta ? ' '+JSON.stringify(e.meta) : '';
    const err = e.error ? ' '+e.error.message : '';
    return ts+'['+lvl+'] '+e.loggerName+': '+e.message+meta+err;
  }
}
export class JsonFormatter implements Formatter {
  private readonly _pretty: boolean;
  constructor(o?: JsonFormatterOptions) { this._pretty = o?.pretty ?? false; }
  format(e: LogEntry): string {
    const obj = { ts: e.timestamp, level: LOG_LEVEL_LABELS[e.level], logger: e.loggerName, msg: e.message, meta: e.meta, error: e.error?.message };
    return this._pretty ? JSON.stringify(obj,null,2) : JSON.stringify(obj);
  }
}
