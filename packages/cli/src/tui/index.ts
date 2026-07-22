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
  NodeRenderState,
  NodeRenderStatus,
  ConfirmResult,
  QueryLoopContext,
} from "./types.js";

// ─── 查询循环 ──────────────────────────────────────
export { queryLoop, extractHistory, agentTalkPersona } from "./query-loop.js";

// ─── 模式 ──────────────────────────────────────────
export { planMode } from "./modes/plan-mode.js";
export type { PlanModeState } from "./modes/plan-mode.js";
export { loadPlanState, savePlanState, clearPlanState, canTransition, reviewStatusToFsmState } from "./modes/plan-mode.js";
export { extractWorkspacePath, formatPlanTree, displayClarification, clarifyAndConfirm } from "./modes/plan-utils.js";

export { streamExecuteTools } from "./streaming-tool-executor.js";

export { commandMode } from "./modes/command-mode.js";
export { classifyIntent, parseAgentFromInput } from "./intent-router.js";
export type { UserIntent } from "./intent-router.js";

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
export { renderDiff, renderDiffText } from "./renderer/diff-viewer.js";

// ─── 钩子 ──────────────────────────────────────────
export { defaultHooks, talkHooks, partyHooks } from "./hooks.js";

// ─── 会话持久化 ────────────────────────────────────
export { saveSession, loadSession, clearSession } from "./session-store.js";
export type { SessionSnapshot } from "./session-store.js";

// ─── 上下文压缩 ────────────────────────────────────
export { compactMessages, estimateTokens } from "./context-compactor.js";
export type { CompactionOptions, CompactionResult } from "./context-compactor.js";

// ─── 群聊 ──────────────────────────────────────────
export { GroupChatManager, groupChat } from "./group-chat.js";
export type { GroupMessage, TaskGroup, GroupSnapshot } from "./group-chat.js";

// ─── WebUI ──────────────────────────────────────────
export { startWebUI } from "./web/index.js";
export type { StartWebUIOptions, StartWebUIResult } from "./web/index.js";
export { WSGateway } from "./web/gateway.js";
export { StateAggregator } from "./web/state-aggregator.js";
export type { WebUIState, TaskNodeSnapshot, AgentStatusSnapshot, PipelineSnapshot } from "./web/state-aggregator.js";
export { APIRouter } from "./web/api-router.js";

// ─── Ink TUI (Phase 1) ─────────────────────────────
export { startInkTui } from "./ink/ink-entry.js";
export type { InkTuiOptions } from "./ink/ink-entry.js";
export { App } from "./ink/app.js";
export type { AppProps } from "./ink/app.js";
export { StatusBar } from "./ink/status-bar.js";
export type { StatusBarProps } from "./ink/status-bar.js";
export { InputBar } from "./ink/input-bar.js";
export type { InputBarProps } from "./ink/input-bar.js";
export { AppContext, useAppContext, useSessionDispatch } from "./ink/app-context.js";
export type { AppContextValue } from "./ink/app-context.js";
export { sessionReducer, initialSessionState } from "./ink/session-reducer.js";
export type { SessionState, SessionAction, SessionMessage, AppMode, TokenSnapshot } from "./ink/session-reducer.js";
export { useEventBridge } from "./ink/hooks/use-event-bridge.js";
export { ChatView } from "./ink/chat-view.js";
export type { ChatViewProps } from "./ink/chat-view.js";
export { TaskTree } from "./ink/task-tree.js";
export type { TaskTreeProps } from "./ink/task-tree.js";
export { SplashScreen } from "./ink/splash-screen.js";
export type { SplashScreenProps } from "./ink/splash-screen.js";
export { loadInkSession, saveInkSession, createAutoSaver, stateToHistory, historyToMessages } from "./ink/session-persistence.js";
export { handleCommand } from "./ink/commands.js";
export type { CommandResult } from "./ink/commands.js";
export type { PlanState, TaskNodeView } from "./ink/session-reducer.js";
export { PermissionPrompt } from "./ink/permission-prompt.js";
export type { PermissionRequest, PermissionResult } from "./ink/permission-prompt.js";
export { GroupView } from "./ink/group-view.js";
export type { GroupViewProps } from "./ink/group-view.js";
