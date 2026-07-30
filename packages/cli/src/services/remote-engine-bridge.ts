/**
 * remote-engine-bridge.ts — 远程引擎桥接（Daemon 模式）
 *
 * 实现 ITuiEngineBridge 接口，将所有引擎操作委托给
 * 运行中的 Cortex daemon（通过 @cortex/client HTTP/WS）。
 *
 * 架构：
 *   CLI (TUI) ── RemoteEngineBridge ──HTTP/WS── daemon ──in-process── engine
 *
 * 与 EngineBridge（本地 in-process）互为替代——TUI 层通过
 * ITuiEngineBridge 接口消费，无需感知引擎运行在本地还是远端。
 *
 * @module services/remote-engine-bridge
 * @since v3 — CLI TUI Daemon 模式
 */

import {
  type AgentType,
  type ITuiEngineBridge,
  type IMetaAgent,
  type LlmMessage,
  type MemoryEntry,
  type MemoryQuery,
  type MemoryWriteInput,
  type TaskNode,
  type ExecutionReport,
  type ReasoningEffort,
} from "@cortex/shared";
import { CortexConnection } from "@cortex/client";

// ═══════════════════════════════════════════════════════════
// §1 RemoteEngineBridge
// ═══════════════════════════════════════════════════════════

export interface RemoteBridgeOptions {
  /** Daemon 端口（默认 3210） */
  port?: number;
  /** Daemon 主机（默认 localhost） */
  host?: string;
}

/**
 * RemoteEngineBridge — 通过 HTTP/WS 连接 daemon 的 ITuiEngineBridge 实现。
 *
 * 所有 LLM 推理、工具执行、记忆读写均在 daemon 侧完成，
 * 本桥接仅负责序列化请求和反序列化响应。
 */
export class RemoteEngineBridge implements ITuiEngineBridge {
  readonly conn: CortexConnection;
  private _chatModelName = "";
  private _reasonerModelName = "";
  private _healthFetched = false;
  /** 当前活跃 agent——由 queryLoop 在调用 streamChat 前设置 */
  private _currentAgent = "cyrene";

  constructor(opts?: RemoteBridgeOptions) {
    const port = opts?.port ?? 3210;
    const host = opts?.host ?? "localhost";

    this.conn = new CortexConnection({
      host,
      port,
      channels: ["chat", "gate", "tui", "pipeline"],
    });
  }

  /** 建立 WebSocket 连接并预获取 daemon 健康信息（缓存模型名） */
  async connect(): Promise<void> {
    this.conn.connect();
    await this._fetchHealth();
  }

  /** 断开连接 */
  disconnect(): void {
    this.conn.disconnect();
  }

  // ─── 模型名 ──────────────────────────────────────────

  getChatModelName(): string {
    return this._chatModelName || "deepseek-v4-flash";
  }

  getReasonerModelName(): string {
    return this._reasonerModelName || "deepseek-v4-pro";
  }

  // ─── 工具定义 ────────────────────────────────────────

  getToolDefs(agent: AgentType): { name: string; description: string; parameters?: Record<string, unknown> }[] {
    // 远程模式下工具定义由 daemon 侧管理——TUI 不需要本地工具列表。
    // 同步当前活跃 agent 供 streamChat 使用（替代硬编码 "cyrene"）。
    this._currentAgent = agent;
    return [];
  }

  /**
   * 异步获取 Agent 工具定义（非 ITuiEngineBridge 接口方法，扩展用）。
   * 用于需要在 TUI 中展示工具列表的场景。
   */
  async fetchToolDefs(agent: AgentType): Promise<{ name: string; description: string; parameters?: Record<string, unknown> }[]> {
    try {
      const agents = await this.conn.http.getAgents();
      const toolNames = agents[agent];
      if (!toolNames) return [];
      return toolNames.map((name) => ({ name, description: "" }));
    } catch {
      return [];
    }
  }

  /** 设置当前活跃 agent——queryLoop 在 streamChat 前调用 */
  setCurrentAgent(agent: string): void {
    this._currentAgent = agent;
  }

  // ─── 流式对话 ────────────────────────────────────────

