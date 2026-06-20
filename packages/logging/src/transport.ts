import type { LogEntry } from "./types.js";
export interface Transport { readonly name: string; write(entry: LogEntry): Promise<void>; flush(): Promise<void>; dispose(): Promise<void>; }
