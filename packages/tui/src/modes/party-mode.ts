/**
 * tui/modes/party-mode.ts — Party 模式（群聊）
 *
 * 多 Agent 群聊——自由 @ 点名 + 全员抢麦。
 * 基于 multiSpeakerLoop 共用底座。
 *
 * @module tui/modes/party-mode
 * @since v3 — CLI TUI 全栈重构
 */

import type { LlmMessage, ITuiEngineBridge } from "@cortex/shared";
import {
  AgentType,
  AGENT_CHINESE_ROLE,
  CHINESE_NAME_TO_TYPE,
} from "@cortex/shared";
import type { TuiEvent } from "../types.js";
import { multiSpeakerLoop, type SpeakerDef } from "../multi-speaker-loop.js";
import { summarizeSubAgents } from "../sub-agent-summarizer.js";

/**
 * 从输入中解析 @ 提及。
 * 支持 @中文名 和 @英文type。
 * 返回匹配到的 AgentType 数组（去重）。
 */
export function parseMentions(input: string): AgentType[] {
  const matches = input.match(/@([^\s,，。！？!?]+)/g);
  if (!matches || matches.length === 0) return [];

  const agents = new Set<AgentType>();
  for (const m of matches) {
    const raw = m.slice(1).trim();
    // 1. 直接匹配 AgentType 枚举值
    const allTypes = [
      AgentType.Analysis, AgentType.Code, AgentType.Ops, AgentType.Butler,
      AgentType.Review, AgentType.Loop, AgentType.DocGovern,
      AgentType.Inspector, AgentType.Browser, AgentType.Fix,
      AgentType.Meta, AgentType.Api, AgentType.Data, AgentType.Strategist,
    ];
    if ((allTypes as string[]).includes(raw)) {
      agents.add(raw as AgentType);
      continue;
    }
    // 2. 中文名 → AgentType
    const byChinese = CHINESE_NAME_TO_TYPE[raw];
    if (byChinese) {
      agents.add(byChinese);
      continue;
    }
  }
  return [...agents];
}

/** Party 模式默认参与者——butler（昔涟）+ analysis（纳西妲） */
export const DEFAULT_PARTY: AgentType[] = [AgentType.Butler, AgentType.Analysis];

/**
 * Party 模式执行器。
 *
 * 群聊特色：
 * - @ 点名：（@纳西妲 @阿贝多）仅点名 Agent 发言
 * - 无 @：所有参与者自由发言
 * - 基于 multiSpeakerLoop 共用底座
 */
export async function* partyMode(
  input: string,
  bridge: ITuiEngineBridge,
  agents: AgentType[],
  history?: LlmMessage[],
): AsyncGenerator<TuiEvent, string, void> {
  const mentioned = parseMentions(input);
  const roster = mentioned.length > 0 ? mentioned : agents;
  // 清理输入中的 @mention（避免干扰 LLM）
  const cleanInput = input.replace(/@\S+/g, "").trim() || input;

  const speakers: SpeakerDef[] = roster.map(a => ({
    agent: a,
    label: AGENT_CHINESE_ROLE[a] ?? a,
  }));

  // multiSpeakerLoop 内部禁工具，无需额外 hooks
  const outputs = await (yield* multiSpeakerLoop({
    input: cleanInput,
    speakers,
    bridge,
    history,
    maxRounds: 1,
  }));

  // 子Agent摘要化：主发言人完整保留，其余压缩为一行摘要
  const summarized = await summarizeSubAgents(
    outputs,
    roster,
    bridge,
    { mainSpeaker: roster[0]!, maxChars: 100 },
  );

  const resultText = summarized.join("\n\n");

  return resultText;
}
