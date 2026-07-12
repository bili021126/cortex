/**
 * compensation.ts — Engine 层补偿策略
 *
 * 节点失败时计算补偿动作：通知下游 abort、通知上游降级、跳过子节点。
 *
 * @design
 *   1. computeCompensation 是纯函数——输入 failedNodeId + taskBoard，输出 CompensationAction[]
 *   2. 不直接修改 taskBoard——由调用方（scheduling-implementations）根据 action 执行
 *   3. 补偿规则：
 *      - 节点失败 → 所有直接子节点（依赖此节点输出的）→ abort_children
 *      - 节点失败 → 如果因依赖缺失 → degrade（降级为最佳努力输出）
 *      - 根节点失败 → 没有父节点可 abort → 仅 abort_children
 *
 * @module compensation
 */

import type { ITaskBoard } from "./task-board.js";

/** 补偿动作类型 */
export type CompensationEvent = "abort_parent" | "abort_children" | "degrade";

/** 补偿动作——通知指定节点如何处理 */
export interface CompensationAction {
  /** 受影响的节点 ID */
  nodeId: string;
  /** 补偿事件类型 */
  event: CompensationEvent;
  /** 触发此补偿的失败节点 ID（用于日志追踪） */
  triggerNodeId: string;
}

/**
 * 计算节点失败后的补偿动作。
 *
 * @param failedNodeId 失败的节点 ID
 * @param taskBoard 当前任务板（用于查依赖关系）
 * @returns 补偿动作列表（空数组表示无需补偿）
 */
export function computeCompensation(
  failedNodeId: string,
  taskBoard: ITaskBoard,
): CompensationAction[] {
  const actions: CompensationAction[] = [];

  const failedNode = taskBoard.getNode(failedNodeId);
  if (!failedNode) return actions;

  // 1. 如果失败节点有父节点 → 通知父节点降级（子节点失败，父节点输出可能不完整）
  if (failedNode.parentId) {
    actions.push({
      nodeId: failedNode.parentId,
      event: "degrade",
      triggerNodeId: failedNodeId,
    });
  }

  // 2. 找到所有依赖此节点的子节点 → abort_children
  const allNodes = taskBoard.getAllNodes();
  for (const node of allNodes) {
    if (node.parentId === failedNodeId) {
      // 直接子节点：父节点失败 → 子节点 abort
      actions.push({
        nodeId: node.id,
        event: "abort_children",
        triggerNodeId: failedNodeId,
      });
    }
  }

  // 3. 找到间接依赖——通过拓扑链向下游传播
  //    广度优先遍历：查找所有以 failedNodeId 为祖先的节点
  const visitedBfs = new Set<string>([failedNodeId]);
  const actionNodeIds = new Set(actions.map(a => a.nodeId));
  const queue = [failedNodeId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const node of allNodes) {
      if (node.parentId === currentId && !visitedBfs.has(node.id)) {
        visitedBfs.add(node.id);
        queue.push(node.id);
        // 间接子节点也 abort（上游失败 → 下游无法正确执行）
        // 如果尚未在 actions 中（可能已被步骤 2 添加）
        if (!actionNodeIds.has(node.id)) {
          actions.push({
            nodeId: node.id,
            event: "abort_children",
            triggerNodeId: failedNodeId,
          });
        }
      }
    }
  }

  return actions;
}

/**
 * 判断补偿动作是否为"终止类"（需要立即停止节点执行）。
 * abort_parent / abort_children 是终止类，degrade 不是。
 */
export function isTerminalAction(action: CompensationAction): boolean {
  return action.event === "abort_parent" || action.event === "abort_children";
}
