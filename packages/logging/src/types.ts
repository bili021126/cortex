import type { LogLevel } from "./log-level.js";
import type { Transport } from "./transport.js";
export interface LogEntry { readonly timestamp: number; readonly level: LogLevel; readonly loggerName: string; readonly message: string; readonly meta?: Record<string,unknown>; readonly error?: Error; }
export interface LoggerOptions { readonly minLevel?: LogLevel; readonly includeStack?: boolean; }
export interface LoggerConfig { readonly minLevel: LogLevel; readonly transports: readonly Transport[]; readonly structured: boolean; readonly globalMeta?: Record<string,unknown>; }
