/**
 * tui/ink/commands.ts — Ink TUI 内部命令处理器
 *
 * 处理 / 前缀命令（/help / /agent / /exit / /save / /clear）。
 * 命令输出以 system 消息形式注入会话，而非直接写 stdout。
 *
 * @module tui/ink/commands
 * @since v5 — Ink 重构 Phase 3
 */

import { AgentType, CHINESE_NAME_TO_TYPE } from "@cortex/shared";
import type { SessionAction, SessionState } from "./session-reducer.js";
import { saveInkSession, clearSession } from "./session-persistence.js";

/** 命令处理结果 */
export interface CommandResult {
  /** 是否已处理（true = 是内部命令，不应走 queryLoop） */
  handled: boolean;
  /** 是否需要退出应用 */
  shouldExit?: boolean;
}

/** 所有可用 agent 的中文名→type 映射（用于 .agent 命令补全） */
const AGENT_LIST: [string, AgentType][] = [
  ["昔涟", AgentType.Butler],
  ["甘雨", AgentType.Meta],
  ["纳西", AgentType.Analysis],
  ["钟离", AgentType.Strategist],
  ["凝光", AgentType.DocGovern],
  ["code", AgentType.Code],
  ["ops", AgentType.Ops],
  ["browser", AgentType.Browser],
  ["fix", AgentType.Fix],
  ["data", AgentType.Data],
  ["api", AgentType.Api],
  ["inspector", AgentType.Inspector],
  ["loop", AgentType.Loop],
];

/**
 * 尝试将输入作为内部命令处理。
 * @returns CommandResult — handled=true 表示已处理，调用方不应再走 queryLoop
 */
export function handleCommand(
  input: string,
  state: SessionState,
  dispatch: React.Dispatch<SessionAction>,
  projectRoot: string,
  requestExit: () => void,
): CommandResult {
  if (!input.startsWith("/")) return { handled: false };

  const [cmd, ...args] = input.slice(1).split(/\s+/);
  const arg = args.join(" ");

  switch (cmd) {
    case "help": {
      dispatch({
        type: "ADD_MESSAGE",
        payload: {
          role: "system",
          content: [
            "📖 可用命令：",
            "  /help          — 显示此帮助",
            "  /agent <名字>   — 切换 Agent（昔涟/甘雨/纳西/钟离/凝光/code/ops/...）",
            "  /save          — 手动保存会话",
            "  /clear         — 清空当前会话消息",
            "  /exit          — 保存并退出",
            "",
            "CLI 命令（task/memory/schedule/skill/inspect 等）可直接键入执行，或按 Ctrl+K 打开命令面板。",
          ].join("\n"),
        },
      });
      return { handled: true };
    }

    case "agent": {
      if (!arg.trim()) {
        const list = AGENT_LIST.map(([cn, type]) => `  ${cn} (${type})`).join("\n");
        dispatch({
          type: "ADD_MESSAGE",
          payload: { role: "system", content: `当前 Agent: ${state.agent}\n可用 Agent:\n${list}` },
        });
        return { handled: true };
      }
      // 尝试中文名
      const byName = CHINESE_NAME_TO_TYPE[arg.trim()];
      const targetType = byName ?? (AGENT_LIST.find(([, t]) => t === arg.trim())?.[1]);
      if (targetType) {
        // 人格分离：切换 Agent 时清空历史，防止旧 persona 混入 LLM 上下文
        dispatch({ type: "CLEAR_MESSAGES" });
        dispatch({ type: "SWITCH_AGENT", payload: targetType });
        const displayName = byName ? arg.trim() : AGENT_LIST.find(([, t]) => t === targetType)?.[0] ?? targetType;
        dispatch({ type: "ADD_MESSAGE", payload: { role: "system", content: `已切换到 ${displayName} (${targetType})，历史已清空` } });
        return { handled: true };
      }
      dispatch({ type: "ADD_MESSAGE", payload: { role: "system", content: `未知 Agent: ${arg.trim()}，用 /agent 查看列表` } });
      return { handled: true };
    }

    case "save": {
      saveInkSession(projectRoot, state);
      dispatch({ type: "ADD_MESSAGE", payload: { role: "system", content: "💾 会话已保存" } });
      return { handled: true };
    }

    case "clear": {
      clearSession(projectRoot);
      dispatch({ type: "CLEAR_MESSAGES" });
      dispatch({ type: "ADD_MESSAGE", payload: { role: "system", content: "🧹 会话已清空" } });
      return { handled: true };
    }

    case "exit":
    case "quit": {
      saveInkSession(projectRoot, state);
      requestExit();
      return { handled: true, shouldExit: true };
    }

    default:
      dispatch({ type: "ADD_MESSAGE", payload: { role: "system", content: `未知命令: /${cmd}，输入 /help 查看帮助` } });
      return { handled: true };
  }
}
