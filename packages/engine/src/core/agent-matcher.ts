import type { TaskNode, Agent } from "@cortex/shared";
import { AGENT_TAGS } from "@cortex/shared";

/** 别名归一化：MetaAgent 可能生成简写别名 */
const TYPE_ALIASES: Record<string, string> = {
  "inspect": "inspector",
};

const knownTypes = new Set<string>(Object.keys(AGENT_TAGS));

/**
 * 为任务节点查找最佳匹配的 Agent 类型。
 *
 * 优先：node.type 若为已知 AgentType，直接匹配。
 * 回退：按 tags 打分匹配，平局以匹配密度打破。
 *
 * @param agents 已注册的 Agent 映射（AgentType → Agent）
 * @param node 待匹配的任务节点
 * @returns 匹配的 Agent 类型，无匹配时返回 null
 */
export function findMatchingAgent(agents: Map<string, Agent>, node: TaskNode): string | null {
  // 归一化：MetaAgent 可能生成 doc_govern（下划线），而 AgentType 为 doc-govern（连字符）
  const normalizedType = node.type.replace(/_/g, "-");
  const aliasResolved = TYPE_ALIASES[normalizedType] ?? normalizedType;

  // 统一用归一化后的类型匹配
  const checkType = aliasResolved !== node.type && knownTypes.has(aliasResolved) ? aliasResolved : node.type;
  if (knownTypes.has(checkType) && agents.has(checkType)) {
    return checkType;
  }

  // 回退：按 tags 打分匹配
  let bestType: string | null = null;
  let bestScore = 0;
  let bestDensity = 0; // 匹配密度 = matching / |tags|，平分时打破平局
  for (const [type, tags] of Object.entries(AGENT_TAGS)) {
    if (!agents.has(type)) continue;
    const tagArr = tags as readonly string[];
    let score = node.tags.filter((t) => tagArr.includes(t)).length;
    // 平局打破1：node.type 精确匹配的 Agent 类型加分
    if (score > 0 && node.type === type) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestType = type;
      bestDensity = tagArr.length > 0 ? score / tagArr.length : 0;
    } else if (score === bestScore && score > 0 && bestType) {
      // 平局打破2：选匹配密度更高的 Agent（更专精、标签噪声更少）
      const density = tagArr.length > 0 ? score / tagArr.length : 0;
      if (density > bestDensity) {
        bestType = type;
        bestDensity = density;
      }
    }
  }
  return bestType;
}

/**
 * 为多视角节点查找所有匹配的 Agent 类型。
 */
export function findAllMatchingAgents(agents: Map<string, Agent>, node: TaskNode): string[] {
  return Object.entries(AGENT_TAGS)
    .filter(
      ([type, tags]) =>
        agents.has(type) &&
        node.tags.some((t) => (tags as readonly string[]).includes(t)),
    )
    .map(([type]) => type);
}
