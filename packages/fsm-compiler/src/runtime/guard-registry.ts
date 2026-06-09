/**
 * @cortex/fsm-compiler — Guard Registry
 *
 * Registry of guard functions referenced by FSM definitions.
 * Guards are PURE functions — given a context, return boolean.
 */

export type GuardFn = (context: unknown) => boolean | Promise<boolean>;

export class GuardRegistry {
  private _guards = new Map<string, GuardFn>();

  register(name: string, fn: GuardFn): void {
    if (this._guards.has(name)) {
      throw new Error(`Guard "${name}" is already registered`);
    }
    this._guards.set(name, fn);
  }

  evaluate(name: string, context: unknown): boolean {
    const fn = this._guards.get(name);
    if (!fn) {
      throw new Error(`Guard "${name}" is not registered`);
    }
    const result = fn(context);
    if (result instanceof Promise) {
      throw new Error(
        `Guard "${name}" returned a Promise. Use evaluateAsync() for async guards.`,
      );
    }
    return result;
  }

  async evaluateAsync(name: string, context: unknown): Promise<boolean> {
    const fn = this._guards.get(name);
    if (!fn) {
      throw new Error(`Guard "${name}" is not registered`);
    }
    return await fn(context);
  }

  has(name: string): boolean {
    return this._guards.has(name);
  }

  remove(name: string): void {
    this._guards.delete(name);
  }

  clear(): void {
    this._guards.clear();
  }

  get names(): string[] {
    return Array.from(this._guards.keys());
  }
}
