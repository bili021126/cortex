/**
 * tui/renderer/task-tree.ts — 任务树渲染器
 *
 * 渲染多 Agent 协作的任务树——递归缩进显示节点层次结构。
 * 支持节点开始/完成/失败事件，实时更新每个节点的状态图标。
 *
 * 渲染格式：
 * ```
 * 📋 任务计划 (3 节点)
 *   ├─ ⏳ code: 初始化项目结构
 *   ├─ ✅ review: 代码审查
 *   └─ 🔄 test: 运行测试
 * ```
 *
 * @module tui/renderer/task-tree
 * @since v3 — CLI TUI 全栈重构
 */
import type { TuiEvent } from "../types.js";
export declare class TaskTreeRenderer {
    private nodes;
    /** 交互模式下当前焦点索引 */
    private focusedIndex;
    /** 交互模式标志 */
    private interactiveMode;
    /** 已折叠的节点集合 */
    private collapsedNodes;
    /** 上次渲染的行数（用于原地刷新） */
    private lastRenderLines;
    /** 处理事件 */
    handleEvent(event: TuiEvent): void;
    /** 更新单个节点 */
    private updateNode;
    /** 计算缩进深度 */
    private calculateDepths;
    /** 渲染任务树 */
    private render;
    /** 树形前缀 */
    private treePrefix;
    /** 拓扑排序 */
    private topologicalSort;
    /** 检查是否为祖先 */
    private isAncestor;
    /** 过滤可见节点（已折叠子节点隐藏） */
    private filterVisible;
    /** 检测节点是否因其父节点被折叠而不可见 */
    private isNodeCollapsed;
    /** 收集后代节点 ID */
    private collectDescendants;
    /** 获取可见节点列表（带索引） */
    private getVisibleNodes;
    /**
     * 进入交互式 review 模式。
     * 接管终端，支持键盘操作 todo 面板。
     */
    interactiveReview(): Promise<void>;
    /** 键盘 → Action 映射 */
    private resolveKeyAction;
    /** 执行操作 */
    private handleAction;
    /** 原地刷新——清除上次渲染的所有行后重绘 */
    private redraw;
    private isLastChild;
}
//# sourceMappingURL=task-tree.d.ts.map