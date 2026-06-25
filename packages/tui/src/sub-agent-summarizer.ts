/**
 * tui/sub-agent-summarizer.ts — 子Agent消息摘要化
 *
 * Claude Code 对标：子Agent消息摘要化，防止共享历史膨胀。
 * Party 模式下，每个子 Agent 的完整响应被压缩为一行摘要后写入共享历史。
 *
 * 摘要策略：
 * - 主发言人（roster 第一位）的完整输出保留
 * - 其他 Agent 输出压缩为 "[Agent名] 完成: <100字结论>"
 * - 优先使用 fast model (deepseek-v4-flash) 做 LLM 摘要
 * - LLM 不可用时回退到前100字截断
 *
 * @module tui/sub-agent-summarizer
 * @since v3 — Claude Code 对标：子Agent摘要化
 */

import type { AgentType, LlmMessage, ICortexApi } from "@cortex/shared";
import { AGENT_CHINESE_ROLE } from "@cortex/shared";

// ═══════════════════════════════════════════════════════════
// §1 类型定义
// ═══════════════════════════════════════════════════════════

/** 摘要选项 */
interface SummarizeOptions {
  /** 主发言人——保留完整输出 */
  mainSpeaker: AgentType;
  /** 摘要最大字符数，默认 100 */
  maxChars?: number;
}

// ═══════════════════════════════════════════════════════════
// §2 摘要工具
// ═══════════════════════════════════════════════════════════

/** 回退：简单截断摘要（无 LLM 可用时） */
function truncateSummary(text: string, maxChars: number = 100): string {
  const cleaned = text.replace(/\n/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, maxChars - 3) + "...";
}

/**
 * 使用 LLM 对子Agent输出做摘要。
 * 调用 fast model 避免消耗 reasoning budget。
 */
async function llmSummarize(
  agentLabel: string,
  text: string,
  bridge: Pick<ICortexApi, "chat"> | null,
  maxChars: number = 100,
): Promise<string> {
  if (!bridge?.chat) return truncateSummary(text, maxChars);

  try {
    const messages: LlmMessage[] = [
      { role: "system", content: `你用极简中文总结以下内容（不超过${maxChars}字）。只输出总结，不加引号或前缀。` },
      { role: "user", content: `${agentLabel} 所说内容：\n${text.slice(0, 2000)}` },
    ];
    const result = await bridge.chat(`请总结${agentLabel}的发言要点，不超过${maxChars}字：`, messages);
    const summary = result.trim();
    if (summary.length > 0 && summary.length <= maxChars * 2) {
      return summary.length > maxChars ? summary.slice(0, maxChars - 3) + "..." : summary;
    }
  } catch (err) { console.warn('[DEGRADED:tui-summarizer]', String(err));
    // LLM 摘要失败，回退截断
  }
  return truncateSummary(text, maxChars);
}

// ═══════════════════════════════════════════════════════════
// §3 主入口
// ═══════════════════════════════════════════════════════════

/**
 * 对多发言者输出做摘要化处理。
 *
 * @param outputs  各发言者的原始输出（与 speakers 顺序对应）
 * @param roster   参与者列表
 * @param bridge   LLM bridge（可选，用于 LLM 摘要）
 * @param opts     摘要选项
 * @returns 带标签的摘要输出数组
 */
export async function summarizeSubAgents(
  outputs: string[],
  roster: AgentType[],
  bridge: Pick<ICortexApi, "chat"> | null,
  opts?: SummarizeOptions,
): Promise<string[]> {
  const maxChars = opts?.maxChars ?? 100;
  const mainSpeaker = opts?.mainSpeaker ?? roster[0];
  const results: string[] = [];

  for (let i = 0; i < outputs.length; i++) {
    const agent = roster[i];
    if (!agent) {
      // 发言人不可识别，直接保留
      results.push(outputs[i]);
      continue;
    }

    const label = AGENT_CHINESE_ROLE[agent] ?? agent;

    if (agent === mainSpeaker) {
      // 主发言人：完整保留
      results.push(`[${label}] ${outputs[i]}`);
    } else {
      // 子Agent：摘要化
      const summary = await llmSummarize(label, outputs[i], bridge, maxChars);
      results.push(`[${label}] ${summary}`);
    }
  }

  return results;
}

/**
 * 对单条已标记的输出来做摘要（备选接口）。
 * 用于历史消息中已经带标签的场景。
 *
 * @param agent   发言者
 * @param text    原始文本（不含标签）
 * @param bridge  LLM bridge
 * @param maxChars 最大摘要字符数
 * @returns 摘要文本
 */
export async function summarizeOne(
  agent: AgentType,
  text: string,
  bridge: Pick<ICortexApi, "chat"> | null,
  maxChars: number = 100,
): Promise<string> {
  const label = AGENT_CHINESE_ROLE[agent] ?? agent;
  return await llmSummarize(label, text, bridge, maxChars);
}
