/**
 * tui/modes/talk-mode.ts — Talk 模式（昔涟独立人格 + 三人亲密）
 *
 * 纯流式对话，不显示工具/任务。
 * 单 Agent：昔涟独立人格——加载 .cortex/persona-talk.txt。
 * 三人：昔涟 + 纳西妲 共存，共享对话历史，各自独立 persona。
 *
 * v2.7: + 昔涟记忆读写（talkMemoryStore），每次对话自动加载最近记忆并保存本次交换。
 *
 * @module tui/modes/talk-mode
 * @since v3 — CLI TUI 全栈重构
 */

import { AgentType, type AgentType as AgentTypeEnum, type LlmMessage, type ITuiEngineBridge } from "@cortex/shared";
import type { TuiEvent, TuiHooks } from "../types.js";
import { queryLoop } from "../query-loop.js";
import { multiSpeakerLoop, type SpeakerDef } from "../multi-speaker-loop.js";

/**
 * Talk 模式执行器——单 Agent（昔涟默认）。
 *
 * 昔涟专属：加载最近 5 条记忆注入上下文，回复后保存本次交换。
 */
export async function* talkMode(
  input: string,
  bridge: ITuiEngineBridge,
  agent: AgentTypeEnum,
  history?: LlmMessage[],
): AsyncGenerator<TuiEvent, string, void> {
  const hooks: TuiHooks = {
    onPreToolUse: async (_event) => "deny",
    onChunk: (_event) => {},
  };

  // ── 加载昔涟记忆（仅 butler agent）──
  let memoryCtx = "";
  if (agent === AgentType.Butler) {
    try {
      await bridge.ensureTalkMemory();
      const memories = await bridge.readTalkMemory({ limit: 5 });
      if (memories.length > 0) {
        memoryCtx = "\n[以下是昔涟记得的最近对话——自然融入回复，不要逐条复述]\n" +
          memories.map(m => `- ${m.summary}`).join("\n") + "\n";
      }
    } catch (err) { console.warn('[DEGRADED:tui-talk-memory]', String(err)) }
  }

  const effectiveInput = memoryCtx ? `${memoryCtx}\n[用户消息] ${input}` : input;
  const result = yield* queryLoop({ input: effectiveInput, bridge, mode: "talk", agent, hooks, history });

  // ── 保存本次交换到昔涟记忆 ──
  if (agent === AgentType.Butler && result) {
    try {
      await bridge.writeTalkMemory({
        source: { agentType: AgentType.Butler, taskId: "talk" },
        kind: "Insight",
        summary: input.slice(0, 80),
        semantic_gist: input.slice(0, 200),
        content_blob: { user: input, assistant: result.slice(0, 500) },
        weight: 1,
      });
    } catch (err) { console.warn('[DEGRADED:tui-talk]', String(err)) }
  }

  return result;
}

/** 三人 talk 的固定参与者 */
const TALK_TRIO: SpeakerDef[] = [
  { agent: AgentType.Butler, label: "昔涟" },
  { agent: AgentType.Analysis, label: "纳西妲" },
];

/**
 * 三人亲密模式——昔涟 + 纳西妲 同场。
 *
 * 共享对话历史，各自加载完整 persona（昔涟 → .cortex/persona-talk.txt，
 * 纳西妲 → nahida-persona.txt），按序流式发言。
 *
 * v2.7: + 昔涟记忆上下文注入 + 保存。
 */
export async function* talkTrioMode(
  input: string,
  bridge: ITuiEngineBridge,
  history?: LlmMessage[],
): AsyncGenerator<TuiEvent, string, void> {
  // ── 加载昔涟记忆 ──
  let memoryCtx = "";
  try {
    await bridge.ensureTalkMemory();
    const memories = await bridge.readTalkMemory({ limit: 3 });
    if (memories.length > 0) {
      memoryCtx = "\n[昔涟记得的最近对话——自然融入]\n" +
        memories.map(m => `- ${m.summary}`).join("\n");
    }
  } catch (err) { console.warn('[DEGRADED:tui-talk]', String(err)) }

  const effectiveInput = memoryCtx ? `${memoryCtx}\n[用户] ${input}` : input;

  const outputs = await (yield* multiSpeakerLoop({
    input: effectiveInput,
    speakers: TALK_TRIO,
    bridge,
    history,
    maxRounds: 1,
  }));

  const resultText = outputs
    .map((o, i) => `[${TALK_TRIO[i]?.label ?? "unknown"}] ${o}`)
    .join("\n\n");

  // ── 保存记忆 ──
  if (resultText) {
    try {
      await bridge.writeTalkMemory({
        source: { agentType: AgentType.Butler, taskId: "talk-trio" },
        kind: "Insight",
        summary: input.slice(0, 80),
        semantic_gist: input.slice(0, 200),
        content_blob: { user: input, responses: resultText.slice(0, 500) },
        weight: 1,
      });
    } catch (err) { console.warn('[DEGRADED:tui-talk]', String(err)) }
  }

  return resultText;
}
