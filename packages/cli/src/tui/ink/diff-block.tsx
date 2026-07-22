/**
 * tui/ink/diff-block.tsx — Diff 块 Ink 组件
 *
 * 将 unified diff 文本渲染为带红绿着色的 Ink 组件。
 * 对标 Claude Code 的 inline diff 展示：
 * - `+` 行绿色、`-` 行红色、`@@` hunk 青色、文件头黄色
 * - 超过 maxVisibleLines 自动折叠为摘要（+N / -N）
 * - 可选行号 gutter
 *
 * 消费 design-tokens ENGINEERING palette 的 diff 色值，
 * 但通过 CLI 本地 theme/tokens.ts 的语义色间接引用（保持 CLI 主题独立性）。
 *
 * @module tui/ink/diff-block
 * @since v7 — 三端 UI 设计 Phase P1
 */

import { Box, Text } from "ink";
import { useState } from "react";
import { defaultTokens } from "../theme/tokens.js";

// ═══════════════════════════════════════════════════════════
// §1 类型定义
// ═══════════════════════════════════════════════════════════

/** 解析后的 diff 行 */
interface DiffLine {
  type: "add" | "remove" | "context" | "header" | "file_header" | "hunk";
  text: string;
  /** 原始行号（在 diff 文本中的序号，从 1 开始） */
  lineNo: number;
}

export interface DiffBlockProps {
  /** unified diff 格式文本 */
  diff: string;
  /** 最大可见行数，超过则折叠。默认 20 */
  maxVisibleLines?: number;
  /** 是否显示行号 gutter。默认 false */
  showLineNumbers?: boolean;
  /** 是否默认展开（当超过 maxVisibleLines 时）。默认 false */
  defaultExpanded?: boolean;
  /** 文件名标签（显示在 diff 块顶部）。可选 */
  fileName?: string;
}

// ═══════════════════════════════════════════════════════════
// §2 解析
// ═══════════════════════════════════════════════════════════

/** 解析 unified diff 文本为结构化行 */
function parseDiff(diffText: string): DiffLine[] {
  const lines: DiffLine[] = [];
  const rawLines = diffText.split("\n");
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (raw === undefined) continue;
    let type: DiffLine["type"];
    if (raw.startsWith("diff --git") || raw.startsWith("index ")) {
      type = "header";
    } else if (raw.startsWith("--- ") || raw.startsWith("+++ ")) {
      type = "file_header";
    } else if (raw.startsWith("@@")) {
      type = "hunk";
    } else if (raw.startsWith("+")) {
      type = "add";
    } else if (raw.startsWith("-")) {
      type = "remove";
    } else {
      type = "context";
    }
    lines.push({ type, text: raw, lineNo: i + 1 });
  }
  return lines;
}

/**
 * 判断一段文本是否为 unified diff。
 *
 * 工具 output 多数是成功消息（如 "已写入 42 行"），只有少数真正携带 diff。
 * 接线前用此闸门过滤，避免把普通文本误渲染进 diff 框。
 * 判据：含 hunk 头(`@@ ... @@`) 或 git diff 头(`diff --git`)——二者是 unified diff 的强特征。
 */
export function looksLikeDiff(text: string): boolean {
  if (!text) return false;
  return /^@@[ +\-\d,]+@@/m.test(text) || /^diff --git /m.test(text);
}

/** 统计增删行数 */
function countChanges(lines: DiffLine[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const l of lines) {
    if (l.type === "add") additions++;
    else if (l.type === "remove") deletions++;
  }
  return { additions, deletions };
}

// ═══════════════════════════════════════════════════════════
// §3 行渲染
// ═══════════════════════════════════════════════════════════

/** 单行颜色映射 */
function lineColor(type: DiffLine["type"]): string {
  const t = defaultTokens;
  switch (type) {
    case "add":
      return t.color.semantic.success;
    case "remove":
      return t.color.semantic.error;
    case "hunk":
      return t.color.semantic.info;
    case "file_header":
      return t.color.semantic.warning;
    case "header":
      return t.color.text.primary;
    default:
      return t.color.text.secondary;
  }
}

