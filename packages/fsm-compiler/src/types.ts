/**
 * @cortex/fsm-compiler — Public Type Definitions
 *
 * Central type definitions for the three-layer FSM compiler architecture.
 *
 * Layer 1 (DSL):   FsmDefinition, FsmStateDefinition, FsmTransitionDefinition
 * Layer 2 (Compiler): FsmAst, ValidationResult, GeneratedOutput
 * Layer 3 (Runtime):  TransitionRecord, MachineSnapshot, GuardFn, ActionFn
 *
 * This file is the single source of truth for all public types.
 * It intentionally does NOT import from implementation files to
 * avoid circular dependencies — concrete classes re-export these types.
 *
 * @module types
 */

// ════════════════════════════════════════════════════════════════
// Layer 1 — DSL Schema Types
// ════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════
// Layer 2 — Compiler Types (AST, Validation, Generation)
// ════════════════════════════════════════════════════════════════

// ── AST ──

export interface FsmAst {
  machine: FsmDefinition;
  stateMap: Map<string, FsmStateDefinition>;
  transitionMap: Map<string, FsmTransitionDefinition>;
  adjacencyList: Map<string, FsmTransitionDefinition[]>;
  /** Reverse adjacency for reachability analysis */
  reverseAdjacency: Map<string, FsmTransitionDefinition[]>;
}

// ── Parse Errors ──

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

// ── Validation ──

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

// ── Code Generation ──

export interface GeneratedOutput {
  /** Generated .ts file content — type enums and transition table */
  types: string;
  /** Generated class with dispatch logic */
  runtime: string;
  /** Guard function stubs */
  guards: string;
  /** Action function stubs */
  actions: string;
  /** Import map — which imports are needed */
  imports: string[];
}

export interface GenOptions {
  /** Optional namespace prefix for generated enums */
  namespace?: string;
  /** Whether to generate immutable types (readonly) */
  readonly?: boolean;
}

// ════════════════════════════════════════════════════════════════
// Layer 3 — Runtime Types
// ════════════════════════════════════════════════════════════════

// ── Transition Record ──

export interface TransitionRecord<TState extends string = string, TEvent extends string = string, TContext = unknown> {
  timestamp: number;
  from: TState;
  to: TState;
  event: TEvent;
  context?: TContext;
  /** Unique ID for this transition (for audit trail) */
  id: string;
  /** Optional cause — who/what triggered it */
  cause?: string;
}

// ── Machine Snapshot ──

export interface MachineSnapshot<TState extends string = string, TContext = unknown> {
  machineId: string;
  version: string;
  currentState: TState;
  history: TransitionRecord<TState, string, TContext>[];
  createdAt: number;
}

// ── Transition Table ──

export interface TransitionEntry<TState extends string> {
  target: TState;
  guard?: string;
  action?: string;
}

export interface TransitionTable<TState extends string, _TEvent extends string> {
  [state: string]: {
    [event: string]: TransitionEntry<TState> | undefined;
  } | undefined;
}

// ── Runtime Errors ──

export class TransitionError extends Error {
  constructor(
    message: string,
    public readonly from: string,
    public readonly event: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "TransitionError";
  }
}

export class GuardError extends Error {
  constructor(
    message: string,
    public readonly guardName: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "GuardError";
  }
}

// ── Guard & Action Signatures ──

/**
 * Pure predicate function — given a context, return boolean.
 * Async guards must be evaluated via evaluateAsync().
 */
export type GuardFn = (context: unknown) => boolean | Promise<boolean>;

/**
 * Side-effect function executed during a transition.
 * Can be async — dispatch() will fire-and-forget; use dispatchAsync() for await.
 */
export type ActionFn = (context: unknown) => void | Promise<void>;

// ── History Recorder Options ──

export interface HistoryRecorderOptions {
  /** Maximum number of records to keep in memory (0 = unlimited) */
  maxRecords?: number;
}

// ── Guard Registry Interface (structural type, avoids circular imports) ──

/**
 * Structural type for GuardRegistry.
 * Concrete GuardRegistry class satisfies this interface.
 */
export interface GuardRegistryLike {
  register(name: string, fn: GuardFn): void;
  evaluate(name: string, context: unknown): boolean;
  evaluateAsync(name: string, context: unknown): Promise<boolean>;
  has(name: string): boolean;
  remove(name: string): void;
  clear(): void;
  readonly names: string[];
}

/**
 * Structural type for ActionRegistry.
 * Concrete ActionRegistry class satisfies this interface.
 */
export interface ActionRegistryLike {
  register(name: string, fn: ActionFn): void;
  execute(name: string, context: unknown): void | Promise<void>;
  executeAsync(name: string, context: unknown): Promise<void>;
  has(name: string): boolean;
  remove(name: string): void;
  clear(): void;
  readonly names: string[];
}

// ── Runtime Options (uses structural types to avoid circular deps) ──

export interface StateMachineOptions<TState extends string, TEvent extends string, _TContext = unknown> {
  guards?: GuardRegistryLike;
  actions?: ActionRegistryLike;
  /** Custom transition table (overrides generated one) */
  transitionTable?: TransitionTable<TState, TEvent>;
}
