/**
 * tui/ink/chat-view.tsx — 聊天视图组件（v6 Token + 动画整合）
 *
 * 渲染会话消息列表：user / assistant / system 三种角色，
 * 流式输出使用 Typewriter 动画，工具调用内嵌显示，消息分隔线。
 * 消费 Design Token，Agent 颜色通过 character-theme 获取。
 *
 * @module tui/ink/chat-view
 * @since v5 — Ink 重构 Phase 1 → v6 Token + 动画整合
 */

import { Box, Text } from "ink";
import { AGENT_DISPLAY_BY_TYPE, AGENT_DISPLAY_FALLBACK } from "@cortex/shared";
import type { AgentType } from "@cortex/shared";
import type { SessionMessage, ToolCallRecord, TaskNodeView, PlanState } from "./session-reducer.js";
import { TaskTree } from "./task-tree.js";
import { inkTheme } from "../theme/adapter-ink.js";
import { defaultTokens } from "../theme/tokens.js";
import { getCharacterColor } from "../theme/character-theme.js";
import { Typewriter } from "../animation/components/Typewriter.js";
import { Spinner } from "../animation/components/Spinner.js";
import { DiffSummary, looksLikeDiff } from "./diff-block.js";

export interface ChatViewProps {
  messages: SessionMessage[];
  streamingContent: string;
  agent: AgentType;
  recentTools: ToolCallRecord[];
  isProcessing: boolean;
  visibleOffset: number;
  /** Plan 模式相关 */
  planNodes?: TaskNodeView[];
  planState?: PlanState;
}

/** 渲染单条工具调用记录（内嵌在消息流中） */
function ToolCallInline({ record }: { record: ToolCallRecord }) {
  const t = inkTheme;
  const tokens = defaultTokens;

  // 状态图标 + 颜色
  let statusIcon: string;
  let statusColor: string;
  if (record.success === undefined) {
    statusIcon = "";  // 使用 Spinner
    statusColor = tokens.color.status.executing;
  } else if (record.success) {
    statusIcon = "✅";
    statusColor = tokens.color.status.complete;
  } else {
    statusIcon = "❌";
    statusColor = tokens.color.status.error;
  }

  const duration = record.durationMs != null ? ` · ${record.durationMs}ms` : "";
  const error = record.error ? ` · ${record.error}` : "";

  // 工具 output 若为 unified diff，成功后附一行增删摘要
  const showDiff = record.success === true && !!record.output && looksLikeDiff(record.output);

  return (
    <Box flexDirection="column" marginLeft={tokens.spacing.md}>
      <Box>
        {record.success === undefined ? (
          <Spinner style="dots" color={statusColor} />
        ) : (
          <Text color={statusColor}>{statusIcon}</Text>
        )}
        <Text color={t.textMuted.color}>
          {" "}{record.tool}
          {duration}
          {error}
        </Text>
      </Box>
      {showDiff && record.output && (
        <Box marginLeft={tokens.spacing.sm}>
          <DiffSummary diff={record.output} />
        </Box>
      )}
    </Box>
  );
}

/** 渲染流式输出行（带 Typewriter 动画） */
function StreamingLine({ content, agent }: { content: string; agent: AgentType }) {
  const display = AGENT_DISPLAY_BY_TYPE[agent] ?? AGENT_DISPLAY_FALLBACK;
  const t = inkTheme;
  const charColor = getCharacterColor(agent);

  return (
    <Box marginBottom={1}>
      <Text color={charColor?.primary ?? t.primary.color} bold>
        {display.emoji} {display.name}:{" "}
      </Text>
      <Typewriter
        text={content}
        isStreaming
        options={{ speed: "fast" }}
        color={t.textPrimary.color}
      />
    </Box>
  );
}

/** 渲染分隔线（每轮对话之间） */
function Separator() {
  const t = inkTheme;
  return (
    <Box>
      <Text color={t.separator.color}>{"─".repeat(40)}</Text>
    </Box>
  );
}

