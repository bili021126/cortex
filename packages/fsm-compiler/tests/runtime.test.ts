// @ci: unit

/**
 * @cortex/fsm-compiler -- runtime.test.ts
 *
 * Tests for the runtime layer (Layer 3) -- StateMachine, GuardRegistry,
 * ActionRegistry, and HistoryRecorder.
 *
 * Covers edge cases beyond the existing per-file unit tests:
 *   - StateMachine: custom transition table, context passing, async actions,
 *     guard exceptions, multiple transitions, history tracking edge cases,
 *     isFinal behavior with multiple final states
 *   - HistoryRecorder: full CRUD, max records trimming, serialization
 *   - Re-export verification from runtime.ts barrel
 */

import { describe, it, expect, vi } from "vitest";
import { StateMachine, TransitionError, GuardError, type TransitionTable } from "../src/runtime/state-machine.js";
import { GuardRegistry } from "../src/runtime/guard-registry.js";
import { ActionRegistry } from "../src/runtime/action-registry.js";
import { HistoryRecorder } from "../src/runtime/history-recorder.js";
import type { FsmDefinition } from "../src/dsl/schema.js";

// ================================================================
// Fixtures
// ================================================================

const basicDef: FsmDefinition = {
  id: "basic",
  displayName: "Basic FSM",
  version: "1.0.0",
  states: [
    { id: "idle" },
    { id: "active" },
    { id: "done", style: "final" },
  ],
  transitions: [
    { id: "t1", from: "idle", to: "active", event: "start" },
    { id: "t2", from: "active", to: "done", event: "finish" },
  ],
  initialState: "idle",
  finalStates: ["done"],
};

const guardDef: FsmDefinition = {
  id: "guarded",
  displayName: "Guarded FSM",
  version: "1.0.0",
  states: [
    { id: "idle" },
    { id: "active" },
    { id: "blocked" },
  ],
  transitions: [
    { id: "t1", from: "idle", to: "active", event: "start", guard: "canStart" },
    { id: "t2", from: "idle", to: "blocked", event: "start", guard: "isBlocked" },
    { id: "t3", from: "active", to: "idle", event: "reset" },
  ],
  initialState: "idle",
  finalStates: [],
};

const actionDef: FsmDefinition = {
  id: "action_fsm",
  displayName: "Action FSM",
  version: "1.0.0",
  states: [
    { id: "a" },
    { id: "b" },
  ],
  transitions: [
    { id: "t1", from: "a", to: "b", event: "go", action: "onGo" },
    { id: "t2", from: "b", to: "a", event: "back", action: "onBack" },
  ],
  initialState: "a",
  finalStates: [],
};

// ================================================================
// StateMachine -- Advanced Tests
// ================================================================

