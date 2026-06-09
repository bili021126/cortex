/**
 * tui/hooks.ts — 生命周期钩子默认实现
 *
 * 提供 PreToolUse / PostToolUse 的默认实现，各 mode 可按需覆盖。
 *
 * @module tui/hooks
 * @since v3 — CLI TUI 全栈重构
 */

import type { TuiHooks, TuiToolStartEvent, TuiToolResultEvent } from "./types.js";
import { reversibilityLevel } from "./renderer/permission-dialog.js";

/**
 * 默认钩子：L1 读操作自动放行，L2/L3 由 Toolkit 内置 ConfirmGate 接管。
 *
 * onPreToolUse 是执行前预检——决定是否允许进入工具执行管道。
 * 真正的用户确认由 Toolkit → ConfirmGate → PlatformBridge 链路处理。
 */
export const defaultHooks: TuiHooks = {
  onPreToolUse: async (event: TuiToolStartEvent): Promise<"allow" | "deny" | "skip"> => {
    const level = reversibilityLevel(event.tool);
    if (level === 1) return "allow"; // L1 读操作：放行，信任模型在 ConfirmGate 层动态判定
    // L2/L3 不可逆操作：放行进入 Toolkit 管道，由 ConfirmGate 做用户确认
    // （Toolkit.setGate() 已在 bootstrap 阶段注入真实 ConfirmGate）
    return "allow";
  },

  onPostToolUse: async (_event: TuiToolResultEvent): Promise<void> => {
    // 默认：记录审计日志
  },

  onChunk: (_event) => {
    // 默认：由 TUI 渲染层处理
  },
};

/**
 * Talk 模式钩子：禁止所有工具调用。
 */
export const talkHooks: TuiHooks = {
  ...defaultHooks,
  onPreToolUse: async (): Promise<"allow" | "deny" | "skip"> => {
    return "deny";
  },
};

/**
 * Party 模式钩子：禁止所有工具调用。
 */
export const partyHooks: TuiHooks = {
  ...defaultHooks,
  onPreToolUse: async (): Promise<"allow" | "deny" | "skip"> => {
    return "deny";
  },
};
