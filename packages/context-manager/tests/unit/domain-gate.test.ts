/**
 * @cortex/context-manager — DomainGateController 单元测试
 *
 * C 层域门控核心行为验证：
 *   - 默认域为 engineering
 *   - 活跃域内允许通过 / 域外拦截
 *   - domain 为 undefined 时回退到 'general'
 *   - setActiveDomains / getActiveDomains 读写一致性
 */
import { describe, it, expect } from "vitest";
import { DomainGateController } from "../../src/domain-gate.js";

describe("DomainGateController", () => {
  it("should default to engineering domain", () => {
    const gate = new DomainGateController();
    expect(gate.getActiveDomains()).toEqual(["engineering"]);
  });

  it("should allow entry in active domain", () => {
    const gate = new DomainGateController();
    expect(gate.isAllowed({ domain: "engineering" })).toBe(true);
  });

  it("should block entry not in active domain", () => {
    const gate = new DomainGateController();
    expect(gate.isAllowed({ domain: "medical" })).toBe(false);
  });

  it("should default unknown domain to general", () => {
    const gate = new DomainGateController();
    // engineering 是唯一活跃域，general 不在其中 → false
    expect(gate.isAllowed({})).toBe(false);
    expect(gate.isAllowed({ domain: undefined })).toBe(false);
  });

  it("should switch active domains via setActiveDomains", () => {
    const gate = new DomainGateController();
    gate.setActiveDomains(["medical", "engineering", "general"]);

    expect(gate.isAllowed({ domain: "medical" })).toBe(true);
    expect(gate.isAllowed({ domain: "engineering" })).toBe(true);
    expect(gate.isAllowed({ domain: "general" })).toBe(true);
    expect(gate.isAllowed({ domain: "finance" })).toBe(false);
  });

  it("should return active domains via getActiveDomains", () => {
    const gate = new DomainGateController();
    gate.setActiveDomains(["a", "b", "c"]);

    const domains = gate.getActiveDomains();
    expect(domains).toContain("a");
    expect(domains).toContain("b");
    expect(domains).toContain("c");
    expect(domains).toHaveLength(3);

    // 返回的是快照，外部修改不影响内部
    domains.push("d");
    expect(gate.getActiveDomains()).toHaveLength(3);
  });
});
