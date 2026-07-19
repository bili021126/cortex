/**
 * tui/ink/session-reducer.ts — 会话状态 reducer
 *
 * Ink TUI 的核心状态管理。Action 类型直接映射 TuiEvent，
 * 实现 event-bus → reducer 的零转换桥接。
 *
 * @module tui/ink/session-reducer
 * @since v5 — Ink 重构 Phase 1 → Phase 3
 */

import type { AgentType, TaskNode } from "@cortex/shared";
import type {
  TuiToolStartEvent,
  TuiToolResultEvent,
  TuiTokenUsageEvent,
  TuiCompactionEvent,
  TuiNodeStartEvent,
  TuiNodeCompleteEvent,
  TuiNodeFailedEvent,
  TuiTaskTreeUpdateEvent,
  TuiPlanGeneratedEvent,
} from "../types.js";

// ─── 应用模式 ──────────────────────────────────

export type AppMode = "chat" | "plan" | "group";

// ─── Plan FSM 状态 ─────────────────────────────

export type PlanState = "idle" | "planning" | "reviewing" | "approved" | "executing" | "completed" | "failed";

// ─── 消息 ──────────────────────────────────────

export interface SessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  agent?: AgentType;
}

// ─── Token 快照 ────────────────────────────────

export interface TokenSnapshot {
  sessionTotalTokens: number;
  contextWindowSize: number;
}

// ─── 工具调用记录 ──────────────────────────────

export interface ToolCallRecord {
  id: string;
  tool: string;
  agent: AgentType;
  success?: boolean;
  durationMs?: number;
  error?: string;
}

// ─── 节点渲染状态 ──────────────────────────────

export type NodeRenderStatus = "pending" | "executing" | "done" | "failed" | "skipped";

/** 带渲染状态的 TaskNode 包装 */
export interface TaskNodeView extends TaskNode {
  renderStatus: NodeRenderStatus;
}

// ── 权限请求 ──────────────────────────────────

export interface PermissionRequestView {
  tool: string;
  input: string;
  level: 1 | 2 | 3;
  agent: string;
}

// ── 会话状态 ──────────────────────────────────

export interface SessionState {
  agent: AgentType;
  messages: SessionMessage[];
  taskNodes: TaskNodeView[];
  tokenUsage: TokenSnapshot;
  mode: AppMode;
  /** 流式输出中的内容（LLM chunk 累积） */
  streamingContent: string;
  /** 最近工具调用记录 */
  recentTools: ToolCallRecord[];
  /** 会话是否从磁盘恢复 */
  sessionRestored: boolean;
  /** 是否正在处理用户输入（queryLoop 执行中） */
  isProcessing: boolean;
  /** Plan 任务节点 */
  planNodes: TaskNodeView[];
  /** Plan FSM 状态 */
  planState: PlanState;
  /** ChatView 滚动偏移（0 = 最底部，正数 = 向上偏移） */
  visibleOffset: number;
  /** 待确认的权限请求（null = 无待确认） */
  pendingPermission: PermissionRequestView | null;
}

// ─── Actions ───────────────────────────────────

