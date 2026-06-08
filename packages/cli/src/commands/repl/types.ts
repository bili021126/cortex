/**
 * repl/types.ts — REPL 类型定义、常量与运行时 Agent 展示状态。
 *
 * 从 repl.ts 拆出：ReplMode、MODE_LABELS、CHAT_AGENT_ALIASES、
 * AgentDisplayInfo、AGENT_DISPLAY、运行时注入逻辑。
 */

import { AgentType, type TaskNode } from "@cortex/shared";
import {
  AGENT_DISPLAY as CONFIG_AGENT_DISPLAY,
  AGENT_DISPLAY_FALLBACK,
  type AgentDisplayInfo,
} from "@cortex/config";
import type * as readline from "node:readline";

// ── 模式 ──────────────────────────────────────────

/** REPL 运行模式 */
export type ReplMode = "command" | "chat" | "talk" | "plan" | "party";

/** CLI 模式标签——UI 概念，非引擎配置 */
export const MODE_LABELS: Record<ReplMode, string> = {
  command: "⌨ 命令",
  chat: "💬 对话",
  talk: "🗣 闲聊",
  plan: "📋 规划",
  party: "👥 群聊",
};

export const MODE_PROMPTS: Record<ReplMode, string> = {
  command: "cortex",
  chat: "chat",
  talk: "talk",
  plan: "plan",
  party: "party",
};

// ── Agent 别名 ────────────────────────────────────

/** 可对话的 Agent 别名 → AgentType 映射。
 *  单源定义在 @cortex/config（string 值），CLI 层转换为 AgentType 键版本。
 *  运行时从 bootstrapResult.config.agentDefinitions 动态构建覆盖。 */
export const CHAT_AGENT_ALIASES: Record<string, AgentType> = {
  // 英文别名
  code: AgentType.Code,
  review: AgentType.Review,
  analysis: AgentType.Analysis,
  ops: AgentType.Ops,
  fix: AgentType.Fix,
  loop: AgentType.Loop,
  inspect: AgentType.Inspector,
  inspector: AgentType.Inspector,
  doc: AgentType.DocGovern,
  "doc-govern": AgentType.DocGovern,
  api: AgentType.Api,
  data: AgentType.Data,
  strategy: AgentType.Strategist,
  strategist: AgentType.Strategist,
  meta: AgentType.Meta,
  butler: AgentType.Butler,
  browser: AgentType.Browser,
  // 中文别名（从 config CHAT_AGENT_ALIASES 推导）
  "阿贝多": AgentType.Code,
  "刻晴": AgentType.Review,
  "纳西妲": AgentType.Analysis,
  "北斗": AgentType.Ops,
  "希格雯": AgentType.Fix,
  "莫娜": AgentType.Loop,
  "安柏": AgentType.Inspector,
  "凝光": AgentType.DocGovern,
  "久岐忍": AgentType.Api,
  "艾尔海森": AgentType.Data,
  "钟离": AgentType.Strategist,
  "霜凝": AgentType.Strategist,
  "甘雨": AgentType.Meta,
  "昔涟": AgentType.Butler,
  "宵宫": AgentType.Browser,
};

// ── Agent 展示 ────────────────────────────────────

/**
 * Agent 角色展示信息（emoji + 角色名 + 签名语）。
 * 单源定义在 @cortex/config，CLI 层转换为 AgentType 键版本。
 */

export const AGENT_DISPLAY: Record<AgentType, AgentDisplayInfo> = {
  [AgentType.Code]:      CONFIG_AGENT_DISPLAY.code,
  [AgentType.Review]:    CONFIG_AGENT_DISPLAY.review,
  [AgentType.Analysis]:  CONFIG_AGENT_DISPLAY.analysis,
  [AgentType.Ops]:       CONFIG_AGENT_DISPLAY.ops,
  [AgentType.Loop]:      CONFIG_AGENT_DISPLAY.loop,
  [AgentType.DocGovern]: CONFIG_AGENT_DISPLAY["doc-govern"],
  [AgentType.Butler]:    CONFIG_AGENT_DISPLAY.butler,
  [AgentType.Inspector]: CONFIG_AGENT_DISPLAY.inspector,
  [AgentType.Fix]:       CONFIG_AGENT_DISPLAY.fix,
  [AgentType.Api]:       CONFIG_AGENT_DISPLAY.api,
  [AgentType.Browser]:   CONFIG_AGENT_DISPLAY.browser,
  [AgentType.Data]:      CONFIG_AGENT_DISPLAY.data,
  [AgentType.Strategist]:CONFIG_AGENT_DISPLAY.strategist,
  [AgentType.Meta]:      CONFIG_AGENT_DISPLAY.meta,
};

