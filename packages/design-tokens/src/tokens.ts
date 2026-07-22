/**
 * @cortex/design-tokens — 双 Palette 设计常量
 *
 * ENGINEERING: CLI / WebUI 使用的冷色工程界面
 * PRESENCE:    Desktop 使用的暖色陪伴界面（色相不变，饱和度 -15%，亮度 +5%）
 *
 * 两套 palette 共享 primary token，在各自空间里独立冷/暖。
 */

// ─── 色彩 ───────────────────────────────────────────────────

/** 工程界面色彩（CLI / WebUI） */
export const ENGINEERING = {
  bg: {
    base: "#0f0f14",
    surface: "#16161d",
    elevated: "#1e1e27",
    overlay: "#252530",
  },
  primary: "#6366f1",
  primaryHover: "#818cf8",
  primaryMuted: "#4f46e520",
  accent: "#a5b4fc",
  semantic: {
    success: "#22c55e",
    error: "#ef4444",
    warning: "#f59e0b",
    info: "#3b82f6",
  },
  text: {
    primary: "#e4e4e7",
    secondary: "#a1a1aa",
    muted: "#71717a",
    inverse: "#18181b",
  },
  border: {
    default: "#27272a",
    focus: "#6366f1",
    subtle: "#1f1f23",
  },
  diff: {
    addedBg: "#16a34a18",
    removedBg: "#dc262618",
    addedLine: "#22c55e",
    removedLine: "#ef4444",
    addedGutter: "#16a34a40",
    removedGutter: "#dc262640",
  },
} as const;

/**
 * 陪伴界面色彩（Desktop）——Persona 派生
 *
 * 设计意图：不是工程师的暗，是"她住的房间的暗"。
 * 每个 persona 有自己的 palette——她们不是同一个人，不该共用一套颜色。
 * Desktop 切换角色时，整个 UI 的色相家族随之改变。
 *
 * 色值来源分级：
 *   [权威] 直接从该角色的 Live2D 贴图 texture_0.png 逐区取色
 *   [待校准] 依据公开立绘估算的初值，待该角色贴图落地后精修
 *
 * ── cyrene（昔涟）[权威] ──
 *   取自 packages/desktop/resources/models/cyrene/texture_0.png：
 *   主发色薰衣草紫、薄荷青挑染、玫粉发梢、彩虹瞳高光、暖象牙肤、星空披风深紫。
 *   她不是 indigo——品牌一致性靠紫色相家族，不靠与 ENGINEERING 共用 hex。
 */

/** 单个 persona 的完整色板结构（与 ENGINEERING 同形，额外含 warmth） */
export interface PersonaPalette {
  bg: { base: string; surface: string; elevated: string; overlay: string };
  primary: string;
  primaryHover: string;
  primaryMuted: string;
  accent: string;
  /** 暖色——PRESENCE 独有，用于气泡边框、问候语高亮等 */
  warmth: string;
  warmthMuted: string;
  semantic: { success: string; error: string; warning: string; info: string };
  text: { primary: string; secondary: string; muted: string; inverse: string };
  border: { default: string; focus: string; subtle: string };
  diff: {
    addedBg: string; removedBg: string;
    addedLine: string; removedLine: string;
    addedGutter: string; removedGutter: string;
  };
}

/** 昔涟——[权威] 取自 Cyrene texture_0.png */
export const CYRENE_PALETTE: PersonaPalette = {
  bg: {
    base: "#14101c",     // 她房间的暗——暖紫调，不是蓝黑
    surface: "#1d1730",  // 星空披风的深紫底
    elevated: "#282040",
    overlay: "#332a50",
  },
  primary: "#b57edc",     // 主发色·薰衣草紫
  primaryHover: "#c99cec",
  primaryMuted: "#b57edc22",
  accent: "#8fd9c4",      // 薄荷青挑染
  warmth: "#fce8dd",      // 暖象牙肤色
  warmthMuted: "#fce8dd22",
  semantic: {
    success: "#8fd9c4",   // 用她的薄荷青当成功色
    error: "#e87ba8",     // 玫粉当错误色（她不会用刺眼的红）
    warning: "#f0c088",
    info: "#c9b6f0",      // 彩虹瞳高光·浅紫
  },
  text: {
    primary: "#f0eaf5",
    secondary: "#c4bcd6",
    muted: "#8b83a0",
    inverse: "#14101c",
  },
  border: {
    default: "#38305a",
    focus: "#b57edc",
    subtle: "#241d3a",
  },
  diff: {
    addedBg: "#8fd9c415",
    removedBg: "#e87ba815",
    addedLine: "#8fd9c4",
    removedLine: "#e87ba8",
    addedGutter: "#8fd9c435",
    removedGutter: "#e87ba835",
  },
};

