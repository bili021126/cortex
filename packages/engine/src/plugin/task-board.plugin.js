// ============================================================
// @cortex/engine/plugin/task-board.plugin
//
// TaskBoard 插件——依赖 PipelineObserver。
// 管理任务节点的认领/释放/完成/移除。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================
import { TaskBoard } from "@cortex/scheduler";
export class TaskBoardPlugin {
    name = "taskBoard";
    dependencies = ["pipelineObserver"];
    instance;
    async init(ctx) {
        const observer = ctx.get("pipelineObserver").getInstance();
        this.instance = new TaskBoard();
        this.instance.setObserver(observer);
    }
    async start() { }
    async stop() { }
    health() {
        return this.instance ? "healthy" : "dead";
    }
    getInstance() {
        return this.instance;
    }
}
//# sourceMappingURL=task-board.plugin.js.map