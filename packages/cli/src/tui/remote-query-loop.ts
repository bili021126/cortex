/**
 * tui/remote-query-loop.ts — 远程查询循环（Daemon 模式）
 *
 * 与本地 queryLoop 对等的异步生成器，但事件源从本地引擎
 * 切换为 daemon WebSocket 推送。TUI 渲染层无需感知差异——
 * 两者 yield 相同的 TuiEvent 联合类型。
 *
 * 架构：
 *   Ink 组件 ← consume ← remoteQueryLoop() ← WS events ← daemon queryLoop
 *
 * 循环逻辑：
 * 1. 调用 conn.ws.startChat({ input, mode, agent }) 发起对话
 * 2. 订阅 "chat" channel，将 WS 事件映射为 TuiEvent yield
 * 3. 订阅 "gate" channel，收到 gate.request 时调用确认回调
 * 4. chat.complete → return 最终输出
 * 5. chat.error → throw
 *
 * @module tui/remote-query-loop
 * @since v3 — CLI TUI Daemon 模式
 */

import type { AgentType, LlmMessage } from "@cortex/shared";
import type { CortexConnection } from "@cortex/client";
import type { TuiEvent, TuiHooks, ReplMode } from "./types.js";

// ═══════════════════════════════════════════════════════════
// §1 类型定义
// ═══════════════════════════════════════════════════════════

/** remoteQueryLoop 参数 */
export interface RemoteQueryLoopParams {
  /** 已连接的 CortexConnection 实例 */
  conn: CortexConnection;
  /** 用户输入文本 */
  input: string;
  /** 对话模式 */
  mode: ReplMode;
  /** Agent 类型 */
  agent: AgentType;
  /** 生命周期钩子（与本地 queryLoop 共用） */
  hooks: TuiHooks;
  /** 对话历史（多轮） */
  history?: LlmMessage[];
  /** 会话 ID（复用已有会话） */
  sessionId?: string;
  /**
   * 确认门回调——收到 gate.request 时调用。
   * 返回 true 表示批准，false 表示拒绝。
   * 若未提供，默认自动批准。
   */
  onGateRequest?: (request: GateRequestInfo) => Promise<boolean>;
}

/** 确认门请求信息 */
export interface GateRequestInfo {
  requestId: string;
  sessionId: string;
  toolName: string;
  level: string;
  summary: string;
  detail?: string;
}

// ═══════════════════════════════════════════════════════════
// §2 remoteQueryLoop 异步生成器
// ═══════════════════════════════════════════════════════════

/**
 * 远程查询循环——与本地 queryLoop 接口对等。
 *
 * yield TuiEvent 供 Ink 组件消费，return 最终输出文本。
 * 事件源为 daemon WS 推送而非本地 LLM 调用。
 */
