/**
 * tui/intent-router.ts — 智能意图判定器（v6 管道桥接）
 *
 * 向后兼容层：对外暴露 classifyIntent / parseAgentFromInput，
 * 内部委托给新的 intent-router/ 分类管道。
 *
 * @module tui/intent-router
 * @since v4 — v6 管道桥接
 */

import { CHINESE_NAME_TO_TYPE, CHAT_AGENT_ALIASES, type AgentType } from "@cortex/shared";
import { classifyIntent as pipelineClassify } from "./intent-router/router.js";

/** 用户意图枚举（向后兼容） */
export type UserIntent = "task" | "command" | "chat";

/**
 * 从输入中解析 @ 提及的 Agent。
 * 支持 @中文名（@昔涟 @阿贝多）和 @英文type（@butler @code）。
 */
function parseAgentMention(input: string): AgentType | null {
  const match = input.match(/@(\S+)/);
  if (!match) return null;
  const raw = match[1]?.trim() ?? "";

  const allTypes: string[] = [
    "analysis", "code", "ops", "butler", "review", "loop",
    "doc-govern", "inspector", "browser", "fix", "meta",
    "api", "data", "strategist", "confirm-gate",
  ];
  if (allTypes.includes(raw)) return raw as unknown as AgentType;

  const byChinese = CHINESE_NAME_TO_TYPE[raw];
  if (byChinese) return byChinese;

  const byAlias = CHAT_AGENT_ALIASES[raw];
  if (byAlias) return byAlias;

  return null;
}

/**
 * 基于分类管道判定用户意图（委托到新管道）。
 * 将新管道的 IntentType 映射回旧的 UserIntent。
 */
export function classifyIntent(input: string): UserIntent {
  const result = pipelineClassify(input);

  // 映射新 IntentType → 旧 UserIntent
  switch (result.type) {
    case "task":
    case "confirmation":
      return "task";
    case "command":
    case "mode-switch":
    case "navigation":
      return "command";
    case "agent-invoke":
    case "chat":
      return "chat";
    case "ambiguous":
    default:
      // 低置信度时回退到简单启发式
      return result.confidence < 0.4 ? "chat" : "task";
  }
}

/**
 * 从输入中提取 @ 提及的目标 Agent。
 */
export function parseAgentFromInput(input: string): AgentType | null {
  return parseAgentMention(input);
}
