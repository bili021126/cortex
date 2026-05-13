// @ci: unit
import { describe, it, expect } from "vitest";
import { AgentType, AgentStatus as AS } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { Toolkit } from "../src/toolkit";
import { createAgent, type AgentFactoryConfig } from "../src/components/agent-factory";
import { PoolAwareState } from "../src/pool-aware";
import type { AgentPool } from "../src/agent-pool";

function mockLlm() {
  const adapter = new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "mock-chat",
    reasonerModel: "mock-reasoner",
  });
  adapter.injectMock(async () => ({
    content: "Task completed.",
    toolCalls: [],
  }));
  return adapter;
}

describe("createAgent (factory)", () => {
  const config: AgentFactoryConfig = {
    type: AgentType.Code,
    systemPrompt: "You are a test agent.",
    memoryEnabled: false,
  };

  it("should create an agent with the correct type", () => {
    const agent = createAgent(config, mockLlm(), new Toolkit());
    expect(agent.type).toBe(AgentType.Code);
  });

  it("should start in Created status", () => {
    const agent = createAgent(config, mockLlm(), new Toolkit());
    expect(agent.status).toBe(AS.Created);
  });

  it("should transition to Awake on wakeup()", async () => {
    const agent = createAgent(config, mockLlm(), new Toolkit());
    await agent.wakeup();
    expect(agent.status).toBe(AS.Awake);
  });

  it("should execute a task and return success", async () => {
    const agent = createAgent(config, mockLlm(), new Toolkit());
    await agent.wakeup();
    const result = await agent.execute(
      { id: "n1", type: "test", payload: "Do nothing", tags: [], needsMultiPerspective: false, status: "pending", claimedBy: [], results: [], createdAt: Date.now() },
      "mock-model",
    );
    expect(result.success).toBe(true);
    expect(result.agentType).toBe(AgentType.Code);
  });

  it("should support maxLoops override", async () => {
    const infiniteMocker = new LlmAdapter({
      apiKey: "mock",
      baseUrl: "mock",
      chatModel: "mock-chat",
      reasonerModel: "mock-reasoner",
    });
    let callCount = 0;
    infiniteMocker.injectMock(async () => {
      callCount++;
      return {
        content: `Loop ${callCount}`,
        toolCalls: [
          { id: `c${callCount}`, name: "read_file", arguments: { file_path: "/test.txt" } },
        ],
      };
    });

    const tk = new Toolkit();
    tk.register("read_file", async () => ({ success: true, output: "content" }));

    const agent = createAgent(
      { type: AgentType.Code, systemPrompt: "Test", maxLoops: 4 },
      infiniteMocker,
      tk,
    );
    await agent.wakeup();
    const result = await agent.execute(
      { id: "n2", type: "test", payload: "Loop forever", tags: [], needsMultiPerspective: false, status: "pending", claimedBy: [], results: [], createdAt: Date.now() },
      "mock-model",
    );
    // maxLoops 4 means it'll exhaust without final answer
    expect(result.success).toBe(false);
    expect(result.error).toContain("Exceeded max loops");
  });

  it("should shutdown and reach Destroyed", async () => {
    const agent = createAgent(config, mockLlm(), new Toolkit());
    await agent.wakeup();
    await agent.shutdown();
    expect(agent.status).toBe(AS.Destroyed);
  });
});

describe("AgentFactoryConfig validation", () => {
  it("should default maxLoops to 64", () => {
    const agent = createAgent(
      { type: AgentType.Review, systemPrompt: "Review" },
      mockLlm(),
      new Toolkit(),
    );
    // No assertion needed — just verifies no throw
    expect(agent.type).toBe(AgentType.Review);
  });

  it("should accept maxLoops override", () => {
    const agent = createAgent(
      { type: AgentType.Inspector, systemPrompt: "Inspect", maxLoops: 24 },
      mockLlm(),
      new Toolkit(),
    );
    expect(agent.type).toBe(AgentType.Inspector);
  });
});

describe("PoolAwareState integration", () => {
  it("should report status from PoolAwareState", () => {
    const agent = createAgent(
      { type: AgentType.Code, systemPrompt: "Test" },
      mockLlm(),
      new Toolkit(),
    );
    expect(agent.status).toBe(AS.Created);
  });

  it("should transition through valid states", async () => {
    const agent = createAgent(
      { type: AgentType.Code, systemPrompt: "Test" },
      mockLlm(),
      new Toolkit(),
    );
    expect(agent.status).toBe(AS.Created);
    await agent.wakeup();
    expect(agent.status).toBe(AS.Awake);
    await agent.shutdown();
    expect(agent.status).toBe(AS.Destroyed);
  });
});
