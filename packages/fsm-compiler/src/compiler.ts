/**
 * @cortex/fsm-compiler — FSM Compiler Entry Point
 *
 * Layer 2 of the three-layer architecture.
 *
 * The Compiler transforms JSON machine definitions into:
 * - Validated AST (parse + semantic checks)
 * - TypeScript code (enums, transition tables, machine classes)
 * - Diagrams (Mermaid state diagrams, Graphviz DOT)
 *
 * Usage:
 * ```ts
 * import { FsmParser, FsmValidator, TypeScriptGenerator } from "@cortex/fsm-compiler/compiler";
 *
 * const parser = new FsmParser();
 * const ast = parser.parse(fsmJson);
 *
 * const validator = new FsmValidator();
 * const result = validator.validate(ast);
 *
 * const generator = new TypeScriptGenerator();
 * const output = generator.generate(ast);
 * ```
 *
 * @module compiler
 */

// ── Parser ──
export { FsmParser } from "./compiler/parser.js";

// ── Validator ──
export { FsmValidator } from "./compiler/validator.js";

// ── Code Generators ──
export { TypeScriptGenerator } from "./compiler/generators/typescript-generator.js";
export { DiagramGenerator } from "./compiler/generators/diagram-generator.js";
