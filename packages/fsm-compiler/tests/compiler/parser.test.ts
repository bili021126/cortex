// @ci: unit
import { describe, it, expect } from "vitest";
import { FsmParser } from "../../src/compiler/parser.js";

describe("FsmParser", () => {
  const parser = new FsmParser();

  it("should parse a valid minimal FSM definition", () => {
    const json = JSON.stringify({
      id: "test_machine",
      displayName: "Test Machine",
      version: "1.0.0",
      states: [
        { id: "idle", displayName: "Idle", style: "initial" },
        { id: "done", displayName: "Done", style: "final" },
      ],
      transitions: [
        { id: "idle_to_done", from: "idle", to: "done", event: "finish" },
      ],
      initialState: "idle",
      finalStates: ["done"],
    });

    const ast = parser.parse(json);

    expect(ast.machine.id).toBe("test_machine");
    expect(ast.stateMap.size).toBe(2);
    expect(ast.transitionMap.size).toBe(1);
    expect(ast.adjacencyList.has("idle")).toBe(true);
    expect(ast.reverseAdjacency.has("done")).toBe(true);
  });

  it("should throw on duplicate state IDs", () => {
    const json = JSON.stringify({
      id: "test",
      displayName: "Test",
      version: "1.0.0",
      states: [
        { id: "a" },
        { id: "a" },
      ],
      transitions: [],
      initialState: "a",
      finalStates: [],
    });

    expect(() => parser.parse(json)).toThrow(/duplicate state/i);
  });

  it("should throw on invalid initial state", () => {
    const json = JSON.stringify({
      id: "test",
      displayName: "Test",
      version: "1.0.0",
      states: [{ id: "a" }],
      transitions: [],
      initialState: "nonexistent",
      finalStates: [],
    });

    expect(() => parser.parse(json)).toThrow(/initial state.*not found/i);
  });

  it("should throw on transition referencing unknown state", () => {
    const json = JSON.stringify({
      id: "test",
      displayName: "Test",
      version: "1.0.0",
      states: [{ id: "a", displayName: "A" }],
      transitions: [
        { id: "t1", from: "a", to: "b", event: "go" },
      ],
      initialState: "a",
      finalStates: [],
    });

    expect(() => parser.parse(json)).toThrow(/unknown state.*"b"/i);
  });
});
