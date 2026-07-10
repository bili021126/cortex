/**
 * @cortex/config — 版本常量
 *
 * @module constants/version
 * @layer root
 */

/** CLI 自身版本 */
export const CORTEX_VERSION = "0.2.1";

/** Core-2 阶段标识 */
export const CORTEX_PHASE = "Core-2";

/** 依赖包版本（同步自各包 package.json） */
export const DEPENDENCY_VERSIONS: Record<string, string> = {
  engine: "@cortex/engine v2.1.0",
  llm: "@cortex/llm v0.3.0",
  shared: "@cortex/shared v2.0.0",
};
