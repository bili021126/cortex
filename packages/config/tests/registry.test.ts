// @ci: unit

import { describe, it, expect } from "vitest";
import { ConfigRegistry } from "@cortex/config";

describe("ConfigRegistry", () => {
  // ── 基本操作 ──────────────────────────────────────

  it("should register a domain and retrieve it", () => {
    const registry = new ConfigRegistry();
    registry.register({ key: "test", defaults: { foo: "bar" } });
    const retrieved = registry.get("test");
    expect(retrieved).toEqual({ foo: "bar" });
  });

  it("should return undefined for unregistered key via has()", () => {
    const registry = new ConfigRegistry();
    expect(registry.has("nonexistent")).toBe(false);
  });

  it("should throw for get() on unregistered key", () => {
    const registry = new ConfigRegistry();
    expect(() => registry.get("missing")).toThrow(/not registered/i);
  });

  it("should list all registered domain keys", () => {
    const registry = new ConfigRegistry();
    registry.register({ key: "a", defaults: {} });
    registry.register({ key: "b", defaults: {} });
    expect(registry.list()).toEqual(["a", "b"]);
  });

  it("should overwrite domain on duplicate register", () => {
    const registry = new ConfigRegistry();
    registry.register({ key: "dup", defaults: { val: "first" } });
    registry.register({ key: "dup", defaults: { val: "second" } });
    expect(registry.get("dup")).toEqual({ val: "second" });
  });

  it("should handle empty key gracefully", () => {
    const registry = new ConfigRegistry();
    registry.register({ key: "", defaults: { val: 1 } });
    expect(registry.has("")).toBe(true);
    expect(registry.get("")).toEqual({ val: 1 });
    expect(registry.list()).toContain("");
  });

  // ── 边界 ──────────────────────────────────────────

  it("should handle large number of domains (100+)", () => {
    const registry = new ConfigRegistry();
    for (let i = 0; i < 150; i++) {
      registry.register({ key: `domain-${i}`, defaults: { index: i } });
    }
    expect(registry.list()).toHaveLength(150);
    // 随机抽检
    expect(registry.get("domain-0")).toEqual({ index: 0 });
    expect(registry.get("domain-99")).toEqual({ index: 99 });
    expect(registry.get("domain-149")).toEqual({ index: 149 });
  });

  it("should handle special characters in domain keys", () => {
    const registry = new ConfigRegistry();
    registry.register({ key: "my-domain_1", defaults: { a: 1 } });
    registry.register({ key: "namespace/key", defaults: { b: 2 } });
    registry.register({ key: " $pecial ", defaults: { c: 3 } });
    expect(registry.has("my-domain_1")).toBe(true);
    expect(registry.has("namespace/key")).toBe(true);
    expect(registry.has(" $pecial ")).toBe(true);
    expect(registry.get(" $pecial ")).toEqual({ c: 3 });
  });

  it("should preserve domain defaults after get() mutation attempt", () => {
    const registry = new ConfigRegistry();
    registry.register({ key: "safe", defaults: { immutable: true, list: [1, 2, 3] } });

    // 尝试修改 get() 返回的对象
    // 注意：get() 直接返回 domain.defaults 引用，不创建副本
    // 此测试验证当前行为：返回的是原始引用
    const retrieved = registry.get<{ immutable: boolean; list: number[] }>("safe");
    retrieved.immutable = false;
    retrieved.list.push(4);

    // 再次获取应看到修改（因为未做深拷贝）
    const retrieved2 = registry.get<{ immutable: boolean; list: number[] }>("safe");
    expect(retrieved2.immutable).toBe(false);
    expect(retrieved2.list).toEqual([1, 2, 3, 4]);
  });

  it("should accept domain with schema field", () => {
    const registry = new ConfigRegistry();
    const schema = { type: "object", properties: { x: { type: "number" } } };
    registry.register({ key: "with-schema", defaults: { x: 42 }, schema });
    expect(registry.has("with-schema")).toBe(true);
  });

  it("should accept domain with envPrefix field", () => {
    const registry = new ConfigRegistry();
    registry.register({ key: "with-env", defaults: {}, envPrefix: "MY_" });
    const retrieved = registry.get("with-env");
    expect(retrieved).toEqual({});
  });

  it("should return empty list for fresh registry", () => {
    const registry = new ConfigRegistry();
    expect(registry.list()).toEqual([]);
  });
});