export type SessionAction =
  | { type: "SWITCH_AGENT"; payload: AgentType }
  | { type: "ADD_MESSAGE"; payload: SessionMessage }
  | { type: "STREAM_CHUNK"; payload: string }
  | { type: "STREAM_END" }
  | { type: "TOOL_START"; payload: TuiToolStartEvent }
  | { type: "TOOL_RESULT"; payload: TuiToolResultEvent }
  | { type: "TOKEN_UPDATE"; payload: TuiTokenUsageEvent }
  | { type: "SET_MODE"; payload: AppMode }
  | { type: "COMPACTION"; payload: TuiCompactionEvent }
  | { type: "RESTORE_SESSION"; payload: { agent: AgentType; messages: SessionMessage[] } }
  | { type: "SET_PROCESSING"; payload: boolean }
  // Plan 相关
  | { type: "PLAN_GENERATED"; payload: TuiPlanGeneratedEvent }
  | { type: "PLAN_APPROVED" }
  | { type: "PLAN_EXECUTED" }
  | { type: "PLAN_FAILED"; payload: string }
  | { type: "TASK_TREE_UPDATE"; payload: TuiTaskTreeUpdateEvent }
  // 节点事件
  | { type: "NODE_START"; payload: TuiNodeStartEvent }
  | { type: "NODE_COMPLETE"; payload: TuiNodeCompleteEvent }
  | { type: "NODE_FAILED"; payload: TuiNodeFailedEvent }
  // 滚动
  | { type: "SCROLL_UP" }
  | { type: "SCROLL_DOWN" }
  | { type: "SCROLL_TO_BOTTOM" }
  // 权限确认
  | { type: "PERMISSION_REQUIRED"; payload: PermissionRequestView }
  | { type: "PERMISSION_RESOLVED" };

// ─── 初始状态 ──────────────────────────────────

export const initialSessionState: SessionState = {
  agent: "butler" as AgentType,
  messages: [],
  taskNodes: [],
  tokenUsage: { sessionTotalTokens: 0, contextWindowSize: 128_000 },
  mode: "chat",
  streamingContent: "",
  recentTools: [],
  sessionRestored: false,
  isProcessing: false,
  planNodes: [],
  planState: "idle",
  visibleOffset: 0,
  pendingPermission: null,
};

// ─── 辅助函数 ──────────────────────────────────

function wrapNodes(nodes: TaskNode[]): TaskNodeView[] {
  return nodes.map((n) => ({ ...n, renderStatus: "pending" as NodeRenderStatus }));
}

function updateNodeStatus(
  nodes: TaskNodeView[],
  nodeId: string,
  status: NodeRenderStatus,
): TaskNodeView[] {
  return nodes.map((n) => (n.id === nodeId ? { ...n, renderStatus: status } : n));
}

