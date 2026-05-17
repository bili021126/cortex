// ============================================================
// @cortex/testing —— Core-1 测试工具包（v2.0 类型对齐）
// Mock 合成数据生成器
// ============================================================
// 适配：移除 uuid 依赖，使用内置 crypto.randomUUID

import * as crypto from "node:crypto";
import { AgentType, MemoryType, MemoryState } from "@cortex/shared";
import type { TaskNode, Tag } from "@cortex/shared";

// ═══════════════════════════════════════════════════════════
// 合成 TaskNode
// ═══════════════════════════════════════════════════════════

export function syntheticTaskNode(overrides?: Partial<TaskNode>): TaskNode {
  const now = Date.now();
  return {
    id: overrides?.id ?? crypto.randomUUID(),
    parentId: overrides?.parentId,
    type: overrides?.type ?? "implementation",
    tags: (overrides?.tags ?? ["implementation"]) as Tag[],
    needsMultiPerspective: overrides?.needsMultiPerspective ?? false,
    status: overrides?.status ?? "pending",
    claimedBy: overrides?.claimedBy ?? [],
    payload: overrides?.payload ?? "合成任务: 实现示例功能",
    results: overrides?.results ?? [],
    createdAt: overrides?.createdAt ?? now,
  };
}

/** 生成一组带 parentId 链的任务树 */
export function syntheticTaskTree(nodeCount: number, parentId?: string): TaskNode[] {
  const nodes: TaskNode[] = [];
  let prevId = parentId;
  const templates = [
    { type: "research", tags: ["research"] as Tag[], payload: "调研现有方案" },
    { type: "implementation", tags: ["implementation"] as Tag[], payload: "实现核心逻辑" },
    { type: "test", tags: ["test"] as Tag[], payload: "编写单元测试", needsMultiPerspective: true },
  ];

  for (let i = 0; i < nodeCount; i++) {
    const t = templates[i % templates.length];
    const node = syntheticTaskNode({
      parentId: prevId,
      type: t.type,
      tags: t.tags,
      payload: `${t.payload} (${i + 1}/${nodeCount})`,
      needsMultiPerspective: t.needsMultiPerspective ?? false,
    });
    nodes.push(node);
    prevId = node.id;
  }

  return nodes;
}

// ═══════════════════════════════════════════════════════════
// 合成记忆模板
// ═══════════════════════════════════════════════════════════

const MEMORY_TEMPLATES: Record<string, string[]> = {
  [MemoryType.Episodic]: [
    "CodeAgent 完成了 bugfix: 修复 null 检查",
    "ReviewAgent 审查了 utils.ts 并提出 3 条建议",
    "AnalysisAgent 分析了性能瓶颈并给出优化方案",
    "用户偏好使用 TypeScript 进行开发",
    "项目使用 pnpm 作为包管理器",
  ],
  [MemoryType.Knowledge]: [
    "上次重构支付模块时因缺少测试导致回滚",
    "使用 ORM 批量操作比逐条操作性能提升 10 倍",
    "生产环境部署必须在低峰期进行",
    "代码审查时发现过 SQL 注入漏洞",
    "TLS 1.2 以下的连接被防火墙拦截",
  ],
};

const AGENT_TYPES: AgentType[] = [
  AgentType.Code,
  AgentType.Review,
  AgentType.Analysis,
  AgentType.Ops,
];

export interface SyntheticMemoryInput {
  memoryType: MemoryType;
  summary: string;
  agentType: AgentType;
  creatorId: string;
  weight?: number;
  isPrivate?: boolean;
}

/** 生成合成记忆数据 */
export function generateSyntheticMemories(
  count: number,
  memoryType: MemoryType = MemoryType.Episodic,
): SyntheticMemoryInput[] {
  const templates = MEMORY_TEMPLATES[memoryType] ?? MEMORY_TEMPLATES[MemoryType.Episodic];
  const entries: SyntheticMemoryInput[] = [];

  for (let i = 0; i < count; i++) {
    entries.push({
      memoryType,
      summary: templates[i % templates.length],
      agentType: AGENT_TYPES[i % AGENT_TYPES.length],
      creatorId: AGENT_TYPES[i % AGENT_TYPES.length],
    });
  }

  return entries;
}

/** 生成带状态标记的合成数据 */
export function generateMemoriesWithStates(
  activeCount: number,
  archivedCount: number,
): Array<{ input: SyntheticMemoryInput; state: MemoryState }> {
  return [
    ...generateSyntheticMemories(activeCount).map((m) => ({ input: m, state: MemoryState.Active })),
    ...generateSyntheticMemories(archivedCount).map((m) => ({ input: m, state: MemoryState.Archived })),
  ];
}
