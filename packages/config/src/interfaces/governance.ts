/**
 * @cortex/config — 治理管线配置接口
 *
 * @module interfaces/governance
 * @layer root — 零依赖，纯类型层
 */

/** 治理管线配置 */
export interface GovernancePipelineConfig {
  enabled: boolean;
  stages: string[];
  ciGate: {
    script: string;
    timeoutMs: number;
    blockOnFailure: boolean;
  };
  triggers: {
    onAmendmentProposed: boolean;
    onSchedule: boolean;
    onCommit: boolean;
  };
}
