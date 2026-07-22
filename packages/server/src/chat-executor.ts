/**
 * @cortex/server — ChatExecutor
 *
 * Delegates LLM streaming + tool execution to engine.streamChat.
 * Adds gate confirmation via RemoteGateBridge and WS event emission.
 */

import * as crypto from "node:crypto";
import type { EngineHost } from "./engine-host.js";
import type { RemoteGateBridge } from "./gate-bridge.js";
import type { ChatSession } from "./session-manager.js";
import { streamChat } from "@cortex/engine";
import type {
  WSChatChunkEvent,
  WSChatToolStartEvent,
  WSChatToolResultEvent,
  WSChatCompleteEvent,
  WSChatErrorEvent,
} from "@cortex/protocol";
import type { LlmMessage, ReversibilityLevel } from "@cortex/shared";

const SYSTEM_PROMPT = "[系统指令] 你是 Cortex 工程助手。";
const READ_ONLY = new Set([
  "read_file", "search_code", "list_files", "parse_ast", "search_symbol",
  "grep_files", "glob_find", "file_info", "resolve_import", "json_query", "web_search",
  "read_many_files", "diff_files",
]);

export class ChatExecutor {
  private readonly engine: EngineHost;
  private readonly gateBridge: RemoteGateBridge;

  constructor(engine: EngineHost, gateBridge: RemoteGateBridge) {
    this.engine = engine;
    this.gateBridge = gateBridge;
  }

  async execute(session: ChatSession, input: string): Promise<void> {
    const signal = session.abortController.signal;

    try {
      // Append user message to history
      const userMsg: LlmMessage = { role: "user", content: input };
      session.history.push(userMsg);
      session.lastActiveAt = Date.now();

      // Build messages
      const messages: LlmMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...session.history,
      ];

      // Correlate tool_start / tool_result via shared ID
      let currentToolCallId = "";

      // Delegate to engine.streamChat for the full loop
      const result = await streamChat({
        llm: this.engine.llm,
        toolkit: this.engine.toolkitInstance,
        agentType: session.agent,
        model: this.engine.llm.chatModel,
        systemPrompt: SYSTEM_PROMPT,
        messages,
        maxRounds: 20,
        signal,
        onChunk: (content: string, reasoning?: string) => {
          if (signal.aborted) return;
          session.send({
            channel: "chat",
            data: { type: "chat.chunk", sessionId: session.id, content, ...(reasoning ? { reasoning } : {}) },
          } satisfies WSChatChunkEvent);
        },
        onBeforeToolExecute: async (name: string, args: Record<string, unknown>) => {
          currentToolCallId = crypto.randomUUID();
          session.send({
            channel: "chat",
            data: { type: "chat.tool_start", sessionId: session.id, toolCallId: currentToolCallId, toolName: name, input: JSON.stringify(args), agent: session.agent },
          } satisfies WSChatToolStartEvent);
          if (!this.gateBridge || READ_ONLY.has(name)) return true;
          const resp = await this.gateBridge.confirm({
            id: `ws-gate-${session.id}-${Date.now()}`,
            toolName: name,
            level: "L2" as ReversibilityLevel,
            summary: `Tool "${name}" requires confirmation`,
            detail: JSON.stringify(args),
          });
          return resp.approved;
        },
        onToolEnd: (name: string, output: string, durationMs: number) => {
          session.send({
            channel: "chat",
            data: { type: "chat.tool_result", sessionId: session.id, toolCallId: currentToolCallId, toolName: name, success: !output.startsWith("ERROR"), output, durationMs },
          } satisfies WSChatToolResultEvent);
        },
      });

      if (result.cancelled) {
        session.send({
          channel: "chat",
          data: { type: "chat.error", sessionId: session.id, error: "cancelled" },
        } satisfies WSChatErrorEvent);
        return;
      }

      session.send({
        channel: "chat",
        data: {
          type: "chat.complete",
          sessionId: session.id,
          output: result.output,
          reasoning: result.reasoning,
          usage: result.usage ? { promptTokens: result.usage.prompt_tokens, completionTokens: result.usage.completion_tokens } : undefined,
        },
      } satisfies WSChatCompleteEvent);
    } catch (err) {
      session.send({
        channel: "chat",
        data: { type: "chat.error", sessionId: session.id, error: err instanceof Error ? err.message : String(err) },
      } satisfies WSChatErrorEvent);
    }
  }

  getToolDefs(agent: string): { name: string; description: string; parameters?: Record<string, unknown> }[] {
    return this.engine.toolkitInstance.listDefinitions(agent as never).map((d) => ({ name: d.name, description: d.description, parameters: d.parameters }));
  }
}
