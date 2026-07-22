/**
 * @cortex/config — 密钥+上下文配置接口
 *
 * L2·密钥+上下文层。key 决定 API 鉴权和模型路由，context 决定每 agent 的窗口上限。
 *
 * @module interfaces/key-context
 * @layer root — 零依赖，纯类型层
 */

/** 单个 API 密钥条目 */
export interface KeyEntry {
  /** 人类可读标签 */
  label: string;
  /** 对应的环境变量名 */
  envVar: string;
  /** 密钥缺失时的模型降级方案（回退到的 key 名称） */
  modelFallback: string;
  /** 使用此密钥的 agent ID 列表 */
  agents: string[];
}

/** 单个上下文限制条目 */
export interface ContextLimitEntry {
  /** 最大 token 数 */
  maxTokens: number;
  /** 描述 */
  description: string;
}

/** keys-context.json 顶层结构 */
export interface KeysContextConfig {
  /** 密钥注册表——key 为密钥 ID */
  keys: Record<string, KeyEntry>;
  /** 上下文窗口限制——key 为策略名（如 "meta", "code", "analysis"） */
  contextLimits: Record<string, ContextLimitEntry>;
}