/** 行前缀符号 */
function linePrefix(type: DiffLine["type"]): string {
  switch (type) {
    case "add":
      return "+";
    case "remove":
      return "-";
    case "hunk":
      return "";
    default:
      return " ";
  }
}

/** 渲染单行 */
function DiffLineView({ line, showLineNo }: { line: DiffLine; showLineNo: boolean }): React.ReactElement {
  const color = lineColor(line.type);
  const isMeta = line.type === "header" || line.type === "file_header" || line.type === "hunk";

  return (
    <Box>
      {showLineNo && (
        <Text color={defaultTokens.color.text.muted} dimColor>
          {String(line.lineNo).padStart(4)}{" "}
        </Text>
      )}
      <Text color={color} bold={line.type === "header"} dimColor={line.type === "context"}>
        {isMeta ? line.text : `${linePrefix(line.type)} ${line.text.slice(1) || ""}`}
      </Text>
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════
// §4 主组件
// ═══════════════════════════════════════════════════════════

/**
 * DiffBlock — 内联 diff 渲染组件
 *
 * 用法：
 * ```tsx
 * <DiffBlock diff={unifiedDiffText} fileName="src/index.ts" />
 * ```
 *
 * 超过 maxVisibleLines 时显示折叠摘要：
 * ```
 * ┌ src/index.ts ─────────────────────┐
 * │ +3 / -2 (5 changes)  [E]xpand    │
 * └───────────────────────────────────┘
 * ```
 */
export function DiffBlock({
  diff,
  maxVisibleLines = 20,
  showLineNumbers = false,
  defaultExpanded = false,
  fileName,
}: DiffBlockProps): React.ReactElement {
  const [expanded] = useState(defaultExpanded);
  const tokens = defaultTokens;

  const lines = parseDiff(diff);
  const { additions, deletions } = countChanges(lines);
  const totalChanges = additions + deletions;
  const needsCollapse = lines.length > maxVisibleLines;
  const visibleLines = needsCollapse && !expanded ? lines.slice(0, maxVisibleLines) : lines;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={tokens.color.border.subtle}
      paddingX={1}
    >
      {/* 文件名标签 */}
      {fileName && (
        <Box marginBottom={0}>
          <Text color={tokens.color.semantic.warning} bold>
            {fileName}
          </Text>
          <Text color={tokens.color.text.muted}>
            {"  "}+{additions} / -{deletions}
          </Text>
        </Box>
      )}

      {/* Diff 行 */}
      {visibleLines.map((line) => (
        <DiffLineView key={line.lineNo} line={line} showLineNo={showLineNumbers} />
      ))}

      {/* 折叠提示 */}
      {needsCollapse && !expanded && (
        <Box marginTop={0}>
          <Text color={tokens.color.text.muted} italic>
            {"  "}··· {lines.length - maxVisibleLines} more lines (
            <Text color={tokens.color.semantic.success}>+{additions}</Text>
            {" / "}
            <Text color={tokens.color.semantic.error}>-{deletions}</Text>
            ) — press [E] to expand
          </Text>
        </Box>
      )}

      {/* 展开后的收起提示 */}
      {needsCollapse && expanded && (
        <Box marginTop={0}>
          <Text color={tokens.color.text.muted} italic>
            {"  "}— {totalChanges} changes total —
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * DiffSummary — 单行 diff 摘要（用于工具调用结果折叠态）
 *
 * 显示为: `+3 / -2 in src/index.ts`
 */
export function DiffSummary({ diff, fileName }: { diff: string; fileName?: string }): React.ReactElement {
  const lines = parseDiff(diff);
  const { additions, deletions } = countChanges(lines);
  const tokens = defaultTokens;

  return (
    <Box>
      <Text color={tokens.color.semantic.success}>+{additions}</Text>
      <Text color={tokens.color.text.muted}> / </Text>
      <Text color={tokens.color.semantic.error}>-{deletions}</Text>
      {fileName && (
        <Text color={tokens.color.text.secondary}> in {fileName}</Text>
      )}
    </Box>
  );
}
