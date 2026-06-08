// ============================================================
// @cortex/engine/plugin/consistency-layer.plugin
//
// ConsistencyLayer 插件——依赖 MemoryStore。
// 记忆-现实一致性校验：InitVerifier + SchemaEnforcer + IntentFactWall。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================

import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import type { MemoryEntry, MemoryWriteInput, ReadMode } from "@cortex/shared";
import { ConsistencyLayer } from "../consistency/consistency-layer.js";

/* eslint-disable no-console */

export class ConsistencyLayerPlugin implements EnginePlugin {
  readonly name = "consistencyLayer";
  readonly dependencies = ["memoryStore"];

  private instance!: ConsistencyLayer;
  private _filterRead!: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[];

  async init(ctx: PluginContext): Promise<void> {
    const memory = ctx.get<MemoryStorePlugin>("memoryStore").getInstance();
    const fs = ctx.externals.fs;

    this.instance = new ConsistencyLayer(memory, {
      projectRoot: ctx.workspaceRoot,
      enableInitVerifier: fs !== undefined,
      fs,
    });

    // 读路径：IntentFactWall 过滤回调
    this._filterRead = this.instance.filterRead.bind(this.instance);

    // 写路径：preWriteCheck 注入
    memory.setPreWriteHook((input: MemoryWriteInput) =>
      this.instance.preWriteCheck(input),
    );
  }

  async start(): Promise<void> {
    // 启动校验：InitVerifier 扫描记忆-文件一致性
    if (this.instance.hasInitVerifier) {
      try {
        const report = await this.instance.verify();
        if (report) {
          const missingRatio =
            report.checkedMemories > 0
              ? report.summary.missing / report.checkedMemories
              : 0;
          console.log(
            `[ConsistencyLayer] 启动校验完成——总数 ${report.totalMemories}，` +
              `缺失 ${report.summary.missing}（${(missingRatio * 100).toFixed(1)}%），` +
              `致命: ${report.fatal ? "是" : "否"}`,
          );
        }
      } catch (e) {
        console.warn("[ConsistencyLayer] 启动校验异常（非致命）:", e);
      }
    }
  }

  async stop(): Promise<void> {}

  health(): PluginHealth {
    return this.instance ? "healthy" : "dead";
  }

  getInstance(): ConsistencyLayer {
    return this.instance;
  }

  getFilterRead(): (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[] {
    return this._filterRead;
  }
}

import type { MemoryStorePlugin } from "./memory-store.plugin.js";

// 自注册
import { PluginLoader } from "./plugin-loader.js";
PluginLoader.register("consistencyLayer", ConsistencyLayerPlugin);
