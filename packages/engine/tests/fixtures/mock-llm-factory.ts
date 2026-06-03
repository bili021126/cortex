// @ci: unit
/**
 * E2E Mock LLM 工厂 —— 为多Agent协作测试提供可复用的 Mock Adapter 集合。
 *
 * 与 mock-adapter.ts 的区别：
 *   mock-adapter.ts 提供单Agent单轮 mock（适合单元测试）
 *   本文件提供多Agent多轮 mock（适合 e2e 流程测试），支持：
 *     - 按 AgentType 分发不同响应
 *     - 多轮对话（toolCall → 执行 → 二次推理 → 最终答案）
 *     - MetaAgent 计划生成
 *     - Scheduler 驱动的完整闭环
 *
 * 使用方式：
 *   import { createE2eMockFactory } from "../fixtures/mock-llm-factory.js";
 *   const factory = createE2eMockFactory();
 *   const codeAdapter = factory.forCode("console.log('hello')");
 *   const reviewAdapter = factory.forReview("Code looks good, 0 defects found.");
 */

import { LlmAdapter } from "@cortex/llm";
import type { LlmResponse, LlmMessage, ToolDef } from "@cortex/shared";

// ─── 类型定义 ─────────────────────────────────────

/** 单轮响应：可以是固定文本或动态生成函数 */
export type MockResponse =
  | string
  | ((messages: LlmMessage[], callIndex: number) => string);

/** 多轮脚本：按调用序号返回不同响应（支持 toolCall） */
export interface MockScriptStep {
  /** 本轮返回的文本内容 */
  content: string;
  /** 本轮返回的 toolCall 列表（Agent 将调用这些工具） */
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}

// ─── 创建基础 Adapter ────────────────────────────

function createBaseAdapter(): LlmAdapter {
  return new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "mock-chat",
    reasonerModel: "mock-reasoner"});
}

// ─── 单响应 Adapter ──────────────────────────────

/** 创建一个永远返回固定文本的 Adapter */
export function mockTextAdapter(output: MockResponse): LlmAdapter {
  const adapter = createBaseAdapter();
  let callIndex = 0;
  adapter.injectMock(async () => {
    const text = typeof output === "function" ? output([], callIndex) : output;
    callIndex++;
    return { content: text, tool_calls: [] };
  });
  return adapter;
}

// ─── 脚本驱动 Adapter ────────────────────────────

/** 按预定义脚本返回响应的 Adapter（支持多轮 toolCall → 执行 → 再推理） */
export function mockScriptAdapter(steps: MockScriptStep[]): LlmAdapter {
  const adapter = createBaseAdapter();
  let stepIndex = 0;
  adapter.injectMock(async () => {
    const step = steps[stepIndex] ?? steps[steps.length - 1];
    if (stepIndex < steps.length) stepIndex++;
    return {
      content: step.content,
      tool_calls: (step.toolCalls ?? []).map((tc, i) => ({
        id: `mock_tc_${stepIndex}_${i}`,
        ...tc}))};
  });
  return adapter;
}

// ─── E2E Mock 工厂类 ─────────────────────────────

/**
 * E2E Mock 工厂 —— 为一次 e2e 测试创建全套 Agent Mock Adapter。
 *
 * 每个 Agent 的 mock 响应模拟该 Agent 的典型行为。
 */
export class E2eMockFactory {
  private _idCounter = 0;

  /** 为 CodeAgent 创建 mock——模拟"写了一段代码" */
  forCode(output: string, toolScript?: MockScriptStep[]): LlmAdapter {
    if (toolScript) return mockScriptAdapter(toolScript);
    // 默认：先调 write_file，再返回完成
    return mockScriptAdapter([
      {
        content: "I'll write the implementation to a file.",
        toolCalls: [{ name: "write_file", arguments: { file_path: "/tmp/output.ts", content: output } }]},
      { content: `Implementation complete:\n\`\`\`\n${output}\n\`\`\`` },
    ]);
  }

  /** 为 ReviewAgent 创建 mock——模拟"审查了一段代码" */
  forReview(
    findings: string,
    defectCount = 0,
    withRunShell = false,
  ): LlmAdapter {
    const steps: MockScriptStep[] = [];
    if (withRunShell) {
      steps.push({
        content: "I'll run the test suite first.",
        toolCalls: [{ name: "run_shell", arguments: { command: "pnpm vitest run" } }]});
      steps.push({
        content: "Tests pass. Now reviewing the code.",
        toolCalls: [{ name: "read_file", arguments: { file_path: "/tmp/output.ts" } }]});
    }
    steps.push({
      content: `## Review Report\n\n${findings}\n\n**Defects found: ${defectCount}**`});
    return mockScriptAdapter(steps);
  }

  /** 为 FixAgent 创建 mock——模拟"修复了 N 个缺陷" */
  forFix(fixPlan: string, fixedCount: number): LlmAdapter {
    return mockScriptAdapter([
      {
        content: "Reading the defect report and source code.",
        toolCalls: [{ name: "read_file", arguments: { file_path: "/tmp/output.ts" } }]},
      {
        content: "Applying fixes.",
        toolCalls: [{ name: "write_file", arguments: { file_path: "/tmp/output.ts", content: fixPlan } }]},
      { content: `Fixed ${fixedCount} defects. All changes applied.` },
    ]);
  }

