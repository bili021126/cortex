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

import type { TuiEvent, NodeRenderState, NodeRenderStatus } from "../types.js";
import { writeln, style, StyleCode, ColorCode } from "./ansi.js";

// ═══════════════════════════════════════════════════════════
// §1 状态图标
// ═══════════════════════════════════════════════════════════

const STATUS_ICONS: Record<NodeRenderStatus, string> = {
  pending: style("○", StyleCode.dim),
  executing: style("⏳", ColorCode.yellow),
  done: style("✓", ColorCode.green),
  failed: style("✗", ColorCode.red),
  skipped: style("⊘", StyleCode.dim),
};

// ═══════════════════════════════════════════════════════════
// §2 TaskTreeRenderer
// ═══════════════════════════════════════════════════════════

export class TaskTreeRenderer {
  private nodes: Map<string, NodeRenderState> = new Map();

  /** 处理事件 */
  handleEvent(event: TuiEvent): void {
    switch (event.type) {
      case "task_tree_update":
        this.nodes.clear();
        for (const node of event.nodes) {
          this.nodes.set(node.id, {
            nodeId: node.id,
            parentId: node.parentId,
            agent: (node.claimedBy?.[0] ?? "code") as NodeRenderState["agent"],
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
  private updateNode(nodeId: string, partial: Partial<NodeRenderState>): void {
    const existing = this.nodes.get(nodeId);
    if (!existing) return;
    this.nodes.set(nodeId, { ...existing, ...partial });
    this.render();
  }

  /** 计算缩进深度 */
  private calculateDepths(): void {
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
  private render(): void {
    const nodeList = Array.from(this.nodes.values());
    const header = style(
      `📋 任务计划 (${nodeList.length} 节点)`,
      StyleCode.bold,
    );
    const lines = [header];

    // 按树状结构排序并渲染
    const sorted = this.topologicalSort(nodeList);
    for (let i = 0; i < sorted.length; i++) {
      const node = sorted[i];
      const _isLast = i === sorted.length - 1 ||
        !this.isAncestor(node.nodeId, sorted[i + 1]?.nodeId);
      const prefix = this.treePrefix(node.depth, _isLast);
      const icon = STATUS_ICONS[node.status];
      const agentLabel = style(`[${node.agent}]`, StyleCode.dim);
      const desc = style(node.description, StyleCode.dim);
      const duration = node.durationMs !== undefined
        ? style(` (${node.durationMs}ms)`, StyleCode.dim)
        : "";

      const line = `${prefix}${icon} ${agentLabel} ${desc}${duration}`;
      if (node.error) {
        lines.push(line);
        lines.push(
          `  ${" ".repeat(node.depth * 2)}${style(`✗ ${node.error}`, ColorCode.red)}`,
        );
      } else {
        lines.push(line);
      }
    }

    for (const line of lines) {
      writeln(line);
    }
  }

  /** 树形前缀 */
  private treePrefix(depth: number, isLast: boolean): string {
    if (depth === 0) return "";
    const indent = "  ".repeat(depth - 1);
    const branch = isLast ? "└─ " : "├─ ";
    return indent + branch;
  }

  /** 拓扑排序 */
  private topologicalSort(nodes: NodeRenderState[]): NodeRenderState[] {
    const result: NodeRenderState[] = [];
    const visited = new Set<string>();

    const visit = (nodeId: string): void => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const children = nodes.filter((n) => n.parentId === nodeId);
      for (const child of children) {
        visit(child.nodeId);
      }
      const node = nodes.find((n) => n.nodeId === nodeId);
      if (node) result.unshift(node);
    };

    for (const node of nodes) {
      if (!node.parentId) visit(node.nodeId);
    }
    return result;
  }

  /** 检查是否为祖先 */
  private isAncestor(ancestorId: string, descendantId?: string): boolean {
    if (!descendantId) return false;
    let current = this.nodes.get(descendantId)?.parentId;
    while (current) {
      if (current === ancestorId) return true;
      current = this.nodes.get(current)?.parentId;
    }
    return false;
  }

  /** 检查是否是父节点下最后一个子节点 */
  private isLastChild(nodeId: string, sorted: NodeRenderState[]): boolean {
    const node = this.nodes.get(nodeId);
    if (!node?.parentId) return true;
    const siblings = sorted.filter((n) => n.parentId === node.parentId);
    const idx = siblings.findIndex((n) => n.nodeId === nodeId);
    return idx === siblings.length - 1;
  }
}
