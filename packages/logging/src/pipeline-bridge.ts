import { LogLevel, LOG_LEVEL_PRIORITY } from "./log-level.js";
import type { LogEntry } from "./types.js";
export interface PipelineBridgeOptions { readonly minLevel?: LogLevel; readonly source?: string; }
export class LoggingPipelineBridge {
  private readonly _minLevel: LogLevel;
  private readonly _source: string;
  constructor(private readonly _options: PipelineBridgeOptions & { emit: (event: string) => void }) {
    this._minLevel = _options.minLevel ?? LogLevel.Warn;
    this._source = _options.source ?? "logging";
  }
  createTransport() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      name: "pipeline-bridge",
      async write(entry: LogEntry): Promise<void> {
        if (LOG_LEVEL_PRIORITY[entry.level] < LOG_LEVEL_PRIORITY[self._minLevel]) return;
        const { level, source, event } = self._mapEntry(entry);
        self._options.emit(JSON.stringify({ level, source, event, timestamp: entry.timestamp }));
      },
      async flush(): Promise<void> {},
      async dispose(): Promise<void> {},
    };
  }
  private _mapEntry(entry: LogEntry): { level: string; source: string; event: string } {
    let level: string;
    switch (entry.level) {
      case LogLevel.Fatal: level = "fatal"; break;
      case LogLevel.Error: case LogLevel.Warn: level = "degraded"; break;
      default: level = "silent";
    }
    return { level, source: this._source, event: '['+entry.loggerName+'] '+entry.message };
  }
}
