// @ci: unit
import { describe, it, expect } from "vitest";
import { FsmParser } from "../../src/compiler/parser.js";
import { FsmValidator } from "../../src/compiler/validator.js";

describe("FsmValidator", () => {
  const parser = new FsmParser();
  const validator = new FsmValidator();

  it("should validate a correct FSM without errors", () => {
    const json = JSON.stringify({
      id: "valid_machine",
      displayName: "Valid Machine",
      version: "1.0.0",
      states: [
        { id: "start", displayName: "Start", style: "initial" },
        { id: "middle", displayName: "Middle" },
        { id: "end", displayName: "End", style: "final" },
      ],
      transitions: [
        { id: "start_to_middle", from: "start", to: "middle", event: "proceed" },
        { id: "middle_to_end", from: "middle", to: "end", event: "finish" },
      ],
      initialState: "start",
      finalStates: ["end"],
    });

    const ast = parser.parse(json);
    const result = validator.validate(ast);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.metrics.stateCount).toBe(3);
    expect(result.metrics.transitionCount).toBe(2);
    expect(result.metrics.reachableStates).toBe(3);
  });

  it("should detect unreachable states", () => {
    const json = JSON.stringify({
      id: "test",
      displayName: "Test",
      version: "1.0.0",
      states: [
        { id: "start", displayName: "Start", style: "initial" },
        { id: "reachable", displayName: "Reachable" },
        { id: "unreachable", displayName: "Unreachable" },
      ],
      transitions: [
        { id: "t1", from: "start", to: "reachable", event: "go" },
      ],
      initialState: "start",
      finalStates: [],
    });

    const ast = parser.parse(json);
    const result = validator.validate(ast);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "UNREACHABLE_STATE")).toBe(true);
    expect(result.metrics.unreachableStates).toContain("unreachable");
  });

  it("should detect deadlock (non-final state with no outgoing transitions)", () => {
    const json = JSON.stringify({
      id: "test",
      displayName: "Test",
      version: "1.0.0",
      states: [
        { id: "start", displayName: "Start", style: "initial" },
        { id: "stuck", displayName: "Stuck" },
      ],
      transitions: [
        { id: "t1", from: "start", to: "stuck", event: "go" },
      ],
      initialState: "start",
      finalStates: [],
    });

    const ast = parser.parse(json);
    const result = validator.validate(ast);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "DEADLOCK")).toBe(true);
  });

  it("should detect non-deterministic transitions", () => {
    const json = JSON.stringify({
      id: "test",
      displayName: "Test",
      version: "1.0.0",
      states: [
        { id: "a", displayName: "A" },
        { id: "b", displayName: "B" },
        { id: "c", displayName: "C" },
      ],
      transitions: [
        { id: "t1", from: "a", to: "b", event: "go" },
        { id: "t2", from: "a", to: "c", event: "go" },
      ],
      initialState: "a",
      finalStates: [],
    });

    const ast = parser.parse(json);
    const result = validator.validate(ast);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "NON_DETERMINISTIC")).toBe(true);
    expect(result.metrics.deterministic).toBe(false);
  });
});