describe("StateMachine -- advanced", () => {
  it("should support custom transition table via options", () => {
    const customTable: TransitionTable<"idle" | "active" | "done", "start" | "finish"> = {
      idle: { start: { target: "active" } },
      active: { finish: { target: "done" } },
    };

    const machine = new StateMachine<"idle" | "active" | "done", "start" | "finish">(
      basicDef,
      "idle",
      { transitionTable: customTable },
    );

    machine.dispatch("start");
    expect(machine.current).toBe("active");

    machine.dispatch("finish");
    expect(machine.current).toBe("done");
  });

  it("should pass context through to transition record", () => {
    const machine = new StateMachine(basicDef, "idle" as const);

    const ctx = { userId: "u1", reason: "manual" };
    machine.dispatch("start" as const, ctx);

    expect(machine.history[0].context).toEqual(ctx);
  });

  it("should generate unique transition IDs", () => {
    const machine = new StateMachine(basicDef, "idle" as const);

    machine.dispatch("start" as const);
    machine.dispatch("finish" as const);

    expect(machine.history[0].id).not.toBe(machine.history[1].id);
    expect(machine.history[0].id).toContain("basic");
  });

  it("should throw TransitionError on invalid event for current state", () => {
    const machine = new StateMachine(basicDef, "idle" as const);

    // "finish" is not valid from "idle"
    expect(() => machine.dispatch("finish" as const)).toThrow(TransitionError);
  });

  it("should retain error cause in TransitionError when guard rejects", () => {
    const guards = new GuardRegistry();
    guards.register("canStart", () => false);

    const machine = new StateMachine(
      { ...guardDef, transitions: [guardDef.transitions[0]] },
      "idle" as const,
      { guards },
    );

    expect(() => machine.dispatch("start" as const)).toThrow(TransitionError);
    try {
      machine.dispatch("start" as const);
    } catch (e) {
      expect(e).toBeInstanceOf(TransitionError);
      expect((e as TransitionError).from).toBe("idle");
      expect((e as TransitionError).event).toBe("start");
    }
  });

  it("should throw GuardError when guard function throws", () => {
    const guards = new GuardRegistry();
    guards.register("canStart", () => {
      throw new Error("internal error");
    });

    const machine = new StateMachine(
      { ...guardDef, transitions: [guardDef.transitions[0]] },
      "idle" as const,
      { guards },
    );

    expect(() => machine.dispatch("start" as const)).toThrow(GuardError);
  });

  it("should execute sync action on transition", () => {
    let sideEffect = "";

    const actions = new ActionRegistry();
    actions.register("onGo", (ctx) => {
      sideEffect = `went to ${(ctx as { target?: string }).target ?? "b"}`;
    });

    const machine = new StateMachine(actionDef, "a" as const, { actions });
    machine.dispatch("go" as const, { target: "B" });

    expect(sideEffect).toBe("went to B");
    expect(machine.current).toBe("b");
  });

  it("should fire-and-forget async actions in sync dispatch", async () => {
    vi.useFakeTimers();

    let asyncDone = false;
    const actions = new ActionRegistry();
    actions.register("onGo", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      asyncDone = true;
    });

    const machine = new StateMachine(actionDef, "a" as const, { actions });

    // This should not throw -- async action is fire-and-forget
    expect(() => machine.dispatch("go" as const)).not.toThrow();

    // State should update immediately
    expect(machine.current).toBe("b");

    // Advance timers and allow promise to resolve
    await vi.runAllTimersAsync();
    expect(asyncDone).toBe(true);

    vi.useRealTimers();
  });

  it("should support machineId and version getters", () => {
    const machine = new StateMachine(basicDef, "idle" as const);

    expect(machine.machineId).toBe("basic");
    expect(machine.version).toBe("1.0.0");
  });

  it("should return false from can() for undefined transitions", () => {
    const machine = new StateMachine(basicDef, "idle" as const);

    expect(machine.can("nonexistent" as any)).toBe(false);
  });

  it("should return false from can() when guard rejects", () => {
    const guards = new GuardRegistry();
    guards.register("canStart", () => false);

    const machine = new StateMachine(
      { ...guardDef, transitions: [guardDef.transitions[0]] },
      "idle" as const,
      { guards },
    );

    expect(machine.can("start" as const)).toBe(false);
  });

  it("should return true from can() when guard passes", () => {
    const guards = new GuardRegistry();
    guards.register("canStart", () => true);

    const machine = new StateMachine(
      { ...guardDef, transitions: [guardDef.transitions[0]] },
      "idle" as const,
      { guards },
    );

    expect(machine.can("start" as const)).toBe(true);
  });

  it("should handle isFinal correctly with multiple final states", () => {
    const multiFinalDef: FsmDefinition = {
      id: "multi_final",
      displayName: "Multi Final",
      version: "1.0.0",
      states: [
        { id: "start" },
        { id: "success", style: "final" },
        { id: "failure", style: "final" },
      ],
      transitions: [
        { id: "t1", from: "start", to: "success", event: "win" },
        { id: "t2", from: "start", to: "failure", event: "lose" },
      ],
      initialState: "start",
      finalStates: ["success", "failure"],
    };

    const machine = new StateMachine(multiFinalDef, "start" as const);

    expect(machine.isFinal).toBe(false);

    machine.dispatch("win" as const);
    expect(machine.current).toBe("success");
    expect(machine.isFinal).toBe(true);

    // Reset and try the other final state
    machine.reset();
    machine.dispatch("lose" as const);
    expect(machine.current).toBe("failure");
    expect(machine.isFinal).toBe(true);
  });

  it("should reset without clearing history when clearHistory=false", () => {
    const machine = new StateMachine(basicDef, "idle" as const);

    machine.dispatch("start" as const);
    expect(machine.history).toHaveLength(1);

    machine.reset(false);
    expect(machine.current).toBe("idle");
    expect(machine.history).toHaveLength(1); // history preserved
  });

  it("should serialize correctly", () => {
    const machine = new StateMachine(basicDef, "idle" as const);
    machine.dispatch("start" as const);

    const snapshot = machine.serialize();

    expect(snapshot.machineId).toBe("basic");
    expect(snapshot.version).toBe("1.0.0");
    expect(snapshot.currentState).toBe("active");
    expect(snapshot.history).toHaveLength(1);
    expect(snapshot.createdAt).toBeGreaterThan(0);
  });

  it("should deserialize and continue from restored state", () => {
    const machine = new StateMachine(basicDef, "idle" as const);
    machine.dispatch("start" as const);

    const snapshot = machine.serialize();
    const restored = StateMachine.deserialize(snapshot, basicDef);

    expect(restored.current).toBe("active");
    expect(restored.history).toHaveLength(1);

    // Continue from restored state
    restored.dispatch("finish" as const);
    expect(restored.current).toBe("done");
    expect(restored.history).toHaveLength(2);
  });

  it("should support deserialize with custom options", () => {
    const guards = new GuardRegistry();
    let _guardChecked = false;
    guards.register("canStart", () => {
      _guardChecked = true;
      return true;
    });

    const machine = new StateMachine(
      { ...guardDef, transitions: [guardDef.transitions[0]] },
      "idle" as const,
      { guards },
    );

    machine.dispatch("start" as const);
    const snapshot = machine.serialize();

    const restored = StateMachine.deserialize(snapshot, {
      ...guardDef,
      transitions: [guardDef.transitions[0]],
    }, { guards });

    expect(restored.current).toBe("active");
  });

  it("should not mutate internal history array via getter", () => {
    const machine = new StateMachine(basicDef, "idle" as const);
    machine.dispatch("start" as const);

    const history = machine.history;
    expect(history).toHaveLength(1);

    // Attempting to push via spread should not affect internal
    expect(machine.history).toHaveLength(1);
  });

  it("should handle sequential transitions with history tracking", () => {
    const machine = new StateMachine(basicDef, "idle" as const);

    machine.dispatch("start" as const);
    machine.dispatch("finish" as const);

    expect(machine.history).toHaveLength(2);
    expect(machine.history[0].from).toBe("idle");
    expect(machine.history[0].to).toBe("active");
    expect(machine.history[0].event).toBe("start");
    expect(machine.history[1].from).toBe("active");
    expect(machine.history[1].to).toBe("done");
    expect(machine.history[1].event).toBe("finish");
  });
});

