
import type { LoggerConfig } from "./types.js";
import type { Transport } from "./transport.js";
import { Logger } from "./logger.js";
import { DEFAULT_LOGGER_CONFIG } from "./config.js";

let _rootConfig: LoggerConfig = { ...DEFAULT_LOGGER_CONFIG };
const _cache = new Map<string, Logger>();

export function createLogger(name: string): Logger {
  const cached = _cache.get(name);
  if (cached) return cached;
  const logger = new Logger(name, _rootConfig.transports, _rootConfig.globalMeta, { minLevel: _rootConfig.minLevel });
  _cache.set(name, logger);
  return logger;
}

export function getLogger(name: string): Logger | undefined { return _cache.get(name); }

export function configureRootLogger(config: Partial<LoggerConfig>) {
  _rootConfig = {
    ..._rootConfig,
    ...(config.minLevel !== undefined && { minLevel: config.minLevel }),
    ...(config.transports !== undefined && { transports: config.transports }),
    ...(config.structured !== undefined && { structured: config.structured }),
    ...(config.globalMeta !== undefined && { globalMeta: config.globalMeta }),
  };
}

export function addTransport(transport: Transport) {
  _rootConfig = { ..._rootConfig, transports: [..._rootConfig.transports, transport] };
}

export async function shutdownLoggers(): Promise<void> {
  for (const t of _rootConfig.transports) { await t.flush(); await t.dispose(); }
  _cache.clear();
}

export function rootLogger(): Logger { return _cache.get("") ?? createLogger(""); }
