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
import { writeln, style, StyleCode, ColorCode, eraseLine, cursorUp } from "./ansi.js";
import * as readline from "node:readline";
// ═══════════════════════════════════════════════════════════
// §1 状态图标
// ═══════════════════════════════════════════════════════════
const STATUS_ICONS = {
    pending: style("○", StyleCode.dim),
    executing: style("⏳", ColorCode.yellow),
    done: style("✓", ColorCode.green),
    failed: style("✗", ColorCode.red),
    skipped: style("⊘", StyleCode.dim),
};
export class TaskTreeRenderer {
    nodes = new Map();
    /** 交互模式下当前焦点索引 */
    focusedIndex = 0;
    /** 交互模式标志 */
    interactiveMode = false;
    /** 已折叠的节点集合 */
    collapsedNodes = new Set();
    /** 上次渲染的行数（用于原地刷新） */
    lastRenderLines = 0;
    /** 处理事件 */
    handleEvent(event) {
        switch (event.type) {
            case "task_tree_update":
                this.nodes.clear();
                for (const node of event.nodes) {
                    this.nodes.set(node.id, {
                        nodeId: node.id,
                        parentId: node.parentId,
                        agent: (node.claimedBy?.[0] ?? "code"),
                        description: node.payload ?? "",
                        status: this.nodes.get(node.id)?.status ?? "pending",
                        depth: 0,
                    });
                }
                this.calculateDepths();
                this.render();
                break;
            case "node_start":
                this.updateNode(event.nodeId, { status: "executing" });
                break;
            case "node_complete":
                this.updateNode(event.nodeId, {
                    status: "done",
                    output: event.output,
                    durationMs: event.durationMs,
                });
                break;
            case "node_failed":
                this.updateNode(event.nodeId, {
                    status: "failed",
                    error: event.error,
                    durationMs: event.durationMs,
                });
                break;
        }
    }
    /** 更新单个节点 */
    updateNode(nodeId, partial) {
        const existing = this.nodes.get(nodeId);
        if (!existing)
            return;
        this.nodes.set(nodeId, { ...existing, ...partial });
        this.render();
    }
    /** 计算缩进深度 */
    calculateDepths() {
        for (const node of this.nodes.values()) {
            let depth = 0;
            let current = node.parentId;
            while (current && this.nodes.has(current)) {
                depth++;
                current = this.nodes.get(current)?.parentId;
            }
            node.depth = depth;
        }
    }
    /** 渲染任务树 */
    render() {
        const nodeList = Array.from(this.nodes.values());
        const header = style(`📋 任务计划 (${nodeList.length} 节点)`, StyleCode.bold);
        const lines = [header];
        // 按树状结构排序并渲染
        const sorted = this.topologicalSort(nodeList);
        let lineIndex = 0;
        for (const node of sorted) {
            // 检查是否被折叠
            if (this.isNodeCollapsed(node))
                continue;
            const hasChildren = nodeList.some(n => n.parentId === node.nodeId);
            const isCollapsed = this.collapsedNodes.has(node.nodeId);
            const _isLast = this.isLastChild(node.nodeId, sorted);
            const prefix = this.treePrefix(node.depth, _isLast);
            const icon = STATUS_ICONS[node.status];
            const agentLabel = style(`[${node.agent}]`, StyleCode.dim);
            const desc = style(node.description, StyleCode.dim);
            const duration = node.durationMs !== undefined
                ? style(` (${node.durationMs}ms)`, StyleCode.dim)
                : "";
            const expandIcon = hasChildren
                ? (isCollapsed ? "▸ " : "▾ ")
                : "  ";
            let line = `${prefix}${expandIcon}${icon} ${agentLabel} ${desc}${duration}`;
            // 高亮当前焦点行
            if (this.interactiveMode && lineIndex === this.focusedIndex) {
                line = style(line, StyleCode.bold + ColorCode.cyan);
            }
            if (node.error) {
                lines.push(line);
                lines.push(`  ${" ".repeat(node.depth * 2)}${style(`✗ ${node.error}`, ColorCode.red)}`);
            }
            else {
                lines.push(line);
            }
            lineIndex++;
        }
        // 交互模式下添加操作提示
        if (this.interactiveMode) {
            lines.push("");
            lines.push(style(" j/k 移动  Space 切换  d 跳过  Enter 折叠  r 重置  q 退出", StyleCode.dim));
        }
        this.lastRenderLines = lines.length;
        for (const line of lines) {
            writeln(line);
        }
    }
    /** 树形前缀 */
    treePrefix(depth, isLast) {
        if (depth === 0)
            return "";
        const indent = "  ".repeat(depth - 1);
        const branch = isLast ? "└─ " : "├─ ";
        return indent + branch;
    }
    /** 拓扑排序 */
    topologicalSort(nodes) {
        const result = [];
        const visited = new Set();
        const visit = (nodeId) => {
            if (visited.has(nodeId))
                return;
            visited.add(nodeId);
            const children = nodes.filter((n) => n.parentId === nodeId);
            for (const child of children) {
                visit(child.nodeId);
            }
            const node = nodes.find((n) => n.nodeId === nodeId);
            if (node)
                result.unshift(node);
        };
        for (const node of nodes) {
            if (!node.parentId)
                visit(node.nodeId);
        }
        return result;
    }
    /** 检查是否为祖先 */
    isAncestor(ancestorId, descendantId) {
        if (!descendantId)
            return false;
        let current = this.nodes.get(descendantId)?.parentId;
        while (current) {
            if (current === ancestorId)
                return true;
            current = this.nodes.get(current)?.parentId;
        }
        return false;
    }
    // ═══════════════════════════════════════════════════════
    // 交互模式
    // ═══════════════════════════════════════════════════════
    /** 过滤可见节点（已折叠子节点隐藏） */
    filterVisible(sorted) {
        const hidden = new Set();
        for (const [id] of this.collapsedNodes) {
            this.collectDescendants(id, sorted, hidden);
        }
        return sorted.filter(n => !hidden.has(n.nodeId));
    }
    /** 检测节点是否因其父节点被折叠而不可见 */
    isNodeCollapsed(node) {
        let current = node.parentId;
        while (current) {
            if (this.collapsedNodes.has(current))
                return true;
            current = this.nodes.get(current)?.parentId;
        }
        return false;
    }
    /** 收集后代节点 ID */
    collectDescendants(parentId, sorted, out) {
        for (const node of sorted) {
            if (node.parentId === parentId) {
                out.add(node.nodeId);
                this.collectDescendants(node.nodeId, sorted, out);
            }
        }
    }
    /** 获取可见节点列表（带索引） */
    getVisibleNodes() {
        const sorted = this.topologicalSort(Array.from(this.nodes.values()));
        return sorted.filter(n => !this.isNodeCollapsed(n));
    }
    /**
     * 进入交互式 review 模式。
     * 接管终端，支持键盘操作 todo 面板。
     */
    async interactiveReview() {
        if (this.nodes.size === 0)
            return;
        this.interactiveMode = true;
        this.focusedIndex = 0;
        // 保存终端状态
        const prevRaw = process.stdin.isRaw;
        process.stdin.setRawMode?.(true);
        return await new Promise((resolve) => {
            const rl = readline.createInterface({ input: process.stdin, escapeCodeTimeout: 50 });
            readline.emitKeypressEvents(process.stdin, rl);
            const onKeypress = (_str, key) => {
                if (!key)
                    return;
                const action = this.resolveKeyAction(key);
                if (action === "exit") {
                    cleanup();
                    resolve();
                    return;
                }
                if (action) {
                    this.handleAction(action);
                    this.redraw();
                }
            };
            const cleanup = () => {
                process.stdin.removeListener("keypress", onKeypress);
                if (prevRaw !== undefined)
                    process.stdin.setRawMode?.(prevRaw);
                rl.close();
                this.interactiveMode = false;
                this.focusedIndex = 0;
                // 最后渲染一次（不带高亮）
                this.redraw();
            };
            process.stdin.on("keypress", onKeypress);
            // 初始渲染
            this.redraw();
        });
    }
    /** 键盘 → Action 映射 */
    resolveKeyAction(key) {
        switch (key.name) {
            case "j":
            case "down": return "move_down";
            case "k":
            case "up": return "move_up";
            case "space": return "toggle";
            case "return": return "expand";
            case "d": return key.ctrl ? null : "skip";
            case "r": return key.ctrl ? null : "reset_all";
            case "q": return "exit";
            case "escape": return "exit";
        }
        // 字符 fallback（部分终端不识别 key.name）
        if (key.sequence === "j" || key.sequence === "J")
            return "move_down";
        if (key.sequence === "k" || key.sequence === "K")
            return "move_up";
        if (key.sequence === " ")
            return "toggle";
        if (key.sequence === "d" || key.sequence === "D")
            return "skip";
        if (key.sequence === "r" || key.sequence === "R")
            return "reset_all";
        if (key.sequence === "q" || key.sequence === "Q")
            return "exit";
        return null;
    }
    /** 执行操作 */
    handleAction(action) {
        const visible = this.getVisibleNodes();
        if (visible.length === 0)
            return;
        switch (action) {
            case "move_down":
                this.focusedIndex = Math.min(this.focusedIndex + 1, visible.length - 1);
                break;
            case "move_up":
                this.focusedIndex = Math.max(this.focusedIndex - 1, 0);
                break;
            case "toggle": {
                const node = visible[this.focusedIndex];
                if (node) {
                    node.status = node.status === "done" ? "pending" : "done";
                    this.nodes.set(node.nodeId, node);
                }
                break;
            }
            case "skip": {
                const node = visible[this.focusedIndex];
                if (node) {
                    node.status = node.status === "skipped" ? "pending" : "skipped";
                    this.nodes.set(node.nodeId, node);
                }
                break;
            }
            case "expand": {
                const node = visible[this.focusedIndex];
                if (node) {
                    if (this.collapsedNodes.has(node.nodeId)) {
                        this.collapsedNodes.delete(node.nodeId);
                    }
                    else {
                        this.collapsedNodes.add(node.nodeId);
                    }
                }
                break;
            }
            case "reset_all":
                for (const node of this.nodes.values()) {
                    node.status = "pending";
                    this.nodes.set(node.nodeId, node);
                }
                this.collapsedNodes.clear();
                break;
        }
    }
    /** 原地刷新——清除上次渲染的所有行后重绘 */
    redraw() {
        // 上移并清除上次渲染的行
        for (let i = 0; i < this.lastRenderLines; i++) {
            process.stdout.write(cursorUp(1));
            process.stdout.write(eraseLine);
        }
        // 重绘
        this.render();
    }
    isLastChild(nodeId, sorted) {
        const node = this.nodes.get(nodeId);
        if (!node?.parentId)
            return true;
        const siblings = sorted.filter((n) => n.parentId === node.parentId);
        const idx = siblings.findIndex((n) => n.nodeId === nodeId);
        return idx === siblings.length - 1;
    }
}
//# sourceMappingURL=task-tree.js.map