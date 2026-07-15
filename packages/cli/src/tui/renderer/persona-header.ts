/**
 * tui/renderer/persona-header.ts — 角色头直接输出
 *
 * 不再实现 TuiComponent 接口。
 * update / updateMulti 时直接写 stdout。
 *
 * @module tui/renderer/persona-header
 * @since v4 — Claude Code 风格纯追加
 */

import { AGENT_DISPLAY_BY_TYPE, AGENT_DISPLAY_FALLBACK, AgentType, type AgentType as AgentTypeEnum } from "@cortex/shared";
import type { ReplMode } from "../types.js";
import { style, terminalWidth, StyleCode } from "./ansi.js";

/** 模式标签 */
const MODE_LABELS: Record<ReplMode, string> = {
  chat: "✨ 智能",
  talk: "🗣 闲聊",
  party: "👥 群聊",
  plan: "📋 规划",
  command: "⌨ 命令",
};

/** 多人头部标签映射 */
const MULTI_MODE_LABELS: Record<string, string> = {
  "talk-trio": "👥 三人",
  "party": "👥 群聊",
};

/** 渲染单角色头的行 */
function renderSingleLine(agent: AgentTypeEnum, mode: ReplMode, width: number): string[] {
  const w = Math.min(width, 80);
  const display = AGENT_DISPLAY_BY_TYPE[agent] ?? AGENT_DISPLAY_FALLBACK;
  const leftPart = `${display.emoji} ${style(display.name, StyleCode.bold)} ${style(`[${agent}]`, StyleCode.dim)} — ${style(display.signature, StyleCode.dim)}`;
  const rightPart = MODE_LABELS[mode];
  const spacer = " ".repeat(Math.max(1, w - leftPart.length - rightPart.length));
  return [leftPart + spacer + rightPart];
}

/** 渲染多人角色头的行 */
function renderMultiLine(agents: AgentTypeEnum[], modeLabel: string, width: number): string[] {
  const w = Math.min(width, 80);
  const parts = agents.map(a => {
    const d = AGENT_DISPLAY_BY_TYPE[a] ?? AGENT_DISPLAY_FALLBACK;
    return `${d.emoji} ${style(d.name, StyleCode.bold)}`;
  });
  const leftPart = parts.join(` ${style("+", StyleCode.dim)} `);
  const rightPart = MULTI_MODE_LABELS[modeLabel] ?? modeLabel;
  const spacer = " ".repeat(Math.max(1, w - leftPart.length - rightPart.length));
  return [leftPart + spacer + rightPart];
}

/**
 * PersonaHeader — 角色头直接输出类。
 *
 * 不再实现 TuiComponent 接口。
 * update / updateMulti 直接写 stdout。
 */
export class PersonaHeader {
  private _agent: AgentTypeEnum = AgentType.Code;
  private _mode: ReplMode = "chat";
  /** 多人模式下的角色列表 */
  private _multiAgents: AgentTypeEnum[] | null = null;
  /** 多人模式标签 */
  private _multiLabel: string = "";

  /** 更新单人角色头和模式（直接输出到 stdout） */
  update(agent: AgentTypeEnum, mode: ReplMode): void {
    this._agent = agent;
    this._mode = mode;
    this._multiAgents = null;
    this._multiLabel = "";
    const line = renderSingleLine(agent, mode, Math.min(terminalWidth(), 80))[0];
    process.stdout.write("\n" + line + "\n\n");
  }

  /** 更新多人角色头（直接输出到 stdout） */
  updateMulti(agents: AgentTypeEnum[], label: string): void {
    this._multiAgents = agents;
    this._multiLabel = label;
    const line = renderMultiLine(agents, label, Math.min(terminalWidth(), 80))[0];
    process.stdout.write("\n" + line + "\n\n");
  }
}

/**
 * 全局单例 PersonaHeader
 */
export const personaHeader = new PersonaHeader();

/**
 * 角色转场动画——简要提示旧角色退场、新角色登场。
 */
export function renderAgentTransition(from: AgentTypeEnum, to: AgentTypeEnum): void {
  const fromDisplay = AGENT_DISPLAY_BY_TYPE[from] ?? AGENT_DISPLAY_FALLBACK;
  const toDisplay = AGENT_DISPLAY_BY_TYPE[to] ?? AGENT_DISPLAY_FALLBACK;

  process.stdout.write(
    style(`${fromDisplay.emoji} ${fromDisplay.name}`, StyleCode.dim) +
    " → " +
    style(`${toDisplay.emoji} ${toDisplay.name}`, StyleCode.bold) +
    " " + style("角色切换", StyleCode.dim) + "\n",
  );
}
