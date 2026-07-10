/**
 * @cortex/fsm-compiler — FSM Compiler
 *
 * Three-layer FSM compiler architecture:
 * - Layer 1 (DSL): Schema definitions for state machines
 * - Layer 2 (Compiler): Parser, Validator, Code Generators
 * - Layer 3 (Runtime): StateMachine engine, Guard/Action registries
 *
 * Import convention:
 * ```ts
 * // All types + classes from a single import:
 * import { FsmDefinition, FsmParser, StateMachine } from "@cortex/fsm-compiler";
 *
 * // Or runtime-only (smaller bundle):
 * import { StateMachine, GuardRegistry } from "@cortex/fsm-compiler/runtime";
 * ```
 *
 * @module index
 */

// ── Public Types (Layer 1, 2, 3) ──
export type {
  // DSL Schema
  FsmDefinition,
  FsmStateDefinition,
  FsmTransitionDefinition,

  // Compiler — AST
  FsmAst,

  // Compiler — Validation
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ValidationMetrics,
  ValidationErrorCode,

  // Compiler — Code Generation
  GeneratedOutput,
  GenOptions,

  // Runtime — Records & Snapshots
  TransitionRecord,
  MachineSnapshot,
  TransitionEntry,
  TransitionTable,

  // Runtime — Function Signatures
  GuardFn,
  ActionFn,

  // Runtime — Options
  StateMachineOptions,
  HistoryRecorderOptions,

  // Runtime — Structural Types
  GuardRegistryLike,
  ActionRegistryLike,
} from "./types.js";

// ── Error Classes (value exports from single source of truth) ──
export { FsmParseError } from "./compiler/parser.js";
export { TransitionError, GuardError } from "./runtime/state-machine.js";

// ── Compiler Layer (Layer 2) ──
export { FsmParser } from "./compiler.js";
export { FsmValidator } from "./compiler.js";
export { TypeScriptGenerator } from "./compiler.js";
export { DiagramGenerator } from "./compiler.js";

// ── Runtime Layer (Layer 3) ──
export { StateMachine } from "./runtime.js";
export { GuardRegistry } from "./runtime.js";
export { ActionRegistry } from "./runtime.js";
export { HistoryRecorder } from "./runtime.js";

// ── 编译时类型安全辅助函数 ──
export { defineFsm } from "./define-fsm.js";
