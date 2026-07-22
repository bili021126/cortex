/** 治理验证相关常量 */

/** 硬验证门缓存 TTL（毫秒）——git diff / eslint 结果缓存有效期 */
export const VERIFICATION_CACHE_TTL_MS = 60_000;

/** Barrel 文件大小上限（字节）——超出时告警 */
export const BARREL_MAX_SIZE = 10 * 1024 * 1024;

/** TypeScript 文件大小上限（字节）——超出时告警 */
export const TSFILE_MAX_SIZE = 10 * 1024 * 1024;
