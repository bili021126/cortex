// ============================================================
// @cortex/shared — Agent 运行时注册表
//
// Agent 域的统一常量定义与运行时覆写层，是 Scheduler/TaskBoard/CLI
// 的标签匹配、中文展示、权限校验的单一真相源。
//
// 架构：
//   - AGENT_DEFS（§2）：AgentType-key 单一起源——所有子表自动派生
//   - 运行时覆写层（§4）：setAgentRegistry() 从 cortex-agents.json 动态注入
//   - 权限解析（§6）：resolveAgentPermissions() 按 AgentType + AgentContext 动态授予
//
// 新增 Agent 类型只需两处修改：
//   1. agent-enums.ts：加枚举值
//   2. 本文件 AGENT_DEFS：加一行定义 → 所有子表自动对齐
//
// @module agent-registry
// @layer shared — 依赖 @cortex/shared 的 agent-enums
// @since v3 统一 agent 域
// ============================================================

import { AgentType, type AgentContext } from "./agent-enums.js";
// ============================================================
// §1 标签词汇表（TAG_VOCABULARY）
// ============================================================

/**
 * 标签词汇表（封闭集合）
 * @since Core-2 — 接口固化，后续新增字段需向下兼容
 */
export const TAG_VOCABULARY = [
  "code",
  "implementation",
  "bugfix",
  "refactor",
  "test",
  "config",
  "review",
  "audit",
  "research",
  "analysis",
  "deploy",
  "ops",
  "loop",
  "pattern_scan",
  "skill_precipitate",
  "plan_review",
  "doc_audit",
  "constitution_check",
  "constitution_propose",
  "inspector",
  "inspect",
  "doc-govern",
  "browser",
  "ui_verify",
  "fix",
  "repair",
  "diagnose",
  "heal",
  "api",
  "data",
  "api_design",
  "api_integration",
  "endpoint",
  "data_model",
  "migration",
  "storage",
  "schema",
  "strategy",
  "strategist",
  "contract",
  "direction",
  "confirm_gate",
  "gatekeeper",
] as const;

/**
 * @since Core-2 — 接口固化，后续新增字段需向下兼容
 */
export type Tag = string;

// §2 剩余内容（AgentDefinition + AGENT_DEFS）
// ============================================================

/** Agent 展示信息 */
export interface AgentDisplayInfo {
  emoji: string;
  name: string;
  signature: string;
}

/**
 * Agent 完整定义——所有子表（AGENT_TAGS / AGENT_CHINESE_ROLE /
 * AGENT_DISPLAY_BY_TYPE / AGENT_TOOL_PERMISSIONS / CHAT_AGENT_ALIASES）
 * 均从此单一结构自动派生。
 *
 * 新增 Agent 类型：只需在 AGENT_DEFS 中加一行即可。
 */
export interface AgentDefinition {
  /** 认领标签（Scheduler 标签匹配依据） */
  tags: readonly Tag[];
  /** 中文角色名 */
  chineseRole: string;
  /** 展示信息（emoji + 签名） */
  display: AgentDisplayInfo;
  /** 工具权限集 */
  toolPermissions: readonly string[];
  /** 额外别名（不含 string-key 和 chineseRole——此二者自动加入） */
  aliases?: readonly string[];
  /** 角色描述（用于 LLM 系统提示词生成） */
  role?: string;
  /** 产出物类型（用于任务匹配） */
  produces?: string[];
}

// ─── 工具权限预设 ──────────────────────────────

const FULL_TOOLSET: readonly string[] = ["read_file", "write_file", "search_code", "web_search", "run_shell", "list_files", "delete_file", "parse_ast", "search_symbol", "read_many_files", "grep_files", "file_info", "glob_find", "resolve_import", "json_query", "diff_files", "edit_file", "format_code", "run_test"];
const BASE_TOOLSET: readonly string[] = ["read_file", "write_file", "search_code", "web_search", "list_files", "delete_file", "parse_ast", "search_symbol", "read_many_files", "grep_files", "file_info", "glob_find", "resolve_import", "json_query", "diff_files", "edit_file", "format_code"];
const READONLY_TOOLSET: readonly string[] = ["read_file", "search_code", "web_search", "list_files", "parse_ast", "search_symbol", "read_many_files", "grep_files", "file_info", "glob_find", "resolve_import", "json_query", "diff_files"];

