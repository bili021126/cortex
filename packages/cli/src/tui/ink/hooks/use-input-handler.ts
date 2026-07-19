/**
 * tui/ink/hooks/use-input-handler.ts — 用户输入分发 hook
 *
 * 从 app.tsx 抽离的输入处理链：
 *   内部命令(.help/.agent/...) → 命令意图(registry.dispatch) →
 *   Plan 审批 → 意图分类 → task(planMode) / chat(queryLoop)。
 *
 * 与 ansi tui-repl 的 dispatchInput 保持行为对称。
 *
 * @module tui/ink/hooks/use-input-handler
 * @since v6 — 从 app.tsx 抽离（降函数复杂度 + 纳入 lint）
 */

import { useCallback } from "react";
import type { Dispatch } from "react";
import type {
  LlmMessage,
  ITuiEngineBridge,
  ICommandDispatcher,
  ICommandContext,
} from "@cortex/shared";
import { classifyIntent, parseAgentFromInput } from "../../intent-router.js";
import { queryLoop } from "../../query-loop.js";
import { planMode } from "../../modes/plan-mode.js";
import { commandMode } from "../../modes/command-mode.js";
import { tuiEventBus } from "../../event-bus.js";
import type { TuiEvent, TuiHooks } from "../../types.js";
import { handleCommand } from "../commands.js";
import type { SessionState, SessionAction } from "../session-reducer.js";

/** useInputHandler 入参 */
export interface UseInputHandlerParams {
  /** 只读引用当前会话状态（避免闭包捕获过期值） */
  stateRef: { readonly current: SessionState };
  dispatch: Dispatch<SessionAction>;
  projectRoot: string;
  requestExit: () => void;
  bridge: ITuiEngineBridge;
  registry: ICommandDispatcher;
  registryCtx?: ICommandContext;
  /** 创建注入 chatMode/planMode 的权限确认 hooks */
  createExternalHooks: () => Partial<TuiHooks>;
}

/**
 * 构建输入分发回调。
 * @returns 处理单次用户输入的异步函数
 */
export function useInputHandler(
  params: UseInputHandlerParams,
): (input: string) => Promise<void> {
  const {
    stateRef,
    dispatch,
    projectRoot,
    requestExit,
    bridge,
    registry,
    registryCtx,
    createExternalHooks,
  } = params;

  return useCallback(
    async (input: string) => {
      if (!input.trim()) return;
      const currentState = stateRef.current;
      if (currentState.isProcessing) return;

      // 0. 内部命令（. 前缀 UI 命令）
      const cmdResult = handleCommand(input, currentState, dispatch, projectRoot, requestExit);
      if (cmdResult.handled) return;

      // 0.5 命令意图 → registry.dispatch（与 ansi dispatchInput 对称，15 个 CLI 命令全通）
      if (classifyIntent(input) === "command") {
        dispatch({ type: "ADD_MESSAGE", payload: { role: "user", content: input } });
        const output = await commandMode(
          (args) => registry.dispatch(args, registryCtx),
          input.trim().split(/\s+/),
        );
        dispatch({ type: "ADD_MESSAGE", payload: { role: "system", content: output } });
        return;
      }

      // 1. Plan 审批
      if (currentState.planState === "reviewing") {
        const approvalWords = /^(好的|执行|确认|可以|行|开始|跑|go|yes|ok|approve|run|start)/i;
        if (approvalWords.test(input.trim())) {
          dispatch({ type: "PLAN_APPROVED" });
          dispatch({ type: "ADD_MESSAGE", payload: { role: "user", content: input } });
          dispatch({ type: "SET_PROCESSING", payload: true });

          try {
            const planState = {
              nodes: currentState.planNodes.map((n) => ({ ...n })),
              intent: input,
              approved: true,
              reviewStatus: "reviewed" as const,
            };
            const gen = planMode("execute", bridge, currentState.agent, planState, undefined, createExternalHooks());
            let result: IteratorResult<TuiEvent, string>;
            while (!(result = await gen.next()).done) {
              tuiEventBus.emit(result.value);
            }
            dispatch({ type: "PLAN_EXECUTED" });
            if (result.value) {
              dispatch({
                type: "ADD_MESSAGE",
                payload: { role: "assistant", content: result.value, agent: currentState.agent },
              });
            }
          } catch (err) {
            dispatch({
              type: "PLAN_FAILED",
              payload: err instanceof Error ? err.message : String(err),
            });
          } finally {
            dispatch({ type: "SET_PROCESSING", payload: false });
          }
          return;
        }
      }

      // 2. 意图分类 + @提及解析
      const intent = classifyIntent(input);
      const targetAgent = parseAgentFromInput(input) ?? currentState.agent;

      // 3. 添加用户消息
      dispatch({ type: "ADD_MESSAGE", payload: { role: "user", content: input } });
      if (targetAgent !== currentState.agent) {
        dispatch({ type: "SWITCH_AGENT", payload: targetAgent });
      }

      // 4. 构建 LLM 历史
      const history: LlmMessage[] = currentState.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }));

      // 5. 标记处理中
      dispatch({ type: "SET_PROCESSING", payload: true });

      // 6. 路由：task → planMode, chat → chatMode
      const externalHooks = createExternalHooks();
      try {
        if (intent === "task") {
          const planState = {
            nodes: [],
            intent: input,
            approved: false,
            reviewStatus: "pending" as const,
          };
          const gen = planMode(input, bridge, targetAgent, planState, history, externalHooks);
          let result: IteratorResult<TuiEvent, string>;
          while (!(result = await gen.next()).done) {
            tuiEventBus.emit(result.value);
          }
          dispatch({ type: "STREAM_END" });
        } else {
          const gen = queryLoop({ input, bridge, mode: "chat", agent: targetAgent, history, hooks: externalHooks });
          let result: IteratorResult<TuiEvent, string>;
          while (!(result = await gen.next()).done) {
            tuiEventBus.emit(result.value);
          }
          dispatch({ type: "STREAM_END" });
        }
      } catch (err) {
        dispatch({
          type: "ADD_MESSAGE",
          payload: {
            role: "system",
            content: `❌ 执行出错: ${err instanceof Error ? err.message : String(err)}`,
          },
        });
      } finally {
        dispatch({ type: "SET_PROCESSING", payload: false });
      }
    },
    [bridge, projectRoot, requestExit, createExternalHooks, registry, registryCtx, dispatch, stateRef],
  );
}
