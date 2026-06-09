// @ci: unit
import { describe, it, expect } from "vitest";
import { StateMachine, TransitionError } from "../../src/runtime/state-machine.js";
import { GuardRegistry } from "../../src/runtime/guard-registry.js";
import { ActionRegistry } from "../../src/runtime/action-registry.js";
import type { FsmDefinition } from "../../src/dsl/schema.js";

const agentPoolDef: FsmDefinition = {
  id: "agent_pool",
  displayName: "Agent Pool Lifecycle",
  version: "1.0.0",
  states: [
    { id: "created", displayName: "Created", style: "initial" },
    { id: "awake", displayName: "Awake" },
    { id: "active", displayName: "Active" },
    { id: "draining", displayName: "Draining" },
    { id: "destroyed", displayName: "Destroyed", style: "final" },
  ],
  transitions: [
    { id: "create_to_awake", from: "created", to: "awake", event: "wakeup", action: "onWakeup" },
    { id: "create_to_destroy", from: "created", to: "destroyed", event: "destroy", action: "onDestroy" },
    { id: "awake_to_active", from: "awake", to: "active", event: "execute", guard: "canExecute" },
    { id: "active_to_awake", from: "active", to: "awake", event: "complete", action: "onComplete" },
    { id: "awake_to_draining", from: "awake", to: "draining", event: "shutdown" },
    { id: "active_to_draining", from: "active", to: "draining", event: "shutdown" },
    { id: "draining_to_destroy", from: "draining", to: "destroyed", event: "complete" },
  ],
  initialState: "created",
  finalStates: ["destroyed"],
};

type AgentPoolState = "created" | "awake" | "active" | "draining" | "destroyed";
type AgentPoolEvent = "wakeup" | "execute" | "complete" | "shutdown" | "destroy";

describe("StateMachine", () => {
  it("should start in the initial state", () => {
    const machine = new StateMachine<AgentPoolState, AgentPoolEvent>(
      agentPoolDef,
      "created" as AgentPoolState,
    );

    expect(machine.current).toBe("created");
    expect(machine.isFinal).toBe(false);
  });

  it("should transition on valid event", () => {
    const machine = new StateMachine<AgentPoolState, AgentPoolEvent>(
      agentPoolDef,
      "created" as AgentPoolState,
    );

    const next = machine.dispatch("wakeup");
    expect(next).toBe("awake");
    expect(machine.current).toBe("awake");
  });

  it("should throw on invalid transition", () => {
    const machine = new StateMachine<AgentPoolState, AgentPoolEvent>(
      agentPoolDef,
      "created" as AgentPoolState,
    );

    expect(() => machine.dispatch("complete" as AgentPoolEvent)).toThrow(TransitionError);
  });

  it("should reach final state", () => {
    const machine = new StateMachine<AgentPoolState, AgentPoolEvent>(
      agentPoolDef,
      "created" as AgentPoolState,
    );

    machine.dispatch("destroy");
    expect(machine.current).toBe("destroyed");
    expect(machine.isFinal).toBe(true);
  });

  it("should record history", () => {
    const machine = new StateMachine<AgentPoolState, AgentPoolEvent>(
      agentPoolDef,
      "created" as AgentPoolState,
    );

    machine.dispatch("wakeup");
    machine.dispatch("execute");

    expect(machine.history).toHaveLength(2);
    expect(machine.history[0].from).toBe("created");
    expect(machine.history[0].to).toBe("awake");
    expect(machine.history[0].event).toBe("wakeup");
    expect(machine.history[1].from).toBe("awake");
    expect(machine.history[1].to).toBe("active");
    expect(machine.history[1].event).toBe("execute");
  });

  it("should check guard before transition", () => {
    const guards = new GuardRegistry();
    guards.register("canExecute", () => false);

    const machine = new StateMachine<AgentPoolState, AgentPoolEvent>(
      agentPoolDef,
      "created" as AgentPoolState,
      { guards },
    );

    machine.dispatch("wakeup");

    expect(() => machine.dispatch("execute")).toThrow(TransitionError);
    expect(machine.current).toBe("awake"); // unchanged
  });

  it("should allow transition when guard passes", () => {
    const guards = new GuardRegistry();
    guards.register("canExecute", () => true);

    const machine = new StateMachine<AgentPoolState, AgentPoolEvent>(
      agentPoolDef,
      "created" as AgentPoolState,
      { guards },
    );

    machine.dispatch("wakeup");
    machine.dispatch("execute");

    expect(machine.current).toBe("active");
  });

  it("should execute action on transition", () => {
    let actionCalled = false;

    const actions = new ActionRegistry();
    actions.register("onWakeup", () => {
      actionCalled = true;
    });

    const machine = new StateMachine<AgentPoolState, AgentPoolEvent>(
      agentPoolDef,
      "created" as AgentPoolState,
      { actions },
    );

    machine.dispatch("wakeup");
    expect(actionCalled).toBe(true);
  });

  it("should serialize and deserialize snapshots", () => {
    const machine = new StateMachine<AgentPoolState, AgentPoolEvent>(
      agentPoolDef,
      "created" as AgentPoolState,
    );

    machine.dispatch("wakeup");
    machine.dispatch("execute");

    const snapshot = machine.serialize();
    expect(snapshot.currentState).toBe("active");
    expect(snapshot.history).toHaveLength(2);

    const restored = StateMachine.deserialize<AgentPoolState, AgentPoolEvent, void>(
      snapshot,
      agentPoolDef,
    );

    expect(restored.current).toBe("active");
    expect(restored.history).toHaveLength(2);
  });

  it("should reset to initial state", () => {
    const machine = new StateMachine<AgentPoolState, AgentPoolEvent>(
      agentPoolDef,
      "created" as AgentPoolState,
    );

    machine.dispatch("wakeup");
    machine.reset();

    expect(machine.current).toBe("created");
    expect(machine.history).toHaveLength(0);
  });

  it("should support can() check", () => {
    const machine = new StateMachine<AgentPoolState, AgentPoolEvent>(
      agentPoolDef,
      "created" as AgentPoolState,
    );

    expect(machine.can("wakeup")).toBe(true);
    expect(machine.can("destroy")).toBe(true);
    expect(machine.can("complete" as AgentPoolEvent)).toBe(false);
    expect(machine.can("shutdown")).toBe(false);
  });
});
