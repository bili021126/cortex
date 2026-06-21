import type { ObservableEvent } from "@cortex/shared";
export interface RuleResult {
    /** 规则名 */
    ruleName: string;
    /** 是否通过了规则校验 */
    passed: boolean;
    /** 详细说明 */
    detail?: string;
}
export interface ZeroTokenRule {
    readonly name: string;
    validate(event: ObservableEvent, context: RuleContext): RuleResult;
}
export interface RuleContext {
    /** workspace 根目录 */
    workspaceRoot: string;
}
/**
 * 规则 1：Git Diff 检查——断言 event.payload 中引用的文件路径
 * 确实在当前 diff 中出现了改动。
 */
export declare class GitDiffRule implements ZeroTokenRule {
    readonly name = "git-diff-check";
    private _cachedDiff;
    private _cacheTime;
    private static readonly CACHE_TTL;
    validate(event: ObservableEvent, _ctx: RuleContext): RuleResult;
    private _getChangedFiles;
}
/**
 * 规则 2：ESLint 宪法违禁检查——断言 event.payload 中引用的
 * 违禁模式（`!` 断言、`as any`）确实是 ESLint 报出的。
 */
export declare class EslintRule implements ZeroTokenRule {
    readonly name = "eslint-constitutional-check";
    private _cachedErrors;
    private _cacheTime;
    private static readonly CACHE_TTL;
    validate(event: ObservableEvent, _ctx: RuleContext): RuleResult;
    private _getEslintErrors;
}
/**
 * 规则 3：FSM 状态流转检查——断言 event.payload 中声称的状态转换
 * 在 MEMORY_VALID_TRANSITIONS 中是合法的。
 */
export declare class FsmTransitionRule implements ZeroTokenRule {
    readonly name = "fsm-transition-check";
    validate(event: ObservableEvent, _ctx: RuleContext): RuleResult;
}
/**
 * 规则 4：Barrel 导出检查——断言 event.payload 中声称的新模块
 * 确实在对应包的 barrel (index.ts) 中有导出。
 */
export declare class BarrelExportRule implements ZeroTokenRule {
    readonly name = "barrel-export-check";
    validate(event: ObservableEvent, _ctx: RuleContext): RuleResult;
}
/**
 * 规则 5：跨包接口契约检查——断言 event.payload 中声称的接口变更
 * 在两包之间确实一致（通过 grep 验证）。
 */
export declare class CrossPackageContractRule implements ZeroTokenRule {
    readonly name = "cross-package-contract-check";
    validate(event: ObservableEvent, _ctx: RuleContext): RuleResult;
    private _grepInterface;
}
/**
 * ZeroTokenValidator —— 治理事件的零 token 预检。
 *
 * 注册一组 ZeroTokenRule，对进入哨兵管道的治理事件逐条验证。
 * 所有规则断言通过 = source="rule"；任意规则断言失败 = source="llm-inference"。
 */
export declare class ZeroTokenValidator {
    private readonly rules;
    constructor();
    /** 注册自定义规则 */
    register(rule: ZeroTokenRule): void;
    /**
     * 校验治理事件——逐条运行注册的规则。
     *
     * @returns source: "rule"（全部通过）或 "llm-inference"（至少一条失败）
     */
    validate(event: ObservableEvent, ctx: RuleContext): {
        source: "rule" | "llm-inference";
        results: RuleResult[];
    };
}
//# sourceMappingURL=zero-token-validator.d.ts.map