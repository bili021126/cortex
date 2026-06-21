/**
 * observer/console-bridge.ts — Console→PipelineObserver 桥接
 *
 * 拦截 console.warn/error/log，转为 PipelineObserver.emit() 事件。
 * 白名单豁免：MemoryStoreMonitor（合法消费者）、embedding 预热等已知合法裸 console 调用。
 *
 * 设计：
 * - installConsoleBridge(observer) — 安装拦截
 * - uninstallConsoleBridge() — 恢复原始 console 方法
 * - 桥接器内部用原始 console 输出（避免递归），通过闭包引用 _orig 方法
 *
 * @module engine/observer/console-bridge
 * @since v3.x — 全系统重构
 */
import { type IPipelineObserver } from "@cortex/shared";
/**
 * 安装 ConsoleBridge——拦截所有 console.warn/error/log。
 * 白名单内的调用（MemoryStoreMonitor 等）透传到原始 console。
 */
export declare function installConsoleBridge(observer: IPipelineObserver): void;
/** 卸载 ConsoleBridge——恢复原始 console 方法 */
export declare function uninstallConsoleBridge(): void;
//# sourceMappingURL=console-bridge.d.ts.map