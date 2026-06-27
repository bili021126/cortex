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

// ────────────────────────────────────────────────────────────
// Generator Types
// ────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────
// TypeScript Generator
// ────────────────────────────────────────────────────────────

export class TypeScriptGenerator {
  generate(ast: FsmAst, options: GenOptions = {}): GeneratedOutput {
    const machineId = ast.machine.id;
    const pascalMachine = this._toPascalCase(machineId);
    const stateEnumName = `${pascalMachine}State`;
    const eventEnumName = `${pascalMachine}Event`;

    const types = this._generateTypes(ast, stateEnumName, eventEnumName, options);
    const runtime = this._generateRuntime(ast, stateEnumName, eventEnumName);
    const guards = this._generateGuards(ast);
    const actions = this._generateActions(ast);

    const imports: string[] = [];
    if (guards.length > 0 || actions.length > 0) {
      imports.push('import type { GuardFn, ActionFn } from "@cortex/fsm-compiler/runtime";');
    }

    return { types, runtime, guards, actions, imports };
  }

  private _generateTypes(
    ast: FsmAst,
    stateEnumName: string,
    eventEnumName: string,
    options: GenOptions,
  ): string {
    const lines: string[] = [];
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
      const seenEvents = new Set<string>();
      for (const t of transitions) {
        if (seenEvents.has(t.event)) {
          console.warn(
            `[FsmCompiler] 重复转换: 状态 "${stateId}" 事件 "${t.event}"` +
            ` 后定义覆盖前定义`,
          );
        }
        seenEvents.add(t.event);
        const eventKey = this._toEnumKey(t.event);
        const toKey = this._toEnumKey(t.to);
        lines.push(`    [${eventEnumName}.${eventKey}]: ${stateEnumName}.${toKey},`);
      }
      lines.push(`  },`);
    }
    lines.push(`};`);

    return lines.join("\n");
  }

  private _generateRuntime(
    ast: FsmAst,
    stateEnumName: string,
    eventEnumName: string,
  ): string {
    const lines: string[] = [];

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

  private _generateGuards(ast: FsmAst): string {
    const guardNames = new Set<string>();
    for (const t of ast.transitionMap.values()) {
      if (t.guard) {
        guardNames.add(t.guard);
      }
    }

    if (guardNames.size === 0) {
      return "// No guards defined\n";
    }

    const lines: string[] = [];
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

  private _generateActions(ast: FsmAst): string {
    const actionNames = new Set<string>();
    for (const t of ast.transitionMap.values()) {
      if (t.action) {
        actionNames.add(t.action);
      }
    }

    if (actionNames.size === 0) {
      return "// No actions defined\n";
    }

    const lines: string[] = [];
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

  private _collectEvents(ast: FsmAst): string[] {
    const eventSet = new Set<string>();
    for (const t of ast.transitionMap.values()) {
      eventSet.add(t.event);
    }
    return Array.from(eventSet).sort();
  }

  private _toPascalCase(str: string): string {
    return str
      .split(/[_-]/)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
      .join("");
  }

  private _toEnumKey(str: string): string {
    // Convert snake_case or kebab-case to PascalCase for enum keys
    // 保留原大小写避免碰撞（如 myState vs mystate）
    return str
      .split(/[_-]/)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join("");
  }
}
