/**
 * tui/ink/input-bar.tsx — 底部输入栏
 *
 * Agent prompt + TextInput。消费 Design Token。
 * 支持焦点管理——当焦点不在 input 时显示焦点提示。
 *
 * @module tui/ink/input-bar
 * @since v5 — Ink 重构 Phase 1 → v6 Token 整合
 */

import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { useState } from "react";
import { AGENT_DISPLAY_BY_TYPE, AGENT_DISPLAY_FALLBACK } from "@cortex/shared";
import type { AgentType } from "@cortex/shared";
import { inkTheme } from "../theme/adapter-ink.js";
import { defaultTokens } from "../theme/tokens.js";

export interface InputBarProps {
  agent: AgentType;
  onSubmit: (value: string) => void;
  /** 是否有回合在进行中——true 时输入进入排队模式（type-ahead） */
  processing?: boolean;
  /** 提示文本（plan 审批等场景，显示为占位符） */
  hint?: string;
  /** 是否拥有焦点 */
  focused?: boolean;
  /** 已排队待发送的输入条数 */
  queuedCount?: number;
}

export function InputBar({ agent, onSubmit, processing = false, hint, focused = true, queuedCount = 0 }: InputBarProps) {
  const display = AGENT_DISPLAY_BY_TYPE[agent] ?? AGENT_DISPLAY_FALLBACK;
  const [value, setValue] = useState("");
  const t = inkTheme;
  const tokens = defaultTokens;

  // 处理中：输入保持可编辑，回车将排队；否则正常提交
  const placeholder = processing ? "回合进行中——回车排队，Esc 中断" : (hint ?? "");

  return (
    <Box flexDirection="column" paddingX={tokens.spacing.xs}>
      {queuedCount > 0 && (
        <Text color={t.textMuted.color}>⏳ 已排队 {queuedCount} 条 · 当前回合结束后依次发送</Text>
      )}
      <Box>
        <Text color={t.primary.color} bold>{display.emoji} {display.name}</Text>
        <Text color={t.separator.color}> ▸ </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(v) => { setValue(""); onSubmit(v); }}
          placeholder={placeholder}
          focus={focused}
        />
      </Box>
    </Box>
  );
}
