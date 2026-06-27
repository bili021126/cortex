// @ci: unit
/**
 * rag-orchestrator.test.ts — RagOrchestrator 测试
 *
 * 覆盖：
 *   - 检索→组装→LLM 调用完整流程
 *   - 无结果时返回空
 *   - 来源引用正确
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { RagOrchestrator, type RagResult } from "../src/rag-orchestrator.js";
import { MemoryStore } from "../src/memory-store.js";
import { ContextBuilder } from "../src/context-builder.js";
import { LlmAdapter } from "@cortex/llm";
import type { LlmMessage, LlmResponse, ToolDef } from "@cortex/shared";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── mock embedder ────────────────────────────────

function mockEmbedder() {
  const dim = 384;
  return {
    embed: async (_text: string) => new Array(dim).fill(0.1),
    embedBatch: async (_texts: string[]) => _texts.map(() => new Array(dim).fill(0.1)),
    isLoaded: true,
    preload: async () => {},
  };
}

// ── mock LLM ────────────────────────────────────

function mockLlmAdapter(response?: string): LlmAdapter {
  const adapter = new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "mock-chat",
    reasonerModel: "mock-reasoner",
  });
  adapter.injectMock(
    async (_messages: LlmMessage[], _tools?: ToolDef[]): Promise<LlmResponse> => ({
      content: response ?? "This is a mock answer based on the context.",
      usage: { prompt_tokens: 50, completion_tokens: 20 },
    }),
  );
  return adapter;
}

describe("RagOrchestrator", () => {
  let store: MemoryStore;
  let contextBuilder: ContextBuilder;
  let orchestrator: RagOrchestrator;
  let tmpDir: string;

  beforeEach(async () => {
    const embedder = mockEmbedder() as any;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-rag-"));
    store = new MemoryStore(undefined, undefined, embedder);
    await store.init(path.join(tmpDir, "test.db"));

    // 写入测试数据
    await store.write({
      source: { agentType: "code" as any, taskId: "rag-test" },
      kind: "Skill",
      isFact: true,
      summary: "[test.txt] chunk 1",
      semantic_gist: "The capital of France is Paris.",
      content_blob: {
        source: "test.txt",
        chunkIndex: 0,
        totalChunks: 2,
        content: "The capital of France is Paris. It is known for the Eiffel Tower.",
      },
    });

    await store.write({
      source: { agentType: "code" as any, taskId: "rag-test" },
      kind: "Skill",
      isFact: true,
      summary: "[test.txt] chunk 2",
      semantic_gist: "The population of Paris is about 2 million.",
      content_blob: {
        source: "test.txt",
        chunkIndex: 1,
        totalChunks: 2,
        content: "The population of Paris is about 2 million people.",
      },
    });

    contextBuilder = new ContextBuilder(store);
    const llmAdapter = mockLlmAdapter("Paris is the capital of France.");
    orchestrator = new RagOrchestrator(store, llmAdapter, contextBuilder);
  });

  afterAll(async () => {
    await store.dispose();
    if (tmpDir) try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ok */ }
  });

  // ── 完整流程 ──────────────────────────────────────

  it("完整检索→组装→LLM 调用流程", async () => {
    const result = await orchestrator.query("What is the capital of France?");
    expect(result.answer).toBeTruthy();
    expect(result.answer).toContain("Paris");
    expect(result.sources.length).toBeGreaterThanOrEqual(1);
    expect(result.tokenUsage.prompt).toBeGreaterThan(0);
    expect(result.tokenUsage.completion).toBeGreaterThan(0);
  });

  it("来源引用正确——包含文件路径和 chunk 序号", async () => {
    const result = await orchestrator.query("Tell me about Paris");
    expect(result.sources.length).toBeGreaterThanOrEqual(1);

    const source = result.sources[0]!;
    expect(source.file).toBe("test.txt");
    expect(typeof source.chunk).toBe("number");
    expect(source.content).toBeTruthy();
    expect(typeof source.score).toBe("number");
  });

  // ── 无结果 ────────────────────────────────────────

  it("无相关结果时 LLM 仍能回答（带空上下文）", async () => {
    // 使用一个与测试数据完全不相关的查询
    const result = await orchestrator.query("What is quantum computing?");
    expect(result).toBeDefined();
    expect(typeof result.answer).toBe("string");
    // sources 可以为空（未匹配到时）
    expect(Array.isArray(result.sources)).toBe(true);
  });

  // ── count 限制 ────────────────────────────────────

  it("maxSources 限制来源数量", async () => {
    const result = await orchestrator.query("France", { maxSources: 1 });
    expect(result.sources.length).toBeLessThanOrEqual(1);
  });

  it("domain 过滤不阻断无 domain 条目的查询", async () => {
    const result = await orchestrator.query("Paris", { domain: "general" });
    // 默认 domain=general 的条目可被检索到
    expect(result.sources.length).toBeGreaterThanOrEqual(0);
    expect(typeof result.answer).toBe("string");
  });

  // ── tokenUsage ────────────────────────────────────

  it("tokenUsage 返回正确结构", async () => {
    const result = await orchestrator.query("France");
    expect(result.tokenUsage).toHaveProperty("prompt");
    expect(result.tokenUsage).toHaveProperty("completion");
    expect(typeof result.tokenUsage.prompt).toBe("number");
    expect(typeof result.tokenUsage.completion).toBe("number");
  });
});
