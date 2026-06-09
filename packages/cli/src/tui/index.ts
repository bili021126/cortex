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
export { extractWorkspacePath, formatPlanTree, displayClarification, clarifyAndConfirm } from "./modes/plan-utils.js";
export { talkMode } from "./modes/talk-mode.js";
export { partyMode } from "./modes/party-mode.js";
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
  renderPermissionDialog,
  clearPermissionDialog,
  listenForConfirm,
  ConfirmGateState,
  reversibilityLevel,
} from "./renderer/permission-dialog.js";
export {
  renderPersonaHeader,
  renderAgentTransition,
} from "./renderer/persona-header.js";

// ─── 钩子 ──────────────────────────────────────────
export { defaultHooks, talkHooks, partyHooks } from "./hooks.js";
