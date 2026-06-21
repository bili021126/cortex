/**
 * @cortex/fsm-compiler — Action Registry
 *
 * Registry of action functions referenced by FSM definitions.
 * Actions can be async — `executeAsync()` will await if action is async.
 */
export type ActionFn = (context: unknown) => void | Promise<void>;
export declare class ActionRegistry {
    private _actions;
    register(name: string, fn: ActionFn): void;
    execute(name: string, context: unknown): void | Promise<void>;
    executeAsync(name: string, context: unknown): Promise<void>;
    has(name: string): boolean;
    remove(name: string): void;
    clear(): void;
    get names(): string[];
}
//# sourceMappingURL=action-registry.d.ts.map