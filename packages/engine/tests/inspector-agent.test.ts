// @ci: llm
import { describe, it, expect, beforeAll } from "vitest";
import { AgentType, AgentStatus } from "@cortex/shared";
import type { Agent } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { Toolkit } from "../src/toolkit";
import { createInspectorAgent } from "../src/agents/inspector-agent";

function mockInspectAdapter() {
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
        content: "Gathering file information...",
        toolCalls: [
          { id: "c1", name: "read_file", arguments: { file_path: "/proj/src/userService.ts" } },
        ],
      };
    }
    if (callCount === 2) {
      return {
        content: "Searching for references...",
        toolCalls: [
          { id: "c2", name: "search_code", arguments: { query: "userService" } },
        ],
      };
    }
    // 第三轮：仅格式化，不调工具，裸输出事实
    return {
      content: [
        "## 事实报告",
        "",
        "- `/proj/src/userService.ts` 导出了 `createUser`, `getUser`, `updateUser` 三个函数",
        "- `userService` 被 14 个文件引用",
        "- 没有发现循环依赖",
        "- `tsc --noEmit` 通过，零类型错误",
      ].join("\n"),
      toolCalls: [],
    };
  });

  return adapter;
}

describe("InspectorAgent", () => {
  let adapter: LlmAdapter;
  let toolkit: Toolkit;
  let agent: Agent & { setWorkspaceRoot?: (root: string) => void };

  beforeAll(async () => {
    adapter = mockInspectAdapter();
    toolkit = new Toolkit();
    agent = createInspectorAgent(adapter, toolkit);
    await agent.wakeup();
  });

  // ── 状态机 ──────────────────────────────────

  it("初始状态为 Created", () => {
    const a = createInspectorAgent(adapter, new Toolkit());
    expect(a.status).toBe(AgentStatus.Created);
    expect(a.type).toBe(AgentType.Inspector);
  });

  it("wakeup → Awake", async () => {
    const a = createInspectorAgent(adapter, new Toolkit());
    await a.wakeup();
    expect(a.status).toBe(AgentStatus.Awake);
  });

  it("execute 期间为 Active，完成后回 Awake", async () => {
    const a = createInspectorAgent(adapter, new Toolkit());
    await a.wakeup();

    const result = await a.execute(
      {
        id: "node-1",
        type: "inspect",
        tags: ["research"],
        needsMultiPerspective: false,
        status: "running",
        claimedBy: [AgentType.Inspector],
        payload: "分析 userService 的依赖关系",
        results: [],
        createdAt: Date.now(),
      },
      "mock-chat",
    );

    expect(result.success).toBe(true);
    expect(a.status).toBe(AgentStatus.Awake);
  });

  it("shutdown → Destroyed", async () => {
    const a = createInspectorAgent(adapter, new Toolkit());
    await a.wakeup();
    await a.shutdown();
    expect(a.status).toBe(AgentStatus.Destroyed);
  });

  // ── 执行验证 ────────────────────────────────

  it("执行检查任务：允许的工具 → 采集 → 输出纯事实报告", async () => {
    const result = await agent.execute(
      {
        id: "node-2",
        type: "inspect",
        tags: ["research"],
        needsMultiPerspective: false,
        status: "running",
        claimedBy: [AgentType.Inspector],
        payload: "分析 userService 的依赖关系",
        results: [],
        createdAt: Date.now(),
      },
      "mock-chat",
    );

    expect(result.success).toBe(true);
    expect(result.agentType).toBe(AgentType.Inspector);
    expect(result.output).toContain("事实报告");
    expect(result.output).toContain("userService");
    expect(result.output).toContain("14 个文件引用");
  });

  it("Inspector 无权调用 write_file——Toolkit 权限层拦截", async () => {
    const badAdapter = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
    });
    badAdapter.injectMock(async () => ({
      content: "Let me write something...",
      toolCalls: [{ id: "w1", name: "write_file", arguments: { file_path: "/x", content: "bad" } }],
    }));

    const badAgent = createInspectorAgent(badAdapter, new Toolkit());
    await badAgent.wakeup();
    const result = await badAgent.execute(
      {
        id: "node-3",
        type: "inspect",
        tags: ["research"],
        needsMultiPerspective: false,
        status: "running",
        claimedBy: [AgentType.Inspector],
        payload: "Try to write",
        results: [],
        createdAt: Date.now(),
      },
      "mock-chat",
    );

    // 工具被权限层拒绝，不应有写操作成功的输出
    expect(result.output ?? "").not.toContain("written");
  });

  it("最多 5 轮循环——超限返回失败", async () => {
    const stuck = new LlmAdapter({
      apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock",
    });
    stuck.injectMock(async () => ({
      content: "Need more data...",
      toolCalls: [{ id: "loop", name: "search_code", arguments: { query: "endless" } }],
    }));

    const stuckAgent = createInspectorAgent(stuck, new Toolkit());
    await stuckAgent.wakeup();
    const result = await stuckAgent.execute(
      {
        id: "node-4",
        type: "inspect",
        tags: ["research"],
        needsMultiPerspective: false,
        status: "running",
        claimedBy: [AgentType.Inspector],
        payload: "永不完成的任务",
        results: [],
        createdAt: Date.now(),
      },
      "mock-chat",
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exceeded/i);
  });

  it("输出不含评价和建议——纯事实格式", async () => {
    // 验证 mock 适配器的输出确实只是事实罗列，不含推断
    const result = await agent.execute(
      {
        id: "node-5",
        type: "inspect",
        tags: ["analysis"],
        needsMultiPerspective: false,
        status: "running",
        claimedBy: [AgentType.Inspector],
        payload: "检查 userService",
        results: [],
        createdAt: Date.now(),
      },
      "mock-chat",
    );

    const output = result.output ?? "";
    // 不应包含建议性词汇
    expect(output).not.toContain("建议");
    expect(output).not.toContain("recommend");
    expect(output).not.toContain("should");
    // 应该是纯事实
    expect(output).toContain("事实报告");
  });
});