// ─── Reducer ───────────────────────────────────

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "SWITCH_AGENT":
      return {
        ...state,
        agent: action.payload,
        streamingContent: "",
        visibleOffset: 0,
        planNodes: [],
        planState: "idle",
        recentTools: [],
        pendingPermission: null,
      };

    case "ADD_MESSAGE": {
      const pending = state.streamingContent;
      const isUser = action.payload.role === "user";
      const msgs = pending
        ? [...state.messages, { role: "assistant" as const, content: pending, agent: state.agent }, action.payload]
        : [...state.messages, action.payload];
      return {
        ...state,
        messages: msgs,
        streamingContent: "",
        recentTools: isUser ? [] : state.recentTools,
        visibleOffset: 0,
      };
    }

    case "STREAM_CHUNK":
      return { ...state, streamingContent: state.streamingContent + action.payload, visibleOffset: 0 };

    case "STREAM_END":
      return state.streamingContent
        ? {
            ...state,
            messages: [
              ...state.messages,
              { role: "assistant" as const, content: state.streamingContent, agent: state.agent },
            ],
            streamingContent: "",
            visibleOffset: 0,
          }
        : state;

    case "TOOL_START": {
      const entry: ToolCallRecord = {
        id: action.payload.id,
        tool: action.payload.tool,
        agent: action.payload.agent,
      };
      return { ...state, recentTools: [...state.recentTools.slice(-19), entry], visibleOffset: 0 };
    }

    case "TOOL_RESULT":
      return {
        ...state,
        recentTools: state.recentTools.map((t) =>
          t.id === action.payload.id
            ? { ...t, success: action.payload.success, durationMs: action.payload.durationMs, error: action.payload.error }
            : t,
        ),
        visibleOffset: 0,
      };

    case "TOKEN_UPDATE": {
      const delta = action.payload.promptTokens + action.payload.completionTokens;
      return {
        ...state,
        tokenUsage: {
          sessionTotalTokens: state.tokenUsage.sessionTotalTokens + delta,
          contextWindowSize: action.payload.contextWindowSize,
        },
      };
    }

    case "COMPACTION":
      // 压缩后重置 token 计数为估算值，避免继续累加已删除的消息
      return {
        ...state,
        tokenUsage: {
          sessionTotalTokens: action.payload.estimatedTokens,
          contextWindowSize: state.tokenUsage.contextWindowSize,
        },
        messages: [
          ...state.messages,
          {
            role: "system" as const,
            content: `📦 上下文已压缩 (移除 ${action.payload.compactedCount} 条, 剩余 ~${action.payload.estimatedTokens} tokens)`,
          },
        ],
        visibleOffset: 0,
      };

    case "SET_MODE":
      return { ...state, mode: action.payload };

    case "RESTORE_SESSION":
      return {
        ...state,
        agent: action.payload.agent,
        messages: action.payload.messages,
        sessionRestored: true,
        visibleOffset: 0,
      };

    case "SET_PROCESSING":
      return { ...state, isProcessing: action.payload };

    // ── Plan 相关 ─────────────────────────────

    case "PLAN_GENERATED": {
      const nodes = wrapNodes(action.payload.nodes);
      return {
        ...state,
        planNodes: nodes,
        planState: "reviewing",
        mode: "plan",
        streamingContent: "",
        visibleOffset: 0,
      };
    }

    case "PLAN_APPROVED":
      return { ...state, planState: "approved" };

    case "PLAN_EXECUTED":
      return { ...state, planState: "completed", planNodes: [], mode: "chat", visibleOffset: 0 };

    case "PLAN_FAILED":
      return {
        ...state,
        planState: "failed",
        messages: [
          ...state.messages,
          { role: "system" as const, content: `❌ 计划执行失败: ${action.payload}` },
        ],
        visibleOffset: 0,
      };

    case "TASK_TREE_UPDATE": {
      const existingStatuses = new Map(state.planNodes.map(n => [n.id, n.renderStatus]));
      const merged = action.payload.nodes.map(n => ({
        ...n,
        renderStatus: (existingStatuses.get(n.id) ?? "pending") as NodeRenderStatus,
      }));
      return { ...state, planNodes: merged, visibleOffset: 0 };
    }

    // ── 节点事件 ──────────────────────────────

    case "NODE_START":
      return {
        ...state,
        planNodes: updateNodeStatus(state.planNodes, action.payload.nodeId, "executing"),
        planState: state.planState === "approved" ? "executing" : state.planState,
        visibleOffset: 0,
      };

    case "NODE_COMPLETE":
      return {
        ...state,
        planNodes: updateNodeStatus(state.planNodes, action.payload.nodeId, "done"),
      };

    case "NODE_FAILED":
      return {
        ...state,
        planNodes: updateNodeStatus(state.planNodes, action.payload.nodeId, "failed"),
        messages: [
          ...state.messages,
          {
            role: "system" as const,
            content: `❌ 节点失败: ${action.payload.nodeId}${action.payload.error ? ` — ${action.payload.error}` : ""}`,
          },
        ],
        visibleOffset: 0,
      };

    // ── 滚动 ──────────────────────────────────

    case "SCROLL_UP":
      return { ...state, visibleOffset: Math.min(state.visibleOffset + 3, Math.max(0, state.messages.length - 5)) };

    case "SCROLL_DOWN":
      return { ...state, visibleOffset: Math.max(0, state.visibleOffset - 3) };

    case "SCROLL_TO_BOTTOM":
      return { ...state, visibleOffset: 0 };

    // ── 权限确认 ──────────────────────────────

    case "PERMISSION_REQUIRED":
      return { ...state, pendingPermission: action.payload, visibleOffset: 0 };

    case "PERMISSION_RESOLVED":
      return { ...state, pendingPermission: null };

    default:
      return state;
  }
}
