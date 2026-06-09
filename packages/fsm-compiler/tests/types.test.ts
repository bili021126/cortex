// @ci: unit

/**
 * @cortex/fsm-compiler — types.test.ts
 *
 * Tests for public type definitions and error classes.
 * Covers FsmDefinition, FsmStateDefinition, FsmTransitionDefinition,
 * FsmParseError, TransitionError, GuardError, and type-level contracts.
 */

import { describe, it, expect } from "vitest";
import {
  FsmParseError,
  TransitionError,
  GuardError,
  type FsmDefinition,
  type FsmStateDefinition,
  type FsmTransitionDefinition,
  type FsmAst,
  type ValidationResult,
  type ValidationError,
  type ValidationWarning,
  type ValidationMetrics,
  type GeneratedOutput,
  type GenOptions,
  type TransitionRecord,
  type MachineSnapshot,
  type TransitionEntry,
  type TransitionTable,
  type GuardFn,
  type ActionFn,
  type StateMachineOptions,
  type HistoryRecorderOptions,
  type GuardRegistryLike,
  type ActionRegistryLike,
} from "../src/types.js";

// ════════════════════════════════════════════════════════════════
// FsmParseError
// ════════════════════════════════════════════════════════════════

describe("FsmParseError", () => {
  it("should create an instance with required fields", () => {
    const error = new FsmParseError("Machine id is required", "MISSING_FIELD", "id");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("FsmParseError");
    expect(error.message).toBe("Machine id is required");
    expect(error.code).toBe("MISSING_FIELD");
    expect(error.nodeId).toBe("id");
  });

  it("should create an instance without nodeId", () => {
    const error = new FsmParseError("At least one state is required", "MISSING_STATES");

    expect(error.code).toBe("MISSING_STATES");
    expect(error.nodeId).toBeUndefined();
  });

  it("should allow subclass catch with instanceof", () => {
    const error = new FsmParseError("test", "TEST");
    expect(error instanceof Error).toBe(true);
    expect(error instanceof FsmParseError).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// TransitionError
// ════════════════════════════════════════════════════════════════

describe("TransitionError", () => {
  it("should create an instance with from/event/cause", () => {
    const cause = new Error("underlying");
    const error = new TransitionError("Invalid transition", "idle", "finish", cause);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("TransitionError");
    expect(error.message).toBe("Invalid transition");
    expect(error.from).toBe("idle");
    expect(error.event).toBe("finish");
    expect(error.cause).toBe(cause);
  });

  it("should create an instance without cause", () => {
    const error = new TransitionError("transition blocked", "a", "go");

    expect(error.from).toBe("a");
    expect(error.event).toBe("go");
    expect(error.cause).toBeUndefined();
  });

  it("should allow instanceof check", () => {
    const error = new TransitionError("x", "s", "e");
    expect(error instanceof TransitionError).toBe(true);
    expect(error instanceof Error).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// GuardError
// ════════════════════════════════════════════════════════════════

describe("GuardError", () => {
  it("should create an instance with guard name and cause", () => {
    const cause = new TypeError("context is null");
    const error = new GuardError("Guard 'canProceed' threw an error", "canProceed", cause);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("GuardError");
    expect(error.guardName).toBe("canProceed");
    expect(error.cause).toBe(cause);
  });

  it("should create an instance without cause", () => {
    const error = new GuardError("guard failed", "myGuard");

    expect(error.guardName).toBe("myGuard");
    expect(error.cause).toBeUndefined();
  });

  it("should allow instanceof check", () => {
    const error = new GuardError("x", "g");
    expect(error instanceof GuardError).toBe(true);
    expect(error instanceof Error).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// FsmDefinition structural contract
// ════════════════════════════════════════════════════════════════

describe("FsmDefinition (structural)", () => {
  it("should accept a minimal valid definition object", () => {
    const def: FsmDefinition = {
      id: "test_machine",
      displayName: "Test Machine",
      version: "1.0.0",
      states: [
        { id: "idle", displayName: "Idle", style: "initial" },
        { id: "done", displayName: "Done", style: "final" },
      ],
      transitions: [
        { id: "t1", from: "idle", to: "done", event: "finish" },
      ],
      initialState: "idle",
      finalStates: ["done"],
    };

    expect(def.id).toBe("test_machine");
    expect(def.states).toHaveLength(2);
    expect(def.transitions).toHaveLength(1);
    expect(def.finalStates).toEqual(["done"]);
  });

  it("should accept optional description field", () => {
    const def: FsmDefinition = {
      id: "m",
      displayName: "M",
      description: "A test machine",
      version: "0.1.0",
      states: [{ id: "s" }],
      transitions: [],
      initialState: "s",
      finalStates: [],
    };

    expect(def.description).toBe("A test machine");
  });
});

// ════════════════════════════════════════════════════════════════
// FsmStateDefinition structural contract
// ════════════════════════════════════════════════════════════════

describe("FsmStateDefinition (structural)", () => {
  it("should accept minimal state definition", () => {
    const state: FsmStateDefinition = { id: "created" };
    expect(state.id).toBe("created");
  });

  it("should accept optional fields", () => {
    const state: FsmStateDefinition = {
      id: "active",
      displayName: "Active",
      description: "Agent is active",
      metadata: { priority: 1 },
      style: "normal",
    };

    expect(state.displayName).toBe("Active");
    expect(state.metadata?.priority).toBe(1);
    expect(state.style).toBe("normal");
  });

  it("should accept all style variants", () => {
    const initial: FsmStateDefinition = { id: "a", style: "initial" };
    const normal: FsmStateDefinition = { id: "b", style: "normal" };
    const final: FsmStateDefinition = { id: "c", style: "final" };
    const error: FsmStateDefinition = { id: "d", style: "error" };

    expect(initial.style).toBe("initial");
    expect(normal.style).toBe("normal");
    expect(final.style).toBe("final");
    expect(error.style).toBe("error");
  });
});

// ════════════════════════════════════════════════════════════════
// FsmTransitionDefinition structural contract
// ════════════════════════════════════════════════════════════════

describe("FsmTransitionDefinition (structural)", () => {
  it("should accept minimal transition definition", () => {
    const t: FsmTransitionDefinition = {
      id: "t1",
      from: "a",
      to: "b",
      event: "go",
    };

    expect(t.id).toBe("t1");
    expect(t.from).toBe("a");
    expect(t.to).toBe("b");
    expect(t.event).toBe("go");
  });

  it("should accept optional guard, action, description, type", () => {
    const t: FsmTransitionDefinition = {
      id: "t2",
      from: "idle",
      to: "active",
      event: "execute",
      guard: "canExecute",
      action: "onExecute",
      description: "Execute when ready",
      type: "external",
    };

    expect(t.guard).toBe("canExecute");
    expect(t.action).toBe("onExecute");
    expect(t.description).toBe("Execute when ready");
    expect(t.type).toBe("external");
  });

  it("should accept all transition types", () => {
    const external: FsmTransitionDefinition = { id: "t1", from: "a", to: "b", event: "e", type: "external" };
    const internal: FsmTransitionDefinition = { id: "t2", from: "a", to: "a", event: "e", type: "internal" };
    const self: FsmTransitionDefinition = { id: "t3", from: "a", to: "a", event: "e", type: "self" };

    expect(external.type).toBe("external");
    expect(internal.type).toBe("internal");
    expect(self.type).toBe("self");
  });

  it("should default type to undefined (external)", () => {
    const t: FsmTransitionDefinition = { id: "t1", from: "a", to: "b", event: "e" };
    expect(t.type).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════
// FsmAst structural contract
// ════════════════════════════════════════════════════════════════

describe("FsmAst (structural)", () => {
  it("should accept a valid AST structure", () => {
    const machine: FsmDefinition = {
      id: "m",
      displayName: "M",
      version: "1.0.0",
      states: [{ id: "s1" }, { id: "s2" }],
      transitions: [{ id: "t1", from: "s1", to: "s2", event: "go" }],
      initialState: "s1",
      finalStates: ["s2"],
    };

    const stateMap = new Map();
    stateMap.set("s1", machine.states[0]);
    stateMap.set("s2", machine.states[1]);

    const transitionMap = new Map();
    transitionMap.set("t1", machine.transitions[0]);

    const adjacencyList = new Map();
    adjacencyList.set("s1", [machine.transitions[0]]);

    const reverseAdjacency = new Map();
    reverseAdjacency.set("s2", [machine.transitions[0]]);

    const ast: FsmAst = {
      machine,
      stateMap,
      transitionMap,
      adjacencyList,
      reverseAdjacency,
    };

    expect(ast.machine.id).toBe("m");
    expect(ast.stateMap.size).toBe(2);
    expect(ast.transitionMap.size).toBe(1);
    expect(ast.adjacencyList.has("s1")).toBe(true);
    expect(ast.reverseAdjacency.has("s2")).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// Validation types structural contract
// ════════════════════════════════════════════════════════════════

describe("Validation types (structural)", () => {
  it("should accept a ValidationResult", () => {
    const error: ValidationError = {
      code: "UNREACHABLE_STATE",
      nodeId: "orphan",
      message: 'State "orphan" is unreachable',
    };

    const warning: ValidationWarning = {
      code: "SELF_LOOP_INCONSISTENT",
      nodeId: "t1",
      message: "Self-loop should have type",
    };

    const metrics: ValidationMetrics = {
      stateCount: 3,
      transitionCount: 2,
      reachableStates: 2,
      unreachableStates: ["orphan"],
      hasDeadlock: false,
      deterministic: true,
    };

    const result: ValidationResult = {
      valid: false,
      errors: [error],
      warnings: [warning],
      metrics,
    };

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.metrics.unreachableStates).toContain("orphan");
  });

  it("should accept all ValidationErrorCode variants", () => {
    const codes: string[] = [
      "UNREACHABLE_STATE",
      "DEADLOCK",
      "NON_DETERMINISTIC",
      "INVALID_REFERENCE",
      "MISSING_STATE",
      "DUPLICATE_ID",
      "INVALID_INITIAL",
      "INVALID_FINAL",
      "SELF_LOOP_INCONSISTENT",
    ];

    codes.forEach((code) => {
      const err: ValidationError = { code: code as ValidationError["code"], nodeId: "x", message: code };
      expect(err.code).toBe(code);
    });
  });
});

// ════════════════════════════════════════════════════════════════
// GeneratedOutput & GenOptions structural contract
// ════════════════════════════════════════════════════════════════

describe("GeneratedOutput & GenOptions (structural)", () => {
  it("should accept a GeneratedOutput", () => {
    const output: GeneratedOutput = {
      types: "export enum State { IDLE = 'idle' }",
      runtime: "export class Machine { }",
      guards: "export function canProceed() { return true; }",
      actions: "export function onEnter() { }",
      imports: ['import type { GuardFn } from "@cortex/fsm-compiler/runtime"'],
    };

    expect(output.types).toContain("enum State");
    expect(output.imports).toHaveLength(1);
  });

  it("should accept GenOptions with namespace", () => {
    const opts: GenOptions = { namespace: "MyApp" };
    expect(opts.namespace).toBe("MyApp");
    expect(opts.readonly).toBeUndefined();
  });

  it("should accept GenOptions with readonly", () => {
    const opts: GenOptions = { readonly: true };
    expect(opts.readonly).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// Runtime types structural contract
// ════════════════════════════════════════════════════════════════

describe("Runtime types (structural)", () => {
  it("should accept a TransitionRecord", () => {
    const record: TransitionRecord = {
      timestamp: 1700000000000,
      from: "idle",
      to: "active",
      event: "execute",
      id: "m-1-1700000000000",
      cause: "user_action",
    };

    expect(record.timestamp).toBeGreaterThan(0);
    expect(record.from).toBe("idle");
    expect(record.to).toBe("active");
    expect(record.id).toMatch(/^m-/);
  });

  it("should accept a TransitionRecord with context", () => {
    const record: TransitionRecord<"a" | "b", "go", { userId: string }> = {
      timestamp: Date.now(),
      from: "a",
      to: "b",
      event: "go",
      id: "t1",
      context: { userId: "u1" },
    };

    expect(record.context?.userId).toBe("u1");
  });

  it("should accept a MachineSnapshot", () => {
    const snapshot: MachineSnapshot = {
      machineId: "agent_pool",
      version: "1.0.0",
      currentState: "active",
      history: [],
      createdAt: Date.now(),
    };

    expect(snapshot.machineId).toBe("agent_pool");
    expect(snapshot.currentState).toBe("active");
  });

  it("should accept a TransitionEntry", () => {
    const entry: TransitionEntry<"idle" | "active"> = {
      target: "active",
      guard: "canProceed",
      action: "onActivate",
    };

    expect(entry.target).toBe("active");
    expect(entry.guard).toBe("canProceed");
  });

  it("should accept a TransitionTable", () => {
    const table: TransitionTable<string, string> = {
      idle: {
        execute: { target: "active" },
        shutdown: { target: "destroyed", guard: "canShutdown" },
      },
    };

    expect(table.idle?.execute?.target).toBe("active");
    expect(table.idle?.shutdown?.guard).toBe("canShutdown");
  });
});

// ════════════════════════════════════════════════════════════════
// GuardFn & ActionFn structural contract
// ════════════════════════════════════════════════════════════════

describe("GuardFn & ActionFn (structural)", () => {
  it("should accept a sync GuardFn", () => {
    const fn: GuardFn = (ctx) => {
      const c = ctx as { ready: boolean };
      return c.ready;
    };

    expect(fn({ ready: true })).toBe(true);
    expect(fn({ ready: false })).toBe(false);
  });

  it("should accept an async GuardFn", async () => {
    const fn: GuardFn = async (ctx) => {
      await Promise.resolve();
      return (ctx as { valid: boolean }).valid;
    };

    const result = await fn({ valid: true });
    expect(result).toBe(true);
  });

  it("should accept a sync ActionFn", () => {
    const fn: ActionFn = (ctx) => {
      const c = ctx as { value: number };
      c.value = 42;
    };

    const obj = { value: 0 };
    void fn(obj);
    expect(obj.value).toBe(42);
  });

  it("should accept an async ActionFn", async () => {
    let called = false;
    const fn: ActionFn = async () => {
      await Promise.resolve();
      called = true;
    };

    await fn({});
    expect(called).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// Options interfaces structural contract
// ════════════════════════════════════════════════════════════════

describe("Options interfaces (structural)", () => {
  it("should accept StateMachineOptions with all fields", () => {
    const guards: GuardRegistryLike = {
      register: () => {},
      evaluate: () => true,
      evaluateAsync: async () => true,
      has: () => true,
      remove: () => {},
      clear: () => {},
      names: ["canProceed"],
    };

    const actions: ActionRegistryLike = {
      register: () => {},
      execute: () => {},
      executeAsync: async () => {},
      has: () => true,
      remove: () => {},
      clear: () => {},
      names: ["onEnter"],
    };

    const table: TransitionTable<"a" | "b", "go"> = {
      a: { go: { target: "b" } },
    };

    const options: StateMachineOptions<"a" | "b", "go"> = {
      guards,
      actions,
      transitionTable: table,
    };

    expect(options.guards).toBeDefined();
    expect(options.actions).toBeDefined();
    expect(options.transitionTable?.a?.go?.target).toBe("b");
  });

  it("should accept HistoryRecorderOptions", () => {
    const opts: HistoryRecorderOptions = { maxRecords: 100 };
    expect(opts.maxRecords).toBe(100);

    const empty: HistoryRecorderOptions = {};
    expect(empty.maxRecords).toBeUndefined();
  });
});
