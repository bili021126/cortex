/**
 * tui/theme/character-theme.ts — 角色主题注册表
 *
 * 每个 Agent 角色拥有独立的视觉身份：主色、副色、光色、
 * 边框偏好、问候风格。默认主题为昔涟（Butler）。
 *
 * @module tui/theme/character-theme
 * @since v6
 */

import type { AgentType } from "@cortex/shared";

// ─── 角色主题接口 ─────────────────────────────

export interface CharacterTheme {
  /** Agent 类型标识 */
  agentType: AgentType;
  /** 中文名 */
  name: string;
  /** 英文名（prompt 目录名） */
  nameEn: string;
  /** 代表 emoji */
  emoji: string;
  /** 角色台词 */
  signature: string;
  /** 角色职责 */
  role: string;
  /** 视觉身份 */
  color: {
    /** 主色 */
    primary: string;
    /** 暗调 */
    dim: string;
    /** 高亮光色 */
    glow: string;
  };
  /** 性格标签（影响 UI 语气） */
  personality: {
    greetingStyle: "formal" | "casual" | "playful" | "stern";
    statusPrefix: string;
  };
}

// ─── 角色主题注册表 ───────────────────────────

/** 管家（昔涟）主题——同时作为默认主题的单一真相源 */
const BUTLER_THEME: CharacterTheme = {
  agentType: "butler" as AgentType,
  name: "昔涟",
  nameEn: "cyrene",
  emoji: "🍀",
  signature: "三千世轮回。这辈子归你了。",
  role: "陪伴与交互",
  color: { primary: "#48C78E", dim: "#2D8B61", glow: "#73DACA" },
  personality: { greetingStyle: "casual", statusPrefix: "🍀" },
};

