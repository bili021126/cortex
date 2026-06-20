// @ci: unit
import { describe, it, expect, vi } from "vitest";
import type { TaskNode } from "@cortex/shared";
import type { IModelRouter } from "@cortex/scheduler";
import { TaskRouter } from "@cortex/engine";
import type { RouteDecision } from "@cortex/engine";

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

/** 构造 Mock IModelRouter */
function mockModelRouter(model = "gpt-4o"): IModelRouter {
  return {
    name: "mock",
    route: vi.fn().mockResolvedValue(model),
  };
}

describe("TaskRouter", () => {
  describe("route() 路由决策", () => {
    it("MetaAgent 已设 preferredStrategy → 直接使用", async () => {
      const router = new TaskRouter(mockModelRouter(), "gpt-4o");
      const node = makeNode({ preferredStrategy: "direct" });

      const decision: RouteDecision = await router.route(node, "code");

      expect(decision.strategy).toBe("direct");
      expect(decision.strategySource).toBe("meta-agent");
      expect(decision.nodeId).toBe("test-node-1");
    });

    it("无 preferredStrategy + 规则匹配 → 使用规则路由", async () => {
      const router = new TaskRouter(mockModelRouter(), "gpt-4o");
      const node = makeNode({
        payload: "分类这段文本", // < 200 字 + 无工具依赖 → direct
        tags: [],
      });

      const decision = await router.route(node, "code");

      expect(decision.strategy).toBe("direct");
      expect(decision.strategySource).toBe("rule-routing");
    });

    it("无 preferredStrategy + 无规则匹配 → fallback react", async () => {
      const router = new TaskRouter(mockModelRouter(), "gpt-4o");
      const node = makeNode({
        payload: "A".repeat(201), // 超过 direct 长度
        tags: ["implementation"], // 非 decompose/jury 标签
        needsMultiPerspective: false,
      });

      const decision = await router.route(node, "code");

      expect(decision.strategy).toBe("react");
      expect(decision.strategySource).toBe("fallback");
    });

    it("模型选择委托给 IModelRouter", async () => {
      const modelRouter = mockModelRouter("claude-3.5-sonnet");
      const router = new TaskRouter(modelRouter, "gpt-4o");
      const node = makeNode();

      const decision = await router.route(node, "review");

      expect(decision.model).toBe("claude-3.5-sonnet");
      expect(modelRouter.route).toHaveBeenCalledWith(node, "review", "gpt-4o");
    });

    it("recommendedTier 已设 → modelSource 标记为 recommended", async () => {
      const router = new TaskRouter(mockModelRouter(), "gpt-4o");
      const node = makeNode({ recommendedTier: "fast" });

      const decision = await router.route(node, "code");

      expect(decision.modelSource).toBe("recommended");
    });

    it("无 recommendedTier + 模型非默认 → modelSource 标记为 classifier", async () => {
      const modelRouter = mockModelRouter("gpt-4o-mini"); // 非默认模型
      const router = new TaskRouter(modelRouter, "gpt-4o");
      const node = makeNode();

      const decision = await router.route(node, "code");

      expect(decision.modelSource).toBe("classifier");
    });

    it("无 recommendedTier + 模型为默认 → modelSource 标记为 fallback", async () => {
      const modelRouter = mockModelRouter("gpt-4o"); // 等于默认模型
      const router = new TaskRouter(modelRouter, "gpt-4o");
      const node = makeNode();

      const decision = await router.route(node, "code");

      expect(decision.modelSource).toBe("fallback");
    });

    it("应包含 durationMs 计时", async () => {
      const router = new TaskRouter(mockModelRouter(), "gpt-4o");
      const node = makeNode();

      const decision = await router.route(node, "code");

      expect(decision.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("routeBatch() 批量路由", () => {
    it("应为多个节点并行计算路由决策", async () => {
      const router = new TaskRouter(mockModelRouter(), "gpt-4o");
      const nodes = [
        makeNode({ id: "n1", preferredStrategy: "direct" }),
        makeNode({ id: "n2", preferredStrategy: "react" }),
        makeNode({ id: "n3" }),
      ];

      const decisions = await router.routeBatch(nodes, "code");

      expect(decisions.size).toBe(3);
      expect(decisions.get("n1")!.strategy).toBe("direct");
      expect(decisions.get("n2")!.strategy).toBe("react");
      expect(decisions.get("n3")).toBeDefined();
    });

    it("空节点列表 → 返回空 Map", async () => {
      const router = new TaskRouter(mockModelRouter(), "gpt-4o");
      const decisions = await router.routeBatch([], "code");
      expect(decisions.size).toBe(0);
    });
  });
});
