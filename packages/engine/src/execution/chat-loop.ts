/**
 * @cortex/engine/execution/chat-loop.ts — 纯 LLM 聊天循环
 *
 * 从 runReActLoop 分离出的无状态聊天引擎。
 * 不依赖 TaskNode / memory / scheduler——仅需 LlmAdapter + Toolkit + 消息。
 * server 的 chat-executor 可调用此函数，复用完整的 DeepSeek V4 协议处理。
 *
 * @module chat-loop
 * @layer 执行层
 */

import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "@cortex/platform";
import type { LlmMessage, ToolDef } from "@cortex/shared";

/** 聊天循环选项 */
export interface ChatLoopOptions {
  /** LLM 适配器 */
  llm: LlmAdapter;
  /** 工具包——用于获取工具定义 + 执行工具调用 */
  toolkit: Toolkit;
  /** Agent 类型——决定工具白名单 */
  agentType: string;
  /** 模型名 */
  model: string;
  /** 系统提示词（注入到 messages 首条） */
  systemPrompt: string;
  /** 消息历史（含 system/user） */
  messages: LlmMessage[];
  /** 流式文本回调 */
  onChunk: (content: string, reasoning?: string) => void;
  /** 最大工具调用轮数（默认 20） */
  maxRounds?: number;
  /** reasoning_effort 参数 */
  reasoningEffort?: "high" | "max" | null;
  /** AbortSignal——取消循环 */
  signal?: AbortSignal;
  /** 工具执行拦截器——返回 false 则跳过该工具（server 用 gate 确认） */
  onBeforeToolExecute?: (name: string, args: Record<string, unknown>) => Promise<boolean>;
  /** SafeErrorReporter */
  onToolStart?: (name: string, input: string) => void;
  onToolEnd?: (name: string, output: string, durationMs: number) => void;
}

/** 聊天循环结果 */
export interface ChatLoopResult {
  /** 累积的完整输出 */
  output: string;
  /** 最后的 usage 统计 */
  usage?: { prompt_tokens: number; completion_tokens: number };
  /** 累积的 reasoning 内容 */
  reasoning?: string;
  /** 是否因信号取消 */
  cancelled?: boolean;
}

/**
 * 纯 LLM 聊天循环——流的循环、工具调用、gate 确认全部内聚。
 *
 * server 的 chat-executor、TUI 的 query-loop、Desktop 的 chat-stream
 * 均可调用此函数，无需各自实现 LLM loop 逻辑。
 */
export async function streamChat(params: ChatLoopOptions): Promise<ChatLoopResult> {
  const {
    llm, toolkit, agentType, model, systemPrompt, messages,
    onChunk, maxRounds = 20, reasoningEffort, signal,
    onBeforeToolExecute, onToolStart, onToolEnd,
  } = params;

  const toolDefs: ToolDef[] = toolkit.listDefinitions(agentType as never).map((d) => ({
    name: d.name,
    description: d.description,
    parameters: d.parameters ?? { type: "object", properties: {}, required: [] },
  }));

  // 注入 system prompt（如果 messages 首条不是 system）
  if (messages.length === 0 || messages[0]?.role !== "system") {
    messages.unshift({ role: "system", content: systemPrompt });
  }

  let fullOutput = "";
  let fullReasoning = "";
  let lastUsage: ChatLoopResult["usage"];

  for (let round = 0; round < maxRounds; round++) {
    if (signal?.aborted) return { output: fullOutput, reasoning: fullReasoning, cancelled: true };

    // 流式调用
    const response = await llm.chatStream(
      model,
      messages,
      toolDefs.length > 0 ? toolDefs : undefined,
      (content, reasoning) => {
        fullOutput += content;
        if (reasoning) fullReasoning += reasoning;
        onChunk(content, reasoning);
      },
      reasoningEffort,
    );

    // usage 追踪
    if (response.usage) {
      lastUsage = {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
      };
    }

    // 无 tool_calls → 对话轮完成
    if (!response.tool_calls || response.tool_calls.length === 0) {
      const assistantMsg: LlmMessage = {
        role: "assistant",
        content: response.content ?? fullOutput,
        ...(response.reasoning_content ? { reasoning_content: response.reasoning_content } : {}),
      };
      messages.push(assistantMsg);
      return { output: fullOutput, usage: lastUsage, reasoning: fullReasoning || undefined };
    }

    // 处理 tool_calls
    const assistantMsg: LlmMessage = {
      role: "assistant",
      content: response.content ?? "",
      tool_calls: response.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      })),
      ...(response.reasoning_content ? { reasoning_content: response.reasoning_content } : {}),
    };
    messages.push(assistantMsg);

    for (const tc of response.tool_calls) {
      if (signal?.aborted) break;

      const t0 = Date.now();
      onToolStart?.(tc.name, JSON.stringify(tc.arguments));

      // Gate 确认拦截——server 可注入 RemoteGateBridge 检查
      if (onBeforeToolExecute) {
        const approved = await onBeforeToolExecute(tc.name, tc.arguments as Record<string, unknown>);
        if (!approved) {
          messages.push({ role: "tool", content: "User denied tool execution", tool_call_id: tc.id });
          onToolEnd?.(tc.name, "denied by gate", Date.now() - t0);
          continue;
        }
      }

      try {
        const result = await toolkit.execute(
          { toolName: tc.name, params: tc.arguments as Record<string, unknown> },
          agentType as never,
        );
        const output = result.success ? (result.output ?? "success") : `ERROR: ${result.error}`;

        messages.push({
          role: "tool",
          content: output,
          tool_call_id: tc.id,
        });

        onToolEnd?.(tc.name, output, Date.now() - t0);
      } catch (err) {
        messages.push({
          role: "tool",
          content: `ERROR: ${String(err)}`,
          tool_call_id: tc.id,
        });
        onToolEnd?.(tc.name, `ERROR: ${String(err)}`, Date.now() - t0);
      }
    }
  }

  return { output: fullOutput, usage: lastUsage, reasoning: fullReasoning || undefined };
}
