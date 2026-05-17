/**
 * platform.ts — PlatformBridge 设置
 *
 * 创建 CLIAdapter 实例并作为 PlatformBridge 注入到 ConfirmGate。
 * 这是 CLI 包与 engine 包之间的桥梁。
 *
 * @see CLI 设计文档 §8.2（对接点矩阵）
 */

import { CLIAdapter } from "@cortex/engine";
import type { PlatformBridge } from "@cortex/shared";

let _bridge: PlatformBridge | null = null;

/** 获取或创建全局 CLI PlatformBridge 实例 */
export function getPlatformBridge(): PlatformBridge {
  if (!_bridge) {
    _bridge = new CLIAdapter();
  }
  return _bridge;
}

/** 关闭 PlatformBridge（释放 stdin） */
export function closePlatformBridge(): void {
  if (_bridge) {
    (_bridge as CLIAdapter).close();
    _bridge = null;
  }
}
