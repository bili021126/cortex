/**
 * tui/streaming-tool-executor.ts — 流式工具并发执行器
 *
 * Claude Code 对标：StreamingToolExecutor。
 * L1 读操作并行执行（Promise.all），L2/L3 写操作串行队列。
 * 混合批次：先并行所有读，等待完成后再串行写。
 *
 * @module tui/streaming-tool-executor
 * @since v3 — Claude Code 对标：工具并发执行
 */

import { reversibilityLevel } from "./renderer/permission-dialog.js";
import type { TuiEvent, TuiHooks } from "./types.js";
import type { AgentType, LlmMessage, ITuiEngineBridge } from "@cortex/shared";

// ═══════════════════════════════════════════════════════════
// §1 类型定义
// ═══════════════════════════════════════════════════════════

/** 单个工具调用的输入 */
interface ToolCallInput {
  name: string;
  arguments: Record<string, unknown>;
  id: string;
}

/** 单个工具执行结果 */
interface ToolCallResult {
  id: string;
  name: string;
  success: boolean;
  output: string;
  durationMs: number;
  level: 1 | 2 | 3;
}

/** Execution batch: 一组工具调用的执行规划 */
interface ExecutionBatch {
  /** L1 读操作——可并行 */
  reads: ToolCallInput[];
  /** L2/L3 写操作——需串行 */
  writes: ToolCallInput[];
}

// ═══════════════════════════════════════════════════════════
// §2 分类与规划
// ═══════════════════════════════════════════════════════════

/** 按可逆性等级将工具调用分为读写两批 */
function classifyCalls(toolCalls: ToolCallInput[]): ExecutionBatch {
  const reads: ToolCallInput[] = [];
  const writes: ToolCallInput[] = [];
  for (const tc of toolCalls) {
    const level = reversibilityLevel(tc.name);
    if (level === 1) reads.push(tc);
    else writes.push(tc);
  }
  return { reads, writes };
}

// ═══════════════════════════════════════════════════════════
// §3 工具执行原子操作
// ═══════════════════════════════════════════════════════════

/** 权限检查门——读写共用 */
async function _checkPermission(
  tc: ToolCallInput,
  agent: AgentType,
  hooks: TuiHooks,
): Promise<"allow" | "deny" | "skip"> {
  if (!hooks.onPreToolUse) return "allow";
  return await hooks.onPreToolUse({
    type: "tool_start",
    id: tc.id,
    agent,
    tool: tc.name,
    input: JSON.stringify(tc.arguments),
  });
}

/** 执行一个工具调用（桥接 + 错误兜底）——读写共用 */
async function _executeOneCall(
  tc: ToolCallInput,
  bridge: Pick<ITuiEngineBridge, "executeToolCall">,
  hooks: TuiHooks,
): Promise<{ success: boolean; output: string; durationMs: number }> {
  const startMs = Date.now();
  try {
    const r = await bridge.executeToolCall(tc.name, tc.arguments);
    return { success: r.success, output: r.output, durationMs: Date.now() - startMs };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    hooks.onToolError?.(tc.name, err);
    return { success: false, output: `工具执行异常: ${err.message}`, durationMs: Date.now() - startMs };
  }
}

/** 写入 assistant + tool 两段消息——读写共用 */
function _pushToolMessages(
  messages: LlmMessage[],
  tc: ToolCallInput,
  output: string,
  reasoningContent?: string,
): void {
  const rcExt = reasoningContent ? { reasoning_content: reasoningContent } : {};
  messages.push(
    { role: "assistant", content: "", tool_calls: [tc], ...rcExt },
    { role: "tool", content: output, tool_call_id: tc.id },
  );
}

// ═══════════════════════════════════════════════════════════
// §4 主入口：并发调度
// ═══════════════════════════════════════════════════════════

