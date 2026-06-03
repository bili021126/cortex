import type { TaskNode, NodeResult, AgentType, MemoryQuery, SafeErrorReporter, MemoryEntry, ReadMode } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "../platform/toolkit.js";
import type { MemoryStore } from "../memory/memory-store.js";

/**
 * 管道执行上下文——流经每个 Step 的共享状态。
 *
 * 设计原则：
 * - 配置字段（agentType/llm/toolkit 等）为只读，Step 不应修改
 * - 状态字段（node/enrichedNode/result）在管道推进中逐步填充
 * - 将来跨项目时，在此追加 sessionId? 字段即可（接口不动，只扩上下文）
 */
export interface PipelineCtx {
  // ── 只读配置 ──
  readonly agentType: AgentType;
  readonly llm: LlmAdapter;
  readonly toolkit: Toolkit;
  readonly systemPrompt: string;
  readonly maxLoops: number;
  readonly reactLoopTimeoutMs: number;
  readonly model: string;

  // ── 可选扩展 ──
  readonly memory?: MemoryStore;
  readonly safeReporter?: SafeErrorReporter;
  readonly filterRead?: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[];
  readonly memoryQuery?: (node: TaskNode) => MemoryQuery;

  // ── 管道状态（Step 间流转） ──
  node: TaskNode;
  enrichedNode?: TaskNode;
  result?: NodeResult;
}

/**
 * IStep —— 管道中的一个可插拔步骤。
 * 每个步骤从 PipelineCtx 读取所需字段，处理后返回新的 PipelineCtx。
 * 原则：单一步骤只做一件事，可独立测试，可自由组合。
 */
export interface IStep {
  /** 步骤名——用于调试和日志 */
  readonly name: string;

  /** 执行此步骤，返回更新后的上下文 */
  run(ctx: PipelineCtx): Promise<PipelineCtx>;
}

/**
 * PipelineRunner —— 管道执行器。
 * 按顺序执行 IStep 数组，每个步骤的输出作为下一个步骤的输入。
 *
 * 使用方式：
 *   const ctx = await PipelineRunner.run([step1, step2, step3], initialCtx);
 *
 * 可扩展性：
 *   不同 Agent 品种只需声明不同的 Step 排列：
 *     Default    = [MemoryRetrieval, ReActLoop, MemoryWrite]
 *     Direct     = [ReActLoop(direct)]              // 无记忆
 *     Decompose  = [MemoryRetrieval, DecomposeLoop, ReActLoop×N, Aggregate, MemoryWrite]
 *     Jury       = [MemoryRetrieval, ReActLoop×16, JuryValidate, MemoryWrite]
 */
export class PipelineRunner {
  static async run(steps: IStep[], ctx: PipelineCtx): Promise<PipelineCtx> {
    let current = ctx;
    for (const step of steps) {
      current = await step.run(current);
    }
    return current;
  }
}
