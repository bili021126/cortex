import type { CortexAgentsConfig } from "../types.js";
/** 跨字段校验结果 */
export interface CrossFieldValidationResult {
    /** 是否通过 */
    valid: boolean;
    /** 错误列表 */
    errors: string[];
    /** 警告列表 */
    warnings: string[];
}
/**
 * 执行跨字段校验。
 * @param config 已加载的 cortex-agents.json 配置
 */
export declare function validateCrossField(config: CortexAgentsConfig): CrossFieldValidationResult;
//# sourceMappingURL=cross-field.validator.d.ts.map