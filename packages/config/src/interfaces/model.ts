/**
 * @cortex/config — 模型配置接口
 *
 * L1·模型层——Cortex 唯一两模型。agent key 决定路由到哪个模型。
 *
 * @module interfaces/model
 * @layer root — 零依赖，纯类型层
 */

/** 模型能力标签 */
export type ModelCapability =
  | "chat"
  | "function-calling"
  | "streaming"
  | "thinking"
  | "reasoning";

/** 单个模型条目 */
export interface ModelEntry {
  /** 人类可读标签（如 "Flash", "Pro"） */
  label: string;
  /** 模型能力列表 */
  capabilities: ModelCapability[];
  /** 是否支持思考模式 */
  thinking: boolean;
  /** 默认分配给哪些 agent type */
  defaultFor: string[];
  /** 最大输出 token 数（DeepSeek V4 Flash: 64K, Pro: 384K） */
  maxOutputTokens?: number;
  /** 上下文窗口大小（DeepSeek V4: 1M tokens） */
  contextWindow?: number;
  /** 支持的 reasoning_effort 等级列表（仅 thinking 模型） */
  reasoningEffortLevels?: string[];
}

/** models.json 顶层结构 */
export interface ModelsConfig {
  /** 模型注册表——key 为模型 ID */
  models: Record<string, ModelEntry>;
}
