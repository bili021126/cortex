import type { TaskNode, NodeResult, AgentType, MemoryQuery, SafeErrorReporter, MemoryEntry, ReadMode } from "@cortex/shared";

/**
 * 管道执行上下文——流经每个 Step 的共享状态。
 *
 * 设计原则：
 * - 配置字段（agentType/llm/toolkit 等）为只读，Step 不应修改
 * - 状态字段（node/enrichedNode/result）在管道推进中逐步填充
 *
 * 泛型化：Toolkit 和 Memory 使用泛型参数，解耦具体实现。
 * 外部使用方在构造 PipelineCtx 时传入具体的 Toolkit/MemoryStore 类型。
 */
export interface PipelineCtx<TToolkit = unknown, TMemory = unknown> {
  // ── 只读配置 ──
  readonly agentType: AgentType;
  readonly llm: unknown;  // LlmAdapter 类型由外部注入时决定
  readonly toolkit: TToolkit;
  readonly systemPrompt: string;
  readonly maxLoops: number;
  readonly reactLoopTimeoutMs: number;
  readonly model: string;

  // ── 可选扩展 ──
  readonly memory?: TMemory;
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

  /** 可选：步骤执行后的清理钩子 */
  cleanup?(ctx: PipelineCtx): Promise<void>;
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
 *     Direct     = [ReActLoop(direct)]
 *     Decompose  = [MemoryRetrieval, DecomposeLoop, ReActLoop×N, Aggregate, MemoryWrite]
 *     Jury       = [MemoryRetrieval, ReActLoop×16, JuryValidate, MemoryWrite]
 */
export class PipelineRunner {
  static async run(steps: IStep[], ctx: PipelineCtx): Promise<PipelineCtx> {
    let current = ctx;
    const completed: IStep[] = [];
    try {
      for (const step of steps) {
        current = await step.run(current);
        completed.push(step);
      }
      return current;
    } finally {
      // 兜底清理：倒序释放已完成 step 的资源，防止异常跳过 CleanupStep
      for (let i = completed.length - 1; i >= 0; i--) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        try { await completed[i]!.cleanup?.(current); } catch { console.error(`[scheduler] pipeline.cleanup_failed`); }
      }
    }
  }
}
