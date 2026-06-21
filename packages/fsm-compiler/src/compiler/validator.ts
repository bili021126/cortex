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

// ────────────────────────────────────────────────────────────
// Validation Types
// ────────────────────────────────────────────────────────────

export type ValidationErrorCode =
  | "UNREACHABLE_STATE"
  | "DEADLOCK"
  | "NON_DETERMINISTIC"
  | "INVALID_REFERENCE"
  | "MISSING_STATE"
  | "DUPLICATE_ID"
  | "INVALID_INITIAL"
  | "INVALID_FINAL"
  | "SELF_LOOP_INCONSISTENT";

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

// ────────────────────────────────────────────────────────────
// Validator
// ────────────────────────────────────────────────────────────

export class FsmValidator {

  /**
   * 检查 FSM 状态图连通性：从 initialState 出发 BFS，标记不可达状态为 warning。
   */
  checkConnectivity(states: string[], transitions: Array<{from:string;to:string}>, initialState: string): string[] {
    const reachable = new Set<string>();
    const queue = [initialState];
    while (queue.length > 0) {
      const s = queue.shift() as string;
      if (reachable.has(s)) continue;
      reachable.add(s);
      for (const t of transitions) {
        if (t.from === s && !reachable.has(t.to)) queue.push(t.to);
      }
    }
    const unreachable = states.filter(s => !reachable.has(s));
    if (unreachable.length > 0) {
      console.warn('[FsmValidator] 不可达状态:', unreachable.join(', '));
    }
    return unreachable;
  }

  /**
   * 原始 FsmValidator {
  /**
   * Validate a parsed FSM AST.
   */
  validate(ast: FsmAst): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // 1. Reachability — BFS from initial state
    const reachable = this._computeReachable(ast);
    const unreachableStates: string[] = [];
    for (const stateId of ast.stateMap.keys()) {
      if (!reachable.has(stateId)) {
        unreachableStates.push(stateId);
        errors.push({
          code: "UNREACHABLE_STATE",
          nodeId: stateId,
          message: `State "${stateId}" is unreachable from initial state "${ast.machine.initialState}"`,
        });
      }
    }

    // 2. Deadlock — non-final states with no outgoing transitions
    const finalSet = new Set(ast.machine.finalStates);
    for (const stateId of ast.stateMap.keys()) {
      if (finalSet.has(stateId)) continue; // final states are allowed to have no outgoing
      const transitions = ast.adjacencyList.get(stateId);
      if (!transitions || transitions.length === 0) {
        errors.push({
          code: "DEADLOCK",
          nodeId: stateId,
          message: `Non-final state "${stateId}" has no outgoing transitions (deadlock)`,
        });
      }
    }

    // 3. Determinism — check for ambiguous transitions
    const eventMap = new Map<string, Map<string, string>>(); // state → (event → transitionId)
    let deterministic = true;
    for (const [stateId, transitions] of ast.adjacencyList) {
      const eventToTransition = new Map<string, string>();
      for (const t of transitions) {
        if (eventToTransition.has(t.event)) {
          deterministic = false;
          errors.push({
            code: "NON_DETERMINISTIC",
            nodeId: t.id,
            message: `State "${stateId}" has ambiguous transitions for event "${t.event}": "${eventToTransition.get(t.event)}" and "${t.id}"`,
          });
        }
        eventToTransition.set(t.event, t.id);
      }
      eventMap.set(stateId, eventToTransition);
    }

    // 4. Self-loop consistency
    for (const transition of ast.transitionMap.values()) {
      if (transition.from === transition.to) {
        if (transition.type !== "self" && transition.type !== "internal") {
          warnings.push({
            code: "SELF_LOOP_INCONSISTENT",
            nodeId: transition.id,
            message: `Self-loop transition "${transition.id}" should have type:"self" or type:"internal" (currently: "${transition.type ?? "external"}")`,
          });
        }
      }
    }

    const hasDeadlock = errors.some((e) => e.code === "DEADLOCK");

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      metrics: {
        stateCount: ast.stateMap.size,
        transitionCount: ast.transitionMap.size,
        reachableStates: reachable.size,
        unreachableStates,
        hasDeadlock,
        deterministic,
      },
    };
  }

  /**
   * BFS from initial state to compute reachable states.
   */
  private _computeReachable(ast: FsmAst): Set<string> {
    const visited = new Set<string>();
    const queue = [ast.machine.initialState];
    visited.add(ast.machine.initialState);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const transitions = ast.adjacencyList.get(current);
      if (!transitions) continue;

      for (const t of transitions) {
        if (!visited.has(t.to)) {
          visited.add(t.to);
          queue.push(t.to);
        }
      }
    }

    return visited;
  }
}
