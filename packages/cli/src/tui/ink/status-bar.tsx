/**
 * tui/ink/status-bar.tsx — 顶部状态栏
 *
 * 三段式布局：Agent 信息 | 模式标签 | Token 进度条。
 * 消费 Design Token，颜色通过 inkTheme 适配器获取。
 *
 * @module tui/ink/status-bar
 * @since v5 — Ink 重构 Phase 1 → v6 Token 整合
 */

import { Box, Text } from "ink";
import { useState, useEffect, useRef } from "react";
import { AGENT_DISPLAY_BY_TYPE, AGENT_DISPLAY_FALLBACK } from "@cortex/shared";
import type { AgentType } from "@cortex/shared";
import type { AppMode, TokenSnapshot } from "./session-reducer.js";
import { inkTheme } from "../theme/adapter-ink.js";
import { defaultTokens } from "../theme/tokens.js";

export interface StatusBarProps {
  agent: AgentType;
  mode: AppMode;
  tokenUsage: TokenSnapshot;
  /** 是否有回合在进行中——驱动经过时间计时与中断提示 */
  isProcessing?: boolean;
}

/** 回合进行中的经过秒数——active 为 true 时每秒自增，结束归零 */
function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active) {
      startRef.current = null;
      setElapsed(0);
      return;
    }
    startRef.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      if (startRef.current != null) setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);
  return elapsed;
}

/** 渲染 Token 使用进度条（▰▱ 风格） */
function TokenBar({ pct, color }: { pct: number; color: string }) {
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  const bar = "▰".repeat(filled) + "▱".repeat(empty);
  return (
    <Text color={color}>
      {bar} {pct}%
    </Text>
  );
}

export function StatusBar({ agent, mode, tokenUsage, isProcessing = false }: StatusBarProps) {
  const display = AGENT_DISPLAY_BY_TYPE[agent] ?? AGENT_DISPLAY_FALLBACK;
  const t = inkTheme;
  const tokens = defaultTokens;
  const elapsed = useElapsedSeconds(isProcessing);

  const pct = tokenUsage.contextWindowSize > 0
    ? Math.round((tokenUsage.sessionTotalTokens / tokenUsage.contextWindowSize) * 100)
    : 0;

  // 语义色：根据 token 使用率选择
  const tokenColor = pct >= 80
    ? tokens.color.semantic.error
    : pct >= 50
      ? tokens.color.semantic.warning
      : tokens.color.semantic.success;

  const tokenStr = tokenUsage.sessionTotalTokens >= 1000
    ? `${(tokenUsage.sessionTotalTokens / 1000).toFixed(1)}k`
    : String(tokenUsage.sessionTotalTokens);
  const windowStr = tokenUsage.contextWindowSize >= 1000
    ? `${(tokenUsage.contextWindowSize / 1000).toFixed(0)}k`
    : String(tokenUsage.contextWindowSize);

  // DeepSeek V4 上下文缓存命中率——hit / (hit + miss)
  const cacheTotal = tokenUsage.cacheHitTokens + tokenUsage.cacheMissTokens;
  const cacheHitRate = cacheTotal > 0 ? Math.round((tokenUsage.cacheHitTokens / cacheTotal) * 100) : null;

  // 模式标签从 token 读取
  const modeLabel = tokens.typography.modeLabels[mode] ?? mode;

  return (
    <Box
      borderStyle={tokens.border.defaultStyle === "rounded" ? "round" : "single"}
      borderColor={t.borderDefault.borderColor}
      paddingX={tokens.spacing.xs}
    >
      <Text color={t.primary.color} bold>
        {display.emoji} {display.name}
      </Text>
      <Text color={t.textMuted.color}> [{agent}] </Text>
      <Text color={t.separator.color}> {"━".repeat(16)} </Text>
      <Text color={t.info.color}>{modeLabel}</Text>
      <Text color={t.separator.color}> │ </Text>
      <TokenBar pct={pct} color={tokenColor} />
      <Text color={t.textMuted.color}> {tokenStr}/{windowStr}</Text>
      {cacheHitRate !== null && (
        <>
          <Text color={t.separator.color}> │ </Text>
          <Text color={t.textMuted.color}>⚡{cacheHitRate}%</Text>
        </>
      )}
      {isProcessing && (
        <>
          <Text color={t.separator.color}> │ </Text>
          <Text color={tokens.color.status.thinking}>⏱ {elapsed}s</Text>
          <Text color={t.textMuted.color}> · Esc 中断</Text>
        </>
      )}
    </Box>
  );
}
