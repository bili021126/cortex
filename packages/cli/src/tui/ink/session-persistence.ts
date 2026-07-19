/**
 * tui/ink/session-persistence.ts — Ink TUI 会话持久化适配层
 *
 * 桥接 session-store.ts 的 SessionSnapshot 与 Ink reducer 的 SessionState。
 * 提供启动加载、自动保存（debounce）、退出保存。
 *
 * @module tui/ink/session-persistence
 * @since v5 — Ink 重构 Phase 3
 */

import type { LlmMessage } from "@cortex/shared";
import { loadSession, saveSession, clearSession } from "../session-store.js";
import type { SessionMessage, SessionState } from "./session-reducer.js";

/** 自动保存 debounce 间隔(ms) */
const AUTOSAVE_INTERVAL_MS = 1000;

/**
 * 将 SessionState 的消息转换为 LlmMessage[]（用于持久化）。
 * 只保留 user/assistant 消息，丢弃 system 消息（system prompt 由 queryLoop 重新注入）。
 */
export function stateToHistory(state: SessionState): LlmMessage[] {
  return state.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * 将 LlmMessage[] 转换为 SessionMessage[]（用于恢复）。
 */
export function historyToMessages(history: LlmMessage[]): SessionMessage[] {
  return history
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
    .map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content }));
}

/**
 * 从磁盘加载会话，返回 reducer 可用的 RESTORE_SESSION payload。
 * @returns { agent, messages } 或 null（无持久化会话）
 */
export function loadInkSession(projectRoot: string): { agent: SessionState["agent"]; messages: SessionMessage[] } | null {
  const snapshot = loadSession(projectRoot);
  if (!snapshot) return null;
  return {
    agent: snapshot.agent,
    messages: historyToMessages(snapshot.history),
  };
}

/**
 * 保存当前会话到磁盘。
 */
export function saveInkSession(projectRoot: string, state: SessionState): void {
  saveSession(projectRoot, {
    agent: state.agent,
    history: stateToHistory(state),
    groups: [], // Ink TUI Phase 3A 暂不持久化群聊
    talkTrio: false,
  });
}

/**
 * 创建自动保存控制器。
 * 每次调用 touch() 重置 debounce 计时器，间隔后自动保存。
 * 返回 { touch, flush, destroy }。
 */
export function createAutoSaver(
  projectRoot: string,
  getState: () => SessionState,
): { touch: () => void; flush: () => void; destroy: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const doSave = () => {
    saveInkSession(projectRoot, getState());
  };

  return {
    touch() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(doSave, AUTOSAVE_INTERVAL_MS);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      doSave();
    },
    destroy() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

export { clearSession };
