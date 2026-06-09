// @ci: integration
/**
 * Integration test: AgentPool FSM
 *
 * Tests the complete pipeline:
 *   JSON definition → FsmParser → FsmValidator → TypeScriptGenerator → StateMachine runtime
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FsmParser } from "../../src/compiler/parser.js";
import { FsmValidator } from "../../src/compiler/validator.js";
import { TypeScriptGenerator } from "../../src/compiler/generators/typescript-generator.js";
import { DiagramGenerator } from "../../src/compiler/generators/diagram-generator.js";
import { StateMachine } from "../../src/runtime/state-machine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const parser = new FsmParser();
const validator = new FsmValidator();
const tsGen = new TypeScriptGenerator();
const diagramGen = new DiagramGenerator();

describe("AgentPool FSM Integration", () => {
  let definitionPath: string;

  beforeAll(() => {
    definitionPath = resolve(__dirname, "../../definitions/agent-pool.fsm.json");
  });

  it("should parse the JSON definition without errors", () => {
    const json = readFileSync(definitionPath, "utf-8");
    expect(() => parser.parse(json)).not.toThrow();
  });

  it("should pass validation", () => {
    const json = readFileSync(definitionPath, "utf-8");
    const ast = parser.parse(json);
    const result = validator.validate(ast);

    expect(result.valid).toBe(true);
    expect(result.metrics.stateCount).toBe(5);
    expect(result.metrics.transitionCount).toBe(8);
    expect(result.metrics.reachableStates).toBe(5);
  });

  it("should generate TypeScript code", () => {
    const json = readFileSync(definitionPath, "utf-8");
    const ast = parser.parse(json);
    const output = tsGen.generate(ast);

    expect(output.types).toContain("AgentPoolState");
    expect(output.types).toContain("AgentPoolEvent");
    expect(output.types).toContain("TRANSITION_TABLE");
  });

  it("should generate Mermaid diagram", () => {
    const json = readFileSync(definitionPath, "utf-8");
    const ast = parser.parse(json);
    const mermaid = diagramGen.toMermaid(ast);

    expect(mermaid).toContain("stateDiagram-v2");
    expect(mermaid).toContain("[*] --> created");
    expect(mermaid).toContain("draining --> destroyed");
  });

  it("should run all transitions correctly through StateMachine runtime", () => {
    const json = readFileSync(definitionPath, "utf-8");
    const ast = parser.parse(json);

    const machine = new StateMachine(ast.machine, "created");

    // Full lifecycle: created → awake → active → awake → draining → destroyed
    expect(machine.current).toBe("created");
    expect(machine.can("wakeup")).toBe(true);

    machine.dispatch("wakeup");
    expect(machine.current).toBe("awake");

    machine.dispatch("execute");
    expect(machine.current).toBe("active");

    machine.dispatch("complete");
    expect(machine.current).toBe("awake");

    machine.dispatch("shutdown");
    expect(machine.current).toBe("draining");

    machine.dispatch("complete");
    expect(machine.current).toBe("destroyed");
    expect(machine.isFinal).toBe(true);

    expect(machine.history).toHaveLength(5);
  });
});
