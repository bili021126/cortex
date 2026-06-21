import { LogLevel } from "./log-level.js";
import type { LogEntry } from "./types.js";
import type { Transport } from "./transport.js";
import type { Formatter } from "./formatter.js";
import { DefaultFormatter } from "./formatter.js";
export class ConsoleTransport implements Transport {
  readonly name = "console";
  private readonly _formatter: Formatter;
  constructor(private readonly _options?: { readonly color?: boolean; readonly showTimestamp?: boolean; readonly formatter?: Formatter }) {
    this._formatter = _options?.formatter ?? new DefaultFormatter({ color: _options?.color, showTimestamp: _options?.showTimestamp });
  }
  async write(entry: LogEntry): Promise<void> {
    /* eslint-disable no-console */
    const msg = this._formatter.format(entry);
    if (entry.level <= LogLevel.Info) console.log(msg);
    else if (entry.level === LogLevel.Warn) console.warn(msg);
    else console.error(msg);
  }
  async flush(): Promise<void> {}
  async dispose(): Promise<void> {}
}
