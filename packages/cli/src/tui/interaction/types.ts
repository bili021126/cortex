/**
 * tui/interaction/types.ts — 交互系统类型
 *
 * @module tui/interaction/types
 * @since v6
 */

// ─── 焦点区域 ─────────────────────────────

export type FocusZone = "input" | "chat" | "sidebar" | "statusbar" | "overlay";

// ─── 快捷键分类 ───────────────────────────

export type KeyCategory =
  | "navigation"
  | "action"
  | "view"
  | "agent"
  | "system";

// ─── 快捷键上下文 ─────────────────────────

export type KeyContext =
  | "global"
  | "input"
  | "chat"
  | "sidebar"
  | "modal";

// ─── 快捷键绑定 ───────────────────────────

export interface KeyBinding {
  /** 唯一标识 */
  id: string;
  /** 按键组合（如 'ctrl+k', 'g then i'） */
  key: string;
  /** 人类可读名称 */
  label: string;
  /** 分类 */
  category: KeyCategory;
  /** 处理函数 */
  handler: () => void | Promise<void>;
  /** 条件激活 */
  when?: () => boolean;
  /** 优先级（冲突时高优先级胜出） */
  priority?: number;
  /** 生效上下文 */
  context?: KeyContext;
  /** 描述 */
  description?: string;
}

// ─── 命令面板项 ───────────────────────────

export interface CommandPaletteItem {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  icon?: string;
  category: string;
  keywords: string[];
  action: () => void | Promise<void>;
}

// ─── 意图类型 ─────────────────────────────

export type IntentType =
  | "task"
  | "command"
  | "chat"
  | "mode-switch"
  | "agent-invoke"
  | "confirmation"
  | "navigation"
  | "ambiguous";

export interface IntentResult {
  type: IntentType;
  confidence: number;
  trace: ClassificationTrace[];
  params: {
    command?: string;
    args?: string[];
    agentId?: string;
    modeId?: string;
  };
  uiHint?: {
    showConfirmation?: boolean;
    suggestedLabel?: string;
  };
}

export interface ClassificationTrace {
  classifier: string;
  result: IntentType;
  confidence: number;
  reason: string;
}

export interface RouterContext {
  currentMode: string;
  currentAgent: string;
  focusZone: FocusZone;
  history: string[];
}
