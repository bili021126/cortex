// ============================================================
// @cortex/engine/plugin/pipeline-observer.plugin
//
// PipelineObserver 插件——零依赖，事件总线根基。
// @layer 治理层
// @role 观察者——全流事件管道，emit-only
// 所有插件 init() 前必须先加载此插件，observer 通过 PluginContext 传递给下游。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================
import { PipelineObserver } from "@cortex/scheduler";
export class PipelineObserverPlugin {
    name = "pipelineObserver";
    dependencies = [];
    instance;
    async init(_ctx) {
        this.instance = new PipelineObserver();
    }
    async start() { }
    async stop() {
        this.instance.clear?.();
    }
    health() {
        return this.instance ? "healthy" : "dead";
    }
    /** 获取 PipelineObserver 实例（供其他插件通过 ctx.get() 使用） */
    getInstance() {
        return this.instance;
    }
}
//# sourceMappingURL=pipeline-observer.plugin.js.map