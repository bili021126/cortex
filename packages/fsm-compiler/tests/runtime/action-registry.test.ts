// @ci: unit
import { describe, it, expect } from "vitest";
import { ActionRegistry } from "../../src/runtime/action-registry.js";

describe("ActionRegistry", () => {
  it("should register and execute a sync action", () => {
    const registry = new ActionRegistry();
    let called = false;

    registry.register("log", () => {
      called = true;
    });

    void registry.execute("log", {});
    expect(called).toBe(true);
  });

  it("should throw on unregistered action", () => {
    const registry = new ActionRegistry();
    expect(() => registry.execute("nonexistent", {})).toThrow(/not registered/);
  });

  it("should throw on duplicate registration", () => {
    const registry = new ActionRegistry();
    registry.register("test", () => {});
    expect(() => registry.register("test", () => {})).toThrow(/already registered/);
  });

  it("should execute async action with executeAsync", async () => {
    const registry = new ActionRegistry();
    let called = false;

    registry.register("asyncAction", async () => {
      await Promise.resolve();
      called = true;
    });

    await registry.executeAsync("asyncAction", {});
    expect(called).toBe(true);
  });

  it("should support has(), remove(), and clear()", () => {
    const registry = new ActionRegistry();
    registry.register("a", () => {});
    registry.register("b", () => {});

    expect(registry.has("a")).toBe(true);
    expect(registry.names).toEqual(["a", "b"]);

    registry.remove("a");
    expect(registry.has("a")).toBe(false);

    registry.clear();
    expect(registry.names).toEqual([]);
  });
});
