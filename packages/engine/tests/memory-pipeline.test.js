// @ci: unit
import { describe, it, expect } from "vitest";
import { AgentType } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";
import { PipelineObserver, PipelineRunner } from "@cortex/scheduler";
import { executeWithMemoryPipeline, resolvePipeline, DirectStep, DEFAULT_PIPELINE, DIRECT_PIPELINE, defaultMemoryQuery } from "@cortex/engine";
import { Toolkit } from "@cortex/platform";
import { MemoryStore } from "@cortex/memory-store";
function mockLlm() {
    const adapter = new LlmAdapter({
        apiKey: "mock",
        baseUrl: "mock",
        chatModel: "mock-chat",
        reasonerModel: "mock-reasoner"
    });
    adapter.injectMock(async () => ({
        content: "Task completed.",
        tool_calls: []
    }));
    return adapter;
}
const testNode = {
    id: "n1",
    type: "test",
    payload: "实现一个添加功能 修复计算器错误",
    tags: [],
    needsMultiPerspective: false,
    status: "pending",
    claimedBy: [],
    results: [],
    createdAt: Date.now()
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
        expect(query.kind).toBe("TaskLog");
    });
});
describe("executeWithMemoryPipeline (without memory)", () => {
    it("should execute without memory", async () => {
        const adapter = mockLlm();
        const ctx = {
            agentType: AgentType.Code,
            llm: adapter,
            toolkit: new Toolkit(),
            systemPrompt: "Test",
            maxLoops: 64,
            reactLoopTimeoutMs: 300_000
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
        const ctx = {
            agentType: AgentType.Code,
            llm: adapter,
            toolkit: new Toolkit(),
            systemPrompt: "Test",
            maxLoops: 64,
            reactLoopTimeoutMs: 300_000
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
        const memory = new MemoryStore(undefined, new PipelineObserver(), {
            embedText: async () => new Array(384).fill(0.1),
            embedBatch: async (texts) => texts.map(() => new Array(384).fill(0.1)),
        });
        await memory.init(":memory:");
        const ctx = {
            agentType: AgentType.Code,
            llm: adapter,
            toolkit: tk,
            systemPrompt: "Test",
            maxLoops: 64,
            reactLoopTimeoutMs: 300_000,
            memory
        };
        const result = await executeWithMemoryPipeline(ctx, testNode, "mock-model");
        expect(result.success).toBe(true);
        // 验证记忆写入
        const memories = await memory.read({ limit: 10 });
        expect(memories.length).toBeGreaterThan(0);
        const hasEpisodic = memories.some((m) => m.kind === "TaskLog");
        expect(hasEpisodic).toBe(true);
    });
    it("should write failure memory as lesson (regression from P2 improvement)", async () => {
        const adapter = mockLlm();
        adapter.injectMock(async () => {
            throw new Error("Fatal error");
        });
        const memory = new MemoryStore(undefined, new PipelineObserver(), {
            embedText: async () => new Array(384).fill(0.1),
            embedBatch: async (texts) => texts.map(() => new Array(384).fill(0.1)),
        });
        await memory.init(":memory:");
        const ctx = {
            agentType: AgentType.Code,
            llm: adapter,
            toolkit: new Toolkit(),
            systemPrompt: "Test",
            maxLoops: 64,
            reactLoopTimeoutMs: 300_000,
            memory
        };
        const result = await executeWithMemoryPipeline(ctx, testNode, "mock-model");
        expect(result.success).toBe(false);
        // 失败时写入教训记忆（isSuccess=false：主记忆 weight=3 + 上下文记忆 weight=1）
        const memories = await memory.read({ limit: 10 });
        const episodicFromThisTask = memories.filter((m) => m.source?.taskId === testNode.id && m.kind === "TaskLog");
        expect(episodicFromThisTask.length).toBe(2);
        const lessonMemory = episodicFromThisTask.find((m) => m.weight === 3);
        expect(lessonMemory).toBeDefined();
        expect(lessonMemory.summary).toContain("[失败教训]");
    });
});
// ══════════════════════════════════════════════
// resolvePipeline — 策略映射
// ══════════════════════════════════════════════
describe("resolvePipeline", () => {
    it("returns DEFAULT_PIPELINE when strategy is undefined", () => {
        const pipeline = resolvePipeline(undefined);
        expect(pipeline).toBe(DEFAULT_PIPELINE);
    });
    it("returns DEFAULT_PIPELINE when strategy is 'react'", () => {
        const pipeline = resolvePipeline("react");
        expect(pipeline).toBe(DEFAULT_PIPELINE);
        expect(pipeline.length).toBe(3);
        expect(pipeline[0].name).toBe("MemoryRetrieval");
        expect(pipeline[1].name).toBe("ReActLoop");
        expect(pipeline[2].name).toBe("MemoryWrite");
    });
    it("returns DIRECT_PIPELINE when strategy is 'direct'", () => {
        const pipeline = resolvePipeline("direct");
        expect(pipeline).toBe(DIRECT_PIPELINE);
        expect(pipeline.length).toBe(2);
        expect(pipeline[0].name).toBe("Direct");
        expect(pipeline[1].name).toBe("MemoryWrite");
    });
    it("falls back to DEFAULT_PIPELINE for unknown strategy", () => {
        const pipeline = resolvePipeline("unknown");
        expect(pipeline).toBe(DEFAULT_PIPELINE);
    });
    it("resolves without args (no strategy)", () => {
        const pipeline = resolvePipeline();
        expect(pipeline).toBe(DEFAULT_PIPELINE);
    });
});
// ══════════════════════════════════════════════
// PipelineRunner — 顺序执行
// ══════════════════════════════════════════════
describe("PipelineRunner", () => {
    function makeCtx(overrides) {
        const adapter = mockLlm();
        return {
            agentType: AgentType.Code,
            llm: adapter,
            toolkit: new Toolkit(),
            systemPrompt: "Test",
            maxLoops: 64,
            reactLoopTimeoutMs: 300_000,
            model: "mock-model",
            node: testNode,
            ...overrides
        };
    }
    it("runs steps in order and passes ctx between them", async () => {
        const order = [];
        const step1 = {
            name: "Step1",
            async run(ctx) { order.push("Step1"); return ctx; }
        };
        const step2 = {
            name: "Step2",
            async run(ctx) { order.push("Step2"); return ctx; }
        };
        const step3 = {
            name: "Step3",
            async run(ctx) { order.push("Step3"); return ctx; }
        };
        await PipelineRunner.run([step1, step2, step3], makeCtx());
        expect(order).toEqual(["Step1", "Step2", "Step3"]);
    });
    it("each step receives the result of the previous step", async () => {
        const step1 = {
            name: "Enricher",
            async run(ctx) {
                ctx.enrichedNode = { ...ctx.node, payload: "enriched" };
                return ctx;
            }
        };
        const step2 = {
            name: "Consumer",
            async run(ctx) {
                expect(ctx.enrichedNode).toBeDefined();
                expect(ctx.enrichedNode.payload).toBe("enriched");
                return ctx;
            }
        };
        await PipelineRunner.run([step1, step2], makeCtx());
    });
    it("returns input ctx unchanged when steps array is empty", async () => {
        const ctx = makeCtx();
        const result = await PipelineRunner.run([], ctx);
        expect(result).toBe(ctx);
        expect(result.node).toBe(testNode);
    });
    it("returns final ctx with result set by last step", async () => {
        const step = {
            name: "Producer",
            async run(ctx) {
                ctx.result = {
                    nodeId: ctx.node.id,
                    agentType: ctx.agentType,
                    success: true,
                    output: "done"
                };
                return ctx;
            }
        };
        const finalCtx = await PipelineRunner.run([step], makeCtx());
        expect(finalCtx.result).toBeDefined();
        expect(finalCtx.result.success).toBe(true);
        expect(finalCtx.result.output).toBe("done");
    });
});
// ══════════════════════════════════════════════
// DirectStep — 单次 LLM 调用
// ══════════════════════════════════════════════
describe("DirectStep", () => {
    it("sets success result with LLM output", async () => {
        const adapter = mockLlm();
        const step = new DirectStep();
        const ctx = {
            agentType: AgentType.Code,
            llm: adapter,
            toolkit: new Toolkit(),
            systemPrompt: "You are a helpful assistant.",
            maxLoops: 1,
            reactLoopTimeoutMs: 300_000,
            model: "mock-model",
            node: testNode
        };
        const result = await step.run(ctx);
        expect(result.result).toBeDefined();
        expect(result.result.success).toBe(true);
        expect(result.result.output).toBe("Task completed.");
    });
    it("sets failure result when LLM crashes", async () => {
        const adapter = mockLlm();
        adapter.injectMock(async () => {
            throw new Error("API unavailable");
        });
        const step = new DirectStep();
        const ctx = {
            agentType: AgentType.Code,
            llm: adapter,
            toolkit: new Toolkit(),
            systemPrompt: "Test",
            maxLoops: 1,
            reactLoopTimeoutMs: 300_000,
            model: "mock-model",
            node: testNode
        };
        const result = await step.run(ctx);
        expect(result.result).toBeDefined();
        expect(result.result.success).toBe(false);
        expect(result.result.error).toContain("API unavailable");
    });
    it("uses enrichedNode when available", async () => {
        const adapter = mockLlm();
        // Override mock to echo the enriched prompt
        adapter.injectMock(async () => ({
            content: "enriched-context-complete",
            tool_calls: []
        }));
        const step = new DirectStep();
        const enrichedNode = { ...testNode, payload: "enriched task" };
        const ctx = {
            agentType: AgentType.Code,
            llm: adapter,
            toolkit: new Toolkit(),
            systemPrompt: "Test",
            maxLoops: 1,
            reactLoopTimeoutMs: 300_000,
            model: "mock-model",
            node: testNode,
            enrichedNode
        };
        const result = await step.run(ctx);
        expect(result.result.output).toBe("enriched-context-complete");
    });
});
// ══════════════════════════════════════════════
// customSteps — 注入自定义管道到 executeWithMemoryPipeline
// ══════════════════════════════════════════════
describe("executeWithMemoryPipeline with customSteps", () => {
    it("runs custom pipeline instead of default", async () => {
        const adapter = mockLlm();
        const ctx = {
            agentType: AgentType.Code,
            llm: adapter,
            toolkit: new Toolkit(),
            systemPrompt: "Test",
            maxLoops: 64,
            reactLoopTimeoutMs: 300_000
        };
        // Use DirectStep as custom pipeline (no memory, no ReAct loop)
        const result = await executeWithMemoryPipeline(ctx, testNode, "mock-model", undefined, undefined, undefined, [new DirectStep()]);
        expect(result.success).toBe(true);
        expect(result.output).toBe("Task completed.");
    });
});
//# sourceMappingURL=memory-pipeline.test.js.map