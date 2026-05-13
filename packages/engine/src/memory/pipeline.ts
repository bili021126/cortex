import type { TaskNode, NodeResult, MemoryQuery, AgentType, SafeErrorReporter } from "@cortex/shared";
import { MemoryType, LinkType, MemoryState } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "../toolkit.js";
import type { MemoryStore } from "../memory-store.js";
import { runReActLoop, type ReActContext } from "../components/react-loop.js";

/**
 * 默认记忆检索策略——调用统一入口 makeMemoryQuery。
 * 如果 Agent 不提供自定义 getMemoryQuery，使用此默认实现。
 */
export function defaultMemoryQuery(node: TaskNode): MemoryQuery {
  return makeMemoryQuery(node, {
    memoryTypes: [MemoryType.Episodic],
    limit: 5,
  });
}

/**
 * 记忆检索查询工厂函数——统一入口。
 *
 * 11 个 Agent 的关键词提取全部收敛至此处，各 Agent 仅需指定差异化参数
 * （memoryTypes / linkTypes / bfsDepth / limit）。
 *
 * 关键词提取策略：
 *   1. CJK 2-gram —— payload 中提取连续中文双字（覆盖日/韩汉字区）
 *   2. 拉丁词 —— 空格分词后保留长度 > 3 的词
 *   3. 粗粒度 CJK 去重 —— 移除被更长 bigram 覆盖的短 bigram（如"重构"被"重构记忆"包含时保留后者）
 *
 * @param node 任务节点
 * @param opts 搜索选项（memoryTypes 必填）
 */
export function makeMemoryQuery(
  node: TaskNode,
  opts: {
    memoryTypes: MemoryType[];
    linkTypes?: LinkType[];
    bfsDepth?: number;
    bfsMaxNodes?: number;
    queryMode?: 'hca' | 'csa';
    trackAccess?: boolean;
    limit?: number;
    bfsDirection?: 'both' | 'outbound';
    states?: MemoryState[];
  },
): MemoryQuery {
  const payload = node.payload;
  const keywords: string[] = [];

  // 1. CJK 2-gram（中日韩统一汉字区）
  const cjkChars = payload.replace(/[^一-鿿㐀-䶿]/g, "");
  for (let i = 0; i <= cjkChars.length - 2; i++) {
    keywords.push(cjkChars.slice(i, i + 2));
  }

  // 2. 拉丁词（英文/数字/下划线等，长度 > 3 才保留）
  const latinWords = payload.split(/\s+/).filter((w) => w.length > 3);
  keywords.push(...latinWords);

  return {
    keywords,
    memoryTypes: opts.memoryTypes,
    linkTypes: opts.linkTypes,
    states: opts.states,
    bfsDepth: opts.bfsDepth ?? 2,
    bfsMaxNodes: opts.bfsMaxNodes ?? 20,
    queryMode: opts.queryMode ?? 'csa',
    trackAccess: opts.trackAccess,
    limit: opts.limit ?? 3,
    bfsDirection: opts.bfsDirection ?? 'outbound',
  };
}

/**
 * 记忆增强执行管道。
 * 从 BaseAgent._executeWithMemory + _executeAndRemember 提取为独立函数。
 *
 * 流程：检索记忆 → 增强上下文 → ReAct 执行 → 记忆写入（成功时）
 *
 * @param ctx ReAct 上下文
 * @param node 任务节点
 * @param model LLM 模型
 * @param memoryQuery 自定义记忆检索策略（可选，默认 CJK bigram）
 * @param safeReporter 错误上报器
 */
