/**
 * tui/interaction/key-bindings.ts — 默认键位绑定（工厂模式）
 *
 * 绑定模板通过 BindingCallbacks 注入真实 handler，
 * 使快捷键能访问 React dispatch / state / 交互系统实例。
 *
 * @module tui/interaction/key-bindings
 * @since v6 — 从静态常量改为工厂函数
 */

import type { KeyBinding } from "./types.js";

/**
 * 绑定回调接口——由 app.tsx 提供真实实现
 */
export interface BindingCallbacks {
  toggleCommandPalette: () => void;
  toggleSidebar: () => void;
  toggleHelp: () => void;
  focusInput: () => void;
  scrollUp: () => void;
  scrollDown: () => void;
  switchAgentNext: () => void;
  switchAgentPrev: () => void;
  togglePlanMode: () => void;
  panelNext: () => void;
  panelPrev: () => void;
}

/**
 * 创建默认键位绑定（带真实 handler）
 */
export function createDefaultBindings(cb: BindingCallbacks): KeyBinding[] {
  return [
    // ── 全局导航 ──────────────────────────
    {
      id: "command-palette",
      key: "ctrl+k",
      label: "命令面板",
      description: "打开命令面板，快速搜索和执行命令",
      category: "navigation",
      handler: cb.toggleCommandPalette,
      context: "global",
    },
    {
      id: "toggle-sidebar",
      key: "ctrl+b",
      label: "切换侧边栏",
      description: "显示/隐藏侧边栏面板",
      category: "view",
      handler: cb.toggleSidebar,
      context: "global",
    },
    {
      id: "help",
      key: "?",
      label: "显示帮助",
      description: "显示快捷键帮助面板",
      category: "system",
      handler: cb.toggleHelp,
      context: "global",
    },

    // ── 聊天区导航 ────────────────────────
    {
      id: "focus-input",
      key: "i",
      label: "聚焦输入框",
      description: "将焦点切换到输入框",
      category: "navigation",
      handler: cb.focusInput,
      context: "chat",
    },
    {
      id: "scroll-up",
      key: "ctrl+u",
      label: "向上翻页",
      description: "向上滚动聊天内容",
      category: "navigation",
      handler: cb.scrollUp,
      context: "chat",
    },
    {
      id: "scroll-down",
      key: "ctrl+d",
      label: "向下翻页",
      description: "向下滚动聊天内容",
      category: "navigation",
      handler: cb.scrollDown,
      context: "chat",
    },

    // ── Agent 切换 ────────────────────────
    {
      id: "switch-agent-next",
      key: "ctrl+]",
      label: "下一个 Agent",
      description: "切换到下一个 Agent",
      category: "agent",
      handler: cb.switchAgentNext,
      context: "global",
    },
    {
      id: "switch-agent-prev",
      key: "ctrl+[",
      label: "上一个 Agent",
      description: "切换到上一个 Agent",
      category: "agent",
      handler: cb.switchAgentPrev,
      context: "global",
    },

    // ── 模式切换 ──────────────────────────
    {
      id: "mode-plan",
      key: "ctrl+p",
      label: "规划模式",
      description: "切换到规划模式",
      category: "action",
      handler: cb.togglePlanMode,
      context: "global",
    },

    // ── 面板导航（Lazygit 风格） ──────────
    {
      id: "panel-next",
      key: "}",
      label: "下一个面板",
      description: "切换到下一个面板",
      category: "navigation",
      handler: cb.panelNext,
      context: "global",
    },
    {
      id: "panel-prev",
      key: "{",
      label: "上一个面板",
      description: "切换到上一个面板",
      category: "navigation",
      handler: cb.panelPrev,
      context: "global",
    },
  ];
}

/**
 * 权限对话框专用键位（仍为模板——handler 由 permission-prompt 直接 useInput 处理）
 */
export const PERMISSION_BINDINGS: KeyBinding[] = [
  {
    id: "perm-approve",
    key: "return",
    label: "批准",
    description: "批准一次",
    category: "action",
    handler: () => {},
    context: "modal",
    priority: 10,
  },
  {
    id: "perm-approve-all",
    key: "a",
    label: "全部批准",
    description: "批准所有后续请求",
    category: "action",
    handler: () => {},
    context: "modal",
    priority: 10,
  },
  {
    id: "perm-deny",
    key: "n",
    label: "拒绝",
    description: "拒绝此操作",
    category: "action",
    handler: () => {},
    context: "modal",
    priority: 10,
  },
  {
    id: "perm-skip",
    key: "s",
    label: "跳过",
    description: "跳过此工具调用",
    category: "action",
    handler: () => {},
    context: "modal",
    priority: 10,
  },
];