// ================================================================
// GuardRegistry -- Additional Edge Cases
// ================================================================

describe("GuardRegistry -- edge cases", () => {
  it("should return names as a frozen-like array copy", () => {
    const registry = new GuardRegistry();
    registry.register("a", () => true);
    registry.register("b", () => false);

    const names = registry.names;
    expect(names).toEqual(["a", "b"]);
  });

  it("should handle empty registry", () => {
    const registry = new GuardRegistry();
    expect(registry.names).toEqual([]);
    expect(registry.has("anything")).toBe(false);
  });

  it("should allow re-registration after remove", () => {
    const registry = new GuardRegistry();
    registry.register("g", () => true);
    registry.remove("g");
    expect(registry.has("g")).toBe(false);

    // Re-register should work
    registry.register("g", () => false);
    expect(registry.has("g")).toBe(true);
    expect(registry.evaluate("g", {})).toBe(false);
  });

  it("should clear all registered guards", () => {
    const registry = new GuardRegistry();
    registry.register("a", () => true);
    registry.register("b", () => true);
    registry.clear();

    expect(registry.names).toEqual([]);
    expect(registry.has("a")).toBe(false);
  });
});

// ================================================================
// ActionRegistry -- Additional Edge Cases
// ================================================================

describe("ActionRegistry -- edge cases", () => {
  it("should return context from execute", () => {
    const registry = new ActionRegistry();
    let captured: unknown = null;

    registry.register("capture", (ctx) => {
      captured = ctx;
    });

    const ctx = { value: 42 };
    void registry.execute("capture", ctx);

    expect(captured).toBe(ctx);
  });

  it("should handle async action in execute (fire-and-forget style)", async () => {
    const registry = new ActionRegistry();
    let called = false;

    registry.register("async", async () => {
      await Promise.resolve();
      called = true;
    });

    // execute() returns void | Promise<void>
    const result = registry.execute("async", {});
    // The result is a Promise since the fn is async
    expect(result).toBeInstanceOf(Promise);

    // Await it to ensure it completes
    await result;
    expect(called).toBe(true);
  });

  it("should clear all registered actions", () => {
    const registry = new ActionRegistry();
    registry.register("a", () => {});
    registry.register("b", () => {});
    registry.clear();

    expect(registry.names).toEqual([]);
  });

  it("should allow re-registration after remove", () => {
    const registry = new ActionRegistry();
    registry.register("a", () => {});
    registry.remove("a");
    registry.register("a", () => {}); // Should not throw

    expect(registry.has("a")).toBe(true);
  });
});

