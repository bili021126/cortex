/**
 * tui/ink/group-view.tsx — 群聊视图组件（v6 Token 整合）
 *
 * 将 GroupChatManager 的任务群数据渲染为 Ink 组件。
 * 消费 Design Token，Agent 颜色通过 character-theme 获取。
 *
 * 布局：
 * ┌─ 📋 {task} ── {agent statuses} ──────────────────┐
 * │ {messages...}                                      │
 * └────────────────────────────────────────────────────┘
 *
 * @module tui/ink/group-view
 * @since v5 — Ink 重构 Phase 3C → v6 Token 整合
 */

import { Box, Text } from "ink";
import { useState, useEffect, useCallback, useRef } from "react";
import type { AgentType } from "@cortex/shared";
import { AGENT_DISPLAY_BY_TYPE, AGENT_DISPLAY_FALLBACK } from "@cortex/shared";
import type { GroupChatManager, TaskGroup, GroupMessage, GroupEvent, AgentState } from "../group-chat.js";
import { inkTheme } from "../theme/adapter-ink.js";
import { defaultTokens } from "../theme/tokens.js";
import { getCharacterColor } from "../theme/character-theme.js";

// ─── 类型 ────────────────────────────────────────

export interface GroupViewProps {
  manager: GroupChatManager;
  /** 最大显示消息数（默认 20） */
  maxMessages?: number;
}

// ─── 常量 ────────────────────────────────────────

const STATUS_ICON: Record<string, string> = {
  waiting: "○",
  working: "⏳",
  done: "✓",
  failed: "✗",
};

// ─── 辅助 ────────────────────────────────────────

function agentEmoji(agent: string): string {
  if (agent === "user") return "⭐";
  return (AGENT_DISPLAY_BY_TYPE[agent as AgentType] ?? AGENT_DISPLAY_FALLBACK).emoji;
}

function agentName(agent: string): string {
  if (agent === "user") return "你";
  return (AGENT_DISPLAY_BY_TYPE[agent as AgentType] ?? AGENT_DISPLAY_FALLBACK).name;
}

// ─── 单条消息渲染 ────────────────────────────────

function GroupMessageLine({ msg }: { msg: GroupMessage }) {
  const emoji = agentEmoji(msg.agent);
  const name = agentName(msg.agent);
  const prefix = msg.replyTo ? "  ↳ " : "  ";
  const t = inkTheme;
  const tokens = defaultTokens;
  const charColor = msg.agent !== "user" ? getCharacterColor(msg.agent) : null;

  switch (msg.type) {
    case "plan":
      return (
        <Box>
          <Text>{prefix}📋 </Text>
          <Text color={charColor?.primary ?? t.primary.color} bold>{name}</Text>
          <Text color={t.textMuted.color}>: [计划] </Text>
          <Text>{msg.content}</Text>
        </Box>
      );
    case "task_start":
      return (
        <Box>
          <Text>{prefix}🧪 </Text>
          <Text color={tokens.color.semantic.warning}>{name}</Text>
          <Text color={t.textMuted.color}>: 开始 </Text>
          <Text>{msg.content}</Text>
        </Box>
      );
    case "task_done": {
      const isFail = msg.content?.includes("❌");
      return (
        <Box>
          <Text>{prefix}{isFail ? "❌" : "✅"} </Text>
          <Text color={isFail ? tokens.color.semantic.error : tokens.color.semantic.success}>{name}</Text>
          <Text color={t.textMuted.color}>: 完成 </Text>
          <Text>{msg.content}</Text>
        </Box>
      );
    }
    case "tool_start":
      return (
        <Box>
          <Text>    ⏳ </Text>
          <Text color={t.textMuted.color}>{msg.toolName ?? msg.content}</Text>
        </Box>
      );
    case "tool_result": {
      const check = msg.toolSuccess ? "✅" : "❌";
      const dur = msg.toolDuration !== undefined ? ` · ${msg.toolDuration}ms` : "";
      return (
        <Box>
          <Text>    {check} </Text>
          <Text color={t.textMuted.color}>{msg.toolName ?? msg.content}{dur}</Text>
        </Box>
      );
    }
    case "review":
      return (
        <Box>
          <Text>{prefix}⚡ </Text>
          <Text color={tokens.color.semantic.info}>{name}</Text>
          <Text color={t.textMuted.color}>: [审查] </Text>
          <Text>{msg.content}</Text>
        </Box>
      );
    case "system":
      return (
        <Box>
          <Text>  ⚡ </Text>
          <Text color={t.textMuted.color}>{msg.content}</Text>
        </Box>
      );
    case "chat":
      return (
        <Box>
          <Text>{prefix}{emoji} </Text>
          <Text bold color={charColor?.primary ?? t.textPrimary.color}>{name}</Text>
          <Text>: {msg.content}</Text>
        </Box>
      );
    default:
      return <Text>{prefix}{msg.content}</Text>;
  }
}

