/**
 * @cortex/design-tokens — CSS Variables 生成器
 *
 * 将 ENGINEERING / PRESENCE palette 转为 CSS custom properties（`--cx-*`）。
 *
 * ── 消费现状：**当前零消费方**（2026-09-26 核实，勿按旧注释行事）──────
 *
 * 本文件此前写着「供 WebUI (Tailwind / vanilla CSS) 和 Desktop (Electron renderer) 使用」，
 * 两者**都不存在**：
 *   · 全仓没有 WebUI，也没有 `packages/webui`——只有 `docs/core/webui-architecture-design.md`
 *     与 `webui-role-assignment.md` 两份设计稿，**设计已写、未落地**；
 *   · Desktop 用的是另一套变量：`packages/desktop/src/renderer/ui/tokens.css` 的 `--rb-*`
 *     （62 项，权威值在 tokens.ts 的 `CHAT_PALETTE`，由 desktop 侧的一致性测试守护）。
 *
 * 实测：`--cx-*` 只在**本文件内**出现；`generateCssVariables` / `generateFullStylesheet`
 * 无任何包外引用（`npx tsx scripts/audit-unconsumed.ts design-tokens`）。
 *
 * 所以这里是**为规划中的 WebUI 预留的发射端**，不是现役链路。两种去向由人定：
 * 接上真实消费方，或按「预留」明确标注（本注释即后者），或删除。
 * 在落地之前，任何 token 改动都不需要为它保持同步——但本包自己的契约测试会覆盖它。
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
 *
 * 同样**当前零消费方**（见文件头）。另注：`PRESENCE` 就是 `CYRENE_PALETTE`，
 * 所以 `[data-theme='presence']` 块与 `[data-theme='presence'][data-persona='cyrene']`
 * 块内容完全相同——默认 persona 的覆盖块是冗余的，不是 bug 但可省。
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
