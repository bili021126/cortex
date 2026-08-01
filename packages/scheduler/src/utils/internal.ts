/**
 * @cortex/scheduler —— 内部私有类型
 *
 * 此文件中的类型不通过 barrel 导出，仅供本包内部使用。
 * 对外暴露的类型应定义在对应模块文件中并通过 index.ts 桶导出。
 */

import { isTestEnv } from "@cortex/config";

// B3：isTestEnv 单源归位——config 定义，本文件 re-export（兼容既有 import 路径）
export { isTestEnv };

/**
 * 仅在非测试环境下执行回调。
 * 用于 invariant 上报等场景——测试环境中不应产生 console.error 噪音。
 */
export function ifNotTest(fn: () => void): void {
  if (!isTestEnv()) {
    fn();
  }
}
