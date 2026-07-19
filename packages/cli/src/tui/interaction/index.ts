/**
 * tui/interaction/index.ts — 交互系统统一导出
 *
 * @module tui/interaction
 * @since v6
 */

// ─── 类型 ─────────────────────────────────
export type {
  FocusZone,
  KeyCategory,
  KeyContext,
  KeyBinding,
  CommandPaletteItem,
  IntentType,
  IntentResult,
  ClassificationTrace,
  RouterContext,
} from "./types.js";

// ─── 快捷键 ──────────────────────────────
export { KeyRegistry } from "./key-registry.js";
export { createDefaultBindings, PERMISSION_BINDINGS } from "./key-bindings.js";
export type { BindingCallbacks } from "./key-bindings.js";

// ─── 焦点管理 ────────────────────────────
export { FocusManager } from "./focus-manager.js";

// ─── 命令面板 ────────────────────────────
export { CommandPaletteController } from "./command-palette.js";

// ─── Hooks ────────────────────────────────
export { useKeybinding, useKeyBinding } from "./hooks/use-keybinding.js";
export { useFocus, useFocusActions } from "./hooks/use-focus.js";