export async function executeWithMemoryPipeline(
  ctx: ReActContext,
  node: TaskNode,
  model: string,
  memoryQuery?: (node: TaskNode) => MemoryQuery,
  safeReporter?: SafeErrorReporter,
): Promise<NodeResult> {
  const { memory, agentType } = ctx;

  // ── 步骤1：记忆检索 + 上下文增强 ──
  let enrichedNode = node;
  if (memory) {
    const query = memoryQuery ? memoryQuery(node) : defaultMemoryQuery(node);
    try {
      const ctxRecords = memory.read(query);
      if (ctxRecords.length > 0) {
        const ctxSummary = ctxRecords.map((m) => `[记忆] ${m.summary}`).join("\n");
        enrichedNode = {
          ...node,
          payload: `上下文记忆：\n${ctxSummary}\n\n任务：${node.payload}`,
        };
      }
    } catch (e) {
      // 记忆检索失败不阻塞执行
      if (safeReporter) {
        safeReporter({
          source: `${agentType}.executeWithMemoryPipeline`,
          error: e,
          severity: "degraded",
          hint: `节点 ${node.id} 记忆检索失败，降级为无记忆执行`,
        });
      }
    }
  }

  // ── 步骤2：ReAct 执行 ──
  const result = await runReActLoop(ctx, enrichedNode, model);

  // ── 步骤3：写入记忆（成功和失败都写，失败经验价值最高）──
  if (memory) {
    await _rememberResult(memory, agentType, node, result, safeReporter);
  }

  return result;
}

/**
 * 将执行结果写入 MemoryStore（成功和失败都写）。
 *
 * 成功记忆：Episodic，weight=5，记录决策和产出
 * 失败记忆：Episodic，weight=3（经验教训，价值高但不重复推荐），记录错误原因
 *
 * 包括：主记忆（Episodic）+ 上下文记忆 + 链接。
 */
async function _rememberResult(
  memory: MemoryStore,
  agentType: AgentType,
  node: TaskNode,
  result: NodeResult,
  safeReporter?: SafeErrorReporter,
): Promise<void> {
  const isSuccess = result.success;
  const isFix = node.type === "bugfix" || node.type === "refactor";

  const content: Record<string, unknown> = {
    taskType: node.type,
    entities: node.tags,
    decision: result.output ?? (result.error ?? ""),
    outcome: isSuccess ? "success" : "failure",
  };
  if (isFix) {
    content.pitfall = node.payload.slice(0, 300);
  }
  if (!isSuccess) {
    content.lesson = `${agentType} 执行 ${node.type} 失败。错误: ${(result.error ?? "unknown").slice(0, 300)}`;
  } else if (isFix) {
    content.lesson = `${agentType} successfully fixed a ${node.type}. The original error context is preserved above.`;
  }

  try {
    const memId = memory.write({
      memoryType: MemoryType.Episodic,
      content,
      summary: isSuccess
        ? isFix
          ? `[修复记录] ${agentType} 修复了 ${node.type}: ${node.payload.slice(0, 100)}`
          : `${agentType} 完成 ${node.type} 任务: ${node.payload.slice(0, 120)}`
        : `[失败教训] ${agentType} 执行 ${node.type} 失败: ${(result.error ?? "unknown").slice(0, 100)}`,
      agentType,
      creatorId: agentType,
      weight: isSuccess ? 5 : 3,
      metadata: { taskId: node.id, nodeType: node.type, tags: node.tags },
    });

    const ctxMemId = memory.write({
      memoryType: MemoryType.Episodic,
      content: { nodeId: node.id, nodeType: node.type, tags: node.tags, outcome: isSuccess ? "success" : "failure" },
      summary: `[上下文] 节点 ${node.id} (${node.type}): ${node.payload.slice(0, 60)}`,
      agentType,
      creatorId: agentType,
      weight: 1,
      metadata: { taskId: node.id },
    });

    memory.link(memId, ctxMemId, LinkType.ProducedBy, agentType);

    if (isFix && node.parentId) {
      const parentMemories = memory.read({
        metadataFilter: { taskId: node.parentId },
        limit: 1,
      });
      if (parentMemories.length > 0) {
        memory.link(memId, parentMemories[0].id, LinkType.ProducedBy, agentType);
      }
    }
  } catch (memErr) {
    if (safeReporter) {
      safeReporter({
        source: `${agentType}.executeWithMemoryPipeline._rememberResult`,
        error: memErr,
        severity: "degraded",
        hint: `任务 ${node.id} 已${isSuccess ? "成功" : "失败"}完成，但记忆写入失败`,
      });
    }
  }
}
