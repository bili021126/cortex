/**
 * @cortex/fsm-compiler — Guard Registry
 *
 * Registry of guard functions referenced by FSM definitions.
 * Guards are PURE functions — given a context, return boolean.
 */
export class GuardRegistry {
    _guards = new Map();
    register(name, fn) {
        if (this._guards.has(name)) {
            throw new Error(`Guard "${name}" is already registered`);
        }
        this._guards.set(name, fn);
    }
    evaluate(name, context) {
        const fn = this._guards.get(name);
        if (!fn) {
            throw new Error(`Guard "${name}" is not registered`);
        }
        const result = fn(context);
        if (result instanceof Promise) {
            throw new Error(`Guard "${name}" returned a Promise. Use evaluateAsync() for async guards.`);
        }
        return result;
    }
    async evaluateAsync(name, context) {
        const fn = this._guards.get(name);
        if (!fn) {
            throw new Error(`Guard "${name}" is not registered`);
        }
        return await fn(context);
    }
    has(name) {
        return this._guards.has(name);
    }
    remove(name) {
        this._guards.delete(name);
    }
    clear() {
        this._guards.clear();
    }
    get names() {
        return Array.from(this._guards.keys());
    }
}
//# sourceMappingURL=guard-registry.js.map