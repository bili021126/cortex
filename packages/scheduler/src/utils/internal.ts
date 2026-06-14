/**
 * @cortex/scheduler —— 内部私有类型
 *
 * 此文件中的类型不通过 barrel 导出，仅供本包内部使用。
 * 对外暴露的类型应定义在对应模块文件中并通过 index.ts 桶导出。
 */

import { ENV_VITEST, ENV_NODE_ENV } from "@cortex/config";

/**
 * 测试环境检测 —— 替代散落在各处的 `process.env.ENV_VITEST` 硬编码。
 *
 * 使用方式：
 *   import { isTestEnv } from "../utils/internal.js";
 *   if (!isTestEnv()) { console.error(...); }
 */
export function isTestEnv(): boolean {
  return !!process.env[ENV_VITEST] || !!process.env[ENV_NODE_ENV]?.startsWith("test");
}

/**
 * 仅在非测试环境下执行回调。
 * 用于 invariant 上报等场景——测试环境中不应产生 console.error 噪音。
 */
export function ifNotTest(fn: () => void): void {
  if (!isTestEnv()) {
    fn();
  }
}