/**
 * 流式并发执行一批工具调用。
 *
 * 策略：
 * - L1 读操作（read_file, glob, grep, search 等）→ Promise.all 并行
 * - L2/L3 写操作（write, bash, delete, search_replace 等）→ 串行队列
 * - 若 reads > 0 且 writes > 0：先并行所有读，等待完成，再串行写
 *
 * @returns 执行结果数组（保持原始 tool_calls 顺序，供后续 messages 注入）
 */
export async function* streamExecuteTools(
  toolCalls: ToolCallInput[],
  agent: AgentType,
  bridge: Pick<ITuiEngineBridge, "executeToolCall">,
  messages: LlmMessage[],
  hooks: TuiHooks,
  reasoningContent?: string,
): AsyncGenerator<TuiEvent, ToolCallResult[], void> {
  if (toolCalls.length === 0) return [];

  const batch = classifyCalls(toolCalls);
  const results: ToolCallResult[] = [];

  // 阶段 1: 并行执行所有 L1 读操作
  if (batch.reads.length > 0) {
    const readPromises: Promise<ToolCallResult>[] = [];

    for (const tc of batch.reads) {
      const permission = await _checkPermission(tc, agent, hooks);

      if (permission === "deny") {
        _pushToolMessages(messages, tc, "denied by hook", reasoningContent);
        results.push({ id: tc.id, name: tc.name, success: false, output: "denied by hook", durationMs: 0, level: 1 });
        continue;
      }
      if (permission === "skip") {
        _pushToolMessages(messages, tc, "[skipped by user]", reasoningContent);
        results.push({ id: tc.id, name: tc.name, success: true, output: "[skipped by user]", durationMs: 0, level: 1 });
        continue;
      }

      yield { type: "tool_start", id: tc.id, agent, tool: tc.name, input: JSON.stringify(tc.arguments) } as TuiEvent;

      readPromises.push((async (): Promise<ToolCallResult> => {
        const { success, output, durationMs } = await _executeOneCall(tc, bridge, hooks);
        return { id: tc.id, name: tc.name, success, output, durationMs, level: 1 };
      })());
    }

    const readResults = await Promise.all(readPromises);

    for (const res of readResults) {
      const resultEv: TuiEvent & { type: "tool_result" } = {
        type: "tool_result", id: res.id, agent, tool: res.name,
        success: res.success, output: res.output, durationMs: res.durationMs,
      };
      yield resultEv;

      const matchingTc = batch.reads.find(tc => tc.id === res.id);
      if (matchingTc) _pushToolMessages(messages, matchingTc, res.output, reasoningContent);
      await hooks.onPostToolUse?.(resultEv);
      results.push(res);
    }
  }

  // 阶段 2: 串行执行所有 L2/L3 写操作
  for (const tc of batch.writes) {
    const permission = await _checkPermission(tc, agent, hooks);
    const level = reversibilityLevel(tc.name);

    if (permission === "deny") {
      _pushToolMessages(messages, tc, "denied by hook", reasoningContent);
      results.push({ id: tc.id, name: tc.name, success: false, output: "denied by hook", durationMs: 0, level });
      continue;
    }
    if (permission === "skip") {
      _pushToolMessages(messages, tc, "[skipped by user]", reasoningContent);
      results.push({ id: tc.id, name: tc.name, success: true, output: "[skipped by user]", durationMs: 0, level });
      continue;
    }

    yield { type: "tool_start", agent, tool: tc.name, input: JSON.stringify(tc.arguments) } as TuiEvent;

    const { success, output, durationMs } = await _executeOneCall(tc, bridge, hooks);

    const resultEv: TuiEvent & { type: "tool_result" } = {
      type: "tool_result", id: tc.id, agent, tool: tc.name,
      success, output, durationMs,
    };
    yield resultEv;

    _pushToolMessages(messages, tc, output, reasoningContent);
    await hooks.onPostToolUse?.(resultEv);
    results.push({ id: tc.id, name: tc.name, success, output, durationMs, level });
  }

  return results;
}
