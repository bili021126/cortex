// @ci: unit
/**
 * @cortex/policy-validator — RuleRegistry 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RuleRegistry, createRule } from "@cortex/policy-validator";
import type { PolicyRule } from "@cortex/policy-validator";

describe("RuleRegistry", () => {
  let registry: RuleRegistry;

  beforeEach(() => {
    registry = new RuleRegistry();
  });

  // ── register ──

  it("should register a single rule", () => {
    const rule = createRule("test/rule-1", "style", "error", "Test rule", "TEST_001");
    registry.register(rule);
    expect(registry.size()).toBe(1);
    expect(registry.get("test/rule-1")).toBe(rule);
  });

  it("should throw when registering duplicate rule", () => {
    const rule = createRule("test/rule-1", "style", "error", "Test rule", "TEST_001");
    registry.register(rule);
    expect(() => registry.register(rule)).toThrow("Rule already registered");
  });

  // ── bulkRegister ──

  it("should bulk register multiple rules", () => {
    const rules: PolicyRule[] = [
      createRule("test/rule-1", "style", "error", "Rule 1", "T1"),
      createRule("test/rule-2", "exception", "warning", "Rule 2", "T2"),
      createRule("test/rule-3", "async", "info", "Rule 3", "T3"),
    ];
    registry.bulkRegister(rules);
    expect(registry.size()).toBe(3);
  });

  it("should throw on duplicate in bulk register", () => {
    const rules: PolicyRule[] = [
      createRule("test/rule-1", "style", "error", "Rule 1", "T1"),
      createRule("test/rule-1", "style", "error", "Rule 1 dup", "T1"),
    ];
    expect(() => registry.bulkRegister(rules)).toThrow("Rule already registered");
  });

  // ── get ──

  it("should return undefined for unknown rule", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  // ── query ──

  it("should return all rules when no filter", () => {
    registry.bulkRegister([
      createRule("test/r1", "style", "error", "R1", "T1"),
      createRule("test/r2", "exception", "warning", "R2", "T2"),
    ]);
    expect(registry.query()).toHaveLength(2);
  });

  it("should filter by domain", () => {
    registry.bulkRegister([
      createRule("test/r1", "style", "error", "R1", "T1"),
      createRule("test/r2", "exception", "warning", "R2", "T2"),
      createRule("test/r3", "style", "warning", "R3", "T3"),
    ]);
    const styleRules = registry.query({ domains: ["style"] });
    expect(styleRules).toHaveLength(2);
    expect(styleRules.every(r => r.domain === "style")).toBe(true);
  });

  it("should filter by severity", () => {
    registry.bulkRegister([
      createRule("test/r1", "style", "error", "R1", "T1"),
      createRule("test/r2", "style", "warning", "R2", "T2"),
      createRule("test/r3", "style", "info", "R3", "T3"),
    ]);
    const errors = registry.query({ severities: ["error"] });
    expect(errors).toHaveLength(1);
    expect(errors[0].id).toBe("test/r1");
  });

  it("should filter by tags", () => {
    registry.bulkRegister([
      createRule("test/r1", "style", "error", "R1", "T1", { tags: ["style", "safety"] }),
      createRule("test/r2", "style", "warning", "R2", "T2", { tags: ["style"] }),
    ]);
    const safetyRules = registry.query({ tags: ["safety"] });
    expect(safetyRules).toHaveLength(1);
    expect(safetyRules[0].id).toBe("test/r1");
  });

  it("should filter by ruleIds", () => {
    registry.bulkRegister([
      createRule("test/r1", "style", "error", "R1", "T1"),
      createRule("test/r2", "style", "error", "R2", "T2"),
      createRule("test/r3", "style", "error", "R3", "T3"),
    ]);
    const selected = registry.query({ ruleIds: ["test/r1", "test/r3"] });
    expect(selected).toHaveLength(2);
    expect(selected.map(r => r.id).sort()).toEqual(["test/r1", "test/r3"]);
  });

  // ── disable / enable ──

  it("should disable a rule and exclude from query", () => {
    registry.register(createRule("test/r1", "style", "error", "R1", "T1"));
    registry.register(createRule("test/r2", "style", "error", "R2", "T2"));
    registry.disable("test/r1");
    expect(registry.isDisabled("test/r1")).toBe(true);
    expect(registry.query()).toHaveLength(1);
    expect(registry.query()[0].id).toBe("test/r2");
  });

  it("should re-enable a disabled rule", () => {
    registry.register(createRule("test/r1", "style", "error", "R1", "T1"));
    registry.disable("test/r1");
    expect(registry.isDisabled("test/r1")).toBe(true);
    registry.enable("test/r1");
    expect(registry.isDisabled("test/r1")).toBe(false);
    expect(registry.query()).toHaveLength(1);
  });

  // ── count ──

  it("should count by domain", () => {
    registry.bulkRegister([
      createRule("test/r1", "style", "error", "R1", "T1"),
      createRule("test/r2", "exception", "warning", "R2", "T2"),
      createRule("test/r3", "style", "warning", "R3", "T3"),
    ]);
    const counts = registry.countByDomain();
    expect(counts.style).toBe(2);
    expect(counts.exception).toBe(1);
  });

  it("should count by severity", () => {
    registry.bulkRegister([
      createRule("test/r1", "style", "error", "R1", "T1"),
      createRule("test/r2", "style", "warning", "R2", "T2"),
      createRule("test/r3", "style", "info", "R3", "T3"),
    ]);
    const counts = registry.countBySeverity();
    expect(counts.error).toBe(1);
    expect(counts.warning).toBe(1);
    expect(counts.info).toBe(1);
  });

  // ── getDomains ──

  it("should return unique domains", () => {
    registry.bulkRegister([
      createRule("test/r1", "style", "error", "R1", "T1"),
      createRule("test/r2", "style", "warning", "R2", "T2"),
      createRule("test/r3", "exception", "warning", "R3", "T3"),
    ]);
    const domains = registry.getDomains();
    expect(domains).toHaveLength(2);
    expect(domains).toContain("style");
    expect(domains).toContain("exception");
  });

  // ── clear ──

  it("should clear all rules", () => {
    registry.register(createRule("test/r1", "style", "error", "R1", "T1"));
    registry.clear();
    expect(registry.size()).toBe(0);
    expect(registry.query()).toHaveLength(0);
  });

  // ── getAll ──

  it("should return all non-disabled rules", () => {
    registry.bulkRegister([
      createRule("test/r1", "style", "error", "R1", "T1"),
      createRule("test/r2", "style", "error", "R2", "T2"),
    ]);
    registry.disable("test/r1");
    const all = registry.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("test/r2");
  });
});
