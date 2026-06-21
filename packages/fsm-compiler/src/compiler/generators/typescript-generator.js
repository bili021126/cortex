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
// ────────────────────────────────────────────────────────────
// TypeScript Generator
// ────────────────────────────────────────────────────────────
export class TypeScriptGenerator {
    generate(ast, options = {}) {
        const machineId = ast.machine.id;
        const pascalMachine = this._toPascalCase(machineId);
        const stateEnumName = `${pascalMachine}State`;
        const eventEnumName = `${pascalMachine}Event`;
        const types = this._generateTypes(ast, stateEnumName, eventEnumName, options);
        const runtime = this._generateRuntime(ast, stateEnumName, eventEnumName);
        const guards = this._generateGuards(ast);
        const actions = this._generateActions(ast);
        const imports = [];
        if (guards.length > 0 || actions.length > 0) {
            imports.push('import type { GuardFn, ActionFn } from "@cortex/fsm-compiler/runtime";');
        }
        return { types, runtime, guards, actions, imports };
    }
    _generateTypes(ast, stateEnumName, eventEnumName, options) {
        const lines = [];
        const readonly = options.readonly ? "readonly " : "";
        // State enum
        lines.push(`// ── State Enum ──`);
        lines.push(`export enum ${stateEnumName} {`);
        for (const state of ast.machine.states) {
            lines.push(`  ${this._toEnumKey(state.id)} = "${state.id}",`);
        }
        lines.push(`}`);
        lines.push("");
        // Event enum
        lines.push(`// ── Event Enum ──`);
        const events = this._collectEvents(ast);
        lines.push(`export enum ${eventEnumName} {`);
        for (const event of events) {
            lines.push(`  ${this._toEnumKey(event)} = "${event}",`);
        }
        lines.push(`}`);
        lines.push("");
        // Transition table type
        lines.push(`// ── Transition Table ──`);
        lines.push(`export type ${stateEnumName}TransitionTable = {`);
        lines.push(`  ${readonly}[state in ${stateEnumName}]?: {`);
        lines.push(`    ${readonly}[event in ${eventEnumName}]?: ${stateEnumName};`);
        lines.push(`  };`);
        lines.push(`};`);
        lines.push("");
        // Transition table constant
        lines.push(`export const TRANSITION_TABLE: ${stateEnumName}TransitionTable = {`);
        for (const [stateId, transitions] of ast.adjacencyList) {
            const stateKey = this._toEnumKey(stateId);
            lines.push(`  [${stateEnumName}.${stateKey}]: {`);
            for (const t of transitions) {
                const eventKey = this._toEnumKey(t.event);
                const toKey = this._toEnumKey(t.to);
                lines.push(`    [${eventEnumName}.${eventKey}]: ${stateEnumName}.${toKey},`);
            }
            lines.push(`  },`);
        }
        lines.push(`};`);
        return lines.join("\n");
    }
    _generateRuntime(ast, stateEnumName, eventEnumName) {
        const lines = [];
        lines.push(`// ── State Machine Runtime ──`);
        lines.push(`import { ${stateEnumName}, ${eventEnumName} } from "./types";`);
        lines.push("");
        lines.push(`export class ${stateEnumName}Machine {`);
        lines.push(`  private _current: ${stateEnumName};`);
        lines.push(`  private _history: Array<{ from: ${stateEnumName}; to: ${stateEnumName}; event: ${eventEnumName}; timestamp: number }> = [];`);
        lines.push("");
        lines.push(`  constructor(initialState: ${stateEnumName} = ${stateEnumName}.${this._toEnumKey(ast.machine.initialState)}) {`);
        lines.push(`    this._current = initialState;`);
        lines.push(`  }`);
        lines.push("");
        lines.push(`  get current(): ${stateEnumName} {`);
        lines.push(`    return this._current;`);
        lines.push(`  }`);
        lines.push("");
        lines.push(`  get history() {`);
        lines.push(`    return this._history as readonly typeof this._history;`);
        lines.push(`  }`);
        lines.push("");
        lines.push(`  can(event: ${eventEnumName}): boolean {`);
        lines.push(`    const table = TRANSITION_TABLE[this._current];`);
        lines.push(`    return table != null && event in table;`);
        lines.push(`  }`);
        lines.push("");
        lines.push(`  dispatch(event: ${eventEnumName}): ${stateEnumName} {`);
        lines.push(`    const table = TRANSITION_TABLE[this._current];`);
        lines.push(`    if (!table || !(event in table)) {`);
        lines.push(`      throw new Error(\`Invalid transition: \${this._current} -> \${event}\`);`);
        lines.push(`    }`);
        lines.push(`    const next = table[event]!;`);
        lines.push(`    this._history.push({ from: this._current, to: next, event, timestamp: Date.now() });`);
        lines.push(`    this._current = next;`);
        lines.push(`    return next;`);
        lines.push(`  }`);
        lines.push("");
        lines.push(`  reset(): void {`);
        lines.push(`    this._current = ${stateEnumName}.${this._toEnumKey(ast.machine.initialState)};`);
        lines.push(`    this._history = [];`);
        lines.push(`  }`);
        lines.push("");
        lines.push(`  get isFinal(): boolean {`);
        lines.push(`    const finals: ${stateEnumName}[] = [${ast.machine.finalStates.map((s) => `${stateEnumName}.${this._toEnumKey(s)}`).join(", ")}];`);
        lines.push(`    return finals.includes(this._current);`);
        lines.push(`  }`);
        lines.push(`}`);
        lines.push("");
        return lines.join("\n");
    }
    _generateGuards(ast) {
        const guardNames = new Set();
        for (const t of ast.transitionMap.values()) {
            if (t.guard) {
                guardNames.add(t.guard);
            }
        }
        if (guardNames.size === 0) {
            return "// No guards defined\n";
        }
        const lines = [];
        lines.push(`// ── Guard Function Stubs ──`);
        for (const name of guardNames) {
            lines.push(`export function ${name}(context: unknown): boolean {`);
            lines.push(`  // TODO: implement guard logic`);
            lines.push(`  return true;`);
            lines.push(`}`);
            lines.push("");
        }
        return lines.join("\n");
    }
    _generateActions(ast) {
        const actionNames = new Set();
        for (const t of ast.transitionMap.values()) {
            if (t.action) {
                actionNames.add(t.action);
            }
        }
        if (actionNames.size === 0) {
            return "// No actions defined\n";
        }
        const lines = [];
        lines.push(`// ── Action Function Stubs ──`);
        for (const name of actionNames) {
            lines.push(`export function ${name}(context: unknown): void {`);
            lines.push(`  // TODO: implement action logic`);
            lines.push(`}`);
            lines.push("");
        }
        return lines.join("\n");
    }
    // ── Helpers ──
    _collectEvents(ast) {
        const eventSet = new Set();
        for (const t of ast.transitionMap.values()) {
            eventSet.add(t.event);
        }
        return Array.from(eventSet).sort();
    }
    _toPascalCase(str) {
        return str
            .split(/[_-]/)
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
            .join("");
    }
    _toEnumKey(str) {
        // Convert snake_case or kebab-case to PascalCase for enum keys
        return str
            .split(/[_-]/)
            .map((s, i) => (i === 0 ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()))
            .join("");
    }
}
//# sourceMappingURL=typescript-generator.js.map