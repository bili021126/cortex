/**
 * @cortex/design-tokens — 三端共享设计常量
 *
 * ENGINEERING palette: CLI / WebUI（冷色工程界面）
 * PRESENCE palette:    Desktop（暖色陪伴界面）
 *
 * @layer L0 — 无内部依赖
 */

export {
  ENGINEERING,
  PRESENCE,
  PRESENCE_PALETTES,
  CYRENE_PALETTE,
  GANYU_PALETTE,
  NAHIDA_PALETTE,
  DEFAULT_PERSONA,
  spacing,
  radius,
  font,
  motion,
  density,
} from "./tokens.js";

export type {
  EngineeringPalette,
  PresencePalette,
  PersonaPalette,
  PersonaId,
  Spacing,
  Radius,
  Font,
  Motion,
} from "./tokens.js";

export {
  generateCssVariables,
  generateFullStylesheet,
} from "./css-variables.js";

export { inkTheme } from "./ink-theme.js";
export type { InkTheme } from "./ink-theme.js";
