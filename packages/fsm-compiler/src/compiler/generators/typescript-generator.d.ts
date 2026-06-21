/**
 * @cortex/fsm-compiler — TypeScript Code Generator
 *
 * Generates TypeScript code from FSM AST.
 *
 * Output includes:
 * 1. Enum of states (string)
 * 2. Enum of events (string)
 * 3. Type-safe transition table (2D matrix: State × Event → State)
 * 4. Guard function stubs (with JSDoc from DSL)
 * 5. Action function stubs
 * 6. Transition validation function (isValidTransition)
 * 7. State machine class skeleton
 */
import type { FsmAst } from "../parser.js";
export interface GeneratedOutput {
    /** Generated .ts file content */
    types: string;
    /** Generated class with dispatch logic */
    runtime: string;
    /** Guard function stubs */
    guards: string;
    /** Action function stubs */
    actions: string;
    /** Import map — which imports are needed */
    imports: string[];
}
export interface GenOptions {
    /** Optional namespace prefix for generated enums */
    namespace?: string;
    /** Whether to generate immutable types (readonly) */
    readonly?: boolean;
}
export declare class TypeScriptGenerator {
    generate(ast: FsmAst, options?: GenOptions): GeneratedOutput;
    private _generateTypes;
    private _generateRuntime;
    private _generateGuards;
    private _generateActions;
    private _collectEvents;
    private _toPascalCase;
    private _toEnumKey;
}
//# sourceMappingURL=typescript-generator.d.ts.map