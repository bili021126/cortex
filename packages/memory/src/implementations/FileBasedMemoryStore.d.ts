import type { MemoryEntry } from "@cortex/shared";
import { AbstractMemoryStore } from "./AbstractMemoryStore.js";
/**
 * FileBasedMemoryStore —— 基于 JSON 文件持久化的 MemoryStore 实现。
 *
 * 继承 AbstractMemoryStore 的全部 36 个共享方法，注入 FileBackend，
 * 并覆写 write/set/delete 以支持 autoFlush。
 */
export declare class FileBasedMemoryStore extends AbstractMemoryStore {
    private readonly _fileBackend;
    private readonly _autoFlush;
    get isPersisted(): boolean;
    constructor(options?: FileBasedMemoryStoreOptions);
    write(input: Parameters<AbstractMemoryStore["write"]>[0]): ReturnType<AbstractMemoryStore["write"]>;
    set(id: string, entry: MemoryEntry): Promise<void>;
    delete(id: string): Promise<boolean>;
}
export interface FileBasedMemoryStoreOptions {
    autoFlush?: boolean;
    prettyPrint?: boolean;
}
//# sourceMappingURL=FileBasedMemoryStore.d.ts.map