/**
 * @cortex/config — 修宪默认值常量
 *
 * @module constants/amendment
 * @layer root
 */

/** 修宪默认超时天数配置 */
export const DEFAULT_AMENDMENT_TIMEOUT = {
  /** pending_judgment 超时天数 */
  judgmentTTLDays: 7,
  /** draft 超时天数 */
  draftTTLDays: 14,
  /** 连续超时自动拒绝的阈值 */
  maxStaleCount: 3,
} as const;
