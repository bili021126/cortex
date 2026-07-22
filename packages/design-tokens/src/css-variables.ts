/**
 * @cortex/design-tokens — CSS Variables 生成器
 *
 * 将 ENGINEERING / PRESENCE palette 转为 CSS custom properties，
 * 供 WebUI (Tailwind / vanilla CSS) 和 Desktop (Electron renderer) 使用。
 */

import { ENGINEERING, PRESENCE, PRESENCE_PALETTES, spacing, radius, font, motion } from "./tokens.js";
import type { PersonaPalette } from "./tokens.js";

type Palette = typeof ENGINEERING | PersonaPalette;

function flattenPalette(obj: Record<string, unknown>, prefix: string): [string, string][] {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(obj)) {
    const varName = `${prefix}-${key}`;
    if (typeof value === "string") {
      entries.push([varName, value]);
    } else if (typeof value === "object" && value !== null) {
      entries.push(...flattenPalette(value as Record<string, unknown>, varName));
    }
  }
  return entries;
}

/**
 * 生成 CSS custom properties 字符串。
 *
 * @param palette - ENGINEERING 或 PRESENCE
 * @param selector - CSS 选择器，默认 ":root"
 *
 * @example
 * ```ts
 * generateCssVariables(ENGINEERING); // ":root { --cx-bg-base: #0f0f14; ... }"
 * generateCssVariables(PRESENCE, "[data-theme='presence']");
 * ```
 */
export function generateCssVariables(
  palette: Palette,
  selector = ":root",
): string {
  const colorVars = flattenPalette(palette as unknown as Record<string, unknown>, "--cx");

  const layoutVars: [string, string][] = [
    ...Object.entries(spacing).map(([k, v]) => [`--cx-space-${k}`, `${v}px`] as [string, string]),
    ...Object.entries(radius).map(([k, v]) => [`--cx-radius-${k}`, `${v}px`] as [string, string]),
    ...Object.entries(font.size).map(([k, v]) => [`--cx-font-size-${k}`, `${v}px`] as [string, string]),
    ["--cx-font-code", font.code],
    ["--cx-font-ui", font.ui],
    ["--cx-motion-panel", motion.panel],
    ["--cx-motion-status", motion.status],
    ["--cx-motion-modal", motion.modal],
  ];

  const allVars = [...colorVars, ...layoutVars];
  const body = allVars.map(([name, value]) => `  ${name}: ${value};`).join("\n");
  return `${selector} {\n${body}\n}`;
}

/**
 * 生成完整的 :root + [data-theme] 样式表。
 * 默认主题为 ENGINEERING，PRESENCE（= 昔涟）通过 data-theme="presence" 激活。
 * 每个 persona 额外生成 [data-theme='presence'][data-persona='<id>'] 覆盖块。
 */
export function generateFullStylesheet(): string {
  const engineering = generateCssVariables(ENGINEERING, ":root");
  const presence = generateCssVariables(PRESENCE, "[data-theme='presence']");
  const personas = Object.entries(PRESENCE_PALETTES)
    .map(([id, palette]) =>
      generateCssVariables(palette, `[data-theme='presence'][data-persona='${id}']`),
    )
    .join("\n\n");
  return `${engineering}\n\n${presence}\n\n${personas}\n`;
}
