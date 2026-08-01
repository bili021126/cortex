// @ci: unit
/**
 * @cortex/context-manager — ContextManager 行为契约测试
 *
 * 验证 ContextManager.resolve() 在不同场景下的返回结构正确性：
 *   1. 已知场景精确命中
 *   2. 未知场景回退到 "single-step"
 *   3. 空注册表兜底
 */
import { describe, it, expect } from "vitest";
import { ConfigRegistry } from "@cortex/config";
import { ContextManager } from "../../src/context-manager.js";
/** 创建一个预注册了测试策略的 ContextManager */
function createManagerWithPolicies(): ContextManager {
  const registry = new ConfigRegistry();
  registry.register({
    name: "context-policies",
    fileName: "context-policies.json",
    required: false,
    description: "test",
    defaults: {
      "code-review": {
        id: "code-review",
        tokenBudget: { critical: 8000, support: 4000, reference: 2000 },
        retrieval: { mode: "CSA", weighting: { recency: 0.7, relevance: 0.3 } },
        pipeline: { assemble: "weighted", sort: "recency" },
      },
      "single-step": {
        id: "single-step",
        tokenBudget: { critical: 4000, support: 2000, reference: 1000 },
        retrieval: { mode: "HCA", weighting: {} },
        pipeline: { assemble: "default", sort: "default" },
      },
      chat: {
        id: "chat",
        tokenBudget: { critical: 2000, support: 1000, reference: 500 },
        retrieval: { mode: "HCA", weighting: { recency: 1.0 } },
        pipeline: { assemble: "default", sort: "recency" },
      },
    },
  });
  return new ContextManager(registry);
}

/** 创建注册了空 policies 的 ContextManager（注册表存在但无策略） */
function createManagerEmptyPolicies(): ContextManager {
  const registry = new ConfigRegistry();
  registry.register({
    name: "context-policies",
    fileName: "context-policies.json",
    required: false,
    description: "test",
    defaults: {},
  });
  return new ContextManager(registry);
}

// ── 1. 基本解析 ────────────────────────────────────

describe("ContextManager contract", () => {
  it("should resolve context for a known scene", () => {
    const manager = createManagerWithPolicies();
    const result = manager.resolve({ scene: "code-review" });

    expect(result).toBeDefined();
    expect(result.policyId).toBe("code-review");
  });

  it("should return default policy when scene not found", () => {
    const manager = createManagerWithPolicies();
    const result = manager.resolve({ scene: "nonexistent-scene" });

    expect(result).toBeDefined();
    // 回退到 "single-step" 策略
    expect(result.policyId).toBe("single-step");
  });

  it("should include token budget in resolved context", () => {
    const manager = createManagerWithPolicies();
    const result = manager.resolve({ scene: "chat" });

    expect(result.tokenBudget).toBeDefined();
    expect(result.tokenBudget.critical).toBeGreaterThan(0);
    expect(result.tokenBudget.support).toBeGreaterThan(0);
    expect(result.tokenBudget.reference).toBeGreaterThanOrEqual(0);
  });

  it("should include retrieval config in resolved context", () => {
    const manager = createManagerWithPolicies();
    const result = manager.resolve({ scene: "code-review" });

    expect(result.retrieval).toBeDefined();
    expect(["HCA", "CSA"]).toContain(result.retrieval.mode);
    expect(result.retrieval.weighting).toBeDefined();
  });

  it("should include pipeline config in resolved context", () => {
    const manager = createManagerWithPolicies();
    const result = manager.resolve({ scene: "chat" });

    expect(result.pipeline).toBeDefined();
    expect(typeof result.pipeline.assemble).toBe("string");
    expect(typeof result.pipeline.sort).toBe("string");
  });

  it("should include reason in resolved context", () => {
    const manager = createManagerWithPolicies();
    const result = manager.resolve({ scene: "code-review", persona: "cyrene" });

    expect(result.reason).toBeDefined();
    expect(result.reason).toContain("scene:code-review");
    expect(result.reason).toContain("persona:cyrene");
  });

  // ── 2. 边界 ──────────────────────────────────────

  it("should handle empty scene gracefully", () => {
    const manager = createManagerWithPolicies();
    // 空字符串场景应回退到 single-step
    const result = manager.resolve({ scene: "" });

    expect(result).toBeDefined();
    expect(result.policyId).toBe("single-step");
  });

  it("should handle unknown persona gracefully", () => {
    const manager = createManagerWithPolicies();
    const result = manager.resolve({
      scene: "code-review",
      persona: "unknown-persona",
    });

    expect(result).toBeDefined();
    expect(result.policyId).toBe("code-review");
    // persona 出现在 reason 中
    expect(result.reason).toContain("unknown-persona");
  });

  it("should handle task with no tags", () => {
    const manager = createManagerWithPolicies();
    const result = manager.resolve({
      scene: "code-review",
      task: { type: "review", tags: [] },
    });

    expect(result).toBeDefined();
    expect(result.policyId).toBe("code-review");
  });

  // ── 3. 空注册表兜底 ──────────────────────────────

  it("should fallback to default when no policies registered", () => {
    const manager = createManagerEmptyPolicies();
    const result = manager.resolve({ scene: "anything" });

    expect(result).toBeDefined();
    expect(result.policyId).toBe("single-step");
    expect(result.tokenBudget.critical).toBe(4000);
    expect(result.retrieval.mode).toBe("HCA");
    expect(result.pipeline.assemble).toBe("default");
    expect(result.reason).toContain("fallback");
  });
});
