// ============================================================
// @cortex/engine/plugin/memory-store.plugin
//
// MemoryStore 插件——依赖 PipelineObserver。
// SQLite 持久化 + 四态生命周期 + 向量检索 + BFS 图遍历。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================

import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import { MemoryStore, defaultEmbeddingService } from "@cortex/memory-store";
import { InMemoryMemoryStore } from "@cortex/memory";

export class MemoryStorePlugin implements EnginePlugin {
  readonly name = "memoryStore";
  readonly dependencies = ["pipelineObserver"];

  private instance!: MemoryStore;

  async init(ctx: PluginContext): Promise<void> {
    // 外部注入的 MemoryStore 优先使用（测试注入 mock embedder）
    if (ctx.externals.memory) {
      this.instance = ctx.externals.memory as unknown as MemoryStore;
      return;
    }
    const observer = ctx.get<PipelineObserverPlugin>("pipelineObserver").getInstance();
    const backend = new InMemoryMemoryStore();
    this.instance = new MemoryStore(backend, observer, defaultEmbeddingService);

    // 初始化持久化层（SQLite 建表 + 加载数据）
    if (ctx.externals.dbPath) {
      await this.instance.init(ctx.externals.dbPath);
    }
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    await this.instance.close();
  }

  health(): PluginHealth {
    return this.instance ? "healthy" : "dead";
  }

  getInstance(): MemoryStore {
    return this.instance;
  }
}

import type { PipelineObserverPlugin } from "./pipeline-observer.plugin.js";


