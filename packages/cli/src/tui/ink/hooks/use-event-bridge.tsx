/**
 * tui/ink/hooks/use-event-bridge.ts — 事件桥接 hook
 *
 * 将 TuiEventBus 的 pub/sub 事件转化为 React reducer dispatch。
 * 组件挂载时订阅，卸载时自动取消。
 *
 * @module tui/ink/hooks/use-event-bridge
 * @since v5 — Ink 重构 Phase 1 → Phase 3
 */

import { useEffect } from "react";
import { tuiEventBus } from "../../event-bus.js";
import type { SessionAction } from "../session-reducer.js";
import type {
  TuiToolStartEvent,
  TuiToolResultEvent,
  TuiTokenUsageEvent,
  TuiCompactionEvent,
  TuiPlanGeneratedEvent,
  TuiTaskTreeUpdateEvent,
  TuiNodeStartEvent,
  TuiNodeCompleteEvent,
  TuiNodeFailedEvent,
} from "../../types.js";

export function useEventBridge(dispatch: React.Dispatch<SessionAction>): void {
  useEffect(() => {
    const unsubs = [
      // 工具调用
      tuiEventBus.on("tool_start", (e) =>
        dispatch({ type: "TOOL_START", payload: e as TuiToolStartEvent }),
      ),
      tuiEventBus.on("tool_result", (e) =>
        dispatch({ type: "TOOL_RESULT", payload: e as TuiToolResultEvent }),
      ),
      // LLM 流式输出
      tuiEventBus.on("llm_chunk", (e) => {
        const ev = e as { content?: string };
        if (ev.content) dispatch({ type: "STREAM_CHUNK", payload: ev.content });
      }),
      // Token / 压缩
      tuiEventBus.on("token_usage", (e) =>
        dispatch({ type: "TOKEN_UPDATE", payload: e as TuiTokenUsageEvent }),
      ),
      tuiEventBus.on("compaction", (e) =>
        dispatch({ type: "COMPACTION", payload: e as TuiCompactionEvent }),
      ),
      // Plan 模式
      tuiEventBus.on("plan_generated", (e) =>
        dispatch({ type: "PLAN_GENERATED", payload: e as TuiPlanGeneratedEvent }),
      ),
      tuiEventBus.on("task_tree_update", (e) =>
        dispatch({ type: "TASK_TREE_UPDATE", payload: e as TuiTaskTreeUpdateEvent }),
      ),
      // 节点生命周期
      tuiEventBus.on("node_start", (e) =>
        dispatch({ type: "NODE_START", payload: e as TuiNodeStartEvent }),
      ),
      tuiEventBus.on("node_complete", (e) =>
        dispatch({ type: "NODE_COMPLETE", payload: e as TuiNodeCompleteEvent }),
      ),
      tuiEventBus.on("node_failed", (e) =>
        dispatch({ type: "NODE_FAILED", payload: e as TuiNodeFailedEvent }),
      ),
      // 回合中断（Esc）——query-loop yield 的 interrupted 事件→复位处理态
      tuiEventBus.on("interrupted", () =>
        dispatch({ type: "TURN_INTERRUPTED" }),
      ),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [dispatch]);
}
