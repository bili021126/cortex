/**
 * @cortex/fsm-compiler — FSM Validator
 *
 * Performs semantic analysis on a parsed FSM AST:
 * 1. Reachability — every state reachable from initial state?
 * 2. Completeness — every state has defined transitions for all possible events?
 * 3. Determinism — no ambiguous transitions (same state + same event → different targets)
 * 4. Deadlock — no non-final state without outgoing transitions
 * 5. Event Consistency — events used in transitions are defined
 * 6. Self-loop Consistency — self-transitions have type:"self" or type:"internal"
 */
import type { FsmAst } from "./parser.js";
export type ValidationErrorCode = "UNREACHABLE_STATE" | "DEADLOCK" | "NON_DETERMINISTIC" | "INVALID_REFERENCE" | "MISSING_STATE" | "DUPLICATE_ID" | "INVALID_INITIAL" | "INVALID_FINAL" | "SELF_LOOP_INCONSISTENT";
export interface ValidationError {
    code: ValidationErrorCode;
    nodeId: string;
    message: string;
}
export interface ValidationWarning {
    code: string;
    nodeId: string;
    message: string;
}
export interface ValidationMetrics {
    stateCount: number;
    transitionCount: number;
    reachableStates: number;
    unreachableStates: string[];
    hasDeadlock: boolean;
    deterministic: boolean;
}
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    metrics: ValidationMetrics;
}
export declare class FsmValidator {
    /**
     * 检查 FSM 状态图连通性：从 initialState 出发 BFS，标记不可达状态为 warning。
     */
    checkConnectivity(states: string[], transitions: Array<{
        from: string;
        to: string;
    }>, initialState: string): string[];
    /**
     * 原始 FsmValidator {
    /**
     * Validate a parsed FSM AST.
     */
    validate(ast: FsmAst): ValidationResult;
    /**
     * BFS from initial state to compute reachable states.
     */
    private _computeReachable;
}
//# sourceMappingURL=validator.d.ts.map