/**
 * tui/index.ts — TUI 模块桶导出与主入口
 *
 * 集成所有 TUI 组件，提供统一的 TUI 启动入口。
 * 通过 --tui flag 从 main.ts 调用。
 *
 * @module tui
 * @since v3 — CLI TUI 全栈重构
 */

// ─── 事件总线 ──────────────────────────────────────
export { TuiEventBus, tuiEventBus } from "./event-bus.js";
export type { TuiEventListener } from "./event-bus.js";

// ─── 类型 ──────────────────────────────────────────
export type {
  TuiEvent,
  TuiToolStartEvent,
  TuiToolResultEvent,
  TuiLlmChunkEvent,
  TuiNodeStartEvent,
  TuiNodeCompleteEvent,
  TuiNodeFailedEvent,
  TuiPermissionRequiredEvent,
  TuiTaskTreeUpdateEvent,
  TuiTokenUsageEvent,
  TuiCompactionEvent,
  TuiLifecycleEvent,
  TuiHooks,
  ReplMode,
  NodeRenderState,
  NodeRenderStatus,
  ConfirmResult,
  QueryLoopContext,
  LlmStreamBridge,
} from "./types.js";

// ─── 查询循环 ──────────────────────────────────────
export { queryLoop, extractHistory } from "./query-loop.js";

// ─── 模式 ──────────────────────────────────────────
export { chatMode } from "./modes/chat-mode.js";
export { planMode } from "./modes/plan-mode.js";
export type { PlanModeState } from "./modes/plan-mode.js";
export { loadPlanState, savePlanState, clearPlanState } from "./modes/plan-mode.js";
export { extractWorkspacePath, formatPlanTree, displayClarification, clarifyAndConfirm } from "./modes/plan-utils.js";
export { talkMode, talkTrioMode } from "./modes/talk-mode.js";
export { partyMode, parseMentions, DEFAULT_PARTY } from "./modes/party-mode.js";
export { multiSpeakerLoop } from "./multi-speaker-loop.js";
export type { SpeakerDef, MultiSpeakerParams } from "./multi-speaker-loop.js";
export { streamExecuteTools } from "./streaming-tool-executor.js";
export { summarizeSubAgents, summarizeOne } from "./sub-agent-summarizer.js";
export { processMultimodalInput, hasImagePaths } from "./multimodal-input.js";
export { commandMode } from "./modes/command-mode.js";

// ─── 渲染器 ────────────────────────────────────────
export {
  cursorUp,
  cursorDown,
  cursorHide,
  cursorShow,
  eraseLine,
  eraseScreen,
  style,
  bold,
  dim,
  color,
  Box,
  StatusLine,
  terminalWidth,
  terminalHeight,
  write,
  writeln,
  StyleCode,
  ColorCode,
} from "./renderer/ansi.js";
export type { ColorName, StyleName } from "./renderer/ansi.js";
export { TaskTreeRenderer } from "./renderer/task-tree.js";
export { ToolLogRenderer } from "./renderer/tool-log.js";
export { TokenMonitor } from "./renderer/token-monitor.js";
export {
  renderInlinePermission as renderPermissionDialog,
  clearInlinePermission as clearPermissionDialog,
  renderInlinePermission,
  clearInlinePermission,
  waitForSingleKey,
  waitForSingleKey as listenForConfirm,
  ConfirmGateState,
  reversibilityLevel,
} from "./renderer/permission-dialog.js";
export {
  renderPersonaHeader,
  renderAgentTransition,
  renderMultiPersonaHeader,
} from "./renderer/persona-header.js";
export { renderDiff, renderDiffText } from "./renderer/diff-viewer.js";

// ─── 钩子 ──────────────────────────────────────────
export { defaultHooks, talkHooks, partyHooks } from "./hooks.js";

// ─── 会话持久化 ────────────────────────────────────
export { saveSession, loadSession, clearSession } from "./session-store.js";
export type { SessionSnapshot } from "./session-store.js";

// ─── 上下文压缩 ────────────────────────────────────
export { compactMessages, estimateTokens } from "./context-compactor.js";
export type { CompactionOptions, CompactionResult } from "./context-compactor.js";

// ─── REPL 主入口 ──────────────────────────────────
export { tuiReplHandler } from "./tui-repl.js";
