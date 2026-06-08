// @ci: llm
import { describe, it, expect, vi } from "vitest";
import { LlmAdapter } from "@cortex/llm";
import { MetaAgent } from "@cortex/engine";
import type { SafeErrorReporter } from "@cortex/shared";

function mockMetaAgentLlm() {
  const adapter = new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "mock-chat",
    reasonerModel: "mock-reasoner"});

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
            needsMultiPerspective: false},
        ]},
      {
        task: "审查新增函数的类型安全",
        type: "review",
        tags: ["review"],
        needsMultiPerspective: true},
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
      reasonerModel: "mock-reasoner"});
    adapter.injectMock(async () => ({
      content: "I think this task should be done in one step: just add the function.",
      toolCalls: []}));

    const meta = new MetaAgent(adapter);
    const nodes = await meta.plan("随便说点什么");

    expect(nodes.length).toBe(1);
    expect(nodes[0].type).toBe("analysis");
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

  // ── setSafeReporter: JSON 解析失败走 reporter ──

  it("setSafeReporter 注入后 JSON 解析失败走 reporter 而非 console.warn", async () => {
    const adapter = new LlmAdapter({
      apiKey: "mock",
      baseUrl: "mock",
      chatModel: "mock-chat",
      reasonerModel: "mock-reasoner"});
    adapter.injectMock(async () => ({
      content: "This is not JSON at all.",
      toolCalls: []}));

    const meta = new MetaAgent(adapter);
    const reporterCalls: any[] = [];
    const reporter: SafeErrorReporter = (ctx) => { reporterCalls.push(ctx); };
    meta.setSafeReporter(reporter);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const nodes = await meta.plan("随便说点什么");

    // reporter 应被调用
    expect(reporterCalls.length).toBe(1);
    expect(reporterCalls[0].source).toBe("MetaAgent._parsePlan");
    expect(reporterCalls[0].severity).toBe("degraded");

    // console.warn 不应被调用（走 reporter 通道后跳过 console）
    const metaAgentWarns = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("[meta-agent]")
    );
    expect(metaAgentWarns.length).toBe(0);

    warnSpy.mockRestore();

    // 行为不变：仍返回兜底单节点
    expect(nodes.length).toBe(1);
    expect(nodes[0].type).toBe("analysis");
    expect(nodes[0].tags).toContain("analysis");
  });

  // ── 空数组 [] 处理 ──

  it("LLM 返回空数组 [] 时不生成兜底节点（工作区边界拒绝）", async () => {
    const adapter = new LlmAdapter({
      apiKey: "mock",
      baseUrl: "mock",
      chatModel: "mock-chat",
      reasonerModel: "mock-reasoner"});
    adapter.injectMock(async () => ({
      content: "[]",
      toolCalls: []}));

    const meta = new MetaAgent(adapter);
    const nodes = await meta.plan("分析 D:\\outside\\project");

    // 空数组是合法结果——不应生成 fallback 节点
    expect(nodes.length).toBe(0);
  });

  it("LLM 返回空数组带空格也不兜底", async () => {
    const adapter = new LlmAdapter({
      apiKey: "mock",
      baseUrl: "mock",
      chatModel: "mock-chat",
      reasonerModel: "mock-reasoner"});
    adapter.injectMock(async () => ({
      content: "  []  ",
      toolCalls: []}));

    const meta = new MetaAgent(adapter);
    const nodes = await meta.plan("工作区外的项目分析");

    expect(nodes.length).toBe(0);
  });

  // ── clarifyIntent: 意图明晰化确认 ──

  it("clarifyIntent 正确解析结构化意图", async () => {
    const adapter = new LlmAdapter({
      apiKey: "mock",
      baseUrl: "mock",
      chatModel: "mock-chat",
      reasonerModel: "mock-reasoner"});
    adapter.injectMock(async () => ({
      content: JSON.stringify({
        goal: "分析用户模块的数据流",
        actionType: "analysis",
        scope: "controller/service/dao 层",
        constraints: "仅读不写",
        unclear: null,
      }),
      toolCalls: [],
    }));

    const meta = new MetaAgent(adapter);
    const result = await meta.clarifyIntent("分析用户模块的数据流，不要修改任何文件");

    expect(result.goal).toBe("分析用户模块的数据流");
    expect(result.actionType).toBe("analysis");
    expect(result.scope).toBe("controller/service/dao 层");
    expect(result.constraints).toBe("仅读不写");
    expect(result.unclear).toBeUndefined();
    expect(result.originalIntent).toBe("分析用户模块的数据流，不要修改任何文件");
  });

  it("clarifyIntent 解析失败时回退为 inquiry", async () => {
    const adapter = new LlmAdapter({
      apiKey: "mock",
      baseUrl: "mock",
      chatModel: "mock-chat",
      reasonerModel: "mock-reasoner"});
    adapter.injectMock(async () => ({
      content: "Sorry, I cannot parse this.",
      toolCalls: [],
    }));

    const meta = new MetaAgent(adapter);
    const result = await meta.clarifyIntent("乱七八糟的输入 @@#$%");

    // 解析失败时用原始 intent 前 80 字符作为 goal
    expect(result.goal).toBe("乱七八糟的输入 @@#$%");
    expect(result.actionType).toBe("inquiry");
    expect(result.originalIntent).toBe("乱七八糟的输入 @@#$%");
  });

  it("clarifyIntent 对非法 actionType 归一化为 inquiry", async () => {
    const adapter = new LlmAdapter({
      apiKey: "mock",
      baseUrl: "mock",
      chatModel: "mock-chat",
      reasonerModel: "mock-reasoner"});
    adapter.injectMock(async () => ({
      content: JSON.stringify({
        goal: "do something",
        actionType: "hack",
        scope: "all",
        constraints: "none",
      }),
      toolCalls: [],
    }));

    const meta = new MetaAgent(adapter);
    const result = await meta.clarifyIntent("hack the planet");

    expect(result.actionType).toBe("inquiry"); // 非法值被归一化
    expect(result.goal).toBe("do something");
  });

  it("clarifyIntent 正确传递 unclear 字段", async () => {
    const adapter = new LlmAdapter({
      apiKey: "mock",
      baseUrl: "mock",
      chatModel: "mock-chat",
      reasonerModel: "mock-reasoner"});
    adapter.injectMock(async () => ({
      content: JSON.stringify({
        goal: "分析代码",
        actionType: "analysis",
        scope: "未知",
        constraints: "无",
        unclear: "用户未指定具体文件或模块",
      }),
      toolCalls: [],
    }));

    const meta = new MetaAgent(adapter);
    const result = await meta.clarifyIntent("分析代码");

    expect(result.unclear).toBe("用户未指定具体文件或模块");
  });
});
