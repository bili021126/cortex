/**
 * 测试环境检测 —— 替代散落在各处的 `process.env.VITEST` 硬编码。
 *
 * 修复 S1：将所有测试环境判断集中至此，避免在产品代码中直接读取环境变量。
 *
 * 使用方式：
 *   import { isTestEnv } from "./test-env.js";
 *   if (!isTestEnv()) { console.error(...); }
 */

export function isTestEnv(): boolean {
  return !!process.env.VITEST || !!process.env.NODE_ENV?.startsWith("test");
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
