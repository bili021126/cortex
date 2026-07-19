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
    primary: "#48C78E",
    primaryDim: "#2D8B61",
    accent: "#F5C842",
    background: "#1A1B26",
    surface: "#24253A",
    surfaceElevated: "#2F3050",
    text: {
      primary: "#C0CAF5",
      secondary: "#565F89",
      muted: "#3B4261",
      inverse: "#1A1B26",
    },
    semantic: {
      success: "#73DACA",
      warning: "#E0AF68",
      error: "#F7768E",
      info: "#7DCFFF",
    },
    status: {
      thinking: "#7DCFFF",
      executing: "#E0AF68",
      waiting: "#565F89",
      error: "#F7768E",
      complete: "#73DACA",
    },
    risk: {
      low: "#73DACA",
      medium: "#E0AF68",
      high: "#F7768E",
    },
    border: {
      default: "#48C78E",
      focus: "#F5C842",
      subtle: "#3B4261",
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
