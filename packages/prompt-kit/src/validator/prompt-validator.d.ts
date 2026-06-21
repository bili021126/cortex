/**
 * @cortex/prompt-kit — Prompt 校验器
 *
 * 校验 PromptTemplate 的完整性和渲染产物的质量。
 * 支持自定义校验规则和段存在性检查。
 *
 * @see DESIGN.md §3.4 PromptValidator
 */
import { PromptBlockType, type PromptTemplate, type PromptResult, type ValidationResult, type ValidationError, type SectionCheckResult } from "../types.js";
/**
 * 校验规则定义。
 */
export type ValidationRule = (template: PromptTemplate, result?: PromptResult) => ValidationError | null;
/**
 * PromptValidator — 校验器。
 */
export declare class PromptValidator {
    private rules;
    constructor();
    /**
     * 校验模板结构。
     */
    validateTemplate(template: PromptTemplate): ValidationResult;
    /**
     * 校验渲染结果。
     */
    validateResult(result: PromptResult): ValidationResult;
    /**
     * 检查必需段是否存在。
     */
    checkRequiredSections(result: PromptResult, requiredTypes: PromptBlockType[]): SectionCheckResult;
    /**
     * 注册自定义校验规则。
     */
    registerRule(name: string, rule: ValidationRule): void;
    /**
     * 注册默认校验规则。
     */
    private registerDefaultRules;
}
//# sourceMappingURL=prompt-validator.d.ts.map