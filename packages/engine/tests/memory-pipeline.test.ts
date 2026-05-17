// @ci: unit
import { describe, it, expect } from "vitest";
import { AgentType, MemoryType } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { Toolkit } from "../src/toolkit";
import { MemoryStore } from "../src/memory/memory-store.js";
import { PipelineObserver } from "../src/pipeline-observer";
import { executeWithMemoryPipeline, defaultMemoryQuery } from "../src/memory/pipeline";
import { type ReActContext } from "../src/components/react-loop";

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

const testNode = {
  id: "n1",
  type: "test",
  payload: "实现一个添加功能 修复计算器错误",
  tags: [],
  needsMultiPerspective: false,
  status: "pending" as const,
  claimedBy: [],
  results: [],
  createdAt: Date.now(),
};

describe("defaultMemoryQuery", () => {
  it("should extract CJK bigrams", () => {
    const query = defaultMemoryQuery(testNode);
    expect(query.keywords?.length ?? 0).toBeGreaterThan(0);
    // 添加 → "添加"
    expect(query.keywords).toContain("添加");
  });

  it("should extract Latin words > 3 chars", () => {
    const node = { ...testNode, payload: "Fix calculation bug in calculator" };
    const query = defaultMemoryQuery(node);
    const latin = (query.keywords ?? []).filter((k) => /[a-z]/i.test(k));
    expect(latin.length).toBeGreaterThan(0);
  });

  it("should default to Episodic memory type", () => {
    const query = defaultMemoryQuery(testNode);
    expect(query.memoryTypes).toContain(MemoryType.Episodic);
  });
});

describe("executeWithMemoryPipeline (without memory)", () => {
  it("should execute without memory", async () => {
    const adapter = mockLlm();
    const ctx: ReActContext = {
      agentType: AgentType.Code,
      llm: adapter,
      toolkit: new Toolkit(),
      systemPrompt: "Test",
      maxLoops: 64,
    };

    const result = await executeWithMemoryPipeline(ctx, testNode, "mock-model");
    expect(result.success).toBe(true);
    expect(result.output).toBe("Task completed.");
  });

  it("should report ReAct crash error", async () => {
    const adapter = mockLlm();
    adapter.injectMock(async () => {
      throw new Error("LLM timeout");
    });

    const ctx: ReActContext = {
      agentType: AgentType.Code,
      llm: adapter,
      toolkit: new Toolkit(),
      systemPrompt: "Test",
      maxLoops: 64,
    };

    const result = await executeWithMemoryPipeline(ctx, testNode, "mock-model");
    expect(result.success).toBe(false);
    expect(result.error).toContain("ReAct loop crashed");
  });
});

describe("executeWithMemoryPipeline (with memory)", () => {
  it("should execute with memory and write to MemoryStore on success", async () => {
    const adapter = mockLlm();
    const tk = new Toolkit();
    const memory = new MemoryStore(new PipelineObserver());
    const ctx: ReActContext = {
      agentType: AgentType.Code,
      llm: adapter,
      toolkit: tk,
      systemPrompt: "Test",
      maxLoops: 64,
      memory,
    };

    const result = await executeWithMemoryPipeline(ctx, testNode, "mock-model");
    expect(result.success).toBe(true);

    // 验证记忆写入
    const memories = memory.read({ limit: 10 });
    expect(memories.length).toBeGreaterThan(0);
    const hasEpisodic = memories.some(
      (m) => m.memoryType === MemoryType.Episodic,
    );
    expect(hasEpisodic).toBe(true);
  });

  it("should write failure memory as lesson (regression from P2 improvement)", async () => {
    const adapter = mockLlm();
    adapter.injectMock(async () => {
      throw new Error("Fatal error");
    });

    const memory = new MemoryStore(new PipelineObserver());

    const ctx: ReActContext = {
      agentType: AgentType.Code,
      llm: adapter,
      toolkit: new Toolkit(),
      systemPrompt: "Test",
      maxLoops: 64,
      memory,
    };

    const result = await executeWithMemoryPipeline(ctx, testNode, "mock-model");
    expect(result.success).toBe(false);

    // 失败时写入教训记忆（isSuccess=false：主记忆 weight=3 + 上下文记忆 weight=1）
    const memories = memory.read({ limit: 10 });
    const episodicFromThisTask = memories.filter(
      (m) => m.metadata?.taskId === testNode.id && m.memoryType === MemoryType.Episodic,
    );
    expect(episodicFromThisTask.length).toBe(2);
    const lessonMemory = episodicFromThisTask.find((m) => m.weight === 3);
    expect(lessonMemory).toBeDefined();
    expect(lessonMemory!.summary).toContain("[失败教训]");
  });
});