// ─── AGENT_DEFS — 单一起源 ─────────────────────
// Core-2 已解耦——shared 持有类型定义，config 持有运行时数据。AGENT_DEFS 可留在 shared 作为默认注册表。

const AGENT_DEFS: Record<AgentType, AgentDefinition> = {
  [AgentType.Meta]: {
    tags: ["plan_review"],
    chineseRole: "甘雨",
    display: { emoji: "📋", name: "甘雨", signature: "让我为你梳理任务脉络。" },
    toolPermissions: READONLY_TOOLSET,
    role: "任务规划与调度",
  },
  [AgentType.Code]: {
    tags: ["code", "implementation", "refactor", "test", "config"],
    chineseRole: "阿贝多",
    display: { emoji: "🧪", name: "阿贝多", signature: "这个结构，值得研究。" },
    toolPermissions: FULL_TOOLSET,
    role: "代码实现与重构",
  },
  [AgentType.Review]: {
    tags: ["review", "audit"],
    chineseRole: "刻晴",
    display: { emoji: "⚔️", name: "刻晴", signature: "每一行都可能藏着疏漏。" },
    toolPermissions: BASE_TOOLSET,
    role: "代码审查",
  },
  [AgentType.Analysis]: {
    tags: ["analysis", "research"],
    chineseRole: "纳西妲",
    display: { emoji: "🌿", name: "纳西妲", signature: "有意思……让我再深挖一层。" },
    toolPermissions: BASE_TOOLSET,
    role: "数据分析与研判",
  },
  [AgentType.Ops]: {
    tags: ["ops", "deploy", "test"],
    chineseRole: "北斗",
    display: { emoji: "⚓", name: "北斗", signature: "死兆星号，准备起航。" },
    toolPermissions: FULL_TOOLSET,
    role: "运维与部署",
  },
  [AgentType.Loop]: {
    tags: ["loop", "pattern_scan", "skill_precipitate"],
    chineseRole: "莫娜",
    display: { emoji: "🔮", name: "莫娜", signature: "星辰不会说谎。" },
    toolPermissions: BASE_TOOLSET,
    role: "模式扫描与沉淀",
  },
  [AgentType.DocGovern]: {
    tags: ["doc-govern", "audit", "plan_review", "doc_audit", "constitution_check", "constitution_propose"],
    chineseRole: "凝光",
    display: { emoji: "🏛️", name: "凝光", signature: "天权定论，不得上诉。" },
    toolPermissions: BASE_TOOLSET,
    aliases: ["doc"],
    role: "文档治理",
  },
  [AgentType.Butler]: {
    tags: [],
    chineseRole: "昔涟",
    display: { emoji: "🍀", name: "昔涟", signature: "三千世轮回。这辈子归你了。" },
    toolPermissions: ["read_file", "search_code", "list_files", "search_symbol", "read_many_files", "grep_files", "file_info", "glob_find", "resolve_import", "json_query", "diff_files"],
    role: "陪伴与交互",
  },
  [AgentType.Inspector]: {
    tags: ["inspector", "inspect"],
    chineseRole: "安柏",
    display: { emoji: "🦅", name: "安柏", signature: "侦察完毕，一切正常。" },
    toolPermissions: BASE_TOOLSET,
    aliases: ["inspect"],
    role: "检查与审计",
  },
  [AgentType.Fix]: {
    tags: ["fix", "bugfix", "repair", "diagnose", "heal"],
    chineseRole: "希格雯",
    display: { emoji: "💉", name: "希格雯", signature: "让我看看伤口在哪里。" },
    toolPermissions: FULL_TOOLSET,
    role: "缺陷修复",
  },
  [AgentType.Api]: {
    tags: ["api", "api_design", "api_integration", "endpoint", "review", "research", "analysis"],
    chineseRole: "久岐忍",
    display: { emoji: "📦", name: "久岐忍", signature: "契约检查完毕。" },
    toolPermissions: BASE_TOOLSET,
    role: "API 设计与集成",
  },
  [AgentType.Data]: {
    tags: ["data", "data_model", "migration", "storage", "schema", "review", "research", "analysis"],
    chineseRole: "艾尔海森",
    display: { emoji: "📚", name: "艾尔海森", signature: "数据就是数据。" },
    toolPermissions: BASE_TOOLSET,
    role: "数据建模",
  },
  [AgentType.Browser]: {
    tags: ["browser", "ui_verify"],
    chineseRole: "宵宫",
    display: { emoji: "🎆", name: "宵宫", signature: "咻~让烟花为你绽放！" },
    toolPermissions: [...BASE_TOOLSET, "browser_do"],
    role: "浏览器操作",
  },
  [AgentType.Strategist]: {
    tags: ["strategy", "contract"],
    chineseRole: "钟离",
    display: { emoji: "⚖️", name: "钟离", signature: "契约既成，食言者当受食岩之罚。" },
    toolPermissions: READONLY_TOOLSET,
    aliases: ["strategy", "霜凝"],
    role: "战略过滤",
  },
  [AgentType.ConfirmGate]: {
    tags: ["confirm_gate", "gatekeeper"],
    chineseRole: "烟绯",
    display: { emoji: "⚖️", name: "烟绯", signature: "让我看看这个操作是否合规。" },
    toolPermissions: READONLY_TOOLSET,
    role: "确认裁决",
  },
};