  /** 为 AnalysisAgent 创建 mock——模拟"分析了一个问题" */
  forAnalysis(report: string): LlmAdapter {
    return mockScriptAdapter([
      {
        content: "I'll search the codebase for relevant patterns.",
        toolCalls: [{ name: "search_code", arguments: { query: "relevant" } }]},
      {
        content: "Writing the analysis report.",
        toolCalls: [{ name: "write_file", arguments: { file_path: "/tmp/analysis.md", content: report } }]},
      { content: `## Analysis Report\n\n${report}` },
    ]);
  }

  /** 为 MetaAgent 创建 mock——模拟"产出任务规划" */
  forMetaAgent(planNodes: Array<{ type: string; tags: string[]; payload: string }>): LlmAdapter {
    const planJson = JSON.stringify(
      planNodes.map((n, i) => ({ id: `plan-${i}`, ...n })),
      null,
      2,
    );
    return mockTextAdapter(
      `## Task Plan\n\n\`\`\`json\n${planJson}\n\`\`\`\n\nExecute the plan in order.`,
    );
  }

  /** 为 DocGovernAgent 创建 mock——模拟"审计通过" */
  forDocGovern(auditOutput: string): LlmAdapter {
    return mockScriptAdapter([
      {
        content: "Reading the constitution and related documents.",
        toolCalls: [{ name: "read_file", arguments: { file_path: "docs/constitution/Cortex.md" } }]},
      { content: auditOutput },
    ]);
  }

  /** 为 LoopAgent 创建 mock——模拟"发现模式" */
  forLoop(findings: Array<{ pattern: string; confidence: number }>): LlmAdapter {
    const report = [
      "## Pattern Discovery Report",
      "",
      ...findings.map((f) => `- **${f.pattern}** (confidence: ${(f.confidence * 100).toFixed(0)}%)`),
      "",
      "End of report.",
    ].join("\n");
    return mockScriptAdapter([
      {
        content: "Searching for recurring patterns.",
        toolCalls: [{ name: "search_code", arguments: { query: "pattern" } }]},
      {
        content: "Writing findings.",
        toolCalls: [{ name: "write_file", arguments: { file_path: "/tmp/patterns.md", content: report } }]},
      { content: report },
    ]);
  }

  /** 为 OpsAgent 创建 mock——模拟"执行运维操作" */
  forOps(task: string, success = true): LlmAdapter {
    return mockScriptAdapter([
      {
        content: "Running the operation.",
        toolCalls: [{ name: "run_shell", arguments: { command: task } }]},
      {
        content: success
          ? `Operation completed successfully: ${task}`
          : `Operation failed: ${task}`},
    ]);
  }

  /** 生成唯一 ID */
  private nextId(): string {
    return `mock_${++this._idCounter}`;
  }
}

/**
 * 快捷函数：创建 E2E Mock 工厂实例
 */
export function createE2eMockFactory(): E2eMockFactory {
  return new E2eMockFactory();
}

/**
 * 创建完整的 Agent Mock 集合（用于快速搭建测试场景）
 */
export function createFullAgentMockSet(scenario: "simple" | "full" | "governance"): Record<string, LlmAdapter> {
  const f = createE2eMockFactory();
  const set: Record<string, LlmAdapter> = {};

  if (scenario === "simple") {
    set.code = f.forCode("function add(a: number, b: number) { return a + b; }");
    set.review = f.forReview("Code is well-structured. No defects found.", 0);
    set.meta = f.forMetaAgent([
      { type: "implementation", tags: ["code"], payload: "Implement add function" },
      { type: "code_review", tags: ["review"], payload: "Review add function" },
    ]);
    return set;
  }

  if (scenario === "full") {
    set.code = f.forCode("export function main() { console.log('hello'); }");
    set.review = f.forReview("Function main looks correct. 0 defects.", 0, true);
    set.analysis = f.forAnalysis("Architecture is sound. Dependencies are properly isolated.");
    set.ops = f.forOps("pnpm vitest run", true);
    set.meta = f.forMetaAgent([
      { type: "implementation", tags: ["code"], payload: "Write main function" },
      { type: "code_review", tags: ["review"], payload: "Review main function" },
      { type: "test", tags: ["ops", "test"], payload: "Run test suite" },
    ]);
    return set;
  }

  // governance scenario
  set.docGovern = f.forDocGovern(
    "## Audit Report\n\n- [x] Constitution compliance\n- [x] File naming conventions\n- [x] Barrel exports correct\n\n**Verdict: PASS**",
  );
  set.review = f.forReview("Governance audit reviewed. All checks pass.", 0);
  set.meta = f.forMetaAgent([
    { type: "constitution_check", tags: ["constitution_check"], payload: "Audit constitution compliance" },
    { type: "code_review", tags: ["review"], payload: "Review audit findings" },
  ]);
  return set;
}
