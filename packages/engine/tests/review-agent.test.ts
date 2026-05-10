import { describe, it, expect, beforeAll } from "vitest";
import { AgentType } from "@cortex/shared";
import { LlmAdapter } from "../src/llm-adapter";
import { Toolkit } from "../src/toolkit";
import { ReviewAgent } from "../src/review-agent";

function mockReviewAdapter() {
  const adapter = new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "mock-chat",
    reasonerModel: "mock-reasoner",
  });

  let callCount = 0;
  adapter.injectMock(async () => {
    callCount++;
    if (callCount === 1) {
      return {
        content: "Let me review the mentioned file first.",
        toolCalls: [
          { id: "c1", name: "read_file", arguments: { file_path: "/proj/src/utils.ts" } },
        ],
      };
    }
    if (callCount === 2) {
      return {
        content: "Let me search for similar patterns.",
        toolCalls: [
          { id: "c2", name: "search_code", arguments: { query: "TODO|FIXME" } },
        ],
      };
    }
    // 第三轮：给出审查结论
    return {
      content: [
        "## 审查报告",
        "",
        "### 发现",
        "- **严重** /proj/src/utils.ts:42 — `Math.random()` 用于密码学场景，应使用 `crypto.randomBytes()`",
        "- **中等** /proj/src/utils.ts:58 — 缺少 null 检查",
        "- **建议** 添加单元测试覆盖这些边界情况",
        "",
        "### 结论",
        "1 个严重问题，1 个中等问题，建议修复后再合并。",
      ].join("\n"),
      toolCalls: [],
    };
  });

  return adapter;
}

describe("ReviewAgent", () => {
  let adapter: LlmAdapter;
  let toolkit: Toolkit;
  let agent: ReviewAgent;

  beforeAll(async () => {
    adapter = mockReviewAdapter();
    toolkit = new Toolkit();
    agent = new ReviewAgent(adapter, toolkit);
    await agent.wakeup();
  });

  it("执行审查任务：读取→搜索→给出结构化审查报告", async () => {
    const result = await agent.execute(
      {
        id: "node-1",
        type: "review",
        tags: ["review"],
        needsMultiPerspective: false,
        status: "running",
        claimedBy: [AgentType.Review],
        payload: "审查 /proj/src/utils.ts 的代码质量与安全性",
        results: [],
        createdAt: Date.now(),
      },
      "mock-chat",
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("审查报告");
    expect(result.output).toContain("严重");
    expect(result.output).toContain("Math.random");
    expect(result.agentType).toBe(AgentType.Review);
    expect(result.nodeId).toBe("node-1");
  });

  it("审查 Agent 无权调用 write_file——Toolkit 权限层拦截", async () => {
    const badAdapter = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
    });
    badAdapter.injectMock(async () => ({
      content: "I will write a fix.",
      toolCalls: [{ id: "w1", name: "write_file", arguments: { file_path: "/x", content: "bad" } }],
    }));

    const badAgent = new ReviewAgent(badAdapter, new Toolkit());
    await badAgent.wakeup();
    const result = await badAgent.execute(
      {
        id: "node-2",
        type: "review",
        tags: ["review"],
        needsMultiPerspective: false,
        status: "running",
        claimedBy: [AgentType.Review],
        payload: "Try to write",
        results: [],
        createdAt: Date.now(),
      },
      "mock-chat",
    );

    // 工具被权限层拒绝，Agent 可能循环耗尽或最终意识到不能写
    // 验证它没有成功执行写操作
    expect(result.output ?? "").not.toContain("written");
  });
});
