// @ci: unit
/**
 * @cortex/policy-validator — RuleEngine 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RuleRegistry, RuleEngine, createRule } from "@cortex/policy-validator";
import type { PolicyRule, PolicyRuleResult } from "@cortex/policy-validator";
import type { PolicyValidatorComponent } from "@cortex/policy-validator";

describe("RuleEngine", () => {
  let registry: RuleRegistry;
  let engine: RuleEngine;

  beforeEach(() => {
    registry = new RuleRegistry();
    engine = new RuleEngine(registry, [], {
      ruleTimeoutMs: 5_000,
      maxConcurrency: 1,
      failFast: false,
    });
  });

  // ── execute with no rules ──

  it("should return valid report when no rules registered", async () => {
    const report = await engine.execute();
    expect(report.valid).toBe(true);
    expect(report.totalRules).toBe(0);
    expect(report.errors).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });

  // ── execute with rules but no components ──

  it("should return valid report when rules have no matching components", async () => {
    const rule = createRule("test/rule-1", "style", "error", "Test rule", "TEST_001");
    registry.register(rule);
    const report = await engine.execute();
    expect(report.valid).toBe(true);
    expect(report.totalRules).toBe(0);
  });

  // ── execute with passing component ──

  it("should return valid report when all rules pass", async () => {
    const rule = createRule("test/pass-rule", "style", "error", "Always passes", "PASS_001");
    registry.register(rule);

    const passingComponent: PolicyValidatorComponent = {
      name: "PassingComponent",
      ruleId: "test/pass-rule",
      async validate(filePath: string, _content: string): Promise<PolicyRuleResult | null> {
        return {
          ruleId: "test/pass-rule",
          severity: "error",
          passed: true,
          code: "PASS_001",
          filePath,
          rule,
        };
      },
    };

    engine = new RuleEngine(registry, [passingComponent]);
    const report = await engine.executeOnFiles(["test.ts"]);
    expect(report.valid).toBe(true);
    expect(report.passedRules).toBe(1);
    expect(report.failedRules).toBe(0);
  });

  // ── execute with failing component ──

  it("should return invalid report when a rule fails", async () => {
    const rule = createRule("test/fail-rule", "style", "error", "Always fails", "FAIL_001");
    registry.register(rule);

    const failingComponent: PolicyValidatorComponent = {
      name: "FailingComponent",
      ruleId: "test/fail-rule",
      async validate(filePath: string, _content: string): Promise<PolicyRuleResult | null> {
        return {
          ruleId: "test/fail-rule",
          severity: "error",
          passed: false,
          message: "Intentional failure",
          code: "FAIL_001",
          filePath,
          rule,
        };
      },
    };

    engine = new RuleEngine(registry, [failingComponent]);
    const report = await engine.executeOnFiles(["test.ts"]);
    expect(report.valid).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(report.failedRules).toBe(1);
    expect(report.errors[0].message).toBe("Intentional failure");
  });

  // ── warning does not invalidate ──

  it("should still be valid with only warnings", async () => {
    const rule = createRule("test/warn-rule", "style", "warning", "Always warns", "WARN_001");
    registry.register(rule);

    const warningComponent: PolicyValidatorComponent = {
      name: "WarningComponent",
      ruleId: "test/warn-rule",
      async validate(filePath: string, _content: string): Promise<PolicyRuleResult | null> {
        return {
          ruleId: "test/warn-rule",
          severity: "warning",
          passed: false,
          message: "This is a warning",
          code: "WARN_001",
          filePath,
          rule,
        };
      },
    };

    engine = new RuleEngine(registry, [warningComponent]);
    const report = await engine.executeOnFiles(["test.ts"]);
    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.warnings).toHaveLength(1);
  });

  // ── event emission ──

  it("should emit engine-start and engine-end events", async () => {
    const rule = createRule("test/event-rule", "style", "error", "Event test", "EVT_001");
    registry.register(rule);

    const component: PolicyValidatorComponent = {
      name: "EventComponent",
      ruleId: "test/event-rule",
      async validate(filePath: string, _content: string): Promise<PolicyRuleResult | null> {
        return {
          ruleId: "test/event-rule",
          severity: "error",
          passed: true,
          code: "EVT_001",
          filePath,
          rule,
        };
      },
    };

    engine = new RuleEngine(registry, [component]);
    const events: string[] = [];

    engine.on("engine-start", () => { events.push("start"); });
    engine.on("engine-end", () => { events.push("end"); });

    await engine.executeOnFiles(["test.ts"]);
    expect(events).toContain("start");
    expect(events).toContain("end");
  });

  // ── failFast ──

  it("should stop after first error when failFast is true", async () => {
    const rule1 = createRule("test/fail-1", "style", "error", "Fails", "F1");
    const rule2 = createRule("test/fail-2", "style", "error", "Also fails", "F2");
    registry.bulkRegister([rule1, rule2]);

    const failComponent1: PolicyValidatorComponent = {
      name: "Fail1",
      ruleId: "test/fail-1",
      async validate(filePath: string, _content: string): Promise<PolicyRuleResult | null> {
        return {
          ruleId: "test/fail-1",
          severity: "error",
          passed: false,
          message: "Error 1",
          code: "F1",
          filePath,
          rule: rule1,
        };
      },
    };

    const failComponent2: PolicyValidatorComponent = {
      name: "Fail2",
      ruleId: "test/fail-2",
      async validate(filePath: string, _content: string): Promise<PolicyRuleResult | null> {
        return {
          ruleId: "test/fail-2",
          severity: "error",
          passed: false,
          message: "Error 2",
          code: "F2",
          filePath,
          rule: rule2,
        };
      },
    };

    engine = new RuleEngine(registry, [failComponent1, failComponent2], {
      failFast: true,
    });

    const report = await engine.executeOnFiles(["test.ts"]);
    // Only first error due to failFast
    expect(report.errors.length).toBeLessThanOrEqual(1);
    expect(report.valid).toBe(false);
  });

  // ── component returns null (rule not applicable) ──

  it("should skip rules when component returns null", async () => {
    const rule = createRule("test/null-rule", "style", "error", "Returns null", "NULL_001");
    registry.register(rule);

    const nullComponent: PolicyValidatorComponent = {
      name: "NullComponent",
      ruleId: "test/null-rule",
      async validate(_filePath: string, _content: string): Promise<PolicyRuleResult | null> {
        return null;
      },
    };

    engine = new RuleEngine(registry, [nullComponent]);
    const report = await engine.executeOnFiles(["test.ts"]);
    expect(report.valid).toBe(true);
    expect(report.totalRules).toBe(0);
  });

  // ── config management ──

  it("should update config at runtime", () => {
    engine.updateConfig({ ruleTimeoutMs: 10_000, verbose: true });
    const config = engine.getConfig();
    expect(config.ruleTimeoutMs).toBe(10_000);
    expect(config.verbose).toBe(true);
  });

  it("should have sensible defaults", () => {
    const defaultEngine = new RuleEngine(registry);
    const config = defaultEngine.getConfig();
    expect(config.ruleTimeoutMs).toBe(30_000);
    expect(config.maxConcurrency).toBe(4);
    expect(config.failFast).toBe(false);
    expect(config.enableCache).toBe(true);
  });
});
