/**
 * @cortex/config — 认知配置接口
 *
 * @module interfaces/cognition
 * @layer root — 零依赖，纯类型层
 */

/** 激活矩阵项 */
export interface ActivationEntry {
  agentType: string;
  active: boolean;
  orientation?: string;
}

/** 注意力策略 */
export interface AttentionStrategy {
  hcaWeight: number;
  csaWeight: number;
  maxMemoryItems: number;
}

/** 认知配置 */
export interface CognitionConfig {
  activationMatrix: ActivationEntry[];
  attention: AttentionStrategy;
}
