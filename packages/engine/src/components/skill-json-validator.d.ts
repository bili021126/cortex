import { type SkillTemplate } from "@cortex/shared";
/** 技能状态——完整生命周期枚举 */
export type SkillStatus = "draft" | "trial" | "active" | "deprecated";
/** 校验错误项 */
export interface SkillJsonValidationError {
    /** 字段路径（如 "agentType"、"steps[2]"） */
    field: string;
    /** 错误描述 */
    message: string;
    /** 错误码 */
    code: string;
}
/** 校验警告项 */
export interface SkillJsonValidationWarning {
    field: string;
    message: string;
    code: string;
}
/** 校验信息项（非阻断性提示） */
export interface SkillJsonValidationInfo {
    field?: string;
    message: string;
    code: string;
}
/** 校验结果 */
export interface SkillJsonValidationResult {
    /** 是否完全通过（无 error 级别问题） */
    valid: boolean;
    /** 错误列表 */
    errors: SkillJsonValidationError[];
    /** 警告列表 */
    warnings: SkillJsonValidationWarning[];
    /** 信息列表 */
    infos: SkillJsonValidationInfo[];
}
/**
 * 校验组件——可插拔的独立校验单元。
 */
export interface SkillJsonValidator {
    readonly name: string;
    validate(data: Record<string, unknown>): {
        errors: SkillJsonValidationError[];
        warnings: SkillJsonValidationWarning[];
    };
}
/**
 * 校验外源技能 JSON 对象的结构和字段合法性。
 *
 * 内部通过 VALIDATOR_REGISTRY 逐组件执行校验。
 * 即使早期组件产生 error，后续组件仍会继续执行以收集完整的诊断信息。
 *
 * @param json - 从 JSON 解析得到的任意值
 * @returns 校验结果
 */
export declare function validateExternalSkillJson(json: unknown): SkillJsonValidationResult;
/**
 * 将已通过 validateExternalSkillJson 校验的外源 JSON 转化为 SkillTemplate。
 *
 * 此函数假设数据已通过校验——不会因字段缺失而崩溃，
 * 但仍会为边界情况提供安全的默认值。
 *
 * @param data - 已校验的外源技能 JSON 对象
 * @returns SkillTemplate——可直接注册到 SkillRegistry
 */
export declare function externalJsonToSkillTemplate(data: Record<string, unknown>): SkillTemplate;
/**
 * 外源技能导入一站式管线：校验 → 转化 → 返回 SkillTemplate。
 *
 * 校验不通过时返回 null（外部调用方应先检查 validationResult）。
 *
 * @param json - 从外源 JSON 文件解析的原始数据
 * @returns 转化后的 SkillTemplate，校验失败时返回 null
 */
export declare function importExternalSkill(json: unknown): {
    template: SkillTemplate | null;
    validation: SkillJsonValidationResult;
};
//# sourceMappingURL=skill-json-validator.d.ts.map