// ============================================================
// @cortex/engine/plugin/memory-store.plugin
//
// MemoryStore 插件——依赖 PipelineObserver。
// SQLite 持久化 + 四态生命周期 + 向量检索 + BFS 图遍历。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================

import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import { MemoryStore } from "../memory/memory-store.js";
import { defaultEmbeddingService } from "../memory/embedding.js";

export class MemoryStorePlugin implements EnginePlugin {
  readonly name = "memoryStore";
  readonly dependencies = ["pipelineObserver"];

  private instance!: MemoryStore;

  async init(ctx: PluginContext): Promise<void> {
    const observer = ctx.get<PipelineObserverPlugin>("pipelineObserver").getInstance();
    this.instance = new MemoryStore(observer, defaultEmbeddingService);

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

// 自注册
import { PluginLoader } from "./plugin-loader.js";
PluginLoader.register("memoryStore", MemoryStorePlugin);
