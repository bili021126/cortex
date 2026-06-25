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
import { DegradationBoundary } from "../core/degradation-boundary.js";

/** 注册项——组件 + 元数据 */
interface LifecycleEntry {
  name: string;
  component: ILifecycle;
  deps: string[];
}

export class LifecycleManager {
  private _entries: LifecycleEntry[] = [];
  private _phase: "uninitialized" | "running" | "shutdown" = "uninitialized";
  private _listeners: Array<(event: string, detail?: unknown) => void> = [];

  /** 注册事件监听器 */
  on(listener: (event: string, detail?: unknown) => void): void {
    this._listeners.push(listener);
  }

  /** 触发事件 */
  private _emit(event: string, detail?: unknown): void {
    for (const l of this._listeners) {
      try { l(event, detail); } catch (err) { DegradationBoundary.handle(err, 'lifecycle-manager', 'trace'); /* 隔离监听器异常 */ }
    }
  }

  /**
   * 注册组件及其依赖。
   *
   * @param name 唯一组件名（用于依赖引用）
   * @param component ILifecycle 实现
   * @param deps 依赖的组件名列表（可选）
   */
  register(name: string, component: ILifecycle, deps?: string[]): void {
    if (this._phase !== "uninitialized") {
      throw new Error(`[LifecycleManager] 无法注册 ${name}: 已${this._phase}`);
    }
    this._entries.push({ name, component, deps: deps ?? [] });
  }

  /**
   * 按拓扑排序初始化所有组件。
   * 依赖优先——若 A 依赖 B，B 先执行 init() 和 start()。
   */
  async bootstrap(): Promise<void> {
    if (this._phase !== "uninitialized") {
      throw new Error(`[LifecycleManager] 无法 bootstrap: 当前状态=${this._phase}`);
    }

    const sorted = this._topoSort();
    const initialized: string[] = [];

    try {
      for (const entry of sorted) {
        await entry.component.init();
        initialized.push(entry.name);
      }

      for (const entry of sorted) {
        await entry.component.start();
      }
    } catch (err) {
      // 回滚：逆序 stop + dispose 已初始化的组件
      for (let i = initialized.length - 1; i >= 0; i--) {
        const name = initialized[i];
        const entry = sorted.find(e => e.name === name);
        if (!entry) continue;
        try { await entry.component.stop(); } catch (err) { DegradationBoundary.handle(err, 'lifecycle-manager', 'trace'); }
        try { await entry.component.dispose(); } catch (err) { DegradationBoundary.handle(err, 'lifecycle-manager', 'trace'); }
      }
      this._emit("component_error", { component: "bootstrap", phase: "init", error: err });
      throw err;
    }

    this._phase = "running";
    this._emit("bootstrap_done");
  }

  /**
   * 反向优雅关闭——后启动的先关闭。
   * 每个组件 stop() 后调用 dispose()。
   *
   * @param timeoutMs 超时强制终止（毫秒），默认 30s
   */
  async shutdown(timeoutMs = 30_000): Promise<void> {
    if (this._phase !== "running") return;

    this._emit("shutdown_start");

    const reversed = [...this._topoSort()].reverse();

    const stopWithTimeout = async (entry: LifecycleEntry): Promise<void> => {
      try {
        const timer = new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`[LifecycleManager] ${entry.name} stop() 超时`)), timeoutMs),
        );
        await Promise.race([entry.component.stop(), timer]);
      } catch (err) {
        this._emit("component_error", { component: entry.name, phase: "stop", error: err });
      }
    };

    for (const entry of reversed) {
      await stopWithTimeout(entry);
    }

    for (const entry of reversed) {
      try { entry.component.dispose(); } catch (err) { DegradationBoundary.handle(err, 'lifecycle-manager', 'trace'); /* dispose 不抛错 */ }
    }

    this._phase = "shutdown";
    this._emit("shutdown_done");
  }

  // ── 拓扑排序（Kahn 算法） ──

  private _topoSort(): LifecycleEntry[] {
    const nameToEntry = new Map<string, LifecycleEntry>();
    for (const e of this._entries) nameToEntry.set(e.name, e);

    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const e of this._entries) {
      inDegree.set(e.name, 0);
      adj.set(e.name, []);
    }

    for (const e of this._entries) {
      for (const dep of e.deps) {
        if (!nameToEntry.has(dep)) {
          throw new Error(`[LifecycleManager] ${e.name} 依赖未注册的组件: ${dep}`);
        }
        const deps = adj.get(dep);
        if (deps) deps.push(e.name);
        inDegree.set(e.name, (inDegree.get(e.name) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [name, deg] of inDegree) {
      if (deg === 0) queue.push(name);
    }

    const sorted: LifecycleEntry[] = [];
    while (queue.length > 0) {
      const name = queue.shift();
      if (!name) break;
      const entry = nameToEntry.get(name);
      if (!entry) break;
      sorted.push(entry);
      for (const neighbor of adj.get(name) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    if (sorted.length !== this._entries.length) {
      throw new Error("[LifecycleManager] 检测到循环依赖");
    }

    return sorted;
  }
}
