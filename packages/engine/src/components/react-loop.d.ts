import type { TaskNode, NodeResult, SafeErrorReporter } from "@cortex/shared";
import { AgentType } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "@cortex/platform";
import type { MemoryStore } from "@cortex/memory-store";
/**
 * ReAct 循环上下文——解耦 BaseAgent 继承链。
 * 所有执行型 Agent 通过此上下文注入依赖，不再依赖 this.llm / this.toolkit 等隐式耦合。
 */
export interface ReActContext {
    agentType: AgentType;
    llm: LlmAdapter;
    toolkit: Toolkit;
    systemPrompt: string;
    maxLoops: number;
    /** 单 Agent ReAct 循环墙钟超时 (ms)。超时后返回 partial output + error 信息，不会被调度器视为异常崩溃。 */
    reactLoopTimeoutMs: number;
    memory?: MemoryStore;
    safeReporter?: SafeErrorReporter;
}
/**
 * 共享 ReAct 循环——所有 Agent 共用。
 * 从 react-helper.ts 提取，增加 ReActContext 封装。
 *
 * @param ctx ReAct 上下文——Agent 类型 + 注入依赖
 * @param node 任务节点
 * @param model LLM 模型名
 */
export declare function runReActLoop(ctx: ReActContext, node: TaskNode, model: string): Promise<NodeResult>;
//# sourceMappingURL=react-loop.d.ts.map