// @layer 规划-执行层
// ============================================================
// @cortex/engine/plugin/task-board.plugin
//
// TaskBoard 插件——依赖 PipelineObserver。
// 管理任务节点的认领/释放/完成/移除。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================

import type { EnginePlugin, PluginContext, PluginHealth } from "./types.js";
import { TaskBoard } from "@cortex/scheduler";

export class TaskBoardPlugin implements EnginePlugin {
  readonly name = "taskBoard";
  readonly dependencies = ["pipelineObserver"];

  private instance!: TaskBoard;

  async init(ctx: PluginContext): Promise<void> {
    const observer = ctx.get<PipelineObserverPlugin>("pipelineObserver").getInstance();
    this.instance = new TaskBoard();
    this.instance.setObserver(observer);
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  health(): PluginHealth {
    return this.instance ? "healthy" : "dead";
  }

  getInstance(): TaskBoard {
    return this.instance;
  }
}

// 前向声明依赖类型
import type { PipelineObserverPlugin } from "./pipeline-observer.plugin.js";


