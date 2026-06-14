import type { IPipelineObserver, TaskNode } from "@cortex/shared";
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
export declare function topologicalSort(nodes: TaskNode[], observer?: IPipelineObserver): string[][];
//# sourceMappingURL=topological-sort.d.ts.map