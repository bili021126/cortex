// @ci: contract
/**
 * Phase 2 P0 contract test: plan() → TaskNode[] shape.
 *
 * _toTaskNode 中 13 个字段有 8 个含隐式默认值/推导逻辑：
 *   type, tags, needsMultiPerspective, status, reasoningEffort,
 *   contextPolicyId, recommendedTier, 以及 _parsePlan 容错链。
 *
 * Scheduler 5 个消费点依赖这些字段——变更需通知。
 */

import { describe, it, expect } from "vitest";
import { LlmAdapter } from "@cortex/llm";
import { MetaAgent } from "@cortex/engine";

// ─── helpers ─────────────────────────────────

function mockLlmReturn(items: unknown[]): LlmAdapter {
  const adapter = new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "mock-chat",
    reasonerModel: "mock-reasoner",
  });
  adapter.injectMock(async () => ({
    content: JSON.stringify(items),
    toolCalls: [],
  }));
  return adapter;
}

function mockLlmRaw(raw: string): LlmAdapter {
  const adapter = new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "mock-chat",
    reasonerModel: "mock-reasoner",
  });
  adapter.injectMock(async () => ({
    content: raw,
    toolCalls: [],
  }));
  return adapter;
}

// ─── 核心契约 ────────────────────────────────

