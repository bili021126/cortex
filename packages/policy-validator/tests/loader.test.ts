// @ci: unit
/**
 * @cortex/policy-validator — RuleLoader 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RuleRegistry, RuleLoader, getBuiltinRules } from "@cortex/policy-validator";

describe("RuleLoader", () => {
  let registry: RuleRegistry;
  let loader: RuleLoader;

  beforeEach(() => {
    registry = new RuleRegistry();
    loader = new RuleLoader(registry);
  });

  // ── getBuiltinRules ──

  it("should return all builtin rules from coding-standards.md mapping", () => {
    const rules = getBuiltinRules();
    expect(rules.length).toBeGreaterThan(0);

    // Check that all required domains are covered
    const domains = new Set(rules.map(r => r.domain));
    expect(domains.has("exception")).toBe(true);
    expect(domains.has("declaration")).toBe(true);
    expect(domains.has("async")).toBe(true);
    expect(domains.has("import")).toBe(true);
    expect(domains.has("console")).toBe(true);
    expect(domains.has("style")).toBe(true);
    expect(domains.has("hardcoded")).toBe(true);
    expect(domains.has("prompts")).toBe(true);
    expect(domains.has("architecture")).toBe(true);
    expect(domains.has("function")).toBe(true);
    expect(domains.has("interface")).toBe(true);
    expect(domains.has("pattern")).toBe(true);
  });

  it("should have unique rule IDs in builtin rules", () => {
    const rules = getBuiltinRules();
    const ids = rules.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("should have no-var rule with correct metadata", () => {
    const rules = getBuiltinRules();
    const noVarRule = rules.find(r => r.id === "declaration/no-var");
    expect(noVarRule).toBeDefined();
    expect(noVarRule!.domain).toBe("declaration");
    expect(noVarRule!.severity).toBe("error");
    expect(noVarRule!.code).toBe("NO_VAR");
    expect(noVarRule!.standardRef).toBe("§二");
  });

  it("should have non-null-assertion rule with correct metadata", () => {
    const rules = getBuiltinRules();
    const nonNullRule = rules.find(r => r.id === "style/no-non-null-assertion");
    expect(nonNullRule).toBeDefined();
    expect(nonNullRule!.severity).toBe("error");
    expect(nonNullRule!.code).toBe("NO_NON_NULL_ASSERTION");
    expect(nonNullRule!.standardRef).toBe("§10.1");
    expect(nonNullRule!.fixSuggestion).toBeDefined();
  });

  // ── loadFromConfig ──

  it("should load all builtin rules into registry", async () => {
    const count = await loader.loadFromConfig();
    expect(count).toBeGreaterThan(0);
    expect(registry.size()).toBe(count);
    expect(registry.getAll().length).toBe(count);
  });

  it("should provide load stats after loading", async () => {
    await loader.loadFromConfig();
    const stats = loader.getLoadStats();
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
    expect(stats.bySeverity.error).toBeGreaterThan(0);
    expect(stats.bySeverity.warning).toBeGreaterThan(0);
  });

  it("should clear before load when option is set", async () => {
    // First load
    await loader.loadFromConfig();
    const firstCount = registry.size();

    // Load again with clearBeforeLoad
    await loader.loadFromConfig({ clearBeforeLoad: true });
    expect(registry.size()).toBe(firstCount); // Same count after re-load
  });

  // ── loadFromJson (not implemented) ──

  it("should throw for loadFromJson", async () => {
    await expect(loader.loadFromJson("rules.json"))
      .rejects.toThrow("loadFromJson requires actual file system access");
  });

  // ── loadFromMarkdown (not implemented) ──

  it("should throw for loadFromMarkdown", async () => {
    await expect(loader.loadFromMarkdown("rules.md"))
      .rejects.toThrow("loadFromMarkdown requires Markdown parsing logic");
  });
});