export async function* remoteQueryLoop(
  p: RemoteQueryLoopParams,
): AsyncGenerator<TuiEvent, string, void> {
  const { conn, input, mode, agent, hooks, history, sessionId, onGateRequest } = p;

  // Hook: onStreamStart
  hooks.onStreamStart?.();

  // 发起对话
  const resolvedSessionId = conn.ws.startChat({
    input,
    mode: mode as "chat" | "talk" | "plan" | "party" | "command",
    agent,
    sessionId,
    history: history?.map((m) => ({
      role: m.role,
      content: m.content,
    })) as never,
  });

  // 事件队列 + 信号机制——将 WS 回调转为 async generator 可消费的流
  const eventQueue: TuiEvent[] = [];
  let done = false;
  let finalOutput = "";
  let streamError: Error | null = null;
  let resolveWait: (() => void) | null = null;

  const signal = () => {
    if (resolveWait) {
      const r = resolveWait;
      resolveWait = null;
      r();
    }
  };

  const pushEvent = (ev: TuiEvent) => {
    eventQueue.push(ev);
    signal();
  };

  const finish = (output: string) => {
    finalOutput = output;
    done = true;
    signal();
  };

  const fail = (err: Error) => {
    streamError = err;
    done = true;
    signal();
  };

  // 订阅 chat channel
  const unsubChat = conn.ws.on("chat", (msg: { data: Record<string, unknown> }) => {
    const data = msg.data;
    if (data.sessionId !== resolvedSessionId) return;

    switch (data.type) {
      case "chat.chunk": {
        const ev: TuiEvent = {
          type: "llm_chunk",
          agent,
          content: (data.content as string) ?? "",
          reasoning: data.reasoning as string | undefined,
        };
        pushEvent(ev);
        hooks.onChunk?.(ev as TuiEvent & { type: "llm_chunk" });
        break;
      }

      case "chat.tool_start": {
        const ev: TuiEvent = {
          type: "tool_start",
          id: (data.toolCallId as string) ?? "",
          agent: (data.agent as AgentType) ?? agent,
          tool: (data.toolName as string) ?? "",
          input: (data.input as string) ?? "",
        };
        pushEvent(ev);
        break;
      }

      case "chat.tool_result": {
        const ev: TuiEvent = {
          type: "tool_result",
          id: (data.toolCallId as string) ?? "",
          agent,
          tool: (data.toolName as string) ?? "",
          success: (data.success as boolean) ?? true,
          output: data.output as string | undefined,
          error: data.success ? undefined : (data.output as string),
          durationMs: (data.durationMs as number) ?? 0,
        };
        pushEvent(ev);
        break;
      }

      case "chat.complete": {
        // Token 用量事件
        if (data.usage) {
          const usage = data.usage as { promptTokens?: number; completionTokens?: number };
          pushEvent({
            type: "token_usage",
            promptTokens: usage.promptTokens ?? 0,
            completionTokens: usage.completionTokens ?? 0,
            sessionTotalTokens: (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0),
            contextWindowSize: 500000,
          });
        }
        finish((data.output as string) ?? "");
        break;
      }

      case "chat.error": {
        fail(new Error((data.error as string) ?? "远程对话出错"));
        break;
      }
    }
  });

  // 订阅 gate channel——确认门请求
  const unsubGate = conn.ws.on("gate", (msg: { data: Record<string, unknown> }) => {
    const data = msg.data;
    if (data.type !== "gate.request") return;
    if (data.sessionId !== resolvedSessionId) return;

    const request: GateRequestInfo = {
      requestId: data.requestId as string,
      sessionId: data.sessionId as string,
      toolName: data.toolName as string,
      level: data.level as string,
      summary: data.summary as string,
      detail: data.detail as string | undefined,
    };

    // 发射权限确认事件供 TUI 渲染
    pushEvent({
      type: "permission_required",
      agent,
      tool: request.toolName,
      input: request.summary,
      reversibilityLevel: (request.level === "L3" ? 3 : request.level === "L2" ? 2 : 1) as 1 | 2 | 3,
    });

    // 异步处理确认——不阻塞事件循环
    void (async () => {
      let approved = true;
      if (onGateRequest) {
        try {
          approved = await onGateRequest(request);
        } catch {
          approved = false;
        }
      }
      conn.ws.resolveGate(request.requestId, approved);
    })();
  });

  // 消费事件队列——async generator 核心循环
  try {
    while (!done) {
      // 排空队列中已有事件
      while (eventQueue.length > 0) {
        const ev = eventQueue.shift();
        if (!ev) break;
        yield ev;
      }

      if (done) break;

      // 等待新事件到达
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
      });
    }

    // 排空残余事件
    while (eventQueue.length > 0) {
      const ev = eventQueue.shift();
      if (!ev) break;
      yield ev;
    }
  } finally {
    // 清理订阅
    unsubChat();
    unsubGate();
  }

  // Hook: onStreamEnd
  hooks.onStreamEnd?.();

  if (streamError) {
    hooks.onError?.(streamError, "remote-query-loop");
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw streamError;
  }

  // Hook: onPostProcessOutput
  if (finalOutput) {
    finalOutput = await (hooks.onPostProcessOutput?.(finalOutput) ?? Promise.resolve(finalOutput));
  }

  return finalOutput;
}

// ═══════════════════════════════════════════════════════════
// §3 辅助：取消对话
// ═══════════════════════════════════════════════════════════

/**
 * 取消正在进行的远程对话。
 * 返回一个 cancel 函数，可在 TUI 层绑定到 Ctrl+C 等中断操作。
 */
export function createRemoteCancel(conn: CortexConnection, sessionId: string): () => void {
  return () => {
    conn.ws.cancelChat(sessionId);
  };
}
