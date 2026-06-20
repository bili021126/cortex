import { LogLevel } from "./log-level.js";
import type { LoggerConfig } from "./types.js";
import { ConsoleTransport } from "./console-transport.js";
export const DEFAULT_LOGGER_CONFIG: LoggerConfig = { minLevel: LogLevel.Info, transports: [new ConsoleTransport()], structured: true, globalMeta: undefined };
export const LOG_CONFIG_DEFAULTS = { MIN_LEVEL: LogLevel.Info, STRUCTURED: true, GLOBAL_META: undefined as Record<string,unknown>|undefined };
