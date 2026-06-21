// @ci: unit
/**
 * @cortex/fsm-compiler — integration.test.ts
 *
 * Full-pipeline integration tests.
 *
 * Exercises the complete flow:
 *   Raw JSON definition → FsmParser → FsmAst → FsmValidator
 *   → TypeScriptGenerator (generated code)
 *   → DiagramGenerator (Mermaid + DOT)
 *   → StateMachine runtime (dispatch, guards, actions, history)
 *
 * Also tests the top-level index.ts barrel exports for correctness.
 */
import { describe, it, expect } from "vitest";
import { FsmParser } from "../src/compiler/parser.js";
import { FsmValidator } from "../src/compiler/validator.js";
import { TypeScriptGenerator } from "../src/compiler/generators/typescript-generator.js";
import { DiagramGenerator } from "../src/compiler/generators/diagram-generator.js";
import { StateMachine } from "../src/runtime/state-machine.js";
import { GuardRegistry } from "../src/runtime/guard-registry.js";
import { ActionRegistry } from "../src/runtime/action-registry.js";
import { HistoryRecorder } from "../src/runtime/history-recorder.js";
// ════════════════════════════════════════════════════════════════
// Fixture: Task Node FSM (simulating a real-world agent lifecycle)
// ════════════════════════════════════════════════════════════════
const taskNodeDef = {
    id: "task_node",
    displayName: "Task Node Lifecycle",
    version: "1.0.0",
    states: [
        { id: "pending", displayName: "Pending", style: "initial" },
        { id: "running", displayName: "Running" },
        { id: "paused", displayName: "Paused" },
        { id: "completed", displayName: "Completed", style: "final" },
        { id: "failed", displayName: "Failed", style: "final" },
        { id: "cancelled", displayName: "Cancelled", style: "final" },
    ],
    transitions: [
        { id: "start_task", from: "pending", to: "running", event: "execute", guard: "canExecute" },
        { id: "cancel_pending", from: "pending", to: "cancelled", event: "cancel" },
        { id: "pause_task", from: "running", to: "paused", event: "pause" },
        { id: "resume_task", from: "paused", to: "running", event: "resume", guard: "canResume" },
        { id: "complete_task", from: "running", to: "completed", event: "complete", action: "onComplete" },
        { id: "fail_task", from: "running", to: "failed", event: "fail", guard: "isFailure", action: "onFail" },
        { id: "cancel_running", from: "running", to: "cancelled", event: "cancel" },
        { id: "cancel_paused", from: "paused", to: "cancelled", event: "cancel" },
    ],
    initialState: "pending",
    finalStates: ["completed", "failed", "cancelled"],
};
// ════════════════════════════════════════════════════════════════
// Integration: Full Pipeline — Parse → Validate → Generate → Execute
// ════════════════════════════════════════════════════════════════
describe("Full Pipeline: Task Node FSM", () => {
    const parser = new FsmParser();
    const validator = new FsmValidator();
    const tsGen = new TypeScriptGenerator();
    const diagramGen = new DiagramGenerator();
    it("should parse the definition into a valid AST", () => {
        const ast = parser.parseObject(taskNodeDef);
        expect(ast.machine.id).toBe("task_node");
        expect(ast.stateMap.size).toBe(6);
        expect(ast.transitionMap.size).toBe(8);
        expect(ast.adjacencyList.has("pending")).toBe(true);
        expect(ast.adjacencyList.has("running")).toBe(true);
        expect(ast.adjacencyList.has("completed")).toBe(false); // no outgoing
    });
    it("should pass validation without errors", () => {
        const ast = parser.parseObject(taskNodeDef);
        const result = validator.validate(ast);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.metrics.stateCount).toBe(6);
        expect(result.metrics.transitionCount).toBe(8);
        expect(result.metrics.reachableStates).toBe(6);
        expect(result.metrics.unreachableStates).toHaveLength(0);
        expect(result.metrics.deterministic).toBe(true);
        expect(result.metrics.hasDeadlock).toBe(false);
    });
    it("should generate TypeScript code with correct structure", () => {
        const ast = parser.parseObject(taskNodeDef);
        const output = tsGen.generate(ast);
        // State enum
        expect(output.types).toContain("TaskNodeState");
        expect(output.types).toContain("Pending = \"pending\"");
        expect(output.types).toContain("Running = \"running\"");
        expect(output.types).toContain("Completed = \"completed\"");
        // Event enum
        expect(output.types).toContain("TaskNodeEvent");
        expect(output.types).toContain("Execute = \"execute\"");
        // Transition table
        expect(output.types).toContain("TRANSITION_TABLE");
        // Runtime class
        expect(output.runtime).toContain("TaskNodeStateMachine");
        expect(output.runtime).toContain("can(event");
        expect(output.runtime).toContain("dispatch(event");
        // Guard stubs
        expect(output.guards).toContain("canExecute");
        expect(output.guards).toContain("canResume");
        expect(output.guards).toContain("isFailure");
        // Action stubs
        expect(output.actions).toContain("onComplete");
        expect(output.actions).toContain("onFail");
    });
    it("should generate a Mermaid state diagram", () => {
        const ast = parser.parseObject(taskNodeDef);
        const mermaid = diagramGen.toMermaid(ast);
        expect(mermaid).toContain("stateDiagram-v2");
        expect(mermaid).toContain("[*] --> pending");
        expect(mermaid).toContain("pending --> running : execute [canExecute]");
        expect(mermaid).toContain("running --> completed : complete");
        expect(mermaid).toContain("completed --> [*]");
        expect(mermaid).toContain("failed --> [*]");
        expect(mermaid).toContain("cancelled --> [*]");
    });
    it("should generate a Graphviz DOT diagram", () => {
        const ast = parser.parseObject(taskNodeDef);
        const dot = diagramGen.toDot(ast);
        expect(dot).toContain("digraph FSM");
        expect(dot).toContain("__start__");
        expect(dot).toContain("__start__ -> pending");
        expect(dot).toContain("pending -> running");
        expect(dot).toContain("running -> completed [label=\"complete / onComplete\"]");
        expect(dot).toContain("completed [label=\"Completed\" shape=doublecircle]");
        expect(dot).toContain("failed [label=\"Failed\" shape=doublecircle]");
        expect(dot).toContain("cancelled [label=\"Cancelled\" shape=doublecircle]");
    });
    it("should execute the happy path through the StateMachine runtime", () => {
        const machine = new StateMachine(taskNodeDef, "pending");
        // pending → running
        machine.dispatch("execute");
        expect(machine.current).toBe("running");
        // running → paused
        machine.dispatch("pause");
        expect(machine.current).toBe("paused");
        // paused → running
        machine.dispatch("resume");
        expect(machine.current).toBe("running");
        // running → completed
        machine.dispatch("complete");
        expect(machine.current).toBe("completed");
        expect(machine.isFinal).toBe(true);
        // Full history
        expect(machine.history).toHaveLength(4);
    });
    it("should execute the failure path", () => {
        const machine = new StateMachine(taskNodeDef, "pending");
        machine.dispatch("execute");
        expect(machine.current).toBe("running");
        machine.dispatch("fail");
        expect(machine.current).toBe("failed");
        expect(machine.isFinal).toBe(true);
    });
    it("should execute the cancellation path from pending", () => {
        const machine = new StateMachine(taskNodeDef, "pending");
        machine.dispatch("cancel");
        expect(machine.current).toBe("cancelled");
        expect(machine.isFinal).toBe(true);
        expect(machine.history).toHaveLength(1);
    });
    it("should execute the cancellation path from running", () => {
        const machine = new StateMachine(taskNodeDef, "pending");
        machine.dispatch("execute");
        machine.dispatch("cancel");
        expect(machine.current).toBe("cancelled");
        expect(machine.isFinal).toBe(true);
    });
    it("should enforce guard conditions", () => {
        const guards = new GuardRegistry();
        guards.register("canExecute", () => false);
        guards.register("canResume", () => true);
        guards.register("isFailure", () => true);
        const machine = new StateMachine(taskNodeDef, "pending", { guards });
        // Guard "canExecute" returns false → should reject
        expect(() => machine.dispatch("execute")).toThrow();
        expect(machine.current).toBe("pending");
    });
    it("should allow transition when guard passes", () => {
        const guards = new GuardRegistry();
        guards.register("canExecute", () => true);
        guards.register("canResume", () => true);
        guards.register("isFailure", () => false); // will block failure path
        const machine = new StateMachine(taskNodeDef, "pending", { guards });
        machine.dispatch("execute");
        expect(machine.current).toBe("running");
        // "isFailure" returns false → can't transition to failed
        // But "complete" has no guard → should work
        machine.dispatch("complete");
        expect(machine.current).toBe("completed");
    });
    it("should execute actions on transitions", () => {
        const actions = [];
        const actionRegistry = new ActionRegistry();
        actionRegistry.register("onComplete", (_ctx) => {
            actions.push(`completed at ${Date.now()}`);
        });
        actionRegistry.register("onFail", (ctx) => {
            actions.push(`failed: ${ctx.reason ?? "unknown"}`);
        });
        const guards = new GuardRegistry();
        guards.register("canExecute", () => true);
        guards.register("canResume", () => true);
        guards.register("isFailure", () => true);
        const machine = new StateMachine(taskNodeDef, "pending", { guards, actions: actionRegistry });
        // Execute → fail path (triggers onFail action)
        machine.dispatch("execute");
        const failContext = { reason: "timeout" };
        machine.dispatch("fail", failContext);
        expect(actions).toHaveLength(1);
        expect(actions[0]).toContain("failed: timeout");
    });
    it("should create a complete audit trail with HistoryRecorder", () => {
        const recorder = new HistoryRecorder({ maxRecords: 10 });
        const machine = new StateMachine(taskNodeDef, "pending");
        // Run through a sequence, recording each step
        const steps = [
            { event: "execute", ctx: { step: 1 } },
            { event: "pause", ctx: { step: 2 } },
            { event: "resume", ctx: { step: 3 } },
            { event: "complete", ctx: { step: 4 } },
        ];
        for (const { event, ctx } of steps) {
            machine.dispatch(event, ctx);
            // Manually record into HistoryRecorder for audit trail
            recorder.record(machine.history[machine.history.length - 1]);
        }
        expect(recorder.size).toBe(4);
        expect(recorder.getFrom("running")).toHaveLength(2); // pause + complete
        expect(recorder.getTo("completed")).toHaveLength(1);
        expect(recorder.getByEvent("pause")).toHaveLength(1);
        // Verify context is preserved in the audit trail
        const firstRecord = recorder.all[0];
        expect(firstRecord.from).toBe("pending");
        expect(firstRecord.to).toBe("running");
    });
    it("should serialize and restore machine state correctly across full lifecycle", () => {
        const machine = new StateMachine(taskNodeDef, "pending");
        // Run halfway
        machine.dispatch("execute");
        machine.dispatch("pause");
        expect(machine.current).toBe("paused");
        // Snapshot
        const snapshot = machine.serialize();
        expect(snapshot.currentState).toBe("paused");
        expect(snapshot.history).toHaveLength(2);
        // Restore and continue
        const restored = StateMachine.deserialize(snapshot, taskNodeDef);
        expect(restored.current).toBe("paused");
        restored.dispatch("resume");
        expect(restored.current).toBe("running");
        restored.dispatch("complete");
        expect(restored.current).toBe("completed");
        expect(restored.isFinal).toBe(true);
        expect(restored.history).toHaveLength(4);
    });
});
// ════════════════════════════════════════════════════════════════
// Integration: Multiple machines working independently
// ════════════════════════════════════════════════════════════════
describe("Multiple independent StateMachine instances", () => {
    const simpleDef = {
        id: "simple",
        displayName: "Simple",
        version: "1.0.0",
        states: [
            { id: "off" },
            { id: "on" },
        ],
        transitions: [
            { id: "t1", from: "off", to: "on", event: "toggle" },
            { id: "t2", from: "on", to: "off", event: "toggle" },
        ],
        initialState: "off",
        finalStates: [],
    };
    it("should maintain independent state for each machine instance", () => {
        const m1 = new StateMachine(simpleDef, "off");
        const m2 = new StateMachine(simpleDef, "off");
        m1.dispatch("toggle");
        expect(m1.current).toBe("on");
        expect(m2.current).toBe("off"); // unchanged
        m2.dispatch("toggle");
        expect(m2.current).toBe("on");
        m1.dispatch("toggle");
        expect(m1.current).toBe("off"); // toggled back
        expect(m2.current).toBe("on"); // unchanged
    });
});
// ════════════════════════════════════════════════════════════════
// Integration: Error recovery and edge case scenarios
// ════════════════════════════════════════════════════════════════
describe("Error recovery and edge cases", () => {
    it("should not change state on invalid transition attempt", () => {
        const machine = new StateMachine(taskNodeDef, "pending");
        // "complete" is not valid from "pending"
        expect(() => machine.dispatch("complete")).toThrow();
        expect(machine.current).toBe("pending");
    });
    it("should not transition when guard throws", () => {
        const guards = new GuardRegistry();
        guards.register("canExecute", () => {
            throw new Error("DB connection failed");
        });
        const machine = new StateMachine(taskNodeDef, "pending", { guards });
        expect(() => machine.dispatch("execute")).toThrow();
        expect(machine.current).toBe("pending");
        expect(machine.history).toHaveLength(0);
    });
    it("should handle can() check correctly for all states and events", () => {
        const machine = new StateMachine(taskNodeDef, "pending");
        // From "pending"
        expect(machine.can("execute")).toBe(true);
        expect(machine.can("cancel")).toBe(true);
        expect(machine.can("pause")).toBe(false);
        expect(machine.can("complete")).toBe(false);
        // Move to "running"
        machine.dispatch("execute");
        expect(machine.can("pause")).toBe(true);
        expect(machine.can("complete")).toBe(true);
        expect(machine.can("fail")).toBe(true);
        expect(machine.can("cancel")).toBe(true);
        expect(machine.can("execute")).toBe(false); // not valid anymore
        expect(machine.can("resume")).toBe(false);
        // Move to "paused"
        machine.dispatch("pause");
        expect(machine.can("resume")).toBe(true);
        expect(machine.can("cancel")).toBe(true);
        expect(machine.can("execute")).toBe(false);
        expect(machine.can("complete")).toBe(false);
    });
});
// ════════════════════════════════════════════════════════════════
// Re-export verification: index.ts (top-level barrel)
// ════════════════════════════════════════════════════════════════
describe("Top-level index.ts barrel re-exports", () => {
    it("should export all type names from index.ts", async () => {
        const mod = await import("../src/index.js");
        // The module should load without error
        expect(mod).toBeDefined();
    });
    it("should export FsmParser from index.ts", async () => {
        const mod = await import("../src/index.js");
        expect(mod.FsmParser).toBe(FsmParser);
    });
    it("should export FsmValidator from index.ts", async () => {
        const mod = await import("../src/index.js");
        expect(mod.FsmValidator).toBe(FsmValidator);
    });
    it("should export TypeScriptGenerator from index.ts", async () => {
        const mod = await import("../src/index.js");
        expect(mod.TypeScriptGenerator).toBe(TypeScriptGenerator);
    });
    it("should export DiagramGenerator from index.ts", async () => {
        const mod = await import("../src/index.js");
        expect(mod.DiagramGenerator).toBe(DiagramGenerator);
    });
    it("should export StateMachine from index.ts", async () => {
        const mod = await import("../src/index.js");
        expect(mod.StateMachine).toBe(StateMachine);
    });
    it("should export GuardRegistry from index.ts", async () => {
        const mod = await import("../src/index.js");
        expect(mod.GuardRegistry).toBe(GuardRegistry);
    });
    it("should export ActionRegistry from index.ts", async () => {
        const mod = await import("../src/index.js");
        expect(mod.ActionRegistry).toBe(ActionRegistry);
    });
    it("should export HistoryRecorder from index.ts", async () => {
        const mod = await import("../src/index.js");
        expect(mod.HistoryRecorder).toBe(HistoryRecorder);
    });
    it("should export error classes from index.ts", async () => {
        const mod = await import("../src/index.js");
        expect(mod.FsmParseError).toBeDefined();
        expect(mod.TransitionError).toBeDefined();
        expect(mod.GuardError).toBeDefined();
        // Verify they're constructable
        expect(new mod.FsmParseError("test", "CODE")).toBeInstanceOf(Error);
        expect(new mod.TransitionError("test", "a", "b")).toBeInstanceOf(Error);
        expect(new mod.GuardError("test", "g")).toBeInstanceOf(Error);
    });
});
//# sourceMappingURL=integration.test.js.map