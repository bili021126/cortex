/**
 * tui/ink/task-tree.tsx — 任务树渲染组件
 *
 * 将 TaskNode[] 渲染为终端树形结构。
 * 消费 Design Token，执行中节点使用 Spinner 动画。
 *
 * @module tui/ink/task-tree
 * @since v5 — Ink 重构 Phase 3 → v6 Token + 动画整合
 */

import { Box, Text } from "ink";
import type { TaskNodeView, NodeRenderStatus } from "./session-reducer.js";
import { inkTheme } from "../theme/adapter-ink.js";
import { defaultTokens } from "../theme/tokens.js";
import { Spinner } from "../animation/components/Spinner.js";

export interface TaskTreeProps {
  nodes: TaskNodeView[];
  title?: string;
}

// ─── 图标映射 ──────────────────────────────────

const STATUS_ICONS: Record<NodeRenderStatus, string> = {
  pending: "○",
  executing: "",  // 使用 Spinner 替代
  done: "✅",
  failed: "❌",
  skipped: "⏭",
};

const TYPE_ICONS: Record<string, string> = {
  code: "🔨",
  implementation: "🔨",
  review: "🔍",
  analysis: "🧠",
  design: "",
  test: "🧪",
  refactor: "♻",
  docs: "📝",
  deploy: "🚀",
  research: "",
  default: "📋",
};

function getTypeIcon(type: string): string {
  return (TYPE_ICONS[type.toLowerCase()] ?? TYPE_ICONS.default) as string;
}

// ─── 树构建 ────────────────────────────────────

interface TreeNode {
  node: TaskNodeView;
  children: TreeNode[];
}

function buildTree(nodes: TaskNodeView[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // 第一遍：创建所有节点
  for (const node of nodes) {
    map.set(node.id, { node, children: [] });
  }

  // 第二遍：建立父子关系
  for (const tn of map.values()) {
    const parent = tn.node.parentId ? map.get(tn.node.parentId) : undefined;
    if (parent) {
      parent.children.push(tn);
    } else {
      roots.push(tn);
    }
  }

  return roots;
}

// ─── 进度统计 ──────────────────────────────────

function getProgress(nodes: TaskNodeView[]): { done: number; total: number; failed: number } {
  let done = 0;
  let failed = 0;
  for (const n of nodes) {
    if (n.renderStatus === "done") done++;
    if (n.renderStatus === "failed") failed++;
  }
  return { done, total: nodes.length, failed };
}

// ─── 递归渲染 ──────────────────────────────────

function renderNode(
  treeNode: TreeNode,
  prefix: string,
  isLast: boolean,
  depth: number,
): React.ReactNode {
  const { node } = treeNode;
  const connector = depth === 0 ? "" : isLast ? "└─ " : "├─ ";
  const childPrefix = depth === 0 ? "" : isLast ? "   " : "│  ";
  const icon = getTypeIcon(node.type);
  const multiTag = node.needsMultiPerspective ? " [多视角]" : "";
  const tags = node.tags.length > 0 ? ` {${node.tags.join(", ")}}` : "";
  const t = inkTheme;
  const tokens = defaultTokens;

  // 截断过长的 payload
  const maxPayloadLen = 60;
  const payload = node.payload.length > maxPayloadLen
    ? node.payload.slice(0, maxPayloadLen) + "…"
    : node.payload;

  // 状态渲染：executing 使用 Spinner，其余使用静态图标
  let statusElement: React.ReactNode;
  if (node.renderStatus === "executing") {
    statusElement = <Spinner style="dots" color={tokens.color.status.executing} />;
  } else {
    const statusIcon = STATUS_ICONS[node.renderStatus] ?? "";
    const statusColor = node.renderStatus === "done"
      ? tokens.color.status.complete
      : node.renderStatus === "failed"
        ? tokens.color.status.error
        : t.textMuted.color;
    statusElement = <Text color={statusColor}>{statusIcon}</Text>;
  }

  const nodeLine = (
    <Box key={node.id}>
      <Text>
        {prefix}{connector}
      </Text>
      {statusElement}
      <Text> {icon} {payload}{tags}{multiTag}</Text>
    </Box>
  );

  const children = treeNode.children.map((child, i) =>
    renderNode(child, prefix + childPrefix, i === treeNode.children.length - 1, depth + 1),
  );

  return (
    <Box key={node.id} flexDirection="column">
      {nodeLine}
      {children}
    </Box>
  );
}

// ─── 组件 ──────────────────────────────────────

export function TaskTree({ nodes, title = "📋 任务计划" }: TaskTreeProps) {
  if (nodes.length === 0) return null;

  const roots = buildTree(nodes);
  const progress = getProgress(nodes);
  const t = inkTheme;
  const tokens = defaultTokens;

  const progressText = progress.total > 0
    ? ` (${progress.done}/${progress.total}${progress.failed > 0 ? ` · ${progress.failed} 失败` : ""})`
    : "";

  return (
    <Box flexDirection="column" paddingX={tokens.spacing.xs} marginTop={tokens.spacing.xs}>
      <Box>
        <Text bold color={t.primary.color}>{title}{progressText}</Text>
      </Box>
      <Box>
        <Text color={t.separator.color}>{"═".repeat(50)}</Text>
      </Box>
      {roots.map((root, i) =>
        renderNode(root, "", i === roots.length - 1, 0),
      )}
    </Box>
  );
}
