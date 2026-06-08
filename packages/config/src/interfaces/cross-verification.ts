/**
 * @cortex/config — 交叉验证配对接口
 *
 * @module interfaces/cross-verification
 * @layer root — 零依赖，纯类型层
 */

/** 交叉验证配对 */
export interface CrossVerificationPair {
  reporterKey: string;
  reporterName: string;
  reporterEmoji: string;
  verifierKey: string;
  verifierName: string;
  verifierEmoji: string;
  reportFilePattern: string;
}

/** 交叉验证配置 */
export interface CrossVerificationConfig {
  description: string;
  pairs: CrossVerificationPair[];
}