/** 判断是否需要在两条消息之间插入分隔线 */
function needsSeparator(prev: SessionMessage, curr: SessionMessage): boolean {
  // user → assistant 转换时加分隔（一轮对话结束）
  return prev.role === "assistant" && curr.role === "user";
}

export function ChatView({
  messages,
  streamingContent,
  agent,
  recentTools,
  isProcessing,
  visibleOffset,
  planNodes,
  planState,
}: ChatViewProps) {
  const display = AGENT_DISPLAY_BY_TYPE[agent] ?? AGENT_DISPLAY_FALLBACK;
  const t = inkTheme;
  const tokens = defaultTokens;

  // ── 空状态 ────────────────────────────────
  if (messages.length === 0 && !streamingContent && recentTools.length === 0 && (!planNodes || planNodes.length === 0)) {
    return (
      <Box paddingX={tokens.spacing.xs}>
        <Text color={t.textMuted.color}>
          {display.emoji} {display.name} — 输入 .help 查看命令
        </Text>
      </Box>
    );
  }

  // ── 构建渲染行 ────────────────────────────
  const rows: React.ReactNode[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    const prev = i > 0 ? messages[i - 1] : undefined;

    // 分隔线
    if (prev && needsSeparator(prev, msg)) {
      rows.push(<Separator key={`sep-${i}`} />);
    }

    if (msg.role === "user") {
      rows.push(
        <Box key={`msg-${i}`} marginBottom={1}>
          <Text bold color={t.textPrimary.color}>{tokens.typography.messagePrefix.user}: </Text>
          <Text>{msg.content}</Text>
        </Box>,
      );
    } else if (msg.role === "system") {
      rows.push(
        <Box key={`msg-${i}`} marginBottom={1}>
          <Text color={t.textMuted.color}>{msg.content}</Text>
        </Box>,
      );
    } else {
      // assistant — 使用角色主题色
      const agentDisplay = msg.agent
        ? (AGENT_DISPLAY_BY_TYPE[msg.agent] ?? AGENT_DISPLAY_FALLBACK)
        : display;
      const charColor = msg.agent ? getCharacterColor(msg.agent) : null;
      const nameColor = charColor?.primary ?? t.primary.color;

      rows.push(
        <Box key={`msg-${i}`} marginBottom={1}>
          <Text color={nameColor} bold>
            {agentDisplay.emoji} {agentDisplay.name}:{" "}
          </Text>
          <Text>{msg.content}</Text>
        </Box>,
      );
    }
  }

  // ─ 工具调用记录（在消息下方） ─────────────
  for (const record of recentTools) {
    rows.push(<ToolCallInline key={`tool-${record.id}`} record={record} />);
  }

  // ── 流式输出 ──────────────────────────────
  if (streamingContent) {
    rows.push(<StreamingLine key="streaming" content={streamingContent} agent={agent} />);
  }

  // ── 处理中指示 ────────────────────────────
  if (isProcessing && !streamingContent && recentTools.length === 0 && messages.length > 0) {
    rows.push(
      <Box key="processing" marginBottom={1}>
        <Spinner style="dots" color={tokens.color.status.thinking} />
        <Text color={t.textMuted.color}> 处理中...</Text>
      </Box>,
    );
  }

  // ── Plan 任务树 ───────────────────────────
  if (planNodes && planNodes.length > 0) {
    rows.push(<TaskTree key="task-tree" nodes={planNodes} />);
  }

  // ─ Plan 审批提示 ─────────────────────────
  if (planState === "reviewing") {
    rows.push(
      <Box key="plan-prompt" marginTop={1}>
        <Text color={tokens.color.semantic.warning}>💡 说"好的"执行计划，或继续对话修改方案</Text>
      </Box>,
    );
  }

  // ── 滚动裁剪 ──────────────────────────────
  // visibleOffset = 0 显示全部；> 0 时从底部向上偏移（隐藏最新 N 行，露出更早的消息）
  const visibleRows = visibleOffset > 0 && rows.length > visibleOffset
    ? rows.slice(0, rows.length - visibleOffset)
    : rows;

  return (
    <Box flexDirection="column" paddingX={tokens.spacing.xs}>
      {visibleRows}
    </Box>
  );
}
