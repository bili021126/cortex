import type { MemoryEntry } from "@cortex/shared";
import { AbstractMemoryStore } from "./AbstractMemoryStore.js";
/**
 * InMemoryMemoryStore —— 基于 Map 的纯内存 MemoryStore 实现。
 *
 * 继承 AbstractMemoryStore 的全部 36 个共享方法，后端为空操作。
 */
export declare class InMemoryMemoryStore extends AbstractMemoryStore {
    constructor();
    /** 复写 get——返回结构化克隆以保证不可变性 */
    get(id: string): Promise<MemoryEntry | undefined>;
}
//# sourceMappingURL=InMemoryMemoryStore.d.ts.map