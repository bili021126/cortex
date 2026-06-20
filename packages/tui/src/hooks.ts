/**
 * tui/hooks.ts — 生命周期钩子默认实现
 *
 * 提供 PreToolUse / PostToolUse 的默认实现，各 mode 可按需覆盖。
 *
 * @module tui/hooks
 * @since v3 — CLI TUI 全栈重构
 */

import type { TuiHooks, TuiToolStartEvent, TuiToolResultEvent, TuiLlmChunkEvent, TuiNodeCompleteEvent, TuiNodeFailedEvent, ReplMode } from "./types.js";
import type { AgentType, LlmMessage } from "@cortex/shared";
import type { CompactionResult } from "./context-compactor.js";
import type { SessionSnapshot } from "./session-store.js";
import { reversibilityLevel } from "./renderer/permission-dialog.js";

/**
 * 默认钩子：26 个生命周期 Hook 的全量默认实现。
 *
 * L1 读操作自动放行，L2/L3 由 Toolkit 内置 ConfirmGate 接管。
 * 所有非关键 Hook 默认 no-op，各 mode 按需覆盖。
 */
export const defaultHooks: TuiHooks = {
  // ── 会话级 ──
  onSessionStart: (_mode: ReplMode, _agent: AgentType) => {},
  onSessionEnd: async () => {},
  onSessionSave: (_snapshot: SessionSnapshot) => {},
  onSessionRestore: (_snapshot: SessionSnapshot) => {},

  // ── 请求级 ──
  onPreModelRequest: async (messages: LlmMessage[]) => messages,
  onPostModelRequest: (_response) => {},
  onPreToolUse: async (event: TuiToolStartEvent): Promise<"allow" | "deny" | "skip"> => {
    const level = reversibilityLevel(event.tool);
    if (level === 1) return "allow";
    return "allow";
  },
  onPostToolUse: async (_event: TuiToolResultEvent): Promise<void> => {},

  // ── 压缩级 ──
  onPreCompact: async (_messages: LlmMessage[]) => {},
  onPostCompact: (_result: CompactionResult) => {},
  onCompactionWarning: (_percent: number) => {},

  // ── 错误级 ──
  onError: (_error: Error, _context: string) => {},
  onToolError: (_tool: string, _error: Error) => {},
  onMaxToolRounds: () => {},

  // ── 输入级 ──
  onUserInput: async (input: string) => input,
  onPreProcessInput: async (input: string) => input,
  onPostProcessOutput: async (output: string) => output,

  // ── 模式级 ──
  onModeChange: (_from: ReplMode, _to: ReplMode) => {},
  onAgentSwitch: (_from: AgentType, _to: AgentType) => {},
  onTalkTrioToggle: (_enabled: boolean) => {},

  // ── 流式级 ──
  onStreamStart: () => {},
  onStreamEnd: () => {},
  onChunk: (_event: TuiLlmChunkEvent) => {},

  // ── 节点级 ──
  onNodeStart: (_nodeId: string, _nodeType: string, _agent: AgentType) => {},
  onNodeComplete: (_event: TuiNodeCompleteEvent) => {},
  onNodeFailed: (_event: TuiNodeFailedEvent) => {},
};

/**
 * Talk 模式钩子：禁止所有工具调用。覆盖需要变更的 Hook。
 */
export const talkHooks: TuiHooks = {
  ...defaultHooks,
  onPreToolUse: async (): Promise<"allow" | "deny" | "skip"> => "deny",
};

/**
 * Party 模式钩子：禁止所有工具调用。覆盖需要变更的 Hook。
 */
export const partyHooks: TuiHooks = {
  ...defaultHooks,
  onPreToolUse: async (): Promise<"allow" | "deny" | "skip"> => "deny",
};
