import { describe, it, expect } from "vitest";
import { LlmAdapter } from "../src/llm-adapter";
import { MetaAgent } from "../src/meta-agent";

function mockMetaAgentLlm() {
  const adapter = new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "mock-chat",
    reasonerModel: "mock-reasoner",
  });

  adapter.injectMock(async () => {
    const plan = JSON.stringify([
      {
        task: "在 /src/utils.ts 添加 formatDate 函数",
        type: "implementation",
        tags: ["implementation", "test"],
        needsMultiPerspective: false,
        children: [
          {
            task: "为 formatDate 函数写单元测试",
            type: "implementation",
            tags: ["test"],
            needsMultiPerspective: false,
          },
        ],
      },
      {
        task: "审查新增函数的类型安全",
        type: "review",
        tags: ["review"],
        needsMultiPerspective: true,
      },
    ]);
    return { content: plan, toolCalls: [] };
  });

  return adapter;
}

describe("MetaAgent", () => {
  it("将用户意图拆解为 TaskNode 树", async () => {
    const adapter = mockMetaAgentLlm();
    const meta = new MetaAgent(adapter);

    const nodes = await meta.plan("添加一个日期格式化工具函数");

    // mock 返回 2 个顶层 PlanItem，其中一个有 1 个 child → 扁平化后共 3 个 TaskNode
    expect(nodes.length).toBe(3);
    expect(nodes[0]).toBeTruthy();
    expect(nodes[1]).toBeTruthy();

    // 第一个节点是 implementation
    const impl = nodes.find((n) => n.type === "implementation")!;
    expect(impl).toBeDefined();
    expect(impl.tags).toContain("implementation");
    expect(impl.payload).toContain("formatDate");
    expect(impl.needsMultiPerspective).toBe(false);
    expect(impl.status).toBe("pending");

    // 第二个节点是 review，且标志了多视角
    const review = nodes.find((n) => n.type === "review")!;
    expect(review).toBeDefined();
    expect(review.needsMultiPerspective).toBe(true);
    expect(review.tags).toContain("review");
  });

  it("LLM 输出非 JSON 时返回兜底单节点", async () => {
    const adapter = new LlmAdapter({
      apiKey: "mock",
      baseUrl: "mock",
      chatModel: "mock-chat",
      reasonerModel: "mock-reasoner",
    });
    adapter.injectMock(async () => ({
      content: "I think this task should be done in one step: just add the function.",
      toolCalls: [],
    }));

    const meta = new MetaAgent(adapter);
    const nodes = await meta.plan("随便说点什么");

    expect(nodes.length).toBe(1);
    expect(nodes[0].type).toBe("generic");
    expect(nodes[0].tags).toContain("analysis");
    expect(nodes[0].payload).toBe("I think this task should be done in one step: just add the function.");
  });

  it("parentId 正确传递到子节点", async () => {
    const adapter = mockMetaAgentLlm();
    const meta = new MetaAgent(adapter);

    const nodes = await meta.plan("test", { parentId: "parent-node-999" });

    // mock 返回 2 个顶层 PlanItem，其中一个有 1 个 child → 扁平化后共 3 个 TaskNode
    expect(nodes.length).toBe(3);
    // 顶层节点的 parentId 应继承传入的 context.parentId
    const impl = nodes.find((n) => n.type === "implementation")!;
    expect(impl.parentId).toBe("parent-node-999");
  });
});
