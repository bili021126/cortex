/**
 * tui/theme/tokens.ts — 核心设计令牌定义
 *
 * 零依赖纯数据层。v4 (ANSI) 和 v5 (Ink) 共享同一份 token，
 * 各自通过 adapter-ansi.ts / adapter-ink.ts 消费。
 *
 * @module tui/theme/tokens
 * @since v6 — TUI 统一重构
 */

// ─── 色彩令牌 ─────────────────────────────────

export interface ColorTokens {
  /** 品牌主色（昔涟翡翠绿） */
  primary: string;
  /** 主色暗调 */
  primaryDim: string;
  /** 品牌点缀色（金色） */
  accent: string;
  /** 深色背景 */
  background: string;
  /** 面板底色 */
  surface: string;
  /** 浮层底色 */
  surfaceElevated: string;
  /** 文本色阶 */
  text: {
    primary: string;
    secondary: string;
    muted: string;
    inverse: string;
  };
  /** 语义色 */
  semantic: {
    success: string;
    warning: string;
    error: string;
    info: string;
  };
  /** 状态色 */
  status: {
    thinking: string;
    executing: string;
    waiting: string;
    error: string;
    complete: string;
  };
  /** 权限风险等级 */
  risk: {
    low: string;
    medium: string;
    high: string;
  };
  /** 边框色 */
  border: {
    default: string;
    focus: string;
    subtle: string;
  };
}

// ─── 间距令牌 ─────────────────────────────────

export interface SpacingTokens {
  /** 0.5 字符宽 */
  xxs: number;
  /** 1 字符宽 */
  xs: number;
  /** 2 字符宽 */
  sm: number;
  /** 4 字符宽 */
  md: number;
  /** 6 字符宽 */
  lg: number;
  /** 8 字符宽 */
  xl: number;
}

// ─── 边框令牌 ─────────────────────────────────

export type BorderStyle = "single" | "rounded" | "double" | "bold" | "block" | "xilian";

export interface BorderTokens {
  /** 默认边框风格 */
  defaultStyle: BorderStyle;
  /** 聚焦时边框风格 */
  focusStyle: BorderStyle;
  /** 默认边框色 */
  defaultColor: string;
  /** 聚焦边框色 */
  focusColor: string;
}

// ─── 排版令牌 ─────────────────────────────────

export interface TypographyTokens {
  /** 模式标签映射 */
  modeLabels: Record<string, string>;
  /** 消息前缀 */
  messagePrefix: {
    user: string;
    assistant: string;
    system: string;
  };
  /** 流式光标字符 */
  streamingCursor: string;
}

// ─── 动效令牌 ─────────────────────────────────

export interface MotionTokens {
  /** 时长 (ms) */
  duration: {
    /** 即时反馈 50ms */
    instant: number;
    /** 快速过渡 100ms */
    fast: number;
    /** 标准过渡 200ms */
    normal: number;
    /** 慢速过渡 400ms */
    slow: number;
    /** 戏剧性过渡 800ms */
    dramatic: number;
  };
  /** 打字机速度 (字符/帧) */
  typewriterSpeed: {
    fast: number;
    normal: number;
    slow: number;
  };
  /** 帧率上限 */
  maxFps: number;
}

// ─── 聚合接口 ─────────────────────────────────

export interface DesignTokens {
  color: ColorTokens;
  spacing: SpacingTokens;
  border: BorderTokens;
  typography: TypographyTokens;
  motion: MotionTokens;
}

// ─── 默认值（昔涟主题） ───────────────────────

export const defaultTokens: DesignTokens = {
  color: {
    // 原神+崩铁：星轨蓝主色 + 元素金点缀 + 深空蓝紫背景（米哈游视觉语言）
    primary: "#5B8DEF",
    primaryDim: "#3D6BC4",
    accent: "#F0C75E",
    background: "#0F1524",
    surface: "#1A2340",
    surfaceElevated: "#232E52",
    text: {
      primary: "#DCE4F7",
      secondary: "#8B96B8",
      muted: "#4A5678",
      inverse: "#0F1524",
    },
    semantic: {
      success: "#4FBF9F",
      warning: "#E8B84B",
      error: "#E05C6B",
      info: "#6FB6F0",
    },
    status: {
      thinking: "#6FB6F0",
      executing: "#E8B84B",
      waiting: "#8B96B8",
      error: "#E05C6B",
      complete: "#4FBF9F",
    },
    risk: {
      low: "#4FBF9F",
      medium: "#E8B84B",
      high: "#E05C6B",
    },
    border: {
      default: "#5B8DEF",
      focus: "#F0C75E",
      subtle: "#2A3558",
    },
  },
  spacing: {
    xxs: 0,
    xs: 1,
    sm: 2,
    md: 4,
    lg: 6,
    xl: 8,
  },
  border: {
    defaultStyle: "rounded",
    focusStyle: "bold",
    defaultColor: "#48C78E",
    focusColor: "#F5C842",
  },
  typography: {
    modeLabels: {
      chat: "✨ 智能",
      talk: "🗣 闲聊",
      plan: "📋 规划",
      group: "👥 群聊",
      command: "⌨ 命令",
    },
    messagePrefix: {
      user: "🧑 你",
      assistant: "🍀 昔涟",
      system: "⚙️ 系统",
    },
    streamingCursor: "▌",
  },
  motion: {
    duration: {
      instant: 50,
      fast: 100,
      normal: 200,
      slow: 400,
      dramatic: 800,
    },
    typewriterSpeed: {
      fast: 3,
      normal: 2,
      slow: 1,
    },
    maxFps: 15,
  },
};
