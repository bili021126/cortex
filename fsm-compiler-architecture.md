# FSM Compiler Architecture — Three-Layer Abstraction Design

> **Target System**: Cortex v2/v3 Monorepo (packages/shared, packages/engine, packages/factory)
>
> **Motivation**: Current codebase has ~6 implicit state machines (AgentPool 5-state FSM, TaskNode 5-state lifecycle, MemoryEntry 4-state lifecycle, ConfirmGate request lifecycle, ManifoldGate flow control, TrustModel escalation) — each implemented as ad-hoc enum + switch-case scatterings. A unified FSM compiler eliminates duplicated transition validation, invariant enforcement, and visualization dead zones.

---

## Table of Contents

1. [Current-State Analysis](#1-current-state-analysis)
2. [Three-Layer Architecture Overview](#2-three-layer-architecture-overview)
3. [Layer 1 — FSM Definition Language (DSL)](#3-layer-1--fsm-definition-language-dsl)
4. [Layer 2 — FSM Compiler](#4-layer-2--fsm-compiler)
5. [Layer 3 — FSM Runtime Engine](#5-layer-3--fsm-runtime-engine)
6. [Monorepo Integration Map](#6-monorepo-integration-map)
7. [Migration Strategy](#7-migration-strategy)
8. [Appendix: State Machine Inventory](#8-appendix-state-machine-inventory)

---

## 1. Current-State Analysis

### 1.1 Implicit State Machines Identified

| Domain | States | Implementation | Location | Lines |
|--------|--------|---------------|----------|-------|
| AgentPool | Created → Awake → Active → Draining → Destroyed | `AgentStatus` enum + `VALID_TRANSITIONS` Map | `packages/engine/src/core/agent-pool.ts` | ~35 |
| TaskNode | pending → claimed → running → done → failed | `status` field + switch in `claim/release/complete` | `packages/engine/src/core/task-board.ts` | ~120 |
| MemoryEntry | Active → Archived → Obliterated | `SemanticState` enum + `cas()` method | `packages/shared/src/memory.ts` | ~15 |
| Memory (v2 compat) | Active → Pending → Archived → Frozen → Obliterated | `MemoryState` enum (deprecated) | `packages/shared/src/memory.ts` | ~10 |
| ConfirmGate | pending → approved/rejected | `Map<string, Promise>` + `resolve()` | `packages/engine/src/core/confirm-gate.ts` | implicit |
| ManifoldGate | waiting → acquired → released / timeout | Queue-based semaphore | `packages/engine/src/core/dispatch-steps/manifold-gate.ts` | implicit |
| TrustModel | L0→L1→L2→L3 with decay | `TrustLevel` enum + `recordDecision()` | `packages/shared/src/toolkit.ts` | implicit |

### 1.2 Pain Points

1. **No single source of truth** — `VALID_TRANSITIONS` in `AgentPool` is duplicated nowhere, yet consumed by `PoolAwareState` in `packages/engine/src/components/pool-aware.ts`
2. **No compile-time transition validation** — invalid transitions only caught at runtime via `setStatus()` returning `false`
3. **No visualization** — impossible to generate state diagrams from code
4. **No serializable history** — cannot replay or debug state machine traversals
5. **Ad-hoc invariant enforcement** — each FSM has its own `_reportInvariant()` call pattern
6. **Patch-driven duplication** — `MemoryState` (v2) and `SemanticState` (v3) coexist with zero mapping

---

## 2. Three-Layer Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Consumer Code (Engine/CLI)                    │
│  AgentPool │ TaskBoard │ MemoryStore │ ...                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ uses
┌──────────────────────────▼──────────────────────────────────────┐
│  Layer 3: FSM Runtime Engine                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ StateMachine<T>   │ TransitionEngine │ GuardEvaluator    │    │
│  │ ActionDispatcher   │ HistoryRecorder │ Visualization     │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ compiled from
┌──────────────────────────▼──────────────────────────────────────┐
│  Layer 2: FSM Compiler                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Parser (DSL → AST)    │ Validator (reachability,        │    │
│  │                        │  completeness, determinism)     │    │
│  │ Code Generator         │ Diagram Generator               │    │
│  │ (TypeScript + JSON)    │ (Mermaid / DOT)                 │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ compiles
┌──────────────────────────▼──────────────────────────────────────┐
│  Layer 1: FSM Definition Language (DSL)                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ FSM Schema (JSON/YAML)   │ TypeScript Decorators        │    │
│  │                          │ ┌────────────────────────┐   │    │
│  │  - states                │ │ @StateMachine          │   │    │
│  │  - transitions           │ │ @State                 │   │    │
│  │  - guards (predicates)   │ │ @Transition            │   │    │
│  │  - actions (side effects)│ │ @Guard                 │   │    │
│  │  - initial state          │ │ @Action                │   │    │
│  │  - final states           │ └────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Declarative over Imperative** — Define WHAT states/transitions exist, not HOW to transition
2. **Compile-time Safety** — Invalid transitions cause build failures, not runtime crashes
3. **Orthogonal Extensibility** — Guards, actions, and side-effects are pluggable without modifying the machine definition
4. **Auditability** — Every transition is recorded with timestamp, cause, and context
5. **Visualizable** — Any defined machine can be rendered as Mermaid/DOT diagram

---

## 3. Layer 1 — FSM Definition Language (DSL)

### 3.1 Schema (JSON-based, normative definition)

```typescript
// packages/fsm-compiler/src/dsl/schema.ts

/**
 * FSM Definition Schema — the single source of truth for any state machine.
 *
 * A machine is:
 *   - A set of finite states (each with metadata)
 *   - Transitions between states (with optional guards and actions)
 *   - One initial state
 *   - Zero or more final (terminal) states
 */
export interface FsmDefinition {
  /** Machine metadata */
  id: string;                    // e.g. "agent_pool", "task_node", "memory_entry"
  displayName: string;           // Human-readable, e.g. "Agent Pool Lifecycle"
  description?: string;
  version: string;               // SemVer for the machine definition

  /** States */
  states: FsmStateDefinition[];

  /** Transitions */
  transitions: FsmTransitionDefinition[];

  /** The initial state ID */
  initialState: string;

  /** Terminal states (no outgoing transitions) */
  finalStates: string[];
}

export interface FsmStateDefinition {
  id: string;                    // e.g. "created", "awake"
  displayName?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  /** CSS class / diagram style hint */
  style?: "initial" | "normal" | "final" | "error";
}

export interface FsmTransitionDefinition {
  id: string;                    // e.g. "created_to_awake"
  from: string;                  // Source state ID
  to: string;                    // Target state ID
  event: string;                 // Trigger event name, e.g. "wakeup", "execute"
  
  /** Optional guard condition (predicate function reference) */
  guard?: string;
  
  /** Optional action to execute on transition (function reference) */
  action?: string;
  
  description?: string;
  
  /**
   * Transition type:
   *   - "external" (default): full exit/enter cycle
   *   - "internal": stay in same state, no exit/enter
   *   - "self": explicit self-transition (exit → enter)
   */
  type?: "external" | "internal" | "self";
}
```

### 3.2 Example: Current AgentPool FSM

```json
{
  "id": "agent_pool",
  "displayName": "Agent Pool Lifecycle",
  "version": "1.0.0",
  "states": [
    { "id": "created",  "displayName": "Created",  "style": "initial" },
    { "id": "awake",    "displayName": "Awake",    "description": "Idle, ready to accept work" },
    { "id": "active",   "displayName": "Active",   "description": "Currently executing a task" },
    { "id": "draining", "displayName": "Draining", "description": "Shutting down, no new work" },
    { "id": "destroyed","displayName": "Destroyed","style": "final" }
  ],
  "transitions": [
    { "id": "create_to_awake",  "from": "created",   "to": "awake",    "event": "wakeup",    "action": "onWakeup" },
    { "id": "create_to_destroy","from": "created",   "to": "destroyed","event": "destroy",  "action": "onDestroy" },
    { "id": "awake_to_active",  "from": "awake",     "to": "active",   "event": "execute",  "guard": "canExecute" },
    { "id": "active_to_awake",  "from": "active",    "to": "awake",    "event": "complete", "action": "onComplete" },
    { "id": "active_to_active", "from": "active",    "to": "active",   "event": "execute",  "guard": "canExecute", "type": "internal", "description": "Re-enter Active (no-op for concurrent dispatch)" },
    { "id": "awake_to_draining","from": "awake",     "to": "draining", "event": "shutdown" },
    { "id": "active_to_draining","from": "active",   "to": "draining", "event": "shutdown" },
    { "id": "draining_to_destroy","from": "draining","to": "destroyed","event": "complete" }
  ],
  "initialState": "created",
  "finalStates": ["destroyed"]
}
```

### 3.3 TypeScript Decorator Alternative (for in-code definition)

```typescript
// Example usage in existing AgentPool

@StateMachine({
  id: "agent_pool",
  initialState: "created",
  finalStates: ["destroyed"]
})
class AgentPool {
  @State("created", { style: "initial" })
  private _created = true;

  @Transition({ from: "created", to: "awake", event: "wakeup" })
  onWakeup(context: TransitionContext): void {
    // side-effect: register with ManifoldGate
  }

  @Guard({ for: "awake_to_active" })
  canExecute(context: GuardContext): boolean {
    return this.active.size < this.config.maxInstances;
  }
}
```

### 3.4 FSM Definition Repository

All machine definitions live in a single location for discoverability:

```
packages/fsm-compiler/definitions/
  agent-pool.fsm.json
  task-node.fsm.json
  memory-entry.fsm.json
  confirm-gate.fsm.json
  manifold-gate.fsm.json
  trust-model.fsm.json
```

---

## 4. Layer 2 — FSM Compiler

### 4.1 Compiler Pipeline

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  FSM DSL     │───▶│  Parser      │───▶│  Validator   │───▶│  Generator   │
│  (.json)     │    │  (DSL→AST)   │    │  (Semantic   │    │  (AST→Code/  │
│              │    │              │    │   Analysis)  │    │   Diagram)   │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
                                              │
                                              ▼
                                       Error Reporter
                                       (build failure
                                        or warnings)
```

### 4.2 Parser Module

```typescript
// packages/fsm-compiler/src/compiler/parser.ts

export class FsmParser {
  /**
   * Parse a JSON FSM definition into an AST.
   * 
   * Validation performed:
   *   - Required fields present
   *   - State IDs referenced in transitions exist in states array
   *   - No duplicate state/transition IDs
   *   - Initial state is a valid state ID
   *   - Final states are all valid state IDs
   */
  parse(json: string): FsmAst;
  
  /**
   * Parse from TypeScript decorators via reflection.
   * Requires experimentalDecorators or using ts-morph.
   */
  parseFromClass(target: object): FsmAst;
}

export interface FsmAst {
  machine: FsmDefinition;
  stateMap: Map<string, FsmStateDefinition>;
  transitionMap: Map<string, FsmTransitionDefinition>;
  adjacencyList: Map<string, FsmTransitionDefinition[]>;
  /**
   * Reverse adjacency for reachability analysis
   */
  reverseAdjacency: Map<string, FsmTransitionDefinition[]>;
}
```

### 4.3 Validator Module — Semantic Analysis

```typescript
// packages/fsm-compiler/src/compiler/validator.ts

export class FsmValidator {
  /**
   * Validate a parsed FSM AST.
   * 
   * Checks:
   * 1. Reachability — every state reachable from initial state?
   * 2. Completeness — every state has defined transitions for all possible events?
   * 3. Determinism — no ambiguous transitions (same state + same event → different targets)
   * 4. Deadlock — no non-final state without outgoing transitions
   * 5. Event Consistency — events used in transitions are defined
   * 6. Guard/Action References — guard/action names resolve to actual functions
   * 7. Self-loop Consistency — self-transitions have type:"self" or type:"internal"
   * 
   * @returns ValidationResult with errors and warnings
   */
  validate(ast: FsmAst): ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  /**
   * Reachability graph — for diagram generation
   */
  metrics: {
    stateCount: number;
    transitionCount: number;
    reachableStates: number;
    unreachableStates: string[];
    hasDeadlock: boolean;
    deterministic: boolean;
  };
}

export interface ValidationError {
  code: "UNREACHABLE_STATE" | "DEADLOCK" | "NON_DETERMINISTIC" 
      | "INVALID_REFERENCE" | "MISSING_STATE" | "DUPLICATE_ID"
      | "INVALID_INITIAL" | "INVALID_FINAL";
  nodeId: string;
  message: string;
}
```

### 4.4 Code Generator — TypeScript Output

```typescript
// packages/fsm-compiler/src/compiler/generators/typescript-generator.ts

export class TypeScriptGenerator {
  /**
   * Generate TypeScript from FSM AST.
   * 
   * Output includes:
   * 1. Enum of states (string or numeric)
   * 2. Enum of events (string)
   * 3. Type-safe transition table (2D matrix: State × Event → State)
   * 4. Guard function stubs (with JSDoc from DSL)
   * 5. Action function stubs
   * 6. Transition validation function (isValidTransition)
   * 7. State machine class with:
   *    - getCurrentState()
   *    - dispatch(event, context) → new state
   *    - can(event) → boolean (guard evaluation)
   *    - getHistory() → TransitionRecord[]
   * 
   * @example Generated for AgentPool:
   *   enum AgentPoolState { Created, Awake, Active, Draining, Destroyed }
   *   enum AgentPoolEvent { Wakeup, Execute, Complete, Shutdown, Destroy }
   *   const TRANSITION_TABLE: Record<AgentPoolState, Partial<Record<AgentPoolEvent, AgentPoolState>>>
   */
  generate(ast: FsmAst, options?: GenOptions): GeneratedOutput;
}

export interface GeneratedOutput {
  /** Generated .ts file content */
  types: string;
  /** Generated class with dispatch logic */
  runtime: string;
  /** Guard function stubs (if DSL references guards) */
  guards: string;
  /** Action function stubs */
  actions: string;
  /** Import map — which imports are needed */
  imports: string[];
}
```

### 4.5 Diagram Generator — Mermaid/DOT

```typescript
// packages/fsm-compiler/src/compiler/generators/diagram-generator.ts

export class DiagramGenerator {
  /**
   * Generate Mermaid state diagram.
   * 
   * @example Output:
   *   stateDiagram-v2
   *     [*] --> created
   *     created --> awake : wakeup
   *     created --> destroyed : destroy
   *     awake --> active : execute [canExecute]
   *     active --> awake : complete
   *     ...
   */
  toMermaid(ast: FsmAst, highlight?: string): string;
  
  /**
   * Generate Graphviz DOT format.
   */
  toDot(ast: FsmAst): string;
}
```

### 4.6 Compiler CLI

```bash
# Build all FSM definitions
fsm-compiler build

# Build specific machine
fsm-compiler build --machine agent-pool

# Validate only
fsm-compiler validate

# Generate diagram
fsm-compiler diagram --format mermaid --output docs/fsm/

# Watch mode (recompile on definition change)
fsm-compiler watch
```

---

## 5. Layer 3 — FSM Runtime Engine

### 5.1 Core Runtime Interface

```typescript
// packages/fsm-compiler/src/runtime/state-machine.ts

/**
 * Generic state machine runtime.
 * 
 * Type parameters:
 *   TState — State enum type (generated by compiler)
 *   TEvent — Event enum type (generated by compiler)
 *   TContext — User-defined context carried through transitions
 */
export class StateMachine<TState extends string, TEvent extends string, TContext = void> {
  private _current: TState;
  private _history: TransitionRecord<TState, TEvent, TContext>[];
  private _transitionTable: TransitionTable<TState, TEvent>;
  
  constructor(
    definition: FsmDefinition,
    options?: StateMachineOptions<TState, TEvent, TContext>
  );

  /** Current state (read-only outside) */
  get current(): TState;

  /** Read-only history */
  get history(): readonly TransitionRecord[];

  /**
   * Check if event can be dispatched (guard evaluation).
   * Does not mutate state.
   */
  can(event: TEvent, context?: TContext): boolean;

  /**
   * Dispatch an event.
   * 
   * 1. Look up transition: current × event → (target, guard?, action?)
   * 2. Evaluate guard (if any) → reject if false
   * 3. Execute exit action of current state
   * 4. Execute transition action (if any)
   * 5. Execute enter action of target state
   * 6. Set current state
   * 7. Record in history
   * 
   * @throws TransitionError if invalid or guard fails
   * @returns The new state
   */
  dispatch(event: TEvent, context?: TContext): TState;

  /**
   * Reset machine to initial state (with optional history clear).
   */
  reset(clearHistory?: boolean): void;

  /**
   * Check if machine is in a terminal (final) state.
   */
  get isFinal(): boolean;

  /**
   * Serialize machine state for persistence.
   */
  serialize(): MachineSnapshot<TState, TContext>;

  /**
   * Restore machine from serialized snapshot.
   */
  static deserialize<T, E, C>(snapshot: MachineSnapshot<T, E, C>): StateMachine<T, E, C>;
}

export interface TransitionRecord<TState, TEvent, TContext> {
  timestamp: number;
  from: TState;
  to: TState;
  event: TEvent;
  context?: TContext;
  /** Unique ID for this transition (for audit trail) */
  id: string;
  /** Optional cause — who/what triggered it */
  cause?: string;
}

export interface MachineSnapshot<TState, TEvent, TContext> {
  machineId: string;
  version: string;
  currentState: TState;
  history: TransitionRecord<TState, TEvent, TContext>[];
  createdAt: number;
}
```

### 5.2 Guard and Action Registry

```typescript
// packages/fsm-compiler/src/runtime/guard-registry.ts

/**
 * Registry of guard functions referenced by FSM definitions.
 * Guards are PURE functions — given a context, return boolean.
 */
export class GuardRegistry {
  private _guards = new Map<string, GuardFn>();

  register(name: string, fn: GuardFn): void;
  evaluate(name: string, context: unknown): boolean;
  has(name: string): boolean;
}

export type GuardFn = (context: unknown) => boolean | Promise<boolean>;


// packages/fsm-compiler/src/runtime/action-registry.ts

/**
 * Registry of action functions referenced by FSM definitions.
 * Actions can be async — `dispatch()` will await if action is async.
 */
export class ActionRegistry {
  private _actions = new Map<string, ActionFn>();

  register(name: string, fn: ActionFn): void;
  execute(name: string, context: unknown): void | Promise<void>;
}

export type ActionFn = (context: unknown) => void | Promise<void>;
```

### 5.3 Integration with Existing Engine

```typescript
// packages/engine/src/core/agent-pool.ts (refactored)

import { StateMachine, GuardRegistry, ActionRegistry } from "@cortex/fsm-compiler/runtime";
import AgentPoolFsm from "../generated/agent-pool.fsm.json" assert { type: "json" };

export class AgentPool implements IAgentPool {
  private fsm: StateMachine<AgentPoolState, AgentPoolEvent>;
  
  constructor() {
    const guards = new GuardRegistry();
    guards.register("canSpawn", (ctx) => this._canSpawn(ctx as SpawnContext));
    
    const actions = new ActionRegistry();
    actions.register("onWakeup", (ctx) => this._onWakeup(ctx as WakeupContext));
    actions.register("onDestroy", (ctx) => this._onDestroy(ctx as DestroyContext));
    
    this.fsm = new StateMachine(AgentPoolFsm, { guards, actions });
  }
  
  setStatus(instanceId: string, status: AgentStatus): boolean {
    // Before: manual VALID_TRANSITIONS lookup
    // After: delegate to FSM engine
    const event = statusToEvent(status);
    try {
      this.fsm.dispatch(event, { instanceId });
      return true;
    } catch (e) {
      if (e instanceof TransitionError) {
        this._reportInvariant("AgentPool.setStatus", 
          `非法流转 ${this.fsm.current} → ${status} (instance: ${instanceId})`);
        return false;
      }
      throw e;
    }
  }
}
```

### 5.4 History Recorder & Audit Trail

```typescript
// packages/fsm-compiler/src/runtime/history-recorder.ts

/**
 * Records all FSM transitions for audit, debugging, and replay.
 * 
 * Integration points:
 *   - PipelineObserver (emit FSM transition events)
 *   - MemoryStore (persist as MemoryEntry for long-term audit)
 *   - Log file (structured JSONL for diagnostics)
 */
export class HistoryRecorder {
  constructor(
    private readonly machineId: string,
    private readonly observer?: IPipelineObserver,
    private readonly memory?: IMemoryStore,
  ) {}

  onTransition(record: TransitionRecord): void {
    // 1. Record in-memory buffer
    // 2. Emit PipelineObserver event
    this.observer?.emit({
      type: PipelineEventType.NodeStart, // REUSE or add new FSM event type
      priority: PipelinePriority.NORMAL,
      payload: { machineId: this.machineId, ...record },
      timestamp: Date.now(),
    });
    // 3. Persist to memory (async, fire-and-forget)
  }
}
```

### 5.5 Visualization Server (Dev Mode)

```typescript
// packages/fsm-compiler/src/runtime/visualization-server.ts

/**
 * In development mode, serves a live FSM visualization.
 * Uses WebSocket to push state changes in real-time.
 * 
 * URL: http://localhost:3456/fsm/{machineId}
 * Shows: current state highlighted, transition animation, history list
 */
export class VisualizationServer {
  start(port?: number): void;
  pushTransition(record: TransitionRecord): void;
  stop(): void;
}
```

---

## 6. Monorepo Integration Map

### 6.1 New Package Structure

```
packages/fsm-compiler/
  package.json                     # @cortex/fsm-compiler
  src/
    cli/
      index.ts                     # CLI entry
      build.ts                     # fsm-compiler build
      validate.ts                  # fsm-compiler validate
      diagram.ts                   # fsm-compiler diagram
      watch.ts                     # fsm-compiler watch
    dsl/
      schema.ts                    # FsmDefinition, FsmStateDefinition, etc.
      parser.ts                    # JSON + decorator parsers
    compiler/
      parser.ts                    # DSL → AST
      validator.ts                 # Semantic analysis
      generators/
        typescript-generator.ts    # → .ts code
        json-generator.ts          # → transition table JSON (for runtime)
        diagram-generator.ts       # → Mermaid/DOT
    runtime/
      state-machine.ts             # StateMachine<TState, TEvent, TContext>
      guard-registry.ts            # GuardFn registry
      action-registry.ts           # ActionFn registry
      history-recorder.ts          # Audit trail
      visualization-server.ts      # Dev-mode live view
      index.ts                     # barrel export
    errors.ts                      # TransitionError, GuardError
  definitions/
    agent-pool.fsm.json            # ✅ Current Enum → DSL migration
    task-node.fsm.json             # ✅ Current Enum → DSL migration
    memory-entry.fsm.json          # ✅ Current Enum → DSL migration
    confirm-gate.fsm.json          # 🆕 First-class definition
    manifold-gate.fsm.json         # 🆕 First-class definition
    trust-model.fsm.json           # 🆕 First-class definition
  tests/
    compiler/
      parser.test.ts
      validator.test.ts
      typescript-generator.test.ts
    runtime/
      state-machine.test.ts
      guard-registry.test.ts
    integration/
      agent-pool.test.ts           # Compare old vs new behavior
      task-board.test.ts           # Compare old vs new behavior
```

### 6.2 Integration with Package Graph

```
@cortex/fsm-compiler
  │
  ├── build-time dependency ──────────────┐
  │ (compile definitions → generated code) │
  │                                       ▼
  │                              @cortex/shared
  │                               (re-exports generated types)
  │                                     │
  └── runtime dependency ──────────────┐ │
    (StateMachine class, registries)   │ │
                                       ▼ ▼
                              @cortex/engine
                        (consumes FSM runtime in:
                         AgentPool, TaskBoard,
                         MetaAgent, ConfirmGate)
                                     │
                                     ▼
                              @cortex/factory
                        (bootstrap → injects
                         guard/action registrations)
```

### 6.3 Generated Code Location

```
packages/shared/src/generated/   # Auto-generated by fsm-compiler build
  fsm-types.ts                   # All state/event enums
  agent-pool-fsm.ts              # AgentPool specific generated code
  task-node-fsm.ts               # TaskNode specific generated code
  memory-entry-fsm.ts            # MemoryEntry specific generated code
  fsm-index.ts                   # Barrel export
```

### 6.4 Build Pipeline Integration

```json
// packages/fsm-compiler/package.json (scripts)
{
  "scripts": {
    "build": "tsc",
    "prebuild": "fsm-compiler build --out packages/shared/src/generated",
    "validate": "fsm-compiler validate",
    "diagram": "fsm-compiler diagram --out docs/fsm/",
    "watch": "fsm-compiler watch"
  }
}

// Root package.json (scripts)
{
  "scripts": {
    "build:fsm": "pnpm --filter @cortex/fsm-compiler run build",
    "build:shared": "pnpm --filter @cortex/shared run build",
    "build": "pnpm build:fsm && pnpm build:shared && pnpm -r --filter !@cortex/fsm-compiler --filter !@cortex/shared run build"
  }
}
```

---

## 7. Migration Strategy

### Phase 1 — Foundation (Week 1-2)

| Task | Deliverable | Validation |
|------|------------|------------|
| Implement DSL schema | `FsmDefinition` interfaces + JSON validation | Unit tests for schema parsing |
| Implement FSM Parser | `FsmParser.parse()` with error reporting | Parse all 6 current FSM definitions |
| Implement FSM Validator | Reachability, deadlock, determinism checks | Validate existing machines (expect 0 errors for current implicit machines) |
| CLI scaffold | `build`, `validate`, `diagram` commands | End-to-end: definitions → parse → validate → report |

### Phase 2 — Code Generation (Week 3-4)

| Task | Deliverable | Validation |
|------|------------|------------|
| TypeScript enum/type generator | Generated enums + transition table | Generated code compiles with strict TypeScript |
| Runtime engine | `StateMachine` class with dispatch | Test: all AgentPool transitions match old behavior |
| Guard/Action registry | Registry + integration with runtime | Test: guard predicates properly block invalid transitions |
| History recorder | Record + serialize all transitions | Test: snapshot roundtrip |

### Phase 3 — Integration (Week 5-6)

| Task | Deliverable | Validation |
|------|------------|------------|
| AgentPool migration | Replace `VALID_TRANSITIONS` + `setStatus()` with FSM | All existing AgentPool tests pass unchanged |
| TaskBoard migration | Replace manual state logic with FSM | All existing TaskBoard tests pass unchanged |
| MemoryEntry migration | Replace `cas()` + manual checks with FSM | All existing MemoryStore tests pass unchanged |
| ConfirmGate migration | First-class definition for request lifecycle | Existing CLI/engine integration tests pass |
| Build pipeline | Prebuild hook in root package.json | `pnpm build` runs FSM compiler first |

### Phase 4 — Enhancement (Week 7-8)

| Task | Deliverable | Validation |
|------|------------|------------|
| Diagram generation | Mermaid/DOT output | Visual review of generated diagrams |
| Visualization server | Live FSM viewer in dev mode | Manual inspection during engine tests |
| Watch mode | `fsm-compiler watch` with auto-rebuild | File change → rebuild → test pass |
| Documentation | Architecture doc + migration guide | Team review |

---

## 8. Appendix: State Machine Inventory

### 8.1 AgentPool FSM (Current: `packages/engine/src/core/agent-pool.ts`)

```
States:     5 (Created, Awake, Active, Draining, Destroyed)
Events:     5 (wakeup, execute, complete, shutdown, destroy)
Transitions: 8 (including Active→Active internal)
Guards:     1 (canExecute — implicit in spawn())
Actions:    3 (onWakeup, onComplete, onDestroy — implicit)
Persistence: None (in-memory only)
```

### 8.2 TaskNode FSM (Current: `packages/engine/src/core/task-board.ts`)

```
States:     5 (pending, claimed, running, done, failed)
Events:     5 (claim, release, complete, fail, cancel)
Transitions: ~10 (with multi-perspective branching)
Guards:     4 (canClaim, canRelease, isAllPerspectivesDone, isTerminal)
Actions:    4 (onClaim, onRelease, onComplete, onFail)
Persistence: In-memory (serialized in ExecutionReport)
```

### 8.3 MemoryEntry FSM (Current: `packages/shared/src/memory.ts`)

```
States:     3 (Active, Archived, Obliterated) + 1 (Pending) for v2
Events:     3 (archive, obliterate, commit)
Transitions: 6
Guards:     1 (canArchive — weight threshold)
Actions:    2 (onArchive — trigger link cleanup, onObliterate — full cleanup)
Persistence: SQLite (serialized to JSON)
```

### 8.4 ConfirmGate Request FSM

```
States:     3 (pending, approved, rejected)
Events:     2 (approve, reject)
Transitions: 2
Guards:     0
Actions:    1 (onResolve — notify waiter)
Persistence: In-memory (ephemeral)
```

### 8.5 ManifoldGate Slot FSM

```
States:     4 (waiting, acquired, released, timeout)
Events:     4 (acquire, release, timeout, cancel)
Transitions: 5
Guards:     1 (canAcquire — slot available)
Actions:    2 (onAcquire — start execution, onTimeout — cleanup waiter)
Persistence: In-memory (ephemeral)
```

### 8.6 TrustModel FSM

```
States:     4 (L0, L1, L2, L3)
Events:     3 (approve, reject, decay)
Transitions: ~8 (circular with decay back-edges)
Guards:     2 (canEscalate — consecutive count, canDecay — inactivity period)
Actions:    4 (onEscalate, onDeescalate, onReset, onDecay)
Persistence: In-memory (serialized in snapshot)
```

---

## Summary

The three-layer FSM compiler architecture transforms Cortex's 6 scattered, ad-hoc state machines into:

1. **Layer 1 (DSL)** — A single declarative JSON schema that is the authoritative source of truth for every state machine
2. **Layer 2 (Compiler)** — Build-time validation (reachability, determinism, deadlock) + code generation (TypeScript types, transition tables, diagrams)
3. **Layer 3 (Runtime)** — A unified `StateMachine<T>` engine with guard/action registries, history recording, and live visualization

This eliminates the current pattern of duplicated transition tables (`VALID_TRANSITIONS` in AgentPool, `res.status` checks in TaskBoard, `cas()` in MemoryStore), replaces runtime-only invariant violations with compile-time guarantees, and adds auditability to every state transition in the system.