// AGENT_DISPLAY_FALLBACK 从 @cortex/config 导入（见顶部 import），此处直接重导出
import type { PartyState } from "./party.js";
export { AGENT_DISPLAY_FALLBACK };

// ── 运行时覆写 ───────────────────────────────────

/** 运行时别名映射（从 cortex-agents.json 注入） */
let _runtimeAliases: Record<string, AgentType> | undefined;
/** 运行时展示映射（从 cortex-agents.json 注入） */
let _runtimeDisplay: Record<AgentType, AgentDisplayInfo> | undefined;

/** 从 Agent 定义列表构建运行时 Agent 别名和展示映射 */
export function injectAgentDisplayFromConfig(
  defs: Array<{ type: string; id: string; display?: { emoji?: string; shortName?: string; title?: string } }>,
): void {
  const aliases: Record<string, AgentType> = {};
  const display: Record<AgentType, AgentDisplayInfo> = {} as Record<AgentType, AgentDisplayInfo>;
  for (const d of defs) {
    const at = d.type as AgentType;
    aliases[d.type] = at;
    if (d.id && d.id !== d.type) aliases[d.id] = at;
    if (d.display?.shortName) aliases[d.display.shortName] = at;
    if (d.display) {
      display[at] = {
        emoji: d.display.emoji ?? "🤖",
        name: d.display.shortName ?? d.id,
        signature: d.display.title ?? "",
      };
    }
  }
  _runtimeAliases = aliases;
  _runtimeDisplay = display;
}

/** 获取 Agent 展示信息（运行时覆盖优先） */
export function getAgentDisplay(agentType: AgentType): AgentDisplayInfo {
  return _runtimeDisplay?.[agentType] ?? AGENT_DISPLAY[agentType] ?? AGENT_DISPLAY_FALLBACK;
}

/** 获取运行时别名映射（用于 parseAgentPrefix 等） */
export function getRuntimeAliases(): Record<string, AgentType> | undefined {
  return _runtimeAliases;
}

// ── Plan 模式上下文 ──────────────────────────────

/** Plan 模式执行上下文（从 createReplHandler 传递到 executePlanInput） */
export interface PlanExecutionContext {
  getPlanNodes: () => TaskNode[];
  setPlanNodes: (nodes: TaskNode[]) => void;
  getPlanIntent: () => string;
  setPlanIntent: (intent: string) => void;
  /** 获取当前会话版本号——异步操作回来后校验 */
  getGeneration?: () => number;
  /** 操作发起时的版本号——与 getGeneration() 比较判断是否过时 */
  startGeneration?: number;
}

// ── 内部命令上下文 ──────────────────────────────

/** REPL 内部命令上下文（传递给 handleInternalCommand） */
export interface ReplContext {
  rl: readline.Interface;
  promptStr: string | undefined;
  historyFile: string;
  noHistory: boolean;
  setFormat: (f: "text" | "json" | "color") => void;
  setMode: (m: ReplMode) => void;
  getMode: () => ReplMode;
  setAgent: (a: AgentType) => void;
  getAgent: () => AgentType;
  stop: () => void;
  // Plan Mode
  getPlanNodes: () => TaskNode[];
  setPlanNodes: (nodes: TaskNode[]) => void;
  getPlanIntent: () => string;
  setPlanIntent: (intent: string) => void;
  // Talk Companion（三人对话）
  getTalkCompanion: () => AgentType | null;
  setTalkCompanion: (a: AgentType | null) => void;
  // Party Mode（群聊）
  getPartyState: () => PartyState;
  syncPartyState: (s: PartyState) => void;
}
