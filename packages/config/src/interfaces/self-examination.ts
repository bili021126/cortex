/**
 * @cortex/config — 自审视脚本配置接口
 *
 * @module interfaces/self-examination
 * @layer root — 零依赖，纯类型层
 */

/** 自审视脚本配置 */
export interface SelfExaminationConfig {
  description: string;
  agents: {
    hard: string[];
    soft: string[];
  };
  consensusAgents: string[];
  agentTypes: {
    hard: string[];
    soft: string[];
  };
  outputDir: {
    hard: string;
    soft: string;
  };
  consensusOutput: string;
  archiveBase: string;
  cleanupFiles: string[];
  templates: {
    hard: string;
    soft: string;
  };
  reportMaxCharsDefault: number;
}
