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
  disabled?: boolean;
  /** 提示文本（plan 审批等场景，显示在 prompt 后方） */
  hint?: string;
  /** 是否拥有焦点 */
  focused?: boolean;
}

export function InputBar({ agent, onSubmit, disabled, hint, focused = true }: InputBarProps) {
  const display = AGENT_DISPLAY_BY_TYPE[agent] ?? AGENT_DISPLAY_FALLBACK;
  const [value, setValue] = useState("");
  const t = inkTheme;
  const tokens = defaultTokens;

  return (
    <Box paddingX={tokens.spacing.xs}>
      <Text color={t.primary.color} bold>{display.emoji} {display.name}</Text>
      <Text color={t.separator.color}> ▸ </Text>
      {disabled ? (
        <Text color={t.textMuted.color}>处理中...</Text>
      ) : hint ? (
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(v) => { setValue(""); onSubmit(v); }}
          placeholder={hint}
          focus={focused}
        />
      ) : (
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(v) => { setValue(""); onSubmit(v); }}
          placeholder=""
          focus={focused}
        />
      )}
    </Box>
  );
}
