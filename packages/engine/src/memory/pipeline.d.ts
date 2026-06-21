import { LinkType, type MemoryEntry, type MemoryKind, type MemoryQuery, type NodeResult, type ReadMode, type SafeErrorReporter, type TaskNode } from "@cortex/shared";
import { type ReActContext } from "../components/react-loop.js";
import { type PipelineCtx, type IStep } from "@cortex/scheduler";
/**
 * 默认记忆检索策略——调用统一入口 makeMemoryQuery。
 * 如果 Agent 不提供自定义 getMemoryQuery，使用此默认实现。
 */
export declare function defaultMemoryQuery(node: TaskNode): MemoryQuery;
/**
 * 记忆检索查询工厂函数——统一入口。
 *
 * 11 个 Agent 的关键词提取全部收敛至此处，各 Agent 仅需指定差异化参数
 * （kind / linkTypes / bfsDepth / limit）。
 */
export declare function makeMemoryQuery(node: TaskNode, opts: {
    kind?: MemoryKind;
    linkTypes?: LinkType[];
    bfsDepth?: number;
    bfsMaxNodes?: number;
    limit?: number;
    bfsDirection?: 'both' | 'outbound';
}): MemoryQuery;
/**
 * MemoryRetrievalStep — 记忆检索 + 上下文增强。
 * 从 MemoryStore 检索相关记忆，注入到任务 payload 中。
 * 检索失败不阻塞执行（降级为无记忆）。
 */
export declare class MemoryRetrievalStep implements IStep {
    readonly name = "MemoryRetrieval";
    run(ctx: PipelineCtx): Promise<PipelineCtx>;
}
/**
 * ReActLoopStep — ReAct 循环执行。
 * 从 ctx 提取 ReActContext，调用共享的 runReActLoop。
 * 将来可通过构造函数注入不同的循环策略（Direct / Decompose / Jury）。
 */
export declare class ReActLoopStep implements IStep {
    readonly name = "ReActLoop";
    run(ctx: PipelineCtx): Promise<PipelineCtx>;
}
/**
 * MemoryWriteStep — 记忆写入。
 * 成功和失败都写（失败经验价值最高）。
 */
export declare class MemoryWriteStep implements IStep {
    readonly name = "MemoryWrite";
    run(ctx: PipelineCtx): Promise<PipelineCtx>;
}
/**
 * DirectStep — 单次 LLM 调用，不进入 ReAct 循环，不调用工具。
 * 适合：意图清晰、无工具依赖的单步任务（如纯文本生成、简单分类）。
 * 仍写记忆，以便后续任务利用上下文。
 */
export declare class DirectStep implements IStep {
    readonly name = "Direct";
    run(ctx: PipelineCtx): Promise<PipelineCtx>;
}
/** 默认管道：记忆检索 → ReAct 循环 → 记忆写入 */
export declare const DEFAULT_PIPELINE: IStep[];
/** Direct 管道：单次 LLM 调用 → 记忆写入（跳过记忆检索和 ReAct 循环） */
export declare const DIRECT_PIPELINE: IStep[];
/**
 * resolvePipeline —— 根据策略名返回对应的 Step 管道。
 *
 * 策略映射：
 *   "react"  → DEFAULT_PIPELINE   [MemoryRetrieval, ReActLoop, MemoryWrite]
 *   "direct" → DIRECT_PIPELINE    [DirectStep, MemoryWrite]
 *   undefined → DEFAULT_PIPELINE  （回退）
 *   "decompose" / "jury" → 未来扩展
 */
export declare function resolvePipeline(strategy?: string): IStep[];
/**
 * executeWithMemoryPipeline —— 记忆增强执行管道。
 *
 * 流程：检索记忆 → 增强上下文 → ReAct 执行 → 记忆写入。
 * 内部使用 PipelineRunner 串联 DEFAULT_PIPELINE 三个 Step。
 *
 * 签名完全向后兼容——所有现有调用者无需修改。
 *
 * @param ctx    ReAct 上下文
 * @param node   任务节点
 * @param model  LLM 模型
 * @param memoryQuery    可选自定义记忆检索策略
 * @param safeReporter   可选错误上报器
 * @param filterRead     可选读路径 Intent 过滤
 * @returns NodeResult
 */
export declare function executeWithMemoryPipeline(ctx: ReActContext, node: TaskNode, model: string, memoryQuery?: (node: TaskNode) => MemoryQuery, safeReporter?: SafeErrorReporter, filterRead?: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[], customSteps?: IStep[]): Promise<NodeResult>;
/**
 * 子 Agent 执行后的上下文摘要。
 *
 * Context Sharding 的核心：子 Agent 执行完成后，不把完整上下文传给协调者。
 * 而是压缩为结构化摘要，协调者只读摘要做决策——这突破了单上下文窗口限制。
 */
export interface SubAgentSummary {
    /** 执行节点 ID */
    nodeId: string;
    /** 执行 Agent 类型 */
    agentType: string;
    /** 是否成功 */
    success: boolean;
    /** 关键发现（≤200 字） */
    keyFindings: string;
    /** 执行步骤数 */
    stepsExecuted: number;
    /** 使用的工具 */
    toolsUsed: string[];
    /** 引用的文件 */
    filesTouched: string[];
    /** 下一步建议 */
    nextSuggestion?: string;
}
/**
 * 将子 Agent 的完整输出压缩为 Context Sharding 摘要。
 *
 * 模仿 Kimi Agent Swarm 的"子 Agent 只汇报关键结论"模式：
 * - 提取前 200 字作为关键发现
 * - 提取文件路径和工具调用
 * - 丢弃完整推理中间过程
 *
 * @param nodeResult 子 Agent 的完整执行结果
 * @returns 压缩后的摘要，可写入 MemoryStore 供协调者读取
 */
export declare function compactToSubAgentSummary(nodeResult: {
    nodeId: string;
    agentType: string;
    success: boolean;
    output?: string;
    error?: string;
}): SubAgentSummary;
//# sourceMappingURL=pipeline.d.ts.map