// ─── Agent 状态行 ────────────────────────────────

function AgentStatusBar({ agents, agentStates }: { agents: AgentType[]; agentStates: Map<string, AgentState> }) {
  const t = inkTheme;

  return (
    <Box>
      {agents.map((a, i) => {
        const state = agentStates.get(a as string);
        const icon = state ? (STATUS_ICON[state.status] ?? "○") : "○";
        const display = AGENT_DISPLAY_BY_TYPE[a] ?? AGENT_DISPLAY_FALLBACK;
        const charColor = getCharacterColor(a as string);
        return (
          <Box key={a as string}>
            {i > 0 && <Text color={t.textMuted.color}>  </Text>}
            <Text color={charColor?.primary ?? t.textPrimary.color}>{display.emoji}{icon}</Text>
            <Text color={t.textMuted.color}> {display.name}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── 主组件 ──────────────────────────────────────

export function GroupView({ manager, maxMessages = 20 }: GroupViewProps) {
  const [group, setGroup] = useState<TaskGroup | null>(null);
  const originalRenderRef = useRef<typeof manager.renderGroup | null>(null);
  const t = inkTheme;
  const tokens = defaultTokens;

  // 订阅群聊事件 → 更新本地状态
  const syncGroup = useCallback(() => {
    const activeId = manager.activeGroupId;
    if (!activeId) {
      setGroup(null);
      return;
    }
    const g = manager.groups.get(activeId);
    if (g) {
      // 浅拷贝触发 React 重渲染
      setGroup({ ...g, messages: [...g.messages], agentStates: new Map(g.agentStates) });
    } else {
      setGroup(null);
    }
  }, [manager]);

  useEffect(() => {
    const unsub = manager.on((_event: GroupEvent) => {
      syncGroup();
    });

    // 抑制 GroupChatManager 的 ANSI 渲染（避免与 Ink 冲突）
    originalRenderRef.current = manager.renderGroup.bind(manager);
    manager.renderGroup = () => { /* no-op: Ink 接管渲染 */ };

    // 初始同步
    syncGroup();

    return () => {
      unsub();
      // 恢复原始渲染方法
      if (originalRenderRef.current) {
        manager.renderGroup = originalRenderRef.current;
      }
    };
  }, [manager, syncGroup]);

  // ── 空状态 ──
  if (!group) {
    return null;
  }

  // ── 消息折叠 ──
  const displayMessages = group.messages.length > maxMessages
    ? group.messages.slice(-maxMessages)
    : group.messages;
  const foldedCount = group.messages.length - displayMessages.length;

  // ── 进度统计 ──
  const taskDoneMsgs = group.messages.filter(m => m.type === "task_done");
  const doneCount = taskDoneMsgs.filter(m => !m.content?.includes("❌")).length;
  const totalCount = taskDoneMsgs.length;
  const progressLabel = totalCount > 0 ? ` (${doneCount}/${totalCount}完成)` : "";

  // 状态色通过 token 获取
  const statusColor = group.status === "active"
    ? tokens.color.semantic.success
    : group.status === "done"
      ? tokens.color.status.complete
      : group.status === "failed"
        ? tokens.color.semantic.error
        : tokens.color.semantic.warning;

  return (
    <Box flexDirection="column" paddingX={tokens.spacing.xs} marginTop={tokens.spacing.xs}>
      {/* 标题栏 */}
      <Box>
        <Text bold color={statusColor}>
          ┌─ 📋 {group.task.slice(0, 30)}{progressLabel}
        </Text>
      </Box>

      {/* Agent 状态行 */}
      <Box marginLeft={tokens.spacing.sm}>
        <AgentStatusBar agents={group.agents} agentStates={group.agentStates} />
      </Box>

      {/* 分隔线 */}
      <Box>
        <Text color={t.separator.color}>│</Text>
      </Box>

      {/* 折叠提示 */}
      {foldedCount > 0 && (
        <Box marginLeft={tokens.spacing.sm}>
          <Text color={t.textMuted.color}>│ ... ({foldedCount} 条更早的消息)</Text>
        </Box>
      )}

      {/* 消息列表 */}
      {displayMessages.map((msg) => (
        <Box key={msg.id} marginLeft={tokens.spacing.sm}>
          <Text color={t.separator.color}>│ </Text>
          <GroupMessageLine msg={msg} />
        </Box>
      ))}

      {/* 底部边框 */}
      <Box>
        <Text color={t.separator.color}>└{"─".repeat(40)}</Text>
      </Box>
    </Box>
  );
}
