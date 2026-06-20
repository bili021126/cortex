// @ci: unit
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskNode } from "@cortex/shared";
import { EnvironmentAwareRouter } from "@cortex/engine";
import type { ModelHealth } from "@cortex/engine";

/** 构造测试用 TaskNode */
function makeNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "test-node-1",
    type: "implementation",
    tags: ["implementation"],
    needsMultiPerspective: false,
    status: "pending",
    claimedBy: [],
    payload: "Implement feature X",
    results: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("EnvironmentAwareRouter", () => {
  let router: EnvironmentAwareRouter;

  beforeEach(() => {
    router = new EnvironmentAwareRouter({
      modelPriority: ["gpt-4o", "claude-3.5-sonnet", "gpt-4o-mini"],
      fallbackStrategy: "next-in-priority",
      healthCheckCooldownMs: 1000,
      failureThreshold: 3,
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("resolve() 模型解析", () => {
    it("首选模型可用 → 直接返回", async () => {
      const node = makeNode();
      const result = await router.resolve("gpt-4o", node);
      expect(result).toBe("gpt-4o");
    });

    it("首选模型不可用 → 降级到下一个优先级模型", async () => {
      // 使 gpt-4o 连续失败 3 次 → 标记为不可用
      router.reportFailure("gpt-4o");
      router.reportFailure("gpt-4o");
      router.reportFailure("gpt-4o");

      const node = makeNode();
      const result = await router.resolve("gpt-4o", node);
      expect(result).toBe("claude-3.5-sonnet");
    });

    it("连续失败恢复后重试首选模型", async () => {
      router.reportFailure("gpt-4o");
      router.reportFailure("gpt-4o");
      router.reportFailure("gpt-4o");

      // 模拟成功恢复
      router.reportSuccess("gpt-4o", 100);

      const node = makeNode();
      const result = await router.resolve("gpt-4o", node);
      expect(result).toBe("gpt-4o");
    });

    it("未知模型 → 视为可用", async () => {
      const node = makeNode();
      const result = await router.resolve("unknown-model", node);
      expect(result).toBe("unknown-model");
    });
  });

  describe("reportSuccess() 成功上报", () => {
    it("重置连续失败计数", () => {
      router.reportFailure("gpt-4o");
      router.reportFailure("gpt-4o");
      router.reportSuccess("gpt-4o", 500);

      const health = router.getHealthSnapshot();
      const gpt4o = health.find((h) => h.model === "gpt-4o");
      expect(gpt4o!.consecutiveFailures).toBe(0);
      expect(gpt4o!.available).toBe(true);
    });

    it("更新平均延迟", () => {
      router.reportSuccess("gpt-4o", 100);
      router.reportSuccess("gpt-4o", 200);

      const health = router.getHealthSnapshot();
      const gpt4o = health.find((h) => h.model === "gpt-4o");
      expect(gpt4o!.avgLatencyMs).toBeDefined();
    });
  });

  describe("reportFailure() 失败上报", () => {
    it("累计连续失败次数", () => {
      router.reportFailure("gpt-4o");
      router.reportFailure("gpt-4o");

      const health = router.getHealthSnapshot();
      const gpt4o = health.find((h) => h.model === "gpt-4o");
      expect(gpt4o!.consecutiveFailures).toBe(2);
    });

    it("达到阈值后标记为不可用", () => {
      router.reportFailure("gpt-4o");
      router.reportFailure("gpt-4o");
      router.reportFailure("gpt-4o");

      const health = router.getHealthSnapshot();
      const gpt4o = health.find((h) => h.model === "gpt-4o");
      expect(gpt4o!.available).toBe(false);
    });
  });

  describe("getHealthSnapshot() 健康快照", () => {
    it("返回所有模型的健康状态", () => {
      const health = router.getHealthSnapshot();
      expect(health).toHaveLength(3);
      expect(health.map((h) => h.model)).toEqual([
        "gpt-4o",
        "claude-3.5-sonnet",
        "gpt-4o-mini",
      ]);
    });

    it("返回深拷贝（不影响内部状态）", () => {
      const health1 = router.getHealthSnapshot();
      health1[0].available = false; // 修改副本

      const health2 = router.getHealthSnapshot();
      expect(health2[0].available).toBe(true); // 原状态不变
    });
  });

  describe("降级策略", () => {
    it("next-in-priority：按优先级列表顺序降级", async () => {
      router.reportFailure("gpt-4o");
      router.reportFailure("gpt-4o");
      router.reportFailure("gpt-4o");

      const node = makeNode();
      const result = await router.resolve("gpt-4o", node);
      expect(result).toBe("claude-3.5-sonnet");
    });

    it("所有模型不可用 → 强制使用首选模型", async () => {
      // 使所有模型不可用
      for (const model of ["gpt-4o", "claude-3.5-sonnet", "gpt-4o-mini"]) {
        router.reportFailure(model);
        router.reportFailure(model);
        router.reportFailure(model);
      }

      const node = makeNode();
      const result = await router.resolve("gpt-4o", node);
      expect(result).toBe("gpt-4o"); // 强制重试
    });
  });
});
