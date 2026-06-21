/**
 * @cortex/fsm-compiler — Guard Registry
 *
 * Registry of guard functions referenced by FSM definitions.
 * Guards are PURE functions — given a context, return boolean.
 */
export type GuardFn = (context: unknown) => boolean | Promise<boolean>;
export declare class GuardRegistry {
    private _guards;
    register(name: string, fn: GuardFn): void;
    evaluate(name: string, context: unknown): boolean;
    evaluateAsync(name: string, context: unknown): Promise<boolean>;
    has(name: string): boolean;
    remove(name: string): void;
    clear(): void;
    get names(): string[];
}
//# sourceMappingURL=guard-registry.d.ts.map