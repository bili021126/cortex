/**
 * tui/interaction/hooks/use-keybinding.ts — Ink 快捷键 hook
 *
 * @module tui/interaction/hooks/use-keybinding
 * @since v6
 */

import { useInput } from "ink";
import type { Key } from "ink";
import { useEffect, useRef } from "react";
import type { KeyRegistry } from "../key-registry.js";
import type { FocusManager } from "../focus-manager.js";
import type { KeyContext } from "../types.js";

/**
 * 将 Ink 的 useInput 输入转换为 KeyRegistry 可处理的格式
 */
function inkKeyToString(input: string, key: Key): string | null {
  if (key.ctrl) {
    return `ctrl+${input.toLowerCase()}`;
  }
  if (key.meta) {
    return `meta+${input.toLowerCase()}`;
  }
  if (key.return) {
    return "return";
  }
  if (key.escape) {
    return "escape";
  }
  if (key.tab) {
    return "tab";
  }
  if (key.backspace || key.delete) {
    return "backspace";
  }
  if (key.upArrow) return "up";
  if (key.downArrow) return "down";
  if (key.leftArrow) return "left";
  if (key.rightArrow) return "right";
  if (key.pageUp) return "pageup";
  if (key.pageDown) return "pagedown";

  // 普通字符
  if (input?.length === 1) {
    return input.toLowerCase();
  }

  return null;
}

/**
 * 快捷键绑定 hook
 * 将 KeyRegistry 和 FocusManager 连接到 Ink 的输入系统
 */
export function useKeybinding(
  registry: KeyRegistry,
  focusManager: FocusManager,
): void {
  useInput((input, key) => {
    const keyStr = inkKeyToString(input, key);
    if (!keyStr) return;

    const context = focusManager.getCurrent() as KeyContext;
    registry.handleKeyPress(keyStr, context);
  });
}

/**
 * 注册单个快捷键的 hook
 */
export function useKeyBinding(
  registry: KeyRegistry,
  id: string,
  key: string,
  label: string,
  handler: () => void,
  context?: KeyContext,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unregister = registry.register({
      id,
      key,
      label,
      category: "action",
      handler: () => handlerRef.current(),
      context,
    });
    return unregister;
  }, [registry, id, key, label, context]);
}