  /**
   * 流式 LLM 对话——通过 WS chat channel 实现。
   *
   * 远程模式下，daemon 运行完整的 queryLoop（含工具执行），
   * 客户端仅接收流式事件。此方法发起 chat.start 并等待
   * chat.complete，期间通过 onChunk 回调推送文本块。
   *
   * 注意：远程模式下 tool_calls 始终为 undefined（daemon 自行处理工具）。
   */
  async streamChat(
    model: string,
    messages: LlmMessage[],
    tools: { name: string; description: string; parameters?: Record<string, unknown> }[] | undefined,
    onChunk: (content: string, reasoning?: string) => void,
    opts?: { reasoningEffort?: ReasoningEffort | null; signal?: AbortSignal },
  ): Promise<{
    content: string | null;
    tool_calls?: { id: string; name: string; arguments: Record<string, unknown> }[];
    usage?: { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number };
    reasoning_content?: string;
  }> {
    // 提取用户输入（最后一条 user 消息）
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const input = lastUserMsg?.content ?? "";

    // 完整序列化消息历史——保留 tool_calls / reasoning_content / tool_call_id
    const serializeMsg = (m: LlmMessage): Record<string, unknown> => {
      const dto: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.tool_call_id) dto.tool_call_id = m.tool_call_id;
      if (m.reasoning_content) dto.reasoning_content = m.reasoning_content;
      if (m.tool_calls && m.tool_calls.length > 0) {
        dto.tool_calls = m.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
        }));
      }
      return dto;
    };

    return await new Promise((resolve, reject) => {
      let fullContent = "";
      let fullReasoning = "";

      const sessionId = this.conn.ws.startChat({
        input,
        mode: "chat",
        agent: this._currentAgent,
        history: messages.map(serializeMsg) as never,
      });

      const unsubChat = this.conn.ws.on("chat", (msg: { data: Record<string, unknown> }) => {
        const data = msg.data;
        if (data.sessionId !== sessionId) return;

        switch (data.type) {
          case "chat.chunk":
            fullContent += (data.content as string) ?? "";
            if (data.reasoning) fullReasoning += data.reasoning as string;
            onChunk(data.content as string, data.reasoning as string | undefined);
            break;
          case "chat.complete":
            cleanup();
            resolve({
              content: (data.output as string) || fullContent || null,
              tool_calls: undefined,
              usage: data.usage
                ? {
                    prompt_tokens: (data.usage as Record<string, number>).promptTokens ?? 0,
                    completion_tokens: (data.usage as Record<string, number>).completionTokens ?? 0,
                  }
                : undefined,
              reasoning_content: fullReasoning || undefined,
            });
            break;
          case "chat.error":
            cleanup();
            reject(new Error(data.error as string));
            break;
        }
      });

      const cleanup = () => {
        unsubChat();
      };

      // 外部中断（TUI Esc）——断开订阅并以已收到的部分内容干净收尾
      if (opts?.signal) {
        const onAbort = (): void => {
          cleanup();
          resolve({ content: fullContent || null, tool_calls: undefined, usage: undefined, reasoning_content: fullReasoning || undefined });
        };
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  // ─── 工具执行 ────────────────────────────────────────

  /**
   * 执行工具调用——POST /api/v1/execute。
   * 远程模式下由 daemon 侧的 Toolkit 执行。
   */
  async executeToolCall(name: string, args: Record<string, unknown>): Promise<{ success: boolean; output: string }> {
    try {
      const result = await this.conn.http.execute(JSON.stringify({ tool: name, params: args }));
      const r = result as { success?: boolean; output?: string; error?: string };
      return {
        success: r.success ?? true,
        output: r.output ?? (typeof result === "string" ? result : JSON.stringify(result)),
      };
    } catch (err) {
      return {
        success: false,
        output: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ─── 非流式对话 ──────────────────────────────────────

  /**
   * 非流式 LLM 对话——POST /api/v1/chat。
   * 用于摘要、压缩等不需要流式渲染的场景。
   */
  async chat(systemPrompt: string, messages: LlmMessage[], opts?: { model?: string; reasoningEffort?: ReasoningEffort }): Promise<string> {
    void opts;
    // 将 system prompt + messages 序列化为单次输入
    const combined = messages.map((m) => `${m.role}: ${m.content ?? ""}`).join("\n");
    const input = `[System: ${systemPrompt}]\n${combined}`;
    return await this.conn.http.chat(input);
  }

  // ─── 记忆 ────────────────────────────────────────────

  /** 初始化昔涟独立记忆——远程模式下由 daemon 管理，no-op */
  async ensureTalkMemory(): Promise<void> {
    // Daemon 侧在启动时已初始化记忆存储，客户端无需操作
  }

  /** 读取昔涟记忆——GET /api/v1/memory */
  async readTalkMemory(query: MemoryQuery): Promise<MemoryEntry[]> {
    try {
      // MemoryQuery.keywords → 空格 join → HTTP query string
      // daemon 侧 handleMemoryGet 会将 query 串 split(\s+) 还原为 keywords
      const queryStr = query.keywords?.join(" ") ?? "";
      const results = await this.conn.http.searchMemory(queryStr, {
        kind: query.kind,
        limit: query.limit,
      });
      return results as unknown as MemoryEntry[];
    } catch {
      return [];
    }
  }

  /** 写入昔涟记忆——POST /api/v1/memory */
  async writeTalkMemory(entry: MemoryWriteInput): Promise<void> {
    await this.conn.http.writeMemory(entry as never);
  }

  // ─── 流式任务执行 ────────────────────────────────────

  /**
   * 流式执行任务节点——通过 WS pipeline/tui channel 接收事件。
   *
   * 远程模式下，daemon 的 Scheduler 执行所有节点，
   * 客户端通过 WS 接收 node_start/node_complete/node_failed 事件。
   */
  async executeWithStream(nodes: TaskNode[], onEvent: (event: unknown) => void): Promise<ExecutionReport> {
    // 提交执行请求
    const input = JSON.stringify({ action: "execute_plan", nodes });
    await this.conn.http.execute(input);

    // 监听 TUI channel 的节点事件
    return await new Promise<ExecutionReport>((resolve) => {
      const results: { nodeId: string; success: boolean; output?: string; error?: string; agentType?: AgentType }[] = [];
      let completedCount = 0;
      const totalNodes = nodes.length;

      const unsubTui = this.conn.ws.on("tui", (msg: { data: Record<string, unknown> }) => {
        const data = msg.data;
        onEvent(data);

        if (data.type === "node_complete") {
          results.push({
            nodeId: data.nodeId as string,
            success: true,
            output: data.output as string,
            agentType: data.agent as AgentType,
          });
          completedCount++;
        } else if (data.type === "node_failed") {
          results.push({
            nodeId: data.nodeId as string,
            success: false,
            error: data.error as string,
            agentType: data.agent as AgentType,
          });
          completedCount++;
        }

        if (completedCount >= totalNodes) {
          unsubTui();
          resolve({
            results,
            durationMs: 0,
            totalNodes,
            completedNodes: results.filter((r) => r.success).length,
          } as unknown as ExecutionReport);
        }
      });

      // 超时保护：60s 后强制 resolve
      setTimeout(() => {
        unsubTui();
        resolve({
          results,
          durationMs: 60000,
          totalNodes,
          completedNodes: results.filter((r) => r.success).length,
        } as unknown as ExecutionReport);
      }, 60_000);
    });
  }

  // ─── MetaAgent ───────────────────────────────────────

  /**
   * 获取 MetaAgent 代理——远程模式下返回一个通过 HTTP 调用 daemon 的代理对象。
   * daemon 侧运行真正的甘雨 MetaAgent。
   */
  async getMetaAgent(): Promise<IMetaAgent | undefined> {
    return {
      plan: async (intent: string, context?: Record<string, unknown>): Promise<TaskNode[]> => {
        const input = JSON.stringify({ action: "plan", intent, context });
        const result = await this.conn.http.execute(input);
        const r = result as { nodes?: TaskNode[] };
        return r.nodes ?? [];
      },
    };
  }

  // ─── 内部 ────────────────────────────────────────────

  /** 预获取 daemon 健康信息，缓存模型名 */
  private async _fetchHealth(): Promise<void> {
    if (this._healthFetched) return;
    try {
      const health = await this.conn.http.getDaemonHealth();
      // DaemonHealthSnapshot 扩展了 HealthSnapshot，可能包含模型信息
      const h = health as unknown as Record<string, unknown>;
      if (h.chatModel && typeof h.chatModel === "string") {
        this._chatModelName = h.chatModel;
      }
      if (h.reasonerModel && typeof h.reasonerModel === "string") {
        this._reasonerModelName = h.reasonerModel;
      }
      this._healthFetched = true;
    } catch {
      // Daemon 未就绪时使用默认值
      this._healthFetched = true;
    }
  }
}