// ============================================================
// §3 派生公共导出（从 AGENT_DEFS 自动生成——零手动对齐）
// ============================================================

/** Agent 类型 → 认领标签 */
export const AGENT_TAGS: Record<AgentType, readonly Tag[]> = _derive("tags");

/** Agent 类型 → 中文角色名 */
export const AGENT_CHINESE_ROLE: Record<AgentType, string> = _derive("chineseRole");

/** Agent 类型 → 展示信息（AgentType-key） */
export const AGENT_DISPLAY_BY_TYPE: Record<AgentType, AgentDisplayInfo> = _derive("display");

/** Agent 类型 → 工具权限集 */
export const AGENT_TOOL_PERMISSIONS: Record<AgentType, readonly string[]> = _derive("toolPermissions");

/**
 * 中文名 → AgentType 反向映射。
 * 从 AGENT_DEFS.chineseRole 自动派生。
 */
export const CHINESE_NAME_TO_TYPE: Record<string, AgentType> = _buildChineseNameToType();

/**
 * 别名 → AgentType 映射（对话路由用）。
 * 自动包含：string-key（如 "code"）+ chineseRole（如 "阿贝多"）+ aliases（如 "doc"）。
 */
export const CHAT_AGENT_ALIASES: Record<string, AgentType> = _buildChatAgentAliases();

/** 不匹配时的回退展示 */
export const AGENT_DISPLAY_FALLBACK: AgentDisplayInfo = { emoji: "🤖", name: "Agent", signature: "" };

/**
 * Agent 类型 → 展示信息（string-key 原始数据）。
 * 供 JSON 序列化/动态覆盖——从 AGENT_DEFS 派生。
 */
export const AGENT_DISPLAY: Record<string, AgentDisplayInfo> = _buildStringKeyDisplay();

// ─── 派生工具函数 ──────────────────────────────

function _derive<K extends keyof AgentDefinition>(key: K): Record<AgentType, AgentDefinition[K]> {
  const result = {} as Record<AgentType, AgentDefinition[K]>;
  for (const agentType of Object.values(AgentType) as AgentType[]) {
    result[agentType] = AGENT_DEFS[agentType][key];
  }
  return result;
}

function _buildChineseNameToType(): Record<string, AgentType> {
  const map: Record<string, AgentType> = {};
  for (const agentType of Object.values(AgentType) as AgentType[]) {
    const def = AGENT_DEFS[agentType];
    if (!def) continue;
    // 主中文名
    if (!map[def.chineseRole]) {
      map[def.chineseRole] = agentType;
    }
    // 中文别名（CJK 字符检测）
    for (const alias of def.aliases ?? []) {
      if (_isCJK(alias) && !map[alias]) {
        map[alias] = agentType;
      }
    }
  }
  return map;
}

function _isCJK(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s);
}

function _buildChatAgentAliases(): Record<string, AgentType> {
  const map: Record<string, AgentType> = {};
  for (const agentType of Object.values(AgentType) as AgentType[]) {
    const def = AGENT_DEFS[agentType];
    if (!def) continue;
    // string-key（AgentType 枚举值）
    map[agentType as string] = agentType;
    // 中文角色名
    map[def.chineseRole] = agentType;
    // 额外别名
    for (const alias of def.aliases ?? []) {
      if (!map[alias]) map[alias] = agentType;
    }
  }
  return map;
}

