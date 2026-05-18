// ============================================================
// @cortex/factory — 望远镜组装器
//
// 从配置中提取视觉传感器参数。
// Core-2 预埋——望远镜尚未实例化，此处仅定义接口。
// ============================================================

/** 望远镜配置 */
export interface TelescopeConfig {
  /** 视觉提供商 */
  provider: "llm_native" | "local" | "cdp";
  /** 本地模型名（仅 provider=local） */
  localModel?: string;
  /** CDP 是否作为保底 */
  cdpFallback: boolean;
  /** 降级策略 */
  strategy: "first-available" | "local-only" | "cdp-only";
}

/** 默认望远镜配置 */
const DEFAULT_TELESCOPE: TelescopeConfig = {
  provider: "local",
  localModel: "qwen2.5-vl-3b",
  cdpFallback: true,
  strategy: "first-available",
};

/**
 * 组装望远镜配置。
 * 当前为 Core-2 预埋，返回默认配置。
 */
export function assembleTelescope(_overrides?: Partial<TelescopeConfig>): TelescopeConfig {
  return {
    ...DEFAULT_TELESCOPE,
    ..._overrides,
  };
}
