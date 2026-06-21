/**
 * @cortex/fsm-compiler — Diagram Generator
 *
 * Generates Mermaid state diagram and Graphviz DOT format from FSM AST.
 */
import type { FsmAst } from "../parser.js";
export declare class DiagramGenerator {
    /**
     * Generate Mermaid state diagram.
     *
     * @example Output:
     *   stateDiagram-v2
     *     [*] --> created
     *     created --> awake : wakeup
     *     created --> destroyed : destroy
     */
    toMermaid(ast: FsmAst, _highlight?: string): string;
    /**
     * Generate Graphviz DOT format.
     */
    toDot(ast: FsmAst): string;
}
//# sourceMappingURL=diagram-generator.d.ts.map