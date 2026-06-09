// @ci: unit
import { describe, it, expect } from "vitest";
import { GuardRegistry } from "../../src/runtime/guard-registry.js";

describe("GuardRegistry", () => {
  it("should register and evaluate a guard", () => {
    const registry = new GuardRegistry();
    registry.register("isPositive", (ctx) => (ctx as number) > 0);

    expect(registry.evaluate("isPositive", 5)).toBe(true);
    expect(registry.evaluate("isPositive", -1)).toBe(false);
  });

  it("should throw on unregistered guard", () => {
    const registry = new GuardRegistry();
    expect(() => registry.evaluate("nonexistent", {})).toThrow(/not registered/);
  });

  it("should throw on duplicate registration", () => {
    const registry = new GuardRegistry();
    registry.register("test", () => true);
    expect(() => registry.register("test", () => false)).toThrow(/already registered/);
  });

  it("should throw on async guard in sync evaluate", () => {
    const registry = new GuardRegistry();
    registry.register("asyncGuard", async () => true);

    expect(() => registry.evaluate("asyncGuard", {})).toThrow(/Promise/);
  });

  it("should evaluate async guard with evaluateAsync", async () => {
    const registry = new GuardRegistry();
    registry.register("asyncGuard", async (ctx) => (ctx as number) > 0);

    const result = await registry.evaluateAsync("asyncGuard", 5);
    expect(result).toBe(true);
  });

  it("should support has(), remove(), and clear()", () => {
    const registry = new GuardRegistry();
    registry.register("a", () => true);
    registry.register("b", () => false);

    expect(registry.has("a")).toBe(true);
    expect(registry.names).toEqual(["a", "b"]);

    registry.remove("a");
    expect(registry.has("a")).toBe(false);

    registry.clear();
    expect(registry.names).toEqual([]);
  });
});