function _buildStringKeyDisplay(): Record<string, AgentDisplayInfo> {
  const map: Record<string, AgentDisplayInfo> = {};
  for (const agentType of Object.values(AgentType) as AgentType[]) {
    const def = AGENT_DEFS[agentType];
    if (def) map[agentType as string] = def.display;
  }
  return map;
}

// ============================================================
// §4 运行时覆写层
// ============================================================

let _runtimeTags: Record<string, readonly string[]> = { ...AGENT_TAGS as unknown as Record<string, readonly string[]> };
let _runtimeToolPermissions: Record<string, readonly string[]> = { ...AGENT_TOOL_PERMISSIONS as unknown as Record<string, readonly string[]> };

/** 获取 Agent 标签（优先运行时覆写，回退编译期常量） */
export function getAgentTags(): Record<string, readonly string[]> {
  return _runtimeTags;
}

/** 获取标签词汇表（封闭集合） */
export function getTagVocabulary(): readonly string[] {
  return TAG_VOCABULARY;
}

/** 注入运行时标签覆写 */
export function setAgentTags(tags: Record<string, readonly string[]>): void {
  _runtimeTags = { ...AGENT_TAGS as unknown as Record<string, readonly string[]>, ...tags };
}

/** 获取 Agent 工具权限（优先运行时覆写，回退编译期常量） */
export function getAgentToolPermissions(): Record<string, readonly string[]> {
  return _runtimeToolPermissions;
}

/** 注入运行时权限覆写 */
export function setAgentToolPermissions(permissions: Record<string, readonly string[]>): void {
  const WRITE_TOOLS = ['write_file', 'edit_file', 'delete_file', 'run_shell'];
  for (const [key, tools] of Object.entries(permissions)) {
    const base = (AGENT_TOOL_PERMISSIONS as unknown as Record<string, readonly string[]>)[key];
    const isReadonly = (base?.length ?? 0) > 0 && base?.every(t => !WRITE_TOOLS.includes(t));
    if (isReadonly && tools.some(t => WRITE_TOOLS.includes(t))) {
      return; // 只读Agent不能升级为写入权限
    }
  }
  _runtimeToolPermissions = { ...AGENT_TOOL_PERMISSIONS as unknown as Record<string, readonly string[]>, ...permissions };
}

// ============================================================
// §5 权限解析（resolveAgentPermissions）
// ============================================================

/**
 * 按 AgentType 解析实际权限集。
 *
 * 所有 Agent 类型统一走 AGENT_TOOL_PERMISSIONS（含运行时覆写），
 * Review/Inspector 不再特殊 bypass。
 * context 参数保留为向后兼容占位，不影响权限结果。
 */
export function resolveAgentPermissions(
  agentType: AgentType,
  _context?: AgentContext,
): readonly string[] {
  return AGENT_TOOL_PERMISSIONS[agentType] ?? [];
}

// ============================================================
// §6 构建工具
// ============================================================

/** Agent display 信息的最小接口（用于从配置构建映射） */
export interface AgentDisplayEntry {
  type: string;
  shortName: string;
}

/**
 * 从 Agent 定义列表构建中文名映射。
 * 覆盖编译期 AGENT_CHINESE_ROLE / CHINESE_NAME_TO_TYPE。
 */
export function buildChineseRoleMap(
  defs: AgentDisplayEntry[],
): { role: Record<string, string>; nameToType: Record<string, string> } {
  const role: Record<string, string> = {};
  const nameToType: Record<string, string> = {};
  for (const d of defs) {
    role[d.type] = d.shortName;
    if (!nameToType[d.shortName]) {
      nameToType[d.shortName] = d.type;
    }
  }
  return { role, nameToType };
}

// ============================================================
// §7 运行时注册表整合注入
// ============================================================

/**
 * 注入运行时 Agent 注册表覆写。
 * bootstrapEngine 在启动时调用，将 cortex-agents.json 中的
 * 自定义 tags 和 toolPermissions 注入到 shared 层运行时状态。
 */
export function setAgentRegistry(
  tags: Record<string, readonly string[]>,
  toolPermissions: Record<string, readonly string[]>,
): void {
  setAgentTags(tags);
  setAgentToolPermissions(toolPermissions);
}
