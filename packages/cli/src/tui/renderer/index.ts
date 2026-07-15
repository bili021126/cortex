/**
 * tui/renderer/index.ts — 渲染器 barrel 导出
 *
 * 统一导出所有渲染器组件。
 *
 * @module tui/renderer
 * @since v3 — Core-3 差分渲染
 */

export { ChatLog, chatLog } from "./chat-log.js";
export { SigintHandler } from "./sigint-handler.js";
export { sanitizeRenderableText } from "./sanitize.js";
export { PersonaHeader, personaHeader } from "./persona-header.js";
