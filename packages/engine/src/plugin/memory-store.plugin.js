// ============================================================
// @cortex/engine/plugin/memory-store.plugin
//
// MemoryStore 插件——依赖 PipelineObserver。
// SQLite 持久化 + 四态生命周期 + 向量检索 + BFS 图遍历。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================
import { MemoryStore, defaultEmbeddingService } from "@cortex/memory-store";
import { InMemoryMemoryStore } from "@cortex/memory";
export class MemoryStorePlugin {
    name = "memoryStore";
    dependencies = ["pipelineObserver"];
    instance;
    async init(ctx) {
        // 外部注入的 MemoryStore 优先使用（测试注入 mock embedder）
        if (ctx.externals.memory) {
            this.instance = ctx.externals.memory;
            return;
        }
        const observer = ctx.get("pipelineObserver").getInstance();
        const backend = new InMemoryMemoryStore();
        this.instance = new MemoryStore(backend, observer, defaultEmbeddingService);
        // 初始化持久化层（SQLite 建表 + 加载数据）
        if (ctx.externals.dbPath) {
            await this.instance.init(ctx.externals.dbPath);
        }
    }
    async start() { }
    async stop() {
        await this.instance.close();
    }
    health() {
        return this.instance ? "healthy" : "dead";
    }
    getInstance() {
        return this.instance;
    }
}
//# sourceMappingURL=memory-store.plugin.js.map