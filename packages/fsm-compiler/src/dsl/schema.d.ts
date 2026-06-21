/**
 * @cortex/fsm-compiler — DSL Schema
 *
 * FSM Definition Schema — the single source of truth for any state machine.
 *
 * A machine is:
 *   - A set of finite states (each with metadata)
 *   - Transitions between states (with optional guards and actions)
 *   - One initial state
 *   - Zero or more final (terminal) states
 */
export interface FsmDefinition {
    /** Machine metadata */
    id: string;
    displayName: string;
    description?: string;
    /** SemVer for the machine definition */
    version: string;
    /** States */
    states: FsmStateDefinition[];
    /** Transitions */
    transitions: FsmTransitionDefinition[];
    /** The initial state ID */
    initialState: string;
    /** Terminal states (no outgoing transitions) */
    finalStates: string[];
}
export interface FsmStateDefinition {
    id: string;
    displayName?: string;
    description?: string;
    metadata?: Record<string, unknown>;
    /** CSS class / diagram style hint */
    style?: "initial" | "normal" | "final" | "error";
}
export interface FsmTransitionDefinition {
    id: string;
    from: string;
    to: string;
    event: string;
    /** Optional guard condition (predicate function reference) */
    guard?: string;
    /** Optional action to execute on transition (function reference) */
    action?: string;
    description?: string;
    /**
     * Transition type:
     *   - "external" (default): full exit/enter cycle
     *   - "internal": stay in same state, no exit/enter
     *   - "self": explicit self-transition (exit → enter)
     */
    type?: "external" | "internal" | "self";
}
//# sourceMappingURL=schema.d.ts.map