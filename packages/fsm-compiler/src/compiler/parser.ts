/**
 * @cortex/fsm-compiler — FSM Parser
 *
 * Parses FSM DSL definitions (JSON) into an AST representation
 * with map-based lookups for efficient validation and code generation.
 */

import type { FsmDefinition, FsmStateDefinition, FsmTransitionDefinition } from "../dsl/schema.js";

// ────────────────────────────────────────────────────────────
// AST Types
// ────────────────────────────────────────────────────────────

export interface FsmAst {
  machine: FsmDefinition;
  stateMap: Map<string, FsmStateDefinition>;
  transitionMap: Map<string, FsmTransitionDefinition>;
  adjacencyList: Map<string, FsmTransitionDefinition[]>;
  /** Reverse adjacency for reachability analysis */
  reverseAdjacency: Map<string, FsmTransitionDefinition[]>;
}

// ────────────────────────────────────────────────────────────
// Parse Error
// ────────────────────────────────────────────────────────────

export class FsmParseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly nodeId?: string,
  ) {
    super(message);
    this.name = "FsmParseError";
  }
}

// ────────────────────────────────────────────────────────────
// Parser
// ────────────────────────────────────────────────────────────

export class FsmParser {
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
  parse(json: string): FsmAst {
    const raw = JSON.parse(json) as FsmDefinition;
    return this.parseObject(raw);
  }

  /**
   * Parse a pre-parsed FsmDefinition object into an AST.
   */
  parseObject(definition: FsmDefinition): FsmAst {
    // --- Validate required fields ---
    if (!definition.id) {
      throw new FsmParseError("Machine id is required", "MISSING_FIELD", "id");
    }
    if (!definition.initialState) {
      throw new FsmParseError("initialState is required", "MISSING_FIELD", "initialState");
    }
    if (!definition.states || definition.states.length === 0) {
      throw new FsmParseError("At least one state is required", "MISSING_STATES");
    }
    if (!definition.transitions) {
      throw new FsmParseError("transitions field is required", "MISSING_FIELD", "transitions");
    }

    // --- Build state map & check duplicates ---
    const stateMap = new Map<string, FsmStateDefinition>();
    for (const state of definition.states) {
      if (stateMap.has(state.id)) {
        throw new FsmParseError(`Duplicate state id: "${state.id}"`, "DUPLICATE_STATE", state.id);
      }
      stateMap.set(state.id, state);
    }

    // --- Validate initial state ---
    if (!stateMap.has(definition.initialState)) {
      throw new FsmParseError(
        `Initial state "${definition.initialState}" not found in states`,
        "INVALID_INITIAL",
        definition.initialState,
      );
    }

    // --- Validate final states ---
    for (const finalId of definition.finalStates) {
      if (!stateMap.has(finalId)) {
        throw new FsmParseError(
          `Final state "${finalId}" not found in states`,
          "INVALID_FINAL",
          finalId,
        );
      }
    }

    // --- Build transition map & adjacency lists ---
    const transitionMap = new Map<string, FsmTransitionDefinition>();
    const adjacencyList = new Map<string, FsmTransitionDefinition[]>();
    const reverseAdjacency = new Map<string, FsmTransitionDefinition[]>();

    for (const transition of definition.transitions) {
      // Check duplicate transition IDs
      if (transitionMap.has(transition.id)) {
        throw new FsmParseError(
          `Duplicate transition id: "${transition.id}"`,
          "DUPLICATE_TRANSITION",
          transition.id,
        );
      }

      // Validate from/to states exist
      if (!stateMap.has(transition.from)) {
        throw new FsmParseError(
          `Transition "${transition.id}" references unknown state "${transition.from}" as source`,
          "MISSING_STATE",
          transition.id,
        );
      }
      if (!stateMap.has(transition.to)) {
        throw new FsmParseError(
          `Transition "${transition.id}" references unknown state "${transition.to}" as target`,
          "MISSING_STATE",
          transition.id,
        );
      }

      transitionMap.set(transition.id, transition);

      // Forward adjacency
      if (!adjacencyList.has(transition.from)) {
        adjacencyList.set(transition.from, []);
      }
      const fromList = adjacencyList.get(transition.from);
      if (fromList) {
        fromList.push(transition);
      }

      // Reverse adjacency
      if (!reverseAdjacency.has(transition.to)) {
        reverseAdjacency.set(transition.to, []);
      }
      const toList = reverseAdjacency.get(transition.to);
      if (toList) {
        toList.push(transition);
      }
    }

    return {
      machine: definition,
      stateMap,
      transitionMap,
      adjacencyList,
      reverseAdjacency,
    };
  }
}
