// ============================================================
// @cortex/config/data/agent-defs —— Agent 定义数据
//
// 从 @cortex/shared 迁入的运行时数据。
// 类型定义（AgentDefinition, AgentDisplayInfo, Tag 等）
// 仍保留在 @cortex/shared 中。
// ============================================================

import { AgentType } from "../vocabularies/agent-enums.js";
import type { AgentDefinition } from "@cortex/shared";

// Core-2 已解耦——shared 持有类型定义，config 持有运行时数据。AGENT_DEFS 保留在此作为默认注册表。

// ─── 工具权限预设 ──────────────────────────────

export const FULL_TOOLSET: readonly string[] = ["read_file", "write_file", "search_code", "web_search", "run_shell", "list_files", "delete_file", "parse_ast", "search_symbol", "read_many_files", "grep_files", "file_info", "glob_find", "resolve_import", "json_query", "diff_files", "edit_file", "format_code", "run_test"];
export const BASE_TOOLSET: readonly string[] = ["read_file", "write_file", "search_code", "web_search", "list_files", "delete_file", "parse_ast", "search_symbol", "read_many_files", "grep_files", "file_info", "glob_find", "resolve_import", "json_query", "diff_files", "edit_file", "format_code"];
export const READONLY_TOOLSET: readonly string[] = ["read_file", "search_code", "web_search", "list_files", "parse_ast", "search_symbol", "read_many_files", "grep_files", "file_info", "glob_find", "resolve_import", "json_query", "diff_files"];

// ─── AGENT_DEFS — 单一起源 ─────────────────────

export const AGENT_DEFS: Record<AgentType, AgentDefinition> = {
  [AgentType.Meta]: {
    tags: ["plan_review"],
    chineseRole: "甘雨",
    display: { emoji: "📋", name: "甘雨", signature: "让我为你梳理任务脉络。" },
    toolPermissions: READONLY_TOOLSET,
  },
  [AgentType.Code]: {
    tags: ["code", "implementation", "refactor", "test", "config"],
    chineseRole: "阿贝多",
    display: { emoji: "🧪", name: "阿贝多", signature: "这个结构，值得研究。" },
    toolPermissions: FULL_TOOLSET,
  },
  [AgentType.Review]: {
    tags: ["review", "audit"],
    chineseRole: "刻晴",
    display: { emoji: "⚔️", name: "刻晴", signature: "每一行都可能藏着疏漏。" },
    toolPermissions: BASE_TOOLSET,
  },
  [AgentType.Analysis]: {
    tags: ["analysis", "research"],
    chineseRole: "纳西妲",
    display: { emoji: "🌿", name: "纳西妲", signature: "有意思……让我再深挖一层。" },
    toolPermissions: BASE_TOOLSET,
  },
  [AgentType.Ops]: {
    tags: ["ops", "deploy", "test"],
    chineseRole: "北斗",
    display: { emoji: "⚓", name: "北斗", signature: "死兆星号，准备起航。" },
    toolPermissions: FULL_TOOLSET,
  },
  [AgentType.Loop]: {
    tags: ["loop", "pattern_scan", "skill_precipitate"],
    chineseRole: "莫娜",
    display: { emoji: "🔮", name: "莫娜", signature: "星辰不会说谎。" },
    toolPermissions: BASE_TOOLSET,
  },
  [AgentType.DocGovern]: {
    tags: ["doc-govern", "audit", "plan_review", "doc_audit", "constitution_check", "constitution_propose"],
    chineseRole: "凝光",
    display: { emoji: "🏛️", name: "凝光", signature: "天权定论，不得上诉。" },
    toolPermissions: BASE_TOOLSET,
    aliases: ["doc"],
  },
  [AgentType.Butler]: {
    tags: [],
    chineseRole: "昔涟",
    display: { emoji: "🍀", name: "昔涟", signature: "三千世轮回。这辈子归你了。" },
    toolPermissions: ["read_file", "search_code", "list_files", "search_symbol", "read_many_files", "grep_files", "file_info", "glob_find", "resolve_import", "json_query", "diff_files"],
  },
  [AgentType.Inspector]: {
    tags: ["inspector", "inspect"],
    chineseRole: "安柏",
    display: { emoji: "🦅", name: "安柏", signature: "侦察完毕，一切正常。" },
    toolPermissions: BASE_TOOLSET,
    aliases: ["inspect"],
  },
  [AgentType.Browser]: {
    tags: ["browser", "ui_verify"],
    chineseRole: "宵宫",
    display: { emoji: "🎆", name: "宵宫", signature: "咻~让烟花为你绽放！" },
    toolPermissions: [...BASE_TOOLSET, "browser_do"],
  },
  [AgentType.Fix]: {
    tags: ["fix", "bugfix", "repair", "diagnose", "heal"],
    chineseRole: "希格雯",
    display: { emoji: "💉", name: "希格雯", signature: "让我看看伤口在哪里。" },
    toolPermissions: FULL_TOOLSET,
  },
  [AgentType.Api]: {
    tags: ["api", "api_design", "api_integration", "endpoint", "review", "research", "analysis"],
    chineseRole: "久岐忍",
    display: { emoji: "📦", name: "久岐忍", signature: "契约检查完毕。" },
    toolPermissions: BASE_TOOLSET,
  },
  [AgentType.Data]: {
    tags: ["data", "data_model", "migration", "storage", "schema", "review", "research", "analysis"],
    chineseRole: "艾尔海森",
    display: { emoji: "📚", name: "艾尔海森", signature: "数据就是数据。" },
    toolPermissions: BASE_TOOLSET,
  },
  [AgentType.Strategist]: {
    tags: ["strategy", "contract"],
    chineseRole: "钟离",
    display: { emoji: "⚖️", name: "钟离", signature: "契约既成，食言者当受食岩之罚。" },
    toolPermissions: READONLY_TOOLSET,
    aliases: ["strategy", "霜凝"],
  },
};
