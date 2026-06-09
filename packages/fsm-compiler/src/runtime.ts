/**
 * @cortex/fsm-compiler — FSM Runtime Engine Entry Point
 *
 * Layer 3 of the three-layer architecture.
 *
 * The Runtime Engine executes compiled state machines with:
 * - StateMachine<TState, TEvent, TContext> — generic transition engine
 * - GuardRegistry — pluggable predicate evaluation
 * - ActionRegistry — pluggable side-effect dispatch
 * - HistoryRecorder — audit trail with serialization
 *
 * Usage:
 * ```ts
 * import { StateMachine, GuardRegistry, ActionRegistry } from "@cortex/fsm-compiler/runtime";
 *
 * const guards = new GuardRegistry();
 * guards.register("canProceed", (ctx) => (ctx as MyContext).ready);
 *
 * const actions = new ActionRegistry();
 * actions.register("onEnter", (ctx) => console.log("entered"));
 *
 * const machine = new StateMachine<MyState, MyEvent>(definition, initialState, {
 *   guards,
 *   actions,
 * });
 *
 * machine.dispatch("someEvent");
 * console.log(machine.current);
 * ```
 *
 * @module runtime
 */

// ── State Machine ──
export { StateMachine } from "./runtime/state-machine.js";

// ── Registries ──
export { GuardRegistry } from "./runtime/guard-registry.js";
export { ActionRegistry } from "./runtime/action-registry.js";

// ── History ──
export { HistoryRecorder } from "./runtime/history-recorder.js";
