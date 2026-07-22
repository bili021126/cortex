/**
 * @cortex/protocol — 客户端-engine 通信协议
 *
 * 纯类型 + 轻量校验，零运行时依赖。
 * 三端（TUI / WebUI / Desktop）与 engine daemon 之间的唯一契约。
 *
 * @layer L0 — 无内部依赖
 */

// ─── 核心结构 ─────────────────────────────────────────
export * from "./envelope.js";
export * from "./problem-details.js";
export * from "./version.js";
export * from "./validation.js";

// ─── REST 资源类型 ────────────────────────────────────
export * from "./rest/index.js";

// ─── WebSocket 协议 ───────────────────────────────────
export * from "./ws/index.js";
