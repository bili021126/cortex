// @ci: unit
import { describe, it, expect, beforeAll } from "vitest";
import { AgentType, type Agent } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { Toolkit } from "../src/toolkit";
import { createAgent } from "../src/components/agent-factory";
import { codeAgentConfig } from "../src/agents/code-agent";

function mockLlamaAdapter() {
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
        content: "Let me read the target file first.",
        toolCalls: [
          { id: "c1", name: "read_file", arguments: { file_path: "/proj/src/app.ts" } },
        ],
      };
    }
    if (callCount === 2) {
      return {
        content: "Now I will apply the fix.",
        toolCalls: [
          { id: "c2", name: "write_file", arguments: { file_path: "/proj/src/app.ts", content: "fixed" } },
        ],
      };
    }
    return {
      content: "任务完成：已修改 /proj/src/app.ts，添加了缺失的 import 语句。",
      toolCalls: [],
    };
  });

  return adapter;
}

describe("CodeAgent", () => {
  let adapter: LlmAdapter;
  let toolkit: Toolkit;
  let agent: Agent;

  beforeAll(async () => {
    adapter = mockLlamaAdapter();
    toolkit = new Toolkit();
    agent = createAgent(codeAgentConfig(), adapter, toolkit);
    await agent.wakeup();
  });

  it("执行实现任务：读取→写入→给出最终答案", async () => {
    const result = await agent.execute(
      {
        id: "node-1",
        type: "implementation",
        tags: ["implementation"],
        needsMultiPerspective: false,
        status: "running",
        claimedBy: [AgentType.Code],
        payload: "修复 /proj/src/app.ts 中缺失的 import 语句",
        results: [],
        createdAt: Date.now(),
      },
      "mock-chat",
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("已修改");
    expect(result.agentType).toBe(AgentType.Code);
    expect(result.nodeId).toBe("node-1");
  });

  it("超过最大循环次数应返回失败", async () => {
    const stuck = new LlmAdapter({
      apiKey: "mock",
      baseUrl: "mock",
      chatModel: "mock-chat",
      reasonerModel: "mock-reasoner",
    });
    stuck.injectMock(async () => ({
      content: "I need to read more...",
      toolCalls: [{ id: "loop", name: "read_file", arguments: { file_path: "/x" } }],
    }));

    const stuckAgent = createAgent(codeAgentConfig(), stuck, new Toolkit());
    await stuckAgent.wakeup();
    const result = await stuckAgent.execute(
      {
        id: "node-2",
        type: "implementation",
        tags: ["implementation"],
        needsMultiPerspective: false,
        status: "running",
        claimedBy: [AgentType.Code],
        payload: "某个永远不会完成的任务",
        results: [],
        createdAt: Date.now(),
      },
      "mock-chat",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Exceeded max loops");
  });

  it("状态机：Created → Awake → Active → Awake", async () => {
    const a = createAgent(codeAgentConfig(), adapter, new Toolkit());
    expect(a.status).toBe("created");

    await a.wakeup();
    expect(a.status).toBe("awake");

    // execute 期间为 active，完成后回到 awake
    const result = await a.execute(
      {
        id: "node-3",
        type: "implementation",
        tags: ["implementation"],
        needsMultiPerspective: false,
        status: "running",
        claimedBy: [AgentType.Code],
        payload: "简单任务",
        results: [],
        createdAt: Date.now(),
      },
      "mock-chat",
    );
    expect(a.status).toBe("awake");
  });
});
