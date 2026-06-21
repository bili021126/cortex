/**
 * @cortex/fsm-compiler — FSM Parser
 *
 * Parses FSM DSL definitions (JSON) into an AST representation
 * with map-based lookups for efficient validation and code generation.
 */
import type { FsmDefinition, FsmStateDefinition, FsmTransitionDefinition } from "../dsl/schema.js";
export interface FsmAst {
    machine: FsmDefinition;
    stateMap: Map<string, FsmStateDefinition>;
    transitionMap: Map<string, FsmTransitionDefinition>;
    adjacencyList: Map<string, FsmTransitionDefinition[]>;
    /** Reverse adjacency for reachability analysis */
    reverseAdjacency: Map<string, FsmTransitionDefinition[]>;
}
export declare class FsmParseError extends Error {
    readonly code: string;
    readonly nodeId?: string | undefined;
    constructor(message: string, code: string, nodeId?: string | undefined);
}
export declare class FsmParser {
    /**
     * Parse a JSON FSM definition string into an AST.
     *
     * Validation performed:
     *   - Required fields present
     *   - State IDs referenced in transitions exist in states array
     *   - No duplicate state/transition IDs
     *   - Initial state is a valid state ID
     *   - Final states are all valid state IDs
     */
    parse(json: string): FsmAst;
    /**
     * Parse a pre-parsed FsmDefinition object into an AST.
     */
    parseObject(definition: FsmDefinition): FsmAst;
}
//# sourceMappingURL=parser.d.ts.map