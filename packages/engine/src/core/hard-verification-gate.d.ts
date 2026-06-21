import { PipelineEventType, type GovernanceEventPayload, type IPipelineObserver } from "@cortex/shared";
export interface RuleVerdict {
    ruleName: string;
    passed: boolean;
    reason?: string;
}
export interface HardGateResult {
    /** 全部规则通过？ */
    passed: boolean;
    /** 逐条裁决明细 */
    verdicts: RuleVerdict[];
}
/**
 * HardVerificationGate —— 零 token 硬验证门。
 *
 * 用法：
 *   const gate = new HardVerificationGate();
 *   const result = gate.check(governanceEventPayload);
 *   if (!result.passed) { /* 拒绝处理 *\/ }
 */
export declare class HardVerificationGate {
    private _gitDiffCache;
    private _gitDiffTime;
    private _eslintCache;
    private _eslintTime;
    private static readonly CACHE_TTL;
    /** 治理事件类型常量 */
    static readonly GOVERNANCE_EVENT_TYPES: PipelineEventType[];
    /**
     * 硬验证——5 条零 token 规则逐条校验。
     * 全部通过 → passed=true；任意否决 → passed=false + 否决原因。
     */
    check(event: GovernanceEventPayload): HardGateResult;
    private _ruleGitDiff;
    private _ruleEslint;
    private _ruleFsmTransition;
    private _ruleBarrelExport;
    private _ruleCrossPackage;
    private _getChangedFiles;
    private _getEslintErrors;
}
/**
 * 拒绝事件发射器——将硬验证门拒绝信号回写给 DocGovernAgent。
 * 拒绝事件以 FYI 优先级、source="rule-denied" 发射，
 * 同时写入拒绝注册表供 DocGovernAgent 下一轮查询。
 */
export declare function emitGateRejection(observer: IPipelineObserver, originalEvent: GovernanceEventPayload, result: HardGateResult): void;
/** 获取近期拒绝记录——供 DocGovernAgent 审计上下文注入 */
export declare function getRejections(): ReadonlyArray<{
    timestamp: number;
    summary: string;
    details: string;
}>;
//# sourceMappingURL=hard-verification-gate.d.ts.map