describe("plan() → TaskNode[] shape 契约", () => {
  // ═══════════════════════════════════════════════
  // Test 1: _toTaskNode 字段默认值契约
  // ═══════════════════════════════════════════════
  describe("_toTaskNode 字段默认值", () => {
    it("type 默认 analysis", async () => {
      // item.type === undefined → "analysis"
      const meta = new MetaAgent(mockLlmReturn([{ task: "do something" }]));
      const [node] = await meta.plan("test");
      expect(node.type).toBe("analysis");

      // 显式指定 type → 保留
      const meta2 = new MetaAgent(mockLlmReturn([{ task: "review code", type: "review" }]));
      const [node2] = await meta2.plan("test");
      expect(node2.type).toBe("review");
    });

    it("tags 默认 ['code']", async () => {
      // item.tags === undefined → ["code"]
      const meta = new MetaAgent(mockLlmReturn([{ task: "do something" }]));
      const [node] = await meta.plan("test");
      expect(node.tags).toEqual(["code"]);

      // 显式指定 tags → 保留
      const meta2 = new MetaAgent(mockLlmReturn([{ task: "audit", tags: ["audit", "security"] }]));
      const [node2] = await meta2.plan("test");
      expect(node2.tags).toEqual(["audit", "security"]);
    });

    it("needsMultiPerspective 默认 false", async () => {
      // item.needsMultiPerspective === undefined → false
      const meta = new MetaAgent(mockLlmReturn([{ task: "do something" }]));
      const [node] = await meta.plan("test");
      expect(node.needsMultiPerspective).toBe(false);

      // 显式指定 true → 保留
      const meta2 = new MetaAgent(mockLlmReturn([{ task: "review", needsMultiPerspective: true }]));
      const [node2] = await meta2.plan("test");
      expect(node2.needsMultiPerspective).toBe(true);
    });

    it("status 始终硬编码为 pending", async () => {
      // LLM 无法覆盖 status
      const meta = new MetaAgent(mockLlmReturn([{ task: "test" }]));
      const [node] = await meta.plan("test");
      expect(node.status).toBe("pending");

      // 即使 item 带 status 字段也忽略（PlanItem 无 status 字段）
      const meta2 = new MetaAgent(mockLlmReturn([{ task: "test" }]));
      const [node2] = await meta2.plan("test");
      expect(node2.status).toBe("pending");
    });

    it("reasoningEffort 无 audit 标签时默认 high", async () => {
      // 无 reasoningEffort + 无 audit 标签 → "high"
      const meta = new MetaAgent(mockLlmReturn([{ task: "write code", tags: ["code"] }]));
      const [node] = await meta.plan("test");
      expect(node.reasoningEffort).toBe("high");

      // 显式指定 reasoningEffort 覆盖 → "max"
      const meta2 = new MetaAgent(
        mockLlmReturn([{ task: "write code", tags: ["code"], reasoningEffort: "max" }]),
      );
      const [node2] = await meta2.plan("test");
      expect(node2.reasoningEffort).toBe("max");
    });

    it("reasoningEffort 含 audit 标签时默认 max", async () => {
      // 无 reasoningEffort + tags 含 audit → "max"
      const meta = new MetaAgent(mockLlmReturn([{ task: "security audit", tags: ["audit"] }]));
      const [node] = await meta.plan("test");
      expect(node.reasoningEffort).toBe("max");

      // constitution_check 标签也触发 max
      const meta2 = new MetaAgent(
        mockLlmReturn([{ task: "check constitution", tags: ["constitution_check"] }]),
      );
      const [node2] = await meta2.plan("test");
      expect(node2.reasoningEffort).toBe("max");

      // 显式指定 reasoningEffort="high" 覆盖
      const meta3 = new MetaAgent(
        mockLlmReturn([{ task: "audit", tags: ["audit"], reasoningEffort: "high" }]),
      );
      const [node3] = await meta3.plan("test");
      expect(node3.reasoningEffort).toBe("high");
    });
  });

  // ═══════════════════════════════════════════════
  // Test 2: _parsePlan 容错链
  // ═══════════════════════════════════════════════
  describe("_parsePlan 容错链", () => {
    it("干净 JSON 直接解析", async () => {
      const meta = new MetaAgent(
        mockLlmRaw('[{"task":"clean task","type":"analysis"}]'),
      );
      const nodes = await meta.plan("test");
      expect(nodes.length).toBe(1);
      expect(nodes[0].payload).toBe("clean task");
    });

    it("markdown ```json 块提取 + 解析", async () => {
      const meta = new MetaAgent(
        mockLlmRaw([
          "Here's the plan:",
          "```json",
          '[{"task":"extracted from json block","type":"review"}]',
          "```",
          "Let me know if you need changes.",
        ].join("\n")),
      );
      const nodes = await meta.plan("test");
      expect(nodes.length).toBe(1);
      expect(nodes[0].payload).toBe("extracted from json block");
      expect(nodes[0].type).toBe("review");
    });

    it("尾部逗号修复", async () => {
      // LLM 经典错误：数组最后一个元素后有多余逗号
      const meta = new MetaAgent(
        mockLlmRaw('[{"task":"trailing comma","type":"analysis"},]'),
      );
      const nodes = await meta.plan("test");
      expect(nodes.length).toBe(1);
      expect(nodes[0].payload).toBe("trailing comma");
    });

    it("截取 [ → ] 区间", async () => {
      // LLM 输出包含前缀和后缀文本
      const meta = new MetaAgent(
        mockLlmRaw(
          "Before text\n[{\"task\":\"bracket extraction\",\"type\":\"refactor\"}]\nAfter text",
        ),
      );
      const nodes = await meta.plan("test");
      expect(nodes.length).toBe(1);
      expect(nodes[0].payload).toBe("bracket extraction");
      expect(nodes[0].type).toBe("refactor");
    });

    it("全部失败 → fallbackNode", async () => {
      const meta = new MetaAgent(mockLlmRaw("This is completely invalid output"));
      const nodes = await meta.plan("test");
      expect(nodes.length).toBe(1);
      expect(nodes[0].type).toBe("analysis");
      expect(nodes[0].tags).toEqual(["analysis"]);
    });
  });

  // ═══════════════════════════════════════════════
  // Test 3: fallbackNode shape 差异
  // ═══════════════════════════════════════════════
  describe("fallbackNode shape 差异", () => {
    it("type=analysis tags=['analysis'] contextPolicyId='diagnose' payload=raw", async () => {
      const raw = "fallback test raw content";
      const meta = new MetaAgent(mockLlmRaw(raw));
      const nodes = await meta.plan("test");
      expect(nodes.length).toBe(1);
      expect(nodes[0].type).toBe("analysis");
      expect(nodes[0].tags).toEqual(["analysis"]);
      expect(nodes[0].contextPolicyId).toBe("diagnose");
      expect(nodes[0].payload).toBe(raw);
      // 其他关键字段
      expect(nodes[0].needsMultiPerspective).toBe(false);
      expect(nodes[0].status).toBe("pending");
    });
  });

  // ═══════════════════════════════════════════════
  // Test 4: 空数组路径
  // ═══════════════════════════════════════════════
  describe("空数组路径", () => {
    it("LLM 返回 [] → plan() 返回 [] 而非 fallbackNode", async () => {
      const meta = new MetaAgent(mockLlmReturn([]));
      const nodes = await meta.plan("test");
      expect(nodes).toEqual([]);
    });

    it("LLM 返回带空格的 [] → plan() 返回 []", async () => {
      const meta = new MetaAgent(mockLlmRaw("  []  "));
      const nodes = await meta.plan("test");
      expect(nodes).toEqual([]);
    });

    it("LLM 返回空数组带前缀文本 → plan() 返回 []", async () => {
      const meta = new MetaAgent(
        mockLlmRaw("No tasks needed.\n[]\n"),
      );
      const nodes = await meta.plan("test");
      expect(nodes).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════
  // Test 5: contextPolicyId 匹配规则表
  // ═══════════════════════════════════════════════
  describe("contextPolicyId 匹配规则表", () => {
    it("type 命中预设 → 返回 type 自身（如 type=diagnose → 'diagnose'）", async () => {
      // PRESET_CONTEXT_POLICIES 包含 diagnose
      const meta = new MetaAgent(
        mockLlmReturn([{ task: "diagnose bug", type: "diagnose", tags: [] }]),
      );
      const [node] = await meta.plan("test");
      expect(node.contextPolicyId).toBe("diagnose");
    });

    it("tags 含 audit → 'architecture-review'", async () => {
      const meta = new MetaAgent(
        mockLlmReturn([{ task: "security check", tags: ["audit"] }]),
      );
      const [node] = await meta.plan("test");
      expect(node.contextPolicyId).toBe("architecture-review");
    });

    it("tags 含 debug → 'diagnose'", async () => {
      const meta = new MetaAgent(
        mockLlmReturn([{ task: "fix crash", tags: ["debug"] }]),
      );
      const [node] = await meta.plan("test");
      expect(node.contextPolicyId).toBe("diagnose");
    });

    it("tags 含 code → 'code-refactor'", async () => {
      const meta = new MetaAgent(
        mockLlmReturn([{ task: "refactor module", tags: ["code"] }]),
      );
      const [node] = await meta.plan("test");
      expect(node.contextPolicyId).toBe("code-refactor");
    });

    it("无特征 → 'single-step'", async () => {
      const meta = new MetaAgent(
        mockLlmReturn([{ task: "simple task", type: "custom", tags: ["misc"] }]),
      );
      const [node] = await meta.plan("test");
      // "custom" 不在 PRESET_CONTEXT_POLICIES 中，tags 无特征匹配 → single-step
      expect(node.contextPolicyId).toBe("single-step");
    });
  });

  // ═══════════════════════════════════════════════
  // Test 6: recommendedTier 静默过滤
  // ═══════════════════════════════════════════════
  describe("recommendedTier 静默过滤", () => {
    it.each([
      { tier: "fast", expectDefined: true },
      { tier: "standard", expectDefined: true },
      { tier: "thinking", expectDefined: true },
      { tier: "deep", expectDefined: false },
      { tier: "high", expectDefined: false },
      { tier: "", expectDefined: false },
    ])("$tier → $expectDefined", async ({ tier, expectDefined }) => {
      const item: Record<string, unknown> = { task: "test", type: "analysis" };
      if (tier) {
        item.recommendedTier = tier;
      }
      const meta = new MetaAgent(mockLlmReturn([item]));
      const [node] = await meta.plan("test");
      if (expectDefined) {
        expect(node.recommendedTier).toBe(tier);
      } else {
        expect(node.recommendedTier).toBeUndefined();
      }
    });
  });
});
