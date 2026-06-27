// @ci: unit

/**
 * @cortex/fsm-compiler — compiler.test.ts
 *
 * Tests for the compiler layer (Layer 2) — FsmParser, FsmValidator,
 * TypeScriptGenerator, and DiagramGenerator.
 *
 * Covers edge cases beyond the existing per-file unit tests:
 *   - Parser: empty states, missing fields, parseObject API
 *   - Validator: self-loop warnings, edge case deadlock detection
 *   - TypeScriptGenerator: generated output structure, readonly option
 *   - DiagramGenerator: Mermaid and DOT output format validation
 */

import { describe, it, expect, vi } from "vitest";
import { FsmParser, FsmParseError } from "../src/compiler/parser.js";
import { FsmValidator } from "../src/compiler/validator.js";
import { TypeScriptGenerator } from "../src/compiler/generators/typescript-generator.js";
import { DiagramGenerator } from "../src/compiler/generators/diagram-generator.js";

// ════════════════════════════════════════════════════════════════
// FsmParser — Additional Edge Cases
// ════════════════════════════════════════════════════════════════

describe("FsmParser — edge cases", () => {
  const parser = new FsmParser();

  it("should throw on missing id", () => {
    const json = JSON.stringify({
      displayName: "NoID",
      version: "1.0.0",
      states: [{ id: "a" }],
      transitions: [],
      initialState: "a",
      finalStates: [],
    });

    expect(() => parser.parse(json)).toThrow(FsmParseError);
    expect(() => parser.parse(json)).toThrow(/id is required/i);
  });

  it("should throw on missing initialState", () => {
    const json = JSON.stringify({
      id: "m",
      displayName: "M",
      version: "1.0.0",
      states: [{ id: "a" }],
      transitions: [],
      finalStates: [],
    });

    expect(() => parser.parse(json)).toThrow(/initialState is required/i);
  });

  it("should throw on empty states array", () => {
    const json = JSON.stringify({
      id: "m",
      displayName: "M",
      version: "1.0.0",
      states: [],
      transitions: [],
      initialState: "a",
      finalStates: [],
    });

    expect(() => parser.parse(json)).toThrow(/At least one state/i);
  });

  it("should throw on missing states field", () => {
    const json = JSON.stringify({
      id: "m",
      displayName: "M",
      version: "1.0.0",
      transitions: [],
      initialState: "a",
      finalStates: [],
    });

    expect(() => parser.parse(json)).toThrow(/At least one state/i);
  });

  it("should throw on missing transitions field", () => {
    const json = JSON.stringify({
      id: "m",
      displayName: "M",
      version: "1.0.0",
      states: [{ id: "a" }],
      initialState: "a",
      finalStates: [],
    });

    expect(() => parser.parse(json)).toThrow(/transitions field is required/i);
  });

  it("should throw on duplicate transition IDs", () => {
    const json = JSON.stringify({
      id: "m",
      displayName: "M",
      version: "1.0.0",
      states: [
        { id: "a" },
        { id: "b" },
      ],
      transitions: [
        { id: "dup", from: "a", to: "b", event: "go" },
        { id: "dup", from: "b", to: "a", event: "back" },
      ],
      initialState: "a",
      finalStates: [],
    });

    expect(() => parser.parse(json)).toThrow(/Duplicate transition id/i);
  });

  it("should throw on invalid final state reference", () => {
    const json = JSON.stringify({
      id: "m",
      displayName: "M",
      version: "1.0.0",
      states: [{ id: "a" }],
      transitions: [],
      initialState: "a",
      finalStates: ["nonexistent"],
    });

    expect(() => parser.parse(json)).toThrow(/not found in states/i);
  });

  it("should build reverse adjacency correctly", () => {
    const json = JSON.stringify({
      id: "m",
      displayName: "M",
      version: "1.0.0",
      states: [
        { id: "a" },
        { id: "b" },
        { id: "c" },
      ],
      transitions: [
        { id: "t1", from: "a", to: "c", event: "go" },
        { id: "t2", from: "b", to: "c", event: "go" },
      ],
      initialState: "a",
      finalStates: ["c"],
    });

    const ast = parser.parse(json);
    expect(ast.reverseAdjacency.get("c")).toHaveLength(2);
    expect(ast.reverseAdjacency.get("a")).toBeUndefined();
  });

  it("should support parseObject with a pre-parsed definition", () => {
    const def = {
      id: "m",
      displayName: "M",
      version: "1.0.0",
      states: [{ id: "a" }],
      transitions: [{ id: "t1", from: "a", to: "a", event: "stay" }],
      initialState: "a",
      finalStates: [],
    };

    const ast = parser.parseObject(def);
    expect(ast.machine.id).toBe("m");
    expect(ast.stateMap.size).toBe(1);
    expect(ast.transitionMap.size).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════
// FsmValidator — Additional Edge Cases
// ════════════════════════════════════════════════════════════════

describe("FsmValidator — edge cases", () => {
  const parser = new FsmParser();
  const validator = new FsmValidator();

  it("should detect unreachable state in a chain with a looped-out subgraph", () => {
    const json = JSON.stringify({
      id: "m",
      displayName: "M",
      version: "1.0.0",
      states: [
        { id: "start" },
        { id: "loop_a" },
        { id: "loop_b" },
        { id: "orphan" },
      ],
      transitions: [
        { id: "t1", from: "start", to: "loop_a", event: "go" },
        { id: "t2", from: "loop_a", to: "loop_b", event: "next" },
        { id: "t3", from: "loop_b", to: "loop_a", event: "prev" },
      ],
      initialState: "start",
      finalStates: [],
    });

    const ast = parser.parse(json);
    const result = validator.validate(ast);

    expect(result.valid).toBe(false);
    expect(result.metrics.unreachableStates).toEqual(["orphan"]);
    expect(result.metrics.reachableStates).toBe(3);
  });

  it("should not report deadlock for final states with no outgoing transitions", () => {
    const json = JSON.stringify({
      id: "m",
      displayName: "M",
      version: "1.0.0",
      states: [
        { id: "start", style: "initial" },
        { id: "end", style: "final" },
      ],
      transitions: [
        { id: "t1", from: "start", to: "end", event: "finish" },
      ],
      initialState: "start",
      finalStates: ["end"],
    });

    const ast = parser.parse(json);
    const result = validator.validate(ast);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should warn on self-loop without type:self or type:internal", () => {
    const json = JSON.stringify({
      id: "m",
      displayName: "M",
      version: "1.0.0",
      states: [
        { id: "s" },
      ],
      transitions: [
        { id: "t1", from: "s", to: "s", event: "loop" },
      ],
      initialState: "s",
      finalStates: [],
    });

    const ast = parser.parse(json);
    const result = validator.validate(ast);

    expect(result.warnings.some((w) => w.code === "SELF_LOOP_INCONSISTENT")).toBe(true);
  });

  it("should NOT warn on self-loop with type:self or type:internal", () => {
    const json = JSON.stringify({
      id: "m",
      displayName: "M",
      version: "1.0.0",
      states: [{ id: "s" }],
      transitions: [
        { id: "t1", from: "s", to: "s", event: "loop", type: "self" },
        { id: "t2", from: "s", to: "s", event: "stay", type: "internal" },
      ],
      initialState: "s",
      finalStates: [],
    });

    const ast = parser.parse(json);
    const result = validator.validate(ast);

    expect(result.warnings.filter((w) => w.code === "SELF_LOOP_INCONSISTENT")).toHaveLength(0);
  });

  it("should mark deterministic as true for unambiguous transitions", () => {
    const json = JSON.stringify({
      id: "m",
      displayName: "M",
      version: "1.0.0",
      states: [
        { id: "a" },
        { id: "b" },
        { id: "c" },
      ],
      transitions: [
        { id: "t1", from: "a", to: "b", event: "go" },
        { id: "t2", from: "a", to: "c", event: "stop" },
      ],
      initialState: "a",
      finalStates: [],
    });

    const ast = parser.parse(json);
    const result = validator.validate(ast);

    expect(result.metrics.deterministic).toBe(true);
  });

  it("should handle a single-state machine with self-loop", () => {
    const json = JSON.stringify({
      id: "m",
      displayName: "M",
      version: "1.0.0",
      states: [{ id: "only" }],
      transitions: [
        { id: "t1", from: "only", to: "only", event: "stay", type: "self" },
      ],
      initialState: "only",
      finalStates: [],
    });

    const ast = parser.parse(json);
    const result = validator.validate(ast);

    expect(result.valid).toBe(true);
    expect(result.metrics.stateCount).toBe(1);
    expect(result.metrics.reachableStates).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════
// TypeScriptGenerator
// ════════════════════════════════════════════════════════════════

describe("TypeScriptGenerator", () => {
  const parser = new FsmParser();
  const generator = new TypeScriptGenerator();

  const minimalDef = {
    id: "test_machine",
    displayName: "Test Machine",
    version: "1.0.0",
    states: [
      { id: "idle", displayName: "Idle", style: "initial" },
      { id: "running", displayName: "Running" },
      { id: "done", displayName: "Done", style: "final" },
    ],
    transitions: [
      { id: "t1", from: "idle", to: "running", event: "start", action: "onStart" },
      { id: "t2", from: "running", to: "done", event: "finish", guard: "canFinish" },
    ],
    initialState: "idle",
    finalStates: ["done"],
  };

  it("should generate all output sections", () => {
    const ast = parser.parseObject(minimalDef);
    const output = generator.generate(ast);

    expect(output.types).toBeTruthy();
    expect(output.runtime).toBeTruthy();
    expect(output.guards).toBeTruthy();
    expect(output.actions).toBeTruthy();
    expect(output.imports.length).toBeGreaterThan(0);
  });

  it("should generate state enum with all states", () => {
    const ast = parser.parseObject(minimalDef);
    const output = generator.generate(ast);

    expect(output.types).toContain("TestMachineState");
    expect(output.types).toContain("Idle");
    expect(output.types).toContain("Running");
    expect(output.types).toContain("Done");
  });

  it("should generate event enum with all events", () => {
    const ast = parser.parseObject(minimalDef);
    const output = generator.generate(ast);

    expect(output.types).toContain("TestMachineEvent");
    expect(output.types).toContain("Start");
    expect(output.types).toContain("Finish");
  });

  it("should generate a TRANSITION_TABLE constant", () => {
    const ast = parser.parseObject(minimalDef);
    const output = generator.generate(ast);

    expect(output.types).toContain("TRANSITION_TABLE");
    expect(output.types).toContain("TestMachineState.Idle");
    expect(output.types).toContain("TestMachineState.Running");
    expect(output.types).toContain("TestMachineState.Done");
  });

  it("should generate a runtime class", () => {
    const ast = parser.parseObject(minimalDef);
    const output = generator.generate(ast);

    expect(output.runtime).toContain("TestMachineStateMachine");
    expect(output.runtime).toContain("can(event");
    expect(output.runtime).toContain("dispatch(event");
    expect(output.runtime).toContain("reset()");
  });

  it("should generate guard stubs", () => {
    const ast = parser.parseObject(minimalDef);
    const output = generator.generate(ast);

    expect(output.guards).toContain("canFinish");
    expect(output.guards).toContain("return true");
  });

  it("should generate action stubs", () => {
    const ast = parser.parseObject(minimalDef);
    const output = generator.generate(ast);

    expect(output.actions).toContain("onStart");
  });

  it("should generate 'no guards' comment when no guards exist", () => {
    const noGuardDef = {
      ...minimalDef,
      transitions: [
        { id: "t1", from: "idle", to: "running", event: "start" },
        { id: "t2", from: "running", to: "done", event: "finish" },
      ],
    };

    const ast = parser.parseObject(noGuardDef);
    const output = generator.generate(ast);

    expect(output.guards).toContain("No guards defined");
  });

  it("should generate 'no actions' comment when no actions exist", () => {
    const noActionDef = {
      ...minimalDef,
      transitions: [
        { id: "t1", from: "idle", to: "running", event: "start" },
        { id: "t2", from: "running", to: "done", event: "finish" },
      ],
    };

    const ast = parser.parseObject(noActionDef);
    const output = generator.generate(ast);

    expect(output.actions).toContain("No actions defined");
  });

  it("should support readonly option", () => {
    const ast = parser.parseObject(minimalDef);
    const output = generator.generate(ast, { readonly: true });

    expect(output.types).toContain("readonly");
  });

  it("should generate import for runtime when guards/actions exist", () => {
    const ast = parser.parseObject(minimalDef);
    const output = generator.generate(ast);
  
    expect(output.imports.some((i) => i.includes("@cortex/fsm-compiler/runtime"))).toBe(true);
  });
  
  it("should warn on duplicate from+event transitions（F-01 修复）", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  
    const dupDef = {
      id: "dup_machine",
      displayName: "Dup Machine",
      version: "1.0.0",
      states: [
        { id: "idle" },
        { id: "running" },
        { id: "stopped" },
      ],
      transitions: [
        { id: "t1", from: "idle", to: "running", event: "start" },
        { id: "t2", from: "idle", to: "stopped", event: "start" },
      ],
      initialState: "idle",
      finalStates: [],
    };
  
    const ast = parser.parseObject(dupDef);
    const output = generator.generate(ast);
  
    // 应至少有一条警告
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("重复转换"),
    );
  
    warnSpy.mockRestore();
  
    // 生成结果仍包含 TRANSITION_TABLE（行为不变）
    expect(output.types).toContain("TRANSITION_TABLE");
  });
  
  it("should NOT warn on unique from+event transitions", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  
    const ast = parser.parseObject(minimalDef);
    generator.generate(ast);
  
    expect(warnSpy).not.toHaveBeenCalled();
  
    warnSpy.mockRestore();
  });

  it("should always have imports present (generator always emits guard/action strings)", () => {
    // The generator always returns non-empty guard and action strings
    // ("No guards defined" / "No actions defined"), so imports[]
    // will always have 1 entry. This test documents that behavior.
    const noGadDef = {
      ...minimalDef,
      transitions: [
        { id: "t1", from: "idle", to: "running", event: "start" },
      ],
    };

    const ast = parser.parseObject(noGadDef);
    const output = generator.generate(ast);

    // The generator's guard/action strings are always non-empty
    // (they contain comment text), so imports always has 1 entry
    expect(output.imports.length).toBe(1);
    expect(output.imports[0]).toContain("@cortex/fsm-compiler/runtime");
  });
});

// ════════════════════════════════════════════════════════════════
// DiagramGenerator
// ════════════════════════════════════════════════════════════════

describe("DiagramGenerator", () => {
  const parser = new FsmParser();
  const diagramGen = new DiagramGenerator();

  const sampleDef = {
    id: "traffic_light",
    displayName: "Traffic Light",
    version: "1.0.0",
    states: [
      { id: "green", displayName: "Green" },
      { id: "yellow", displayName: "Yellow" },
      { id: "red", displayName: "Red" },
    ],
    transitions: [
      { id: "t1", from: "green", to: "yellow", event: "change" },
      { id: "t2", from: "yellow", to: "red", event: "change" },
      { id: "t3", from: "red", to: "green", event: "change" },
    ],
    initialState: "green",
    finalStates: [],
  };

  describe("toMermaid()", () => {
    it("should generate stateDiagram-v2 header", () => {
      const ast = parser.parseObject(sampleDef);
      const mermaid = diagramGen.toMermaid(ast);

      expect(mermaid).toContain("stateDiagram-v2");
    });

    it("should include initial state pointer", () => {
      const ast = parser.parseObject(sampleDef);
      const mermaid = diagramGen.toMermaid(ast);

      expect(mermaid).toContain("[*] --> green");
    });

    it("should include all transitions", () => {
      const ast = parser.parseObject(sampleDef);
      const mermaid = diagramGen.toMermaid(ast);

      expect(mermaid).toContain("green --> yellow");
      expect(mermaid).toContain("yellow --> red");
      expect(mermaid).toContain("red --> green");
    });

    it("should include guard label in transition", () => {
      const defWithGuard = {
        ...sampleDef,
        transitions: [
          { id: "t1", from: "green", to: "yellow", event: "change", guard: "isSafe" },
        ],
      };

      const ast = parser.parseObject(defWithGuard);
      const mermaid = diagramGen.toMermaid(ast);

      expect(mermaid).toContain("change [isSafe]");
    });

    it("should include final state pointer to [*]", () => {
      const defWithFinal = {
        ...sampleDef,
        finalStates: ["red"],
      };

      const ast = parser.parseObject(defWithFinal);
      const mermaid = diagramGen.toMermaid(ast);

      expect(mermaid).toContain("red --> [*]");
    });

    it("should handle self-loop transitions", () => {
      const defWithSelfLoop = {
        id: "m",
        displayName: "M",
        version: "1.0.0",
        states: [{ id: "s" }],
        transitions: [
          { id: "t1", from: "s", to: "s", event: "tick" },
        ],
        initialState: "s",
        finalStates: [],
      };

      const ast = parser.parseObject(defWithSelfLoop);
      const mermaid = diagramGen.toMermaid(ast);

      expect(mermaid).toContain("s --> s");
    });
  });

  describe("toDot()", () => {
    it("should generate digraph FSM header", () => {
      const ast = parser.parseObject(sampleDef);
      const dot = diagramGen.toDot(ast);

      expect(dot).toContain("digraph FSM");
      expect(dot).toContain("rankdir=LR");
    });

    it("should include start point", () => {
      const ast = parser.parseObject(sampleDef);
      const dot = diagramGen.toDot(ast);

      expect(dot).toContain("__start__");
      expect(dot).toContain("__start__ -> green");
    });

    it("should include all states as nodes", () => {
      const ast = parser.parseObject(sampleDef);
      const dot = diagramGen.toDot(ast);

      expect(dot).toContain("green");
      expect(dot).toContain("yellow");
      expect(dot).toContain("red");
    });

    it("should format final states as doublecircle", () => {
      const defWithFinal = {
        ...sampleDef,
        finalStates: ["red"],
      };

      const ast = parser.parseObject(defWithFinal);
      const dot = diagramGen.toDot(ast);

      expect(dot).toContain("shape=doublecircle");
    });

    it("should format initial state with bold circle", () => {
      const ast = parser.parseObject(sampleDef);
      const dot = diagramGen.toDot(ast);

      expect(dot).toContain("green");
      expect(dot).toContain("style=bold");
    });

    it("should include all transitions with labels", () => {
      const ast = parser.parseObject(sampleDef);
      const dot = diagramGen.toDot(ast);

      expect(dot).toContain("green -> yellow");
      expect(dot).toContain("yellow -> red");
      expect(dot).toContain("red -> green");
    });

    it("should include guard and action labels in DOT format", () => {
      const defWithDetails = {
        ...sampleDef,
        transitions: [
          { id: "t1", from: "green", to: "yellow", event: "change", guard: "isSafe", action: "onChange" },
        ],
      };

      const ast = parser.parseObject(defWithDetails);
      const dot = diagramGen.toDot(ast);

      expect(dot).toContain("change [isSafe] / onChange");
    });

    it("should render internal transitions as dashed", () => {
      const defWithInternal = {
        id: "m",
        displayName: "M",
        version: "1.0.0",
        states: [{ id: "s" }],
        transitions: [
          { id: "t1", from: "s", to: "s", event: "stay", type: "internal" },
        ],
        initialState: "s",
        finalStates: [],
      };

      const ast = parser.parseObject(defWithInternal);
      const dot = diagramGen.toDot(ast);

      expect(dot).toContain("style=dashed");
    });
  });
});

// ════════════════════════════════════════════════════════════════
// Re-export verification: compiler.ts barrel
// ════════════════════════════════════════════════════════════════

describe("Compiler barrel re-exports", () => {
  it("should export FsmParser from compiler.ts", async () => {
    const mod = await import("../src/compiler.js");
    expect(mod.FsmParser).toBeDefined();
    expect(typeof mod.FsmParser).toBe("function");
  });

  it("should export FsmValidator from compiler.ts", async () => {
    const mod = await import("../src/compiler.js");
    expect(mod.FsmValidator).toBeDefined();
    expect(typeof mod.FsmValidator).toBe("function");
  });

  it("should export TypeScriptGenerator from compiler.ts", async () => {
    const mod = await import("../src/compiler.js");
    expect(mod.TypeScriptGenerator).toBeDefined();
    expect(typeof mod.TypeScriptGenerator).toBe("function");
  });

  it("should export DiagramGenerator from compiler.ts", async () => {
    const mod = await import("../src/compiler.js");
    expect(mod.DiagramGenerator).toBeDefined();
    expect(typeof mod.DiagramGenerator).toBe("function");
  });
});
