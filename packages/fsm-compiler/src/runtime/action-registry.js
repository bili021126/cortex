/**
 * @cortex/fsm-compiler — Action Registry
 *
 * Registry of action functions referenced by FSM definitions.
 * Actions can be async — `executeAsync()` will await if action is async.
 */
export class ActionRegistry {
    _actions = new Map();
    register(name, fn) {
        if (this._actions.has(name)) {
            throw new Error(`Action "${name}" is already registered`);
        }
        this._actions.set(name, fn);
    }
    execute(name, context) {
        const fn = this._actions.get(name);
        if (!fn) {
            throw new Error(`Action "${name}" is not registered`);
        }
        return fn(context);
    }
    async executeAsync(name, context) {
        const fn = this._actions.get(name);
        if (!fn) {
            throw new Error(`Action "${name}" is not registered`);
        }
        await fn(context);
    }
    has(name) {
        return this._actions.has(name);
    }
    remove(name) {
        this._actions.delete(name);
    }
    clear() {
        this._actions.clear();
    }
    get names() {
        return Array.from(this._actions.keys());
    }
}
//# sourceMappingURL=action-registry.js.map