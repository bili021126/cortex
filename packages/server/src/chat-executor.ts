/**
 * @cortex/server — ChatExecutor
 *
 * Delegates LLM streaming + tool execution to engine.streamChat.
 * Adds gate confirmation via RemoteGateBridge and WS event emission.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
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
import { AGENT_TYPE_TO_DIR, AGENT_ALIAS_TO_TYPE, type LlmMessage } from "@cortex/shared";
import type { ReversibilityLevel } from "@cortex/config";

const SYSTEM_PROMPT = "[系统指令] 你是 Cortex 工程助手。";

// Agent persona 缓存（按 agent type——prompts/<dir>/system.md）
const personaCache = new Map<string, string | null>();

/** 按 agent 加载 prompts/<dir>/system.md（daemon 与 TUI 同源——甘雨加载甘雨 persona，不再混入昔涟） */
function loadAgentSystemPrompt(agent: string, projectRoot: string): string {
  const cached = personaCache.get(agent);
  if (cached !== undefined) return cached ?? SYSTEM_PROMPT;
  // 别名解析：ganyu → meta → 目录 ganyu（AGENT_TYPE_TO_DIR 的 key 是 type）
  const type = AGENT_TYPE_TO_DIR[agent] ? agent : (AGENT_ALIAS_TO_TYPE[agent] ?? agent);
  const dir = AGENT_TYPE_TO_DIR[type] ?? type;
  let loaded: string | null = null;
  if (dir) {
    try {
      const p = path.join(projectRoot, "prompts", dir, "system.md");
      if (fs.existsSync(p)) loaded = fs.readFileSync(p, "utf-8");
    } catch { /* 读取失败回退默认 */ }
  }
  personaCache.set(agent, loaded);
  return loaded ?? SYSTEM_PROMPT;
}
const READ_ONLY = new Set([
  "read_file", "search_code", "list_files", "parse_ast", "search_symbol",
  "grep_files", "glob_find", "file_info", "resolve_import", "json_query", "web_search",
  "read_many_files", "diff_files",
]);

export class ChatExecutor {
  private readonly engine: EngineHost;
  private readonly gateBridge: RemoteGateBridge;
  private readonly projectRoot: string;

  constructor(engine: EngineHost, gateBridge: RemoteGateBridge, projectRoot?: string) {
    this.engine = engine;
    this.gateBridge = gateBridge;
    this.projectRoot = projectRoot ?? process.cwd();
  }

  async execute(session: ChatSession, input: string): Promise<void> {
    const signal = session.abortController.signal;

    try {
      // Append user message to history
      const userMsg: LlmMessage = { role: "user", content: input };
      session.history.push(userMsg);
      session.lastActiveAt = Date.now();

      // Build messages
      const systemPrompt = loadAgentSystemPrompt(session.agent, this.projectRoot);
      const messages: LlmMessage[] = [
        { role: "system", content: systemPrompt },
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
        systemPrompt,
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
          data: { type: "chat.error", sessionId: session.id, error: "cancelled", errorKind: "cancelled" },
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
      const msg = err instanceof Error ? err.message : String(err);
      session.send({
        channel: "chat",
        data: { type: "chat.error", sessionId: session.id, error: msg, errorKind: classifyChatError(msg) },
      } satisfies WSChatErrorEvent);
    }
  }

  getToolDefs(agent: string): { name: string; description: string; parameters?: Record<string, unknown> }[] {
    return this.engine.toolkitInstance.listDefinitions(agent as never).map((d) => ({ name: d.name, description: d.description, parameters: d.parameters }));
  }
}

/**
 * U1 错误分类：错误消息 → 状态机 kind（timeout 可重试/fatal 不可/network 续传）
 * 规则：超时类 → timeout；网络/连接类 → network；其余 → fatal（保守——认证/模型等）
 */
export function classifyChatError(msg: string): "timeout" | "fatal" | "network" {
  const t = msg.toLowerCase();
  if (/timeout|timed out|超时/.test(t)) return "timeout";
  if (/fetch failed|econn|enet|network|socket|连接|网络/.test(t)) return "network";
  return "fatal";
}
