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
import type { LlmMessage } from "@cortex/shared";
/** 单轮响应：可以是固定文本或动态生成函数 */
export type MockResponse = string | ((messages: LlmMessage[], callIndex: number) => string);
/** 多轮脚本：按调用序号返回不同响应（支持 toolCall） */
export interface MockScriptStep {
    /** 本轮返回的文本内容 */
    content: string;
    /** 本轮返回的 toolCall 列表（Agent 将调用这些工具） */
    toolCalls?: Array<{
        name: string;
        arguments: Record<string, unknown>;
    }>;
}
/** 创建一个永远返回固定文本的 Adapter */
export declare function mockTextAdapter(output: MockResponse): LlmAdapter;
/** 按预定义脚本返回响应的 Adapter（支持多轮 toolCall → 执行 → 再推理） */
export declare function mockScriptAdapter(steps: MockScriptStep[]): LlmAdapter;
/**
 * E2E Mock 工厂 —— 为一次 e2e 测试创建全套 Agent Mock Adapter。
 *
 * 每个 Agent 的 mock 响应模拟该 Agent 的典型行为。
 */
export declare class E2eMockFactory {
    private _idCounter;
    /** 为 CodeAgent 创建 mock——模拟"写了一段代码" */
    forCode(output: string, toolScript?: MockScriptStep[]): LlmAdapter;
    /** 为 ReviewAgent 创建 mock——模拟"审查了一段代码" */
    forReview(findings: string, defectCount?: number, withRunShell?: boolean): LlmAdapter;
    /** 为 FixAgent 创建 mock——模拟"修复了 N 个缺陷" */
    forFix(fixPlan: string, fixedCount: number): LlmAdapter;
    /** 为 AnalysisAgent 创建 mock——模拟"分析了一个问题" */
    forAnalysis(report: string): LlmAdapter;
    /** 为 MetaAgent 创建 mock——模拟"产出任务规划" */
    forMetaAgent(planNodes: Array<{
        type: string;
        tags: string[];
        payload: string;
    }>): LlmAdapter;
    /** 为 DocGovernAgent 创建 mock——模拟"审计通过" */
    forDocGovern(auditOutput: string): LlmAdapter;
    /** 为 LoopAgent 创建 mock——模拟"发现模式" */
    forLoop(findings: Array<{
        pattern: string;
        confidence: number;
    }>): LlmAdapter;
    /** 为 OpsAgent 创建 mock——模拟"执行运维操作" */
    forOps(task: string, success?: boolean): LlmAdapter;
    /** 生成唯一 ID */
    private nextId;
}
/**
 * 快捷函数：创建 E2E Mock 工厂实例
 */
export declare function createE2eMockFactory(): E2eMockFactory;
/**
 * 创建完整的 Agent Mock 集合（用于快速搭建测试场景）
 */
export declare function createFullAgentMockSet(scenario: "simple" | "full" | "governance"): Record<string, LlmAdapter>;
//# sourceMappingURL=mock-llm-factory.d.ts.map