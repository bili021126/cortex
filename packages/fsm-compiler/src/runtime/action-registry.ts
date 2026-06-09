/**
 * @cortex/fsm-compiler — Action Registry
 *
 * Registry of action functions referenced by FSM definitions.
 * Actions can be async — `executeAsync()` will await if action is async.
 */

export type ActionFn = (context: unknown) => void | Promise<void>;

export class ActionRegistry {
  private _actions = new Map<string, ActionFn>();

  register(name: string, fn: ActionFn): void {
    if (this._actions.has(name)) {
      throw new Error(`Action "${name}" is already registered`);
    }
    this._actions.set(name, fn);
  }

  execute(name: string, context: unknown): void | Promise<void> {
    const fn = this._actions.get(name);
    if (!fn) {
      throw new Error(`Action "${name}" is not registered`);
    }
    return fn(context);
  }

  async executeAsync(name: string, context: unknown): Promise<void> {
    const fn = this._actions.get(name);
    if (!fn) {
      throw new Error(`Action "${name}" is not registered`);
    }
    await fn(context);
  }

  has(name: string): boolean {
    return this._actions.has(name);
  }

  remove(name: string): void {
    this._actions.delete(name);
  }

  clear(): void {
    this._actions.clear();
  }

  get names(): string[] {
    return Array.from(this._actions.keys());
  }
}
