import type { TaskNode } from "@cortex/shared";
import { PipelinePriority, PipelineEventType } from "@cortex/shared";
import type { IPipelineObserver } from "@cortex/shared";

/**
 * 拓扑排序：按 parentId 依赖关系分层。
 * 无 parentId（根节点）→ 第 0 层，子节点排在父节点之后一层。
 *
 * @returns 二维数组，每层包含该层所有节点 ID
 *          循环依赖时返回空数组（由调用方将节点标记为 failed）
 */
export function topologicalSort(nodes: TaskNode[], observer?: IPipelineObserver): string[][] {
  const idSet = new Set(nodes.map((n) => n.id));
  const children = new Map<string, string[]>(); // parentId → childIds
  const roots: string[] = [];
  const dangling = new Set<string>(); // @fix P2-7 — 追踪悬挂 parentId

  for (const n of nodes) {
    if (!n.parentId || !idSet.has(n.parentId)) {
      if (n.parentId && !idSet.has(n.parentId)) {
        dangling.add(n.parentId);
      }
      roots.push(n.id);
    } else {
      const list = children.get(n.parentId) ?? [];
      list.push(n.id);
      children.set(n.parentId, list);
    }
  }

  // @fix P2-7 — 悬挂 parentId 警告：父节点不在当前集合中，子节点被提升为根
  if (dangling.size > 0) {
    const _msg = `topologicalSort: ${dangling.size} dangling parentId(s) promoted to root: ${[...dangling].slice(0, 5).join(", ")}`;
    if (observer) {
      observer.emit({
        type: PipelineEventType.SchedulerNonstandardType,
        priority: PipelinePriority.NORMAL,
        payload: { danglings: [...dangling].slice(0, 10), total: dangling.size },
        timestamp: Date.now(),
        notificationType: "FYI",
      });
    }
    // @fix P0-4 — console.warn 已移除，事件已通过 observer.emit 走 PipelineObserver 统一管道（原则五）
  }

  // @fix C-01 — 循环依赖检测：roots 为空但有节点 → 存在循环依赖
  if (roots.length === 0 && nodes.length > 0) {
    const cycleIds = nodes.slice(0, 10).map((n) => n.id).join(", ");
    const msg = `topologicalSort: circular dependency detected among ${nodes.length} nodes — all parentId references form a cycle, no roots found. Affected nodes: [${cycleIds}]`;
    if (observer) {
      observer.emit({
        type: PipelineEventType.SchedulerInvariantViolation,
        priority: PipelinePriority.CRITICAL,
        payload: {
          nodeId: nodes[0].id,
          message: msg,
        },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    }
    // @fix P0-4 — console.error 已移除，事件已通过 observer.emit 走 PipelineObserver 统一管道（原则五）
    return []; // 返回空 layers，由调用方（executeAll）将节点标记为 failed
  }

  // BFS 分层
  const layers: string[][] = [];
  let current = roots;
  while (current.length > 0) {
    layers.push(current);
    const next: string[] = [];
    for (const id of current) {
      const kids = children.get(id);
      if (kids) next.push(...kids);
    }
    current = next;
  }

  return layers;
}
