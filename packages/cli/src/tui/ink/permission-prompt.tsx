/**
 * tui/ink/permission-prompt.tsx — 权限确认组件（Phase 3C + v6 动画）
 *
 * 内嵌在聊天流中的权限确认提示。使用 SlideIn 动画滑入。
 * 消费 Design Token，风险等级色标通过 token 语义色获取。
 *
 * 风险等级色标：L1 绿（自动放行）/ L2 黄（需确认）/ L3 红（不可逆）
 * 超时 30s 自动拒绝。
 *
 * @module tui/ink/permission-prompt
 * @since v5 — Ink 重构 Phase 3C → v6 Token + 动画整合
 */

import { Box, Text, useInput } from "ink";
import { useEffect, useRef, useCallback } from "react";
import { useAppContext } from "./app-context.js";
import { inkTheme } from "../theme/adapter-ink.js";
import { defaultTokens } from "../theme/tokens.js";
import { SlideIn } from "../animation/components/SlideIn.js";

// ─── 类型 ──────────────────────────────────────

export type PermissionResult = "approve_once" | "approve_all" | "deny" | "skip";

export interface PermissionRequest {
  tool: string;
  input: string;
  level: 1 | 2 | 3;
  agent: string;
}

export interface PermissionPromptProps {
  request: PermissionRequest;
  onResolve: (result: PermissionResult) => void;
  /** 超时毫秒数，默认 30000（30s） */
  timeoutMs?: number;
}

// ─── 风险等级标签（消费 token 色） ────────────────

const LEVEL_2_CFG = { label: "L2 可逆写", icon: "🟡", colorKey: "medium" as const };
const LEVEL_CONFIG: Record<number, { label: string; icon: string; colorKey: "low" | "medium" | "high" }> = {
  1: { label: "L1 可读", icon: "🟢", colorKey: "low" },
  2: LEVEL_2_CFG,
  3: { label: "L3 不可逆", icon: "🔴", colorKey: "high" },
};

// ─── 组件 ────────────────────────────────────────

export function PermissionPrompt({ request, onResolve, timeoutMs = 30000 }: PermissionPromptProps) {
  const resolvedRef = useRef(false);
  const onResolveRef = useRef(onResolve);
  onResolveRef.current = onResolve;
  const { dispatch } = useAppContext();
  const t = inkTheme;
  const tokens = defaultTokens;

  const resolve = useCallback((result: PermissionResult) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    onResolveRef.current(result);
    dispatch({ type: "PERMISSION_RESOLVED" });
  }, [dispatch]);

  // ── 单键捕获 ────────────────────────────────
  useInput((input, key) => {
    const ch = input?.toLowerCase();
    if (ch === "y" || key.return) {
      resolve("approve_once");
    } else if (ch === "n" || key.escape) {
      resolve("deny");
    } else if (ch === "a") {
      resolve("approve_all");
    } else if (ch === "s") {
      resolve("skip");
    }
  });

  // ── 超时自动拒绝 ────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => resolve("deny"), timeoutMs);
    return () => clearTimeout(timer);
  }, [timeoutMs, resolve]);

  const levelCfg = LEVEL_CONFIG[request.level] ?? LEVEL_2_CFG;
  const riskColor = tokens.color.risk[levelCfg.colorKey];
  const truncatedInput = request.input.length > 50
    ? request.input.slice(0, 47) + "..."
    : request.input;

  return (
    <SlideIn active options={{ from: "bottom", duration: "normal" }}>
      <Box flexDirection="column" paddingX={tokens.spacing.xs} marginTop={tokens.spacing.xs}>
        <Box>
          <Text color={riskColor} bold>
            {"  "}{levelCfg.icon} {levelCfg.label}
          </Text>
          <Text color={t.separator.color}> │ </Text>
          <Text bold>{request.tool}</Text>
        </Box>
        <Box marginLeft={tokens.spacing.sm}>
          <Text color={t.textMuted.color}>{truncatedInput}</Text>
        </Box>
        <Box marginLeft={tokens.spacing.sm} marginTop={tokens.spacing.xs}>
          <Text color={tokens.color.semantic.success} bold>[y]</Text>
          <Text color={t.textMuted.color}> 允许 </Text>
          <Text color={tokens.color.semantic.error} bold>[n]</Text>
          <Text color={t.textMuted.color}> 拒绝 </Text>
          <Text color={t.info.color} bold>[a]</Text>
          <Text color={t.textMuted.color}> 全部允许 </Text>
          <Text color={tokens.color.semantic.warning} bold>[s]</Text>
          <Text color={t.textMuted.color}> 跳过</Text>
        </Box>
      </Box>
    </SlideIn>
  );
}
