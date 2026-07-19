/**
 * tui/interaction/hooks/use-focus.ts — 焦点管理 hook
 *
 * @module tui/interaction/hooks/use-focus
 * @since v6
 */

import { useState, useEffect, useCallback } from "react";
import type { FocusManager } from "../focus-manager.js";
import type { FocusZone } from "../types.js";

/**
 * 焦点管理 hook
 * 订阅焦点变化并返回当前焦点区域
 */
export function useFocus(focusManager: FocusManager): FocusZone {
  const [current, setCurrent] = useState<FocusZone>(focusManager.getCurrent());

  useEffect(() => {
    const unsub = focusManager.onFocusChange((_from, to) => {
      setCurrent(to);
    });
    return unsub;
  }, [focusManager]);

  return current;
}

/**
 * 焦点操作 hook
 * 提供便捷的焦点操作方法
 */
export function useFocusActions(focusManager: FocusManager) {
  const focusInput = useCallback(() => focusManager.focus("input"), [focusManager]);
  const focusChat = useCallback(() => focusManager.focus("chat"), [focusManager]);
  const focusSidebar = useCallback(() => focusManager.focus("sidebar"), [focusManager]);
  const pushOverlay = useCallback(
    (zone: FocusZone) => focusManager.pushOverlay(zone),
    [focusManager],
  );
  const popOverlay = useCallback(() => focusManager.popOverlay(), [focusManager]);

  return {
    focusInput,
    focusChat,
    focusSidebar,
    pushOverlay,
    popOverlay,
    hasOverlay: focusManager.hasOverlay(),
  };
}
