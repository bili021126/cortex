/**
 * tui/renderer/index.ts — 渲染器 barrel 导出
 *
 * 统一导出所有渲染器组件。
 *
 * @module tui/renderer
 * @since v3 — Core-3 差分渲染
 */

export { DiffRenderer, diffRenderer } from "./diff-renderer.js";
export { ChatLog, chatLog } from "./chat-log.js";
export { StatusBar, statusBar } from "./status-bar.js";
export { ToolCard, toolCard } from "./tool-card.js";
export { SigintHandler } from "./sigint-handler.js";
export { sanitizeRenderableText } from "./sanitize.js";
export { OverlayManager, overlay } from "./overlay.js";
export { Footer, footer } from "./footer.js";
export { Layout, layout } from "./layout.js";
export type { TuiComponent } from "./diff-renderer.js";
