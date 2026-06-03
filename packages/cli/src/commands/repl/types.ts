/**
 * repl/types.ts — REPL 类型定义、常量与运行时 Agent 展示状态。
 *
 * 从 repl.ts 拆出：ReplMode、MODE_LABELS、CHAT_AGENT_ALIASES、
 * AgentDisplayInfo、AGENT_DISPLAY、运行时注入逻辑。
 */

import { AgentType } from "@cortex/shared";
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

/** 可对话的 Agent 别名 → AgentType 映射（编译期fallback）。
 *  运行时从 bootstrapResult.config.agentDefinitions 动态构建。
 *  别名规则：英文type名 + 中文display.shortName 均可路由。 */
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
  // 中文别名
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

/** Agent 角色展示信息（emoji + 角色名 + 签名语）。
 *  单源原则：emoji/name 来自 cortex-agents.json agents[].display。
 *  signature 为 CLI 风味文本，JSON 未定义时使用此 fallback。 */
export interface AgentDisplayInfo {
  emoji: string;
  name: string;
  signature: string;
}

export const AGENT_DISPLAY: Record<AgentType, AgentDisplayInfo> = {
  [AgentType.Code]:      { emoji: "🧪", name: "阿贝多", signature: "这个结构，值得研究。" },
  [AgentType.Review]:    { emoji: "⚔️", name: "刻晴",   signature: "每一行都可能藏着疏漏。" },
  [AgentType.Analysis]:  { emoji: "🌿", name: "纳西妲", signature: "有意思……让我再深挖一层。" },
  [AgentType.Ops]:       { emoji: "⚓", name: "北斗",   signature: "死兆星号，准备起航。" },
  [AgentType.Loop]:      { emoji: "🔮", name: "莫娜",   signature: "星辰不会说谎。" },
  [AgentType.DocGovern]: { emoji: "🏛️", name: "凝光",   signature: "天权定论，不得上诉。" },
  [AgentType.Butler]:    { emoji: "🍀", name: "昔涟",   signature: "三千世轮回。这辈子归你了。" },
  [AgentType.Inspector]: { emoji: "🦅", name: "安柏",   signature: "侦察完毕，一切正常。" },
  [AgentType.Fix]:       { emoji: "💉", name: "希格雯", signature: "让我看看伤口在哪里。" },
  [AgentType.Api]:       { emoji: "📦", name: "久岐忍", signature: "契约检查完毕。" },
  [AgentType.Browser]:   { emoji: "🎆", name: "宵宫",   signature: "咻~让烟花为你绽放！" },
  [AgentType.Data]:      { emoji: "📚", name: "艾尔海森", signature: "数据就是数据。" },
  [AgentType.Strategist]:{ emoji: "⚖️", name: "钟离",   signature: "契约既成，食言者当受食岩之罚。" },
  [AgentType.Meta]:      { emoji: "📋", name: "甘雨",   signature: "让我为你梳理任务脉络。" },
};

export const AGENT_DISPLAY_FALLBACK: AgentDisplayInfo = { emoji: "🤖", name: "Agent", signature: "" };

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
  getPlanNodes: () => import("@cortex/shared").TaskNode[];
  setPlanNodes: (nodes: import("@cortex/shared").TaskNode[]) => void;
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
  getPlanNodes: () => import("@cortex/shared").TaskNode[];
  setPlanNodes: (nodes: import("@cortex/shared").TaskNode[]) => void;
  getPlanIntent: () => string;
  setPlanIntent: (intent: string) => void;
  // Talk Companion（三人对话）
  getTalkCompanion: () => AgentType | null;
  setTalkCompanion: (a: AgentType | null) => void;
  // Party Mode（群聊）
  getPartyState: () => import("./party.js").PartyState;
  syncPartyState: (s: import("./party.js").PartyState) => void;
}
