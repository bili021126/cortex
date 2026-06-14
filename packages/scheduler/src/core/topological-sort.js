import { PipelineEventType, PipelinePriority } from "@cortex/shared";
/**
 * 拓扑排序：按 parentId 依赖关系分层。
 *
 * 边类型语义（@since RLM 递归拆解——思考执行体系总纲 §三）：
 *   hard (默认): 子节点排在父节点之后一层——绝对等待
 *   soft:       子节点与父节点同层——并行启动，收敛时等结果
 *   trigger:    同 soft 分层，但父失败则子跳过（由调度层处理）
 *
 * 无 parentId（根节点）→ 第 0 层。
 *
 * @returns 二维数组，每层包含该层所有节点 ID
 *          循环依赖时返回空数组（由调用方将节点标记为 failed）
 */
export function topologicalSort(nodes, observer) {
    const idSet = new Set(nodes.map((n) => n.id));
    const children = new Map(); // parentId → childIds
    const roots = [];
    const dangling = new Set(); // @fix P2-7 — 追踪悬挂 parentId
    /** 软边/触发边子节点：parentId → childIds（与父节点同层） */
    const softChildren = new Map();
    for (const n of nodes) {
        if (!n.parentId || !idSet.has(n.parentId)) {
            if (n.parentId && !idSet.has(n.parentId)) {
                dangling.add(n.parentId);
            }
            roots.push(n.id);
        }
        else {
            const edgeType = n.edgeType ?? "hard";
            if (edgeType === "soft" || edgeType === "trigger") {
                const list = softChildren.get(n.parentId) ?? [];
                list.push(n.id);
                softChildren.set(n.parentId, list);
            }
            else {
                const list = children.get(n.parentId) ?? [];
                list.push(n.id);
                children.set(n.parentId, list);
            }
        }
    }
    // 悬挂 parentId 警告：父节点不在当前集合中，子节点被提升为根
    if (dangling.size > 0) {
        if (observer) {
            observer.emit({
                type: PipelineEventType.SchedulerNonstandardType,
                priority: PipelinePriority.NORMAL,
                payload: { danglings: [...dangling].slice(0, 10), total: dangling.size },
                timestamp: Date.now(),
                notificationType: "FYI",
            });
        }
    }
    // 循环依赖检测：roots 为空但有节点 → 存在循环依赖
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
        return [];
    }
    // BFS 分层（硬边子节点进入下一层，软边/触发边子节点进入同层）
    const layers = [];
    let current = roots;
    while (current.length > 0) {
        layers.push(current);
        const next = [];
        for (const id of current) {
            // 硬边子节点 → 下一层
            const kids = children.get(id);
            if (kids)
                next.push(...kids);
            // 软边/触发边子节点 → 同层（注入当前层，本轮并行执行）
            const softKids = softChildren.get(id);
            if (softKids) {
                // 注入当前层数组，保证与父节点同轮并行
                current.push(...softKids);
            }
        }
        current = next;
    }
    return layers;
}
//# sourceMappingURL=topological-sort.js.map