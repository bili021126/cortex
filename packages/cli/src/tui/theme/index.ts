/**
 * tui/theme/index.ts — 主题系统统一导出
 *
 * @module tui/theme
 * @since v6
 */

// ─── 核心令牌 ─────────────────────────────
export type {
  DesignTokens,
  ColorTokens,
  SpacingTokens,
  BorderTokens,
  TypographyTokens,
  MotionTokens,
  BorderStyle,
} from "./tokens.js";
export { defaultTokens } from "./tokens.js";

// ─── 色板 ─────────────────────────────────
export { PALETTE, GRADIENTS, hexToRgb, rgbToHex, lerpColor, tokenHeatColor } from "./palette.js";

// ─── 角色主题 ──────────────────────────────
export type { CharacterTheme } from "./character-theme.js";
export {
  CHARACTER_THEMES,
  DEFAULT_THEME,
  getCharacterTheme,
  getCharacterColor,
  getAllCharacterThemes,
} from "./character-theme.js";

// ─── 边框字符 ──────────────────────────────
export type { BorderChars } from "./border-chars.js";
export {
  BORDER_CHARS,
  SEPARATOR_CHARS,
  horizontalLine,
  titledTopBorder,
  emptyBox,
} from "./border-chars.js";

// ─── 动效 ─────────────────────────────────
export type { AnimationPreset } from "./motion.js";
export {
  linear,
  easeIn,
  easeOut,
  easeInOut,
  getEasingFrames,
  createPreset,
  SPINNER_DOTS,
  SPINNER_BOUNCE,
  SPINNER_CLOVER,
  SPINNER_PULSE,
  SPINNER_SCAN,
  PRESET_FADE_IN_FAST,
  PRESET_FADE_IN_NORMAL,
  PRESET_SLIDE_IN,
  PRESET_MODE_SWITCH,
  PRESET_DRAMATIC,
} from "./motion.js";

// ─── ANSI 适配器（v4） ────────────────────
export type { AnsiThemeAdapter } from "./adapter-ansi.js";
export {
  createAnsiAdapter,
  ansiTheme,
  fg24,
  bg24,
  RESET,
  BOLD,
  DIM,
  ITALIC,
  UNDERLINE,
  STRIKETHROUGH,
} from "./adapter-ansi.js";

// ─── Ink 适配器（v5） ─────────────────────
export type { InkThemeAdapter, InkTextStyle, InkBoxStyle } from "./adapter-ink.js";
export { createInkAdapter, inkTheme } from "./adapter-ink.js";