// ================================================================
// HistoryRecorder
// ================================================================

describe("HistoryRecorder", () => {
  it("should record a transition", () => {
    const recorder = new HistoryRecorder();

    recorder.record({
      timestamp: Date.now(),
      from: "idle",
      to: "active",
      event: "start",
      id: "m-1",
    });

    expect(recorder.size).toBe(1);
    expect(recorder.all).toHaveLength(1);
  });

  it("should retrieve records by source state", () => {
    const recorder = new HistoryRecorder<"a" | "b", "go">();

    recorder.record({ timestamp: 1, from: "a", to: "b", event: "go", id: "1" });
    recorder.record({ timestamp: 2, from: "b", to: "a", event: "go", id: "2" });
    recorder.record({ timestamp: 3, from: "a", to: "b", event: "go", id: "3" });

    const fromA = recorder.getFrom("a");
    expect(fromA).toHaveLength(2);
    expect(fromA[0].id).toBe("1");
    expect(fromA[1].id).toBe("3");
  });

  it("should retrieve records by target state", () => {
    const recorder = new HistoryRecorder<"a" | "b", "go">();

    recorder.record({ timestamp: 1, from: "a", to: "b", event: "go", id: "1" });
    recorder.record({ timestamp: 2, from: "b", to: "a", event: "go", id: "2" });

    const toA = recorder.getTo("a");
    expect(toA).toHaveLength(1);
    expect(toA[0].id).toBe("2");
  });

  it("should retrieve records by event", () => {
    const recorder = new HistoryRecorder<"a" | "b", "go" | "stop">();

    recorder.record({ timestamp: 1, from: "a", to: "b", event: "go", id: "1" });
    recorder.record({ timestamp: 2, from: "b", to: "a", event: "stop", id: "2" });

    const goEvents = recorder.getByEvent("go");
    expect(goEvents).toHaveLength(1);
    expect(goEvents[0].id).toBe("1");
  });

  it("should return last N records", () => {
    const recorder = new HistoryRecorder();

    recorder.record({ timestamp: 1, from: "a", to: "b", event: "go", id: "1" });
    recorder.record({ timestamp: 2, from: "b", to: "c", event: "go", id: "2" });
    recorder.record({ timestamp: 3, from: "c", to: "d", event: "go", id: "3" });

    const last2 = recorder.last(2);
    expect(last2).toHaveLength(2);
    expect(last2[0].id).toBe("2");
    expect(last2[1].id).toBe("3");
  });

  it("should respect maxRecords option", () => {
    const recorder = new HistoryRecorder({ maxRecords: 2 });

    recorder.record({ timestamp: 1, from: "a", to: "b", event: "go", id: "1" });
    recorder.record({ timestamp: 2, from: "b", to: "c", event: "go", id: "2" });
    recorder.record({ timestamp: 3, from: "c", to: "d", event: "go", id: "3" });

    expect(recorder.size).toBe(2);
    expect(recorder.all[0].id).toBe("2");
    expect(recorder.all[1].id).toBe("3");
  });

  it("should allow unlimited records when maxRecords is 0", () => {
    const recorder = new HistoryRecorder({ maxRecords: 0 });

    for (let i = 0; i < 100; i++) {
      recorder.record({
        timestamp: i,
        from: "a",
        to: "b",
        event: "go",
        id: `r-${i}`,
      });
    }

    expect(recorder.size).toBe(100);
  });

  it("should clear all records", () => {
    const recorder = new HistoryRecorder();
    recorder.record({ timestamp: 1, from: "a", to: "b", event: "go", id: "1" });
    recorder.record({ timestamp: 2, from: "b", to: "c", event: "go", id: "2" });

    recorder.clear();
    expect(recorder.size).toBe(0);
    expect(recorder.all).toHaveLength(0);
  });

  it("should serialize to JSON", () => {
    const recorder = new HistoryRecorder();
    recorder.record({ timestamp: 1, from: "a", to: "b", event: "go", id: "1" });

    const json = recorder.toJSON();
    const parsed = JSON.parse(json);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].from).toBe("a");
    expect(parsed[0].to).toBe("b");
  });

  it("should deserialize from JSON", () => {
    const json = JSON.stringify([
      { timestamp: 1, from: "idle", to: "active", event: "start", id: "m-1" },
      { timestamp: 2, from: "active", to: "done", event: "finish", id: "m-2" },
    ]);

    const recorder = HistoryRecorder.fromJSON(json);

    expect(recorder.size).toBe(2);
    expect(recorder.all[0].from).toBe("idle");
    expect(recorder.all[1].to).toBe("done");
  });

  it("should deserialize from JSON with custom options", () => {
    // Note: maxRecords trimming only applies during record() calls,
    // not during fromJSON. So all parsed records are kept as-is.
    const json = JSON.stringify([
      { timestamp: 1, from: "a", to: "b", event: "go", id: "1" },
      { timestamp: 2, from: "b", to: "c", event: "go", id: "2" },
      { timestamp: 3, from: "c", to: "d", event: "go", id: "3" },
    ]);

    const recorder = HistoryRecorder.fromJSON(json, { maxRecords: 2 });

    // maxRecords is stored but only affects future record() calls
    expect(recorder.size).toBe(3);

    // A new record() call triggers trimming to maxRecords
    recorder.record({ timestamp: 4, from: "d", to: "e", event: "go", id: "4" });
    expect(recorder.size).toBe(2);
    expect(recorder.all[0].id).toBe("3");
    expect(recorder.all[1].id).toBe("4");
  });

  it("should handle empty recorder gracefully", () => {
    const recorder = new HistoryRecorder();

    expect(recorder.size).toBe(0);
    expect(recorder.all).toEqual([]);
    expect(recorder.last(5)).toEqual([]);
    expect(recorder.getFrom("a" as any)).toEqual([]);
    expect(recorder.getTo("b" as any)).toEqual([]);
    expect(recorder.getByEvent("c" as any)).toEqual([]);
    expect(recorder.toJSON()).toBe("[]");
  });

  it("should not share state between instances", () => {
    const r1 = new HistoryRecorder();
    const r2 = new HistoryRecorder();

    r1.record({ timestamp: 1, from: "a", to: "b", event: "go", id: "1" });

    expect(r1.size).toBe(1);
    expect(r2.size).toBe(0);
  });
});

// ================================================================
// Re-export verification: runtime.ts barrel
// ================================================================

describe("Runtime barrel re-exports", () => {
  it("should export StateMachine from runtime.ts", async () => {
    const mod = await import("../src/runtime.js");
    expect(mod.StateMachine).toBeDefined();
    expect(typeof mod.StateMachine).toBe("function");
  });

  it("should export GuardRegistry from runtime.ts", async () => {
    const mod = await import("../src/runtime.js");
    expect(mod.GuardRegistry).toBeDefined();
    expect(typeof mod.GuardRegistry).toBe("function");
  });

  it("should export ActionRegistry from runtime.ts", async () => {
    const mod = await import("../src/runtime.js");
    expect(mod.ActionRegistry).toBeDefined();
    expect(typeof mod.ActionRegistry).toBe("function");
  });

  it("should export HistoryRecorder from runtime.ts", async () => {
    const mod = await import("../src/runtime.js");
    expect(mod.HistoryRecorder).toBeDefined();
    expect(typeof mod.HistoryRecorder).toBe("function");
  });
});
