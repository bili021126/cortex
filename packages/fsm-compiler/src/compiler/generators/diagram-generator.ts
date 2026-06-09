/**
 * @cortex/fsm-compiler — Diagram Generator
 *
 * Generates Mermaid state diagram and Graphviz DOT format from FSM AST.
 */

import type { FsmAst } from "../parser.js";

// ────────────────────────────────────────────────────────────
// Diagram Generator
// ────────────────────────────────────────────────────────────

export class DiagramGenerator {
  /**
   * Generate Mermaid state diagram.
   *
   * @example Output:
   *   stateDiagram-v2
   *     [*] --> created
   *     created --> awake : wakeup
   *     created --> destroyed : destroy
   */
  toMermaid(ast: FsmAst, _highlight?: string): string {
    const lines: string[] = [];
    lines.push("stateDiagram-v2");
    lines.push("");

    // Initial state pointer
    lines.push(`    [*] --> ${ast.machine.initialState}`);

    // Transitions
    for (const transition of ast.transitionMap.values()) {
      const label = transition.guard
        ? `${transition.event} [${transition.guard}]`
        : transition.event;

      if (transition.from === transition.to) {
        // Self-loop
        lines.push(`    ${transition.from} --> ${transition.to} : ${label}`);
      } else {
        lines.push(`    ${transition.from} --> ${transition.to} : ${label}`);
      }
    }

    // Final states
    for (const finalId of ast.machine.finalStates) {
      lines.push(`    ${finalId} --> [*]`);
    }

    return lines.join("\n") + "\n";
  }

  /**
   * Generate Graphviz DOT format.
   */
  toDot(ast: FsmAst): string {
    const lines: string[] = [];
    lines.push("digraph FSM {");
    lines.push("    rankdir=LR;");
    lines.push("    node [shape=circle];");
    lines.push("");

    // Initial state
    lines.push(`    __start__ [label="" shape=point];`);
    lines.push(`    __start__ -> ${ast.machine.initialState};`);

    // States
    for (const state of ast.stateMap.values()) {
      const isFinal = ast.machine.finalStates.includes(state.id);
      const isInitial = state.id === ast.machine.initialState;
      if (isFinal) {
        lines.push(`    ${state.id} [label="${state.displayName ?? state.id}" shape=doublecircle];`);
      } else if (isInitial) {
        lines.push(`    ${state.id} [label="${state.displayName ?? state.id}" shape=circle style=bold];`);
      } else {
        lines.push(`    ${state.id} [label="${state.displayName ?? state.id}"];`);
      }
    }

    lines.push("");

    // Transitions
    for (const transition of ast.transitionMap.values()) {
      let label = transition.event;
      if (transition.guard) {
        label += ` [${transition.guard}]`;
      }
      if (transition.action) {
        label += ` / ${transition.action}`;
      }
      const style = transition.type === "internal" ? " [style=dashed]" : "";
      lines.push(`    ${transition.from} -> ${transition.to} [label="${label}"${style}];`);
    }

    lines.push("}");
    return lines.join("\n") + "\n";
  }
}