/** 甘雨——[待校准] 月海亭：蓝紫马尾、金纹弯角、白蓝云纹连体衣 */
export const GANYU_PALETTE: PersonaPalette = {
  bg: {
    base: "#101420",     // 冷蓝暗
    surface: "#18203a",
    elevated: "#222c4c",
    overlay: "#2c385c",
  },
  primary: "#6b8fd4",     // 蓝紫
  primaryHover: "#8aa8e4",
  primaryMuted: "#6b8fd422",
  accent: "#e0c088",      // 金纹弯角
  warmth: "#f0ead8",      // 云纹白偏暖
  warmthMuted: "#f0ead822",
  semantic: {
    success: "#7bc0a8",
    error: "#e08a9c",
    warning: "#e0c088",
    info: "#8aa8e4",
  },
  text: {
    primary: "#eaeef5",
    secondary: "#bcc4d6",
    muted: "#838ba0",
    inverse: "#101420",
  },
  border: {
    default: "#303a5a",
    focus: "#6b8fd4",
    subtle: "#1d2540",
  },
  diff: {
    addedBg: "#7bc0a815",
    removedBg: "#e08a9c15",
    addedLine: "#7bc0a8",
    removedLine: "#e08a9c",
    addedGutter: "#7bc0a835",
    removedGutter: "#e08a9c35",
  },
};

/** 纳西妲——[待校准] 白绿发、翠绿眼、奶白裙 */
export const NAHIDA_PALETTE: PersonaPalette = {
  bg: {
    base: "#0f1614",     // 绿调暗
    surface: "#172420",
    elevated: "#20322c",
    overlay: "#2a4038",
  },
  primary: "#6dbb9c",     // 翠绿
  primaryHover: "#8cd4b6",
  primaryMuted: "#6dbb9c22",
  accent: "#a8d8b0",      // 嫩绿
  warmth: "#f5f0e0",      // 奶白
  warmthMuted: "#f5f0e022",
  semantic: {
    success: "#6dbb9c",
    error: "#e0a08a",
    warning: "#e0cc88",
    info: "#8cc4d4",
  },
  text: {
    primary: "#eaf2ec",
    secondary: "#bcccc0",
    muted: "#839088",
    inverse: "#0f1614",
  },
  border: {
    default: "#2e4238",
    focus: "#6dbb9c",
    subtle: "#1c2c26",
  },
  diff: {
    addedBg: "#6dbb9c15",
    removedBg: "#e0a08a15",
    addedLine: "#6dbb9c",
    removedLine: "#e0a08a",
    addedGutter: "#6dbb9c35",
    removedGutter: "#e0a08a35",
  },
};

/** 全部 persona 色板注册表 */
export const PRESENCE_PALETTES = {
  cyrene: CYRENE_PALETTE,
  ganyu: GANYU_PALETTE,
  nahida: NAHIDA_PALETTE,
} as const;

/** persona 标识符 */
export type PersonaId = keyof typeof PRESENCE_PALETTES;

/** 默认 persona —— 昔涟 */
export const DEFAULT_PERSONA: PersonaId = "cyrene";

/**
 * PRESENCE —— Desktop 默认色板（= 昔涟）。
 * 保留此导出以向后兼容既有引用；多角色场景请用 PRESENCE_PALETTES[persona]。
 */
export const PRESENCE = CYRENE_PALETTE;

// ─── 间距 ───────────────────────────────────────────────────

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

// ─── 圆角 ───────────────────────────────────────────────────

export const radius = {
  panel: 8,
  card: 6,
  button: 4,
  pill: 999,
} as const;

// ─── 字体 ───────────────────────────────────────────────────

export const font = {
  code: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  ui: "Inter, 'Noto Sans SC', system-ui, sans-serif",
  size: {
    xs: 11,
    sm: 12,
    md: 13,
    lg: 14,
    xl: 16,
    "2xl": 20,
    "3xl": 24,
  },
  lineHeight: {
    tight: 1.3,
    normal: 1.5,
    relaxed: 1.7,
  },
} as const;

// ─── 动效 ───────────────────────────────────────────────────

export const motion = {
  /** 流式文本：无动画 */
  stream: "none",
  /** 面板切换 */
  panel: "150ms ease-out",
  /** 状态变更 */
  status: "200ms ease",
  /** 弹窗/模态 */
  modal: "200ms cubic-bezier(0.16, 1, 0.3, 1)",
  /** Live2D 表情过渡（Desktop 专用） */
  expression: "300ms ease-in-out",
} as const;

// ─── 信息密度 ───────────────────────────────────────────────

export const density = {
  lineHeight: 1.5,
  panelGap: spacing.sm,
  sectionGap: spacing.lg,
  scrollbarWidth: 6,
} as const;

// ─── 类型导出 ───────────────────────────────────────────────

export type EngineeringPalette = typeof ENGINEERING;
export type PresencePalette = typeof PRESENCE;
export type Spacing = typeof spacing;
export type Radius = typeof radius;
export type Font = typeof font;
export type Motion = typeof motion;
