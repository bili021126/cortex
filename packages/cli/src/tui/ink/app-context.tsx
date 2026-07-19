/**
 * tui/ink/app-context.tsx — 全局 React Context
 *
 * 提供 session dispatch、bridge、registry 等贯穿整棵组件树的能力。
 * 子组件通过 useSessionDispatch / useAppContext 消费。
 *
 * @module tui/ink/app-context
 * @since v5 — Ink 重构 Phase 1
 */

import { createContext, useContext } from "react";
import type { ITuiEngineBridge, ICommandDispatcher, ICommandContext } from "@cortex/shared";
import type { SessionAction } from "./session-reducer.js";

// ─── Context 形状 ──────────────────────────────

export interface AppContextValue {
  dispatch: React.Dispatch<SessionAction>;
  bridge: ITuiEngineBridge;
  registry: ICommandDispatcher;
  registryCtx?: ICommandContext;
  projectRoot: string;
}

export const AppContext = createContext<AppContextValue | null>(null);

// ─── 类型守卫 hook ──────────────────────────────

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within <App>");
  return ctx;
}

// ─── 快捷 dispatch hook ───────────────────────

export function useSessionDispatch(): React.Dispatch<SessionAction> {
  return useAppContext().dispatch;
}
