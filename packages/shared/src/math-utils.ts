// ============================================================
// @cortex/shared/math-utils —— 通用数学工具函数
//
// 【定位】跨包共享的数学工具，统一入口，替代各包自行实现的副本。
// ============================================================

/** 将值裁剪到 [min, max] 闭区间 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
