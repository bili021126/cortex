/**
 * lifecycle/lifecycle-manager.ts — 生命周期编排器
 *
 * 按拓扑排序管理所有 ILifecycle 组件。
 * register(component, deps) 注册组件及依赖 → bootstrap() 正向初始化 →
 * shutdown() 反向优雅关闭（先启动的后关闭）。
 *
 * 依赖关系解析：register 时传入 deps 数组（组件名称），
 * bootstrap 时按拓扑排序执行 init()，确保 A 依赖 B 则 B 先 init。
 *
 * @module engine/lifecycle/lifecycle-manager
 * @since v3.x — 全系统重构
 */
import type { ILifecycle } from "@cortex/shared";
export declare class LifecycleManager {
    private _entries;
    private _phase;
    private _listeners;
    /** 注册事件监听器 */
    on(listener: (event: string, detail?: unknown) => void): void;
    /** 触发事件 */
    private _emit;
    /**
     * 注册组件及其依赖。
     *
     * @param name 唯一组件名（用于依赖引用）
     * @param component ILifecycle 实现
     * @param deps 依赖的组件名列表（可选）
     */
    register(name: string, component: ILifecycle, deps?: string[]): void;
    /**
     * 按拓扑排序初始化所有组件。
     * 依赖优先——若 A 依赖 B，B 先执行 init() 和 start()。
     */
    bootstrap(): Promise<void>;
    /**
     * 反向优雅关闭——后启动的先关闭。
     * 每个组件 stop() 后调用 dispose()。
     *
     * @param timeoutMs 超时强制终止（毫秒），默认 30s
     */
    shutdown(timeoutMs?: number): Promise<void>;
    private _topoSort;
}
//# sourceMappingURL=lifecycle-manager.d.ts.map