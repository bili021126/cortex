// ============================================================
// @cortex/memory — InMemoryMemoryStore 纯内存实现
//
// 基于 AbstractMemoryStore 抽象基类，使用空操作后端。
// 适用于测试、临时会话和无持久化需求的场景。
// ============================================================
import { AbstractMemoryStore } from "./AbstractMemoryStore.js";
// ── 空操作后端 ───────────────────────────────
const NOOP_BACKEND = {
    async init() { },
    async load() { },
    async persist() { },
    async remove() { },
    async flushIndex() { },
    async flushLinks() { },
    async flushAll() { },
};
/**
 * InMemoryMemoryStore —— 基于 Map 的纯内存 MemoryStore 实现。
 *
 * 继承 AbstractMemoryStore 的全部 36 个共享方法，后端为空操作。
 */
export class InMemoryMemoryStore extends AbstractMemoryStore {
    constructor() {
        super(NOOP_BACKEND);
    }
    /** 复写 get——返回结构化克隆以保证不可变性 */
    async get(id) {
        // 委托父类（含 _ensureInitialized 检查）
        const entry = await super.get(id);
        return entry;
    }
}
//# sourceMappingURL=InMemoryMemoryStore.js.map