/**
 * tui/query-loop.ts — 统一 Agent 查询循环
 *
 * 吸收 Claude Code 的 queryLoop() 统一架构——所有模式
 * (chat/talk/plan/party/command) 共用同一个执行循环。
 * 各模式差异体现在 system prompt 组装和 hooks 配置，
 * 而非不同的执行路径。
 *
 * 循环逻辑：
 * 1. 根据 mode 组装 system prompt (persona + agent role + format instructions)
 * 2. 调用 LLM (streaming)，逐 chunk yield llm_chunk
 * 3. 模型返回 tool_calls → yield tool_start → 权限门 → 执行 → yield tool_result
 * 4. 工具结果回传 LLM → 继续循环直到模型输出文本
 * 5. yield node_complete 含最终输出
 *
 * @module tui/query-loop
 * @since v3 — CLI TUI 全栈重构
 */

import {
  AGENT_CHINESE_ROLE,
  AGENT_DISPLAY_BY_TYPE,
  AGENT_DISPLAY_FALLBACK,
  type AgentType,
  type LlmMessage,
  type ICortexApi,
} from "@cortex/shared";
import type { TuiEvent, TuiHooks, ReplMode, LlmStreamBridge } from "./types.js";
import fs from "fs";
import path from "path";

// ═══════════════════════════════════════════════════════════
// §1 System Prompt 组装
// ═══════════════════════════════════════════════════════════

const BASE_SYSTEM_PROMPT = `[系统指令] 你是 Cortex 工程助手。`;

/** 懒加载昔涟 persona——从 .cortex/persona-talk.txt 读取 */
let _cyrenePersona: string | null = null;
function cyrenePersona(): string {
  if (_cyrenePersona !== null) return _cyrenePersona;
  try {
    const personaPath = path.join(process.cwd(), ".cortex", "persona-talk.txt");
    _cyrenePersona = fs.readFileSync(personaPath, "utf-8");
  } catch {
    _cyrenePersona = "你是昔涟，用轻松自然的语气和用户聊天。";
  }
  return _cyrenePersona;
}

/** Agent 角色 system prompt */
function agentSystemPrompt(agent: AgentType): string {
  const chinese = AGENT_CHINESE_ROLE[agent] ?? agent;
  const display = AGENT_DISPLAY_BY_TYPE[agent] ?? AGENT_DISPLAY_FALLBACK;
  return `${display.emoji} 你现在是 ${chinese}（${agent}）。${display.signature}`;
}

/** 模式 system prompt */
function modeSystemPrompt(mode: ReplMode): string {
  switch (mode) {
    case "chat":
      return "这是对话模式。你是 Cortex 工程助手，直接回答用户的问题。如果用户有编程任务，可以调用工具完成。";
    case "plan":
      return "这是规划模式。你需要将用户意图拆解为详细的任务计划，列出每个步骤和对应的 Agent 类型。";
    case "talk":
      return cyrenePersona();
    case "party":
      return "这是群聊模式。多个角色在同一个对话中发言。你可以用角色特有的风格说话。";
    case "command":
      return "这是命令模式。你只需要执行用户输入的命令，给出简洁的执行结果。";
    default:
      return "";
  }
}

/** 组装完整 system prompt */
function assembleSystemPrompt(mode: ReplMode, agent: AgentType): string {
  const parts: string[] = [BASE_SYSTEM_PROMPT];

  if (mode !== "command") {
    parts.push(agentSystemPrompt(agent));
  }

  parts.push(modeSystemPrompt(mode));

  // 通用格式指令（talk 模式不追加——persona 自带写作规范）
  if (mode !== "talk") {
    parts.push("[格式] 直接说话/做事，不要用（）写旁白或动作描述。");
  }

  return parts.join("\n");
}

// ═══════════════════════════════════════════════════════════
// §2 QueryLoop 异步生成器
// ═══════════════════════════════════════════════════════════

/**
 * 统一查询循环——所有模式共用。
 *
 * @param input 用户输入
 * @param bridge 引擎桥接（LlmStreamBridge + ICortexApi）
 * @param mode 当前模式
 * @param agent 当前 Agent
 * @param hooks 生命周期钩子
 * @param history 对话历史（多轮）
 * @yields TuiEvent 执行事件
 * @returns 最终输出文本
 */
export async function* queryLoop(
  input: string,
  bridge: LlmStreamBridge & Pick<ICortexApi, "chat" | "submitTask" | "executeAll">,
  mode: ReplMode,
  agent: AgentType,
  hooks: TuiHooks,
  history?: LlmMessage[],
): AsyncGenerator<TuiEvent, string, void> {
  const systemPrompt = assembleSystemPrompt(mode, agent);
  const messages: LlmMessage[] = [];

  // 注入 system prompt
  messages.push({ role: "system", content: systemPrompt });

  // 注入历史（多轮对话）
  if (history && history.length > 0) {
    messages.push(...history);
  }

  // 注入用户输入
  messages.push({ role: "user", content: input });

  // 对话模型选择
  const chatModel = bridge.getChatModelName() || "deepseek-v4-flash";

  // 最大工具调用轮次（防止无限循环）
  const MAX_TOOL_ROUNDS = 10;
  let toolRound = 0;
  let finalOutput = "";

  while (toolRound < MAX_TOOL_ROUNDS) {
    // 调用 LLM（流式）——收集 chunk 后统一 yield
    const chunks: { content: string; reasoning?: string }[] = [];
    const resp = await bridge.streamChat(
      chatModel,
      messages,
      undefined, // tools — 后续可注入 Toolkit 的工具定义
      (content, reasoning) => {
        chunks.push({ content, reasoning });
      },
    );

    // 发射收集的 LLM chunk 事件
    for (const chunk of chunks) {
      const chunkEvent: TuiEvent = {
        type: "llm_chunk",
        agent,
        content: chunk.content,
        reasoning: chunk.reasoning,
      };
      yield chunkEvent;

      // hook: onChunk
      hooks.onChunk?.(chunkEvent as TuiEvent & { type: "llm_chunk" });
    }

    // Token 用量
    if (resp.usage) {
      yield {
        type: "token_usage",
        promptTokens: resp.usage.prompt_tokens,
        completionTokens: resp.usage.completion_tokens,
        sessionTotalTokens: resp.usage.prompt_tokens + resp.usage.completion_tokens,
        contextWindowSize: 128000,
      };
    }

    // 检查 tool_calls
    if (resp.tool_calls && resp.tool_calls.length > 0) {
      toolRound++;

      for (const tc of resp.tool_calls) {
        // hook: onPreToolUse
        let permission: "allow" | "deny" | "skip" = "allow";
        if (hooks.onPreToolUse) {
          permission = await hooks.onPreToolUse({
            type: "tool_start",
            agent,
            tool: tc.name,
            input: JSON.stringify(tc.arguments),
          });
        }

        if (permission === "deny") continue;
        if (permission === "skip") {
          messages.push({
            role: "assistant",
            content: "",
            tool_calls: [tc],
          });
          messages.push({
            role: "tool",
            content: "[skipped by user]",
            tool_call_id: tc.id,
          });
          continue;
        }

        // 发射 tool_start 事件
        yield {
          type: "tool_start",
          agent,
          tool: tc.name,
          input: JSON.stringify(tc.arguments),
        };

        // 实际执行工具——通过 bridge.executeToolCall 转发到引擎 Toolkit
        const startMs = Date.now();
        let toolResult: string;
        let toolSuccess: boolean;
        try {
          const execResult = await bridge.executeToolCall(tc.name, tc.arguments);
          toolResult = execResult.output;
          toolSuccess = execResult.success;
        } catch (e) {
          toolResult = `工具执行异常: ${e instanceof Error ? e.message : String(e)}`;
          toolSuccess = false;
        }
        const durationMs = Date.now() - startMs;

        // 发射 tool_result 事件
        yield {
          type: "tool_result",
          agent,
          tool: tc.name,
          success: toolSuccess,
          output: toolResult,
          durationMs,
        };

        // 将工具调用和结果加入消息历史
        messages.push({
          role: "assistant",
          content: "",
          tool_calls: [tc],
        });
        messages.push({
          role: "tool",
          content: toolResult,
          tool_call_id: tc.id,
        });

        // hook: onPostToolUse
        await hooks.onPostToolUse?.({
          type: "tool_result",
          agent,
          tool: tc.name,
          success: toolSuccess,
          output: toolResult,
          durationMs,
        });
      }

      // 继续循环——LLM 处理工具结果
      continue;
    }

    // 无 tool_calls → 最终输出
    finalOutput = resp.content ?? "";
    break;
  }

  if (toolRound >= MAX_TOOL_ROUNDS) {
    finalOutput = "[已达到最大工具调用轮次，停止]";
  }

  // 将助手回复加入历史
  if (finalOutput) {
    messages.push({ role: "assistant", content: finalOutput });
  }

  return finalOutput;
}

// ═══════════════════════════════════════════════════════════
// §3 辅助函数
// ═══════════════════════════════════════════════════════════

/**
 * 从 queryLoop 的 messages 中提取对话历史（不含 system prompt）。
 * 用于多轮对话上下文的保留。
 */
export function extractHistory(messages: LlmMessage[]): LlmMessage[] {
  return messages.filter((m) => m.role !== "system");
}