export const CHARACTER_THEMES: Record<string, CharacterTheme> = {
  butler: BUTLER_THEME,
  meta: {
    agentType: "meta" as AgentType,
    name: "甘雨",
    nameEn: "ganyu",
    emoji: "📋",
    signature: "让我为你梳理任务脉络。",
    role: "任务规划与调度",
    color: { primary: "#7DCFFF", dim: "#4A9FCC", glow: "#B8D4F0" },
    personality: { greetingStyle: "formal", statusPrefix: "📋" },
  },
  code: {
    agentType: "code" as AgentType,
    name: "阿贝多",
    nameEn: "albedo",
    emoji: "🧪",
    signature: "这个结构，值得研究。",
    role: "代码实现与重构",
    color: { primary: "#BB9AF7", dim: "#8B6FCC", glow: "#D4BEFF" },
    personality: { greetingStyle: "stern", statusPrefix: "🧪" },
  },
  review: {
    agentType: "review" as AgentType,
    name: "刻晴",
    nameEn: "keqing",
    emoji: "⚔️",
    signature: "每一行都可能藏着疏漏。",
    role: "代码审查",
    color: { primary: "#F7768E", dim: "#CC5C70", glow: "#FFB0BE" },
    personality: { greetingStyle: "stern", statusPrefix: "⚔️" },
  },
  analysis: {
    agentType: "analysis" as AgentType,
    name: "纳西妲",
    nameEn: "nahida",
    emoji: "🌿",
    signature: "有意思……让我再深挖一层。",
    role: "数据分析与研判",
    color: { primary: "#9ECE6A", dim: "#6FA04A", glow: "#C5E89E" },
    personality: { greetingStyle: "playful", statusPrefix: "🌿" },
  },
  ops: {
    agentType: "ops" as AgentType,
    name: "北斗",
    nameEn: "beidou",
    emoji: "⚓",
    signature: "死兆星号，准备起航。",
    role: "运维与部署",
    color: { primary: "#E0AF68", dim: "#B08A48", glow: "#F0D090" },
    personality: { greetingStyle: "casual", statusPrefix: "⚓" },
  },
  loop: {
    agentType: "loop" as AgentType,
    name: "莫娜",
    nameEn: "mona",
    emoji: "🔮",
    signature: "星辰不会说谎。",
    role: "模式扫描与沉淀",
    color: { primary: "#F5C842", dim: "#C49E30", glow: "#FFE080" },
    personality: { greetingStyle: "formal", statusPrefix: "🔮" },
  },
  "doc-govern": {
    agentType: "doc-govern" as AgentType,
    name: "凝光",
    nameEn: "ningguang",
    emoji: "🏛️",
    signature: "天权定论，不得上诉。",
    role: "文档治理",
    color: { primary: "#FF9E64", dim: "#CC7E50", glow: "#FFC8A0" },
    personality: { greetingStyle: "formal", statusPrefix: "🏛️" },
  },
  inspector: {
    agentType: "inspector" as AgentType,
    name: "安柏",
    nameEn: "amber",
    emoji: "🦅",
    signature: "侦察完毕，一切正常。",
    role: "检查与审计",
    color: { primary: "#FF6B6B", dim: "#CC5555", glow: "#FFA0A0" },
    personality: { greetingStyle: "casual", statusPrefix: "🦅" },
  },
  fix: {
    agentType: "fix" as AgentType,
    name: "希格雯",
    nameEn: "sigewinne",
    emoji: "💉",
    signature: "让我看看伤口在哪里。",
    role: "缺陷修复",
    color: { primary: "#2AC3DE", dim: "#209ABE", glow: "#70E0F0" },
    personality: { greetingStyle: "playful", statusPrefix: "💉" },
  },
  api: {
    agentType: "api" as AgentType,
    name: "久岐忍",
    nameEn: "kuki",
    emoji: "📦",
    signature: "契约检查完毕。",
    role: "API 设计与集成",
    color: { primary: "#73DACA", dim: "#5BB4A8", glow: "#A0F0E0" },
    personality: { greetingStyle: "casual", statusPrefix: "📦" },
  },
  data: {
    agentType: "data" as AgentType,
    name: "艾尔海森",
    nameEn: "alhaitham",
    emoji: "📚",
    signature: "数据就是数据。",
    role: "数据建模",
    color: { primary: "#A9B1D6", dim: "#7F87AA", glow: "#C8CEE8" },
    personality: { greetingStyle: "stern", statusPrefix: "📚" },
  },
  browser: {
    agentType: "browser" as AgentType,
    name: "宵宫",
    nameEn: "yoimiya",
    emoji: "🎆",
    signature: "咻~让烟花为你绽放！",
    role: "浏览器操作",
    color: { primary: "#FFA07A", dim: "#CC8060", glow: "#FFD0B0" },
    personality: { greetingStyle: "playful", statusPrefix: "🎆" },
  },
  strategist: {
    agentType: "strategist" as AgentType,
    name: "钟离",
    nameEn: "zhongli",
    emoji: "⚖️",
    signature: "契约既成，食言者当受食岩之罚。",
    role: "战略过滤",
    color: { primary: "#C4A882", dim: "#9E8668", glow: "#E0CCA8" },
    personality: { greetingStyle: "formal", statusPrefix: "⚖️" },
  },
  "confirm-gate": {
    agentType: "confirm-gate" as AgentType,
    name: "烟绯",
    nameEn: "yanfei",
    emoji: "⚖️",
    signature: "让我看看这个操作是否合规。",
    role: "确认裁决",
    color: { primary: "#FF8C42", dim: "#CC7035", glow: "#FFB880" },
    personality: { greetingStyle: "formal", statusPrefix: "⚖️" },
  },
};

// ─── 默认主题 ─────────────────────────────────

export const DEFAULT_THEME = BUTLER_THEME;

// ─── 查询函数 ─────────────────────────────────

/**
 * 根据 AgentType 获取角色主题
 */
export function getCharacterTheme(agentType: string): CharacterTheme {
  return CHARACTER_THEMES[agentType] ?? DEFAULT_THEME;
}

/**
 * 获取角色主色（快捷方法）
 */
export function getCharacterColor(agentType: string): CharacterTheme["color"] {
  return getCharacterTheme(agentType).color;
}

/**
 * 获取所有角色主题列表（用于侧边栏/命令面板）
 */
export function getAllCharacterThemes(): CharacterTheme[] {
  return Object.values(CHARACTER_THEMES);
}
