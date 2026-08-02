// @ci: unit
import { describe, it, expect } from "vitest";
import {
  sessionReducer,
  initialSessionState,
} from "../src/tui/ink/session-reducer.js";
import type { SessionState, SessionAction } from "../src/tui/ink/session-reducer.js";
import type { AgentType } from "@cortex/shared";

const agent = "code" as AgentType;

describe("sessionReducer", () => {
  // ── 初始态 ──────────────────────────────────
  it("初始状态正确", () => {
    expect(initialSessionState.agent).toBe("butler");
    expect(initialSessionState.messages).toEqual([]);
    expect(initialSessionState.mode).toBe("chat");
    expect(initialSessionState.streamingContent).toBe("");
    expect(initialSessionState.isProcessing).toBe(false);
    expect(initialSessionState.visibleOffset).toBe(0);
    expect(initialSessionState.planState).toBe("idle");
    expect(initialSessionState.planNodes).toEqual([]);
    expect(initialSessionState.recentTools).toEqual([]);
    expect(initialSessionState.pendingPermission).toBeNull();
  });

  // ── SWITCH_AGENT ────────────────────────────
  it("SWITCH_AGENT 重置流式/滚动/plan/工具/权限", () => {
    const dirty: SessionState = {
      ...initialSessionState,
      agent: "butler" as AgentType,
      streamingContent: "hello",
      visibleOffset: 10,
      planNodes: [{ id: "n1", renderStatus: "pending" } as any],
      planState: "reviewing",
      recentTools: [{ id: "t1", tool: "read", agent: "butler" as AgentType }],
      pendingPermission: { tool: "write", input: "x", level: 2, agent: "butler" },
    };
    const s = sessionReducer(dirty, { type: "SWITCH_AGENT", payload: agent });
    expect(s.agent).toBe(agent);
    expect(s.streamingContent).toBe("");
    expect(s.visibleOffset).toBe(0);
    expect(s.planNodes).toEqual([]);
    expect(s.planState).toBe("idle");
    expect(s.recentTools).toEqual([]);
    expect(s.pendingPermission).toBeNull();
  });

  // ── CLEAR_MESSAGES ──────────────────────────
  it("CLEAR_MESSAGES 清空消息", () => {
    const withMsgs: SessionState = {
      ...initialSessionState,
      messages: [{ role: "user", content: "hi" }],
      streamingContent: "pending",
    };
    const s = sessionReducer(withMsgs, { type: "CLEAR_MESSAGES" });
    expect(s.messages).toEqual([]);
    expect(s.streamingContent).toBe("");
  });

  // ── ADD_MESSAGE ─────────────────────────────
  it("ADD_MESSAGE 追加消息", () => {
    const s = sessionReducer(initialSessionState, {
      type: "ADD_MESSAGE",
      payload: { role: "user", content: "hello", agent },
    });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.content).toBe("hello");
    expect(s.messages[0]!.role).toBe("user");
    expect(s.streamingContent).toBe("");
    expect(s.visibleOffset).toBe(0);
  });

  it("ADD_MESSAGE 有 pending 时先提交 assistant 再追加", () => {
    const pending: SessionState = {
      ...initialSessionState,
      streamingContent: "I'm thinking",
    };
    const s = sessionReducer(pending, {
      type: "ADD_MESSAGE",
      payload: { role: "user", content: "next", agent },
    });
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0]!.role).toBe("assistant");
    expect(s.messages[0]!.content).toBe("I'm thinking");
    expect(s.messages[1]!.role).toBe("user");
    expect(s.messages[1]!.content).toBe("next");
    expect(s.streamingContent).toBe("");
  });

  it("ADD_MESSAGE 去重：pending 与末条相同不重复提交", () => {
    const duplicate: SessionState = {
      ...initialSessionState,
      messages: [{ role: "assistant", content: "same text", agent }],
      streamingContent: "same text",
    };
    const s = sessionReducer(duplicate, {
      type: "ADD_MESSAGE",
      payload: { role: "user", content: "go on", agent },
    });
    // pending 内容等于末条 → 不入队 pending，只追加用户消息
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0]!.content).toBe("same text");
    expect(s.messages[1]!.content).toBe("go on");
  });

  // ── STREAM_CHUNK ────────────────────────────
  it("STREAM_CHUNK 累加内容", () => {
    const s1 = sessionReducer(initialSessionState, { type: "STREAM_CHUNK", payload: "Hello" });
    expect(s1.streamingContent).toBe("Hello");
    const s2 = sessionReducer(s1, { type: "STREAM_CHUNK", payload: " World" });
    expect(s2.streamingContent).toBe("Hello World");
    expect(s2.visibleOffset).toBe(0);
  });

  // ── STREAM_END ──────────────────────────────
  it("STREAM_END 将流式内容转为 assistant 消息", () => {
    const streaming: SessionState = {
      ...initialSessionState,
      streamingContent: "final answer",
      agent,
    };
    const s = sessionReducer(streaming, { type: "STREAM_END" });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.role).toBe("assistant");
    expect(s.messages[0]!.content).toBe("final answer");
    expect(s.streamingContent).toBe("");
  });

  it("STREAM_END 无内容则 noop", () => {
    const s = sessionReducer(initialSessionState, { type: "STREAM_END" });
    expect(s).toBe(initialSessionState);
  });

  it("STREAM_END 去重：末条与内容相同只清 streaming", () => {
    const dup: SessionState = {
      ...initialSessionState,
      messages: [{ role: "assistant", content: "dup", agent }],
      streamingContent: "dup",
    };
    const s = sessionReducer(dup, { type: "STREAM_END" });
    expect(s.messages).toHaveLength(1);
    expect(s.streamingContent).toBe("");
  });

  // ── TURN_INTERRUPTED ────────────────────────
  it("TURN_INTERRUPTED 有流式内容时注入中断消息", () => {
    const interrupted: SessionState = {
      ...initialSessionState,
      streamingContent: "partial",
      isProcessing: true,
      agent,
    };
    const s = sessionReducer(interrupted, { type: "TURN_INTERRUPTED" });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.content).toBe("partial\n\n⎇ 已中断");
    expect(s.streamingContent).toBe("");
    expect(s.isProcessing).toBe(false);
    expect(s.pendingPermission).toBeNull();
  });

  it("TURN_INTERRUPTED 无流式内容时注入纯中断消息", () => {
    const idle: SessionState = {
      ...initialSessionState,
      isProcessing: true,
      agent,
    };
    const s = sessionReducer(idle, { type: "TURN_INTERRUPTED" });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.content).toBe("⎇ 已中断");
    expect(s.isProcessing).toBe(false);
  });

  it("TURN_INTERRUPTED 幂等：已标记中断且无流式残留仅复位", () => {
    const idempotent: SessionState = {
      ...initialSessionState,
      messages: [{ role: "assistant", content: "msg ⎇ 已中断", agent }],
      streamingContent: "",
      isProcessing: true,
    };
    const s = sessionReducer(idempotent, { type: "TURN_INTERRUPTED" });
    // 消息数不变，不追加新中断
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.content).toBe("msg ⎇ 已中断");
    expect(s.isProcessing).toBe(false);
  });

  it("TURN_INTERRUPTED 已 finalize 的消息末尾追加中断标记", () => {
    const finalized: SessionState = {
      ...initialSessionState,
      messages: [{ role: "assistant", content: "done", agent }],
      streamingContent: "done",
    };
    const s = sessionReducer(finalized, { type: "TURN_INTERRUPTED" });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.content).toBe("done\n\n⎇ 已中断");
    expect(s.streamingContent).toBe("");
  });

  // ── SET_MODE ────────────────────────────────
  it("SET_MODE 切换 plan/chat", () => {
    const plan = sessionReducer(initialSessionState, { type: "SET_MODE", payload: "plan" });
    expect(plan.mode).toBe("plan");
    const chat = sessionReducer(plan, { type: "SET_MODE", payload: "chat" });
    expect(chat.mode).toBe("chat");
  });

  // ── SCROLL ──────────────────────────────────
  it("SCROLL_UP 增加偏移，不超过上限", () => {
    const withMsgs: SessionState = {
      ...initialSessionState,
      messages: Array.from({ length: 20 }, (_, i) => ({ role: "user" as const, content: `m${i}` })),
    };
    const s1 = sessionReducer(withMsgs, { type: "SCROLL_UP" });
    expect(s1.visibleOffset).toBe(3);
    // 多次滚动不超过 messages.length - 5
    let s = s1;
    for (let i = 0; i < 10; i++) s = sessionReducer(s, { type: "SCROLL_UP" });
    expect(s.visibleOffset).toBe(Math.min(3 * 11, 15));
    expect(s.visibleOffset).toBe(15);
  });

  it("SCROLL_DOWN 减少偏移，不低于 0", () => {
    const scrolled: SessionState = { ...initialSessionState, visibleOffset: 10 };
    const s1 = sessionReducer(scrolled, { type: "SCROLL_DOWN" });
    expect(s1.visibleOffset).toBe(7);
    const s2 = sessionReducer(s1, { type: "SCROLL_DOWN" });
    expect(s2.visibleOffset).toBe(4);
    const s3 = sessionReducer(s2, { type: "SCROLL_DOWN" });
    expect(s3.visibleOffset).toBe(1);
    const s4 = sessionReducer(s3, { type: "SCROLL_DOWN" });
    expect(s4.visibleOffset).toBe(0);
    const s5 = sessionReducer(s4, { type: "SCROLL_DOWN" });
    expect(s5.visibleOffset).toBe(0); // 不低于 0
  });

  it("SCROLL_TO_BOTTOM 归零", () => {
    const scrolled: SessionState = { ...initialSessionState, visibleOffset: 42 };
    const s = sessionReducer(scrolled, { type: "SCROLL_TO_BOTTOM" });
    expect(s.visibleOffset).toBe(0);
  });

  // ── SET_PROCESSING ──────────────────────────
  it("SET_PROCESSING 控制处理态", () => {
    const s1 = sessionReducer(initialSessionState, { type: "SET_PROCESSING", payload: true });
    expect(s1.isProcessing).toBe(true);
    const s2 = sessionReducer(s1, { type: "SET_PROCESSING", payload: false });
    expect(s2.isProcessing).toBe(false);
  });

  // ── TOKEN_UPDATE ────────────────────────────
  it("TOKEN_UPDATE 累积 token", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "TOKEN_UPDATE",
      payload: { type: "token_usage", promptTokens: 100, completionTokens: 50, sessionTotalTokens: 0, contextWindowSize: 128_000 } as never,
    });
    expect(s1.tokenUsage.sessionTotalTokens).toBe(150);
    expect(s1.tokenUsage.contextWindowSize).toBe(128_000);
    const s2 = sessionReducer(s1, {
      type: "TOKEN_UPDATE",
      payload: { type: "token_usage", promptTokens: 200, completionTokens: 80, sessionTotalTokens: 0, contextWindowSize: 64_000, cacheHitTokens: 30, cacheMissTokens: 10 } as never,
    });
    expect(s2.tokenUsage.sessionTotalTokens).toBe(430);
    expect(s2.tokenUsage.contextWindowSize).toBe(64_000);
    expect(s2.tokenUsage.cacheHitTokens).toBe(30);
    expect(s2.tokenUsage.cacheMissTokens).toBe(10);
  });

  // ── COMPACTION ──────────────────────────────
  it("COMPACTION 重置 token 计数并追加系统消息", () => {
    const withTokens: SessionState = {
      ...initialSessionState,
      tokenUsage: { sessionTotalTokens: 9999, contextWindowSize: 128_000, cacheHitTokens: 50, cacheMissTokens: 20 },
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b", agent },
      ],
    };
    const s = sessionReducer(withTokens, {
      type: "COMPACTION",
      payload: { type: "compaction", compactedCount: 3, estimatedTokens: 500 } as never,
    });
    expect(s.tokenUsage.sessionTotalTokens).toBe(500);
    expect(s.tokenUsage.cacheHitTokens).toBe(50);
    expect(s.tokenUsage.cacheMissTokens).toBe(20);
    expect(s.messages).toHaveLength(3);
    expect(s.messages[2]!.role).toBe("system");
    expect(s.messages[2]!.content).toContain("3 条");
    expect(s.messages[2]!.content).toContain("500");
  });

  // ── RESTORE_SESSION ─────────────────────────
  it("RESTORE_SESSION 恢复会话", () => {
    const s = sessionReducer(initialSessionState, {
      type: "RESTORE_SESSION",
      payload: { agent, messages: [{ role: "user", content: "restored" }] },
    });
    expect(s.agent).toBe(agent);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.content).toBe("restored");
    expect(s.sessionRestored).toBe(true);
  });

  // ── PLAN 动作 ───────────────────────────────
  it("PLAN_GENERATED 设置 plan 状态", () => {
    const s = sessionReducer(initialSessionState, {
      type: "PLAN_GENERATED",
      payload: { nodes: [{ id: "p1", type: "task", tags: [], needsMultiPerspective: false, status: "pending", claimedBy: [agent], payload: "do", results: [], createdAt: 0 } as any] } as never,
    });
    expect(s.planNodes).toHaveLength(1);
    expect(s.planNodes[0]!.id).toBe("p1");
    expect(s.planNodes[0]!.renderStatus).toBe("pending");
    expect(s.planState).toBe("reviewing");
    expect(s.mode).toBe("plan");
  });

  it("PLAN_APPROVED → PLAN_EXECUTED 切换", () => {
    const withPlan: SessionState = { ...initialSessionState, planState: "reviewing", mode: "plan" };
    const approved = sessionReducer(withPlan, { type: "PLAN_APPROVED" });
    expect(approved.planState).toBe("approved");
    const executed = sessionReducer(approved, { type: "PLAN_EXECUTED" });
    expect(executed.planState).toBe("completed");
    expect(executed.planNodes).toEqual([]);
    expect(executed.mode).toBe("chat");
  });

  it("PLAN_FAILED 追加错误消息", () => {
    const s = sessionReducer(initialSessionState, { type: "PLAN_FAILED", payload: "timeout" });
    expect(s.planState).toBe("failed");
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.content).toContain("timeout");
  });

  it("NODE_START 更新节点状态并触发 executing", () => {
    const withNodes: SessionState = {
      ...initialSessionState,
      planNodes: [{ id: "n1", renderStatus: "pending" } as any],
      planState: "approved",
    };
    const s = sessionReducer(withNodes, { type: "NODE_START", payload: { nodeId: "n1" } as never });
    expect(s.planNodes[0]!.renderStatus).toBe("executing");
    expect(s.planState).toBe("executing");
  });

  it("NODE_COMPLETE 标记完成", () => {
    const withNodes: SessionState = {
      ...initialSessionState,
      planNodes: [{ id: "n1", renderStatus: "executing" } as any],
    };
    const s = sessionReducer(withNodes, { type: "NODE_COMPLETE", payload: { nodeId: "n1" } as never });
    expect(s.planNodes[0]!.renderStatus).toBe("done");
  });

  it("NODE_FAILED 追加系统消息", () => {
    const withNodes: SessionState = {
      ...initialSessionState,
      planNodes: [{ id: "n1", renderStatus: "executing" } as any],
    };
    const s = sessionReducer(withNodes, { type: "NODE_FAILED", payload: { nodeId: "n1", error: "crash" } as never });
    expect(s.planNodes[0]!.renderStatus).toBe("failed");
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.content).toContain("crash");
  });

  it("TASK_TREE_UPDATE 合并渲染状态", () => {
    const existing: SessionState = {
      ...initialSessionState,
      planNodes: [{ id: "n1", renderStatus: "executing" } as any],
    };
    const s = sessionReducer(existing, {
      type: "TASK_TREE_UPDATE",
      payload: { nodes: [{ id: "n1", type: "task", tags: [], needsMultiPerspective: false, status: "running", claimedBy: [agent], payload: "do", results: [], createdAt: 0 } as any] } as never,
    });
    expect(s.planNodes).toHaveLength(1);
    expect(s.planNodes[0]!.renderStatus).toBe("executing"); // 保留原有状态
  });

  // ── 工具调用 ────────────────────────────────
  it("TOOL_START 追加工具记录", () => {
    const s = sessionReducer(initialSessionState, {
      type: "TOOL_START",
      payload: { id: "t1", tool: "read", agent } as never,
    });
    expect(s.recentTools).toHaveLength(1);
    expect(s.recentTools[0]!.id).toBe("t1");
    expect(s.recentTools[0]!.tool).toBe("read");
  });

  it("TOOL_RESULT 更新工具结果", () => {
    const withTool: SessionState = {
      ...initialSessionState,
      recentTools: [{ id: "t1", tool: "read", agent }],
    };
    const s = sessionReducer(withTool, {
      type: "TOOL_RESULT",
      payload: { id: "t1", success: true, durationMs: 100 } as never,
    });
    expect(s.recentTools[0]!.success).toBe(true);
    expect(s.recentTools[0]!.durationMs).toBe(100);
  });

  // ── 权限 ────────────────────────────────────
  it("PERMISSION_REQUIRED 设置待确认权限", () => {
    const perm = { tool: "write", input: "file.txt", level: 2 as const, agent: "code" };
    const s = sessionReducer(initialSessionState, { type: "PERMISSION_REQUIRED", payload: perm });
    expect(s.pendingPermission).toEqual(perm);
  });

  it("PERMISSION_RESOLVED 清除待确认权限", () => {
    const withPerm: SessionState = {
      ...initialSessionState,
      pendingPermission: { tool: "write", input: "x", level: 2, agent: "code" },
    };
    const s = sessionReducer(withPerm, { type: "PERMISSION_RESOLVED" });
    expect(s.pendingPermission).toBeNull();
  });

  // ── 未知 action ─────────────────────────────
  it("未知 action 返回原状态", () => {
    const s = sessionReducer(initialSessionState, { type: "UNKNOWN" as any });
    expect(s).toBe(initialSessionState);
  });
});
