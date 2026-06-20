import { promises as fsp } from "node:fs";
import type { LogEntry } from "./types.js";
import type { Transport } from "./transport.js";
import type { Formatter } from "./formatter.js";
import { DefaultFormatter } from "./formatter.js";
export class FileTransport implements Transport {
  readonly name = "file";
  private readonly _path: string;
  private readonly _formatter: Formatter;
  private _fd: fsp.FileHandle | null = null;
  constructor(options?: { readonly path?: string; readonly formatter?: Formatter }) {
    this._path = options?.path ?? "./cortex.log";
    this._formatter = options?.formatter ?? new DefaultFormatter();
  }
  async write(entry: LogEntry): Promise<void> {
    if (!this._fd) this._fd = await fsp.open(this._path, "a");
    await this._fd.write(this._formatter.format(entry) + "\n");
  }
  async flush(): Promise<void> { if (this._fd) await this._fd.sync(); }
  async dispose(): Promise<void> { if (this._fd) { await this._fd.close(); this._fd = null; } }
}
