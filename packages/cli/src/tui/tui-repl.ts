/**
 * tui/tui-repl.ts — TUI REPL 入口
 *
 * 新架构的 REPL 入口——替代 commands/repl.ts。
 * 当前阶段通过 --tui flag 启用，与老 REPL 并行运行。
 *
 * @module tui/tui-repl
 * @since v3 — CLI TUI 全栈重构
 */

import * as readline from "node:readline";
import type { AgentType, LlmMessage } from "@cortex/shared";
import type { EngineBridge } from "../services/engine-bridge.js";
import type { CommandRegistry } from "../commands/index.js";
import type { CommandContext } from "../types.js";
import type { ReplMode, TuiEvent } from "./types.js";
import {
  tuiEventBus,
  chatMode,
  planMode,
  talkMode,
  partyMode,
  commandMode,
  TaskTreeRenderer,
  ToolLogRenderer,
  TokenMonitor,
  renderPersonaHeader,
  renderAgentTransition,
  ConfirmGateState,
  writeln,
  bold,
  dim,
} from "./index.js";

/**
 * TUI REPL 处理器——新架构入口。
 *
 * 当前阶段通过 `cortex --tui` 启用。
 */
export async function tuiReplHandler(
  registry: CommandRegistry,
  bridge: EngineBridge,
  context: CommandContext,
): Promise<number> {
  // ── 渲染器初始化 ──────────────────────────
  const taskTree = new TaskTreeRenderer();
  const toolLog = new ToolLogRenderer();
  const tokenMonitor = new TokenMonitor();
  const _confirmGate = new ConfirmGateState();

  // ── 状态 ──────────────────────────────────
  let mode: ReplMode = "chat";
  let agent: AgentType = "code" as AgentType;
  const history: LlmMessage[] = [];

  // ── 订阅事件总线 ──────────────────────────
  tuiEventBus.on("task_tree_update", (e) => taskTree.handleEvent(e));
  tuiEventBus.on("node_start", (e) => taskTree.handleEvent(e));
  tuiEventBus.on("node_complete", (e) => taskTree.handleEvent(e));
  tuiEventBus.on("node_failed", (e) => taskTree.handleEvent(e));
  tuiEventBus.on("tool_start", (e) => toolLog.handleEvent(e));
  tuiEventBus.on("tool_result", (e) => toolLog.handleEvent(e));
  tuiEventBus.on("token_usage", (e) => tokenMonitor.handleEvent(e));

  // ── 渲染初始头 ────────────────────────────
  renderPersonaHeader(agent, mode);

  // ── 欢迎信息 ──────────────────────────────
  writeln(`  ${bold("Cortex TUI v3")} — ${dim("新架构预览")}`);
  writeln(`  ${dim(".help 查看帮助 | .mode <模式> 切换 | .agent <角色> 切换 | .exit 退出")}`);
  writeln("");

  // ── 主循环 ────────────────────────────────
  let running = true;

  // 使用 readline 兼容异步
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(mode, agent),
  });

  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    // 内部命令处理
    if (input.startsWith(".")) {
      running = await handleInternalCommand(input, rl, (m) => { mode = m; }, (a) => { agent = a; }, () => {});
      if (!running) return;
      rl.prompt();
      return;
    }

    // 模式分发
    try {
      switch (mode) {
        case "command": {
          const result = await commandMode(
            (args) => registry.dispatch(args, context),
            input.split(/\s+/),
          );
          writeln(result);
          break;
        }
        case "chat": {
          const gen = chatMode(input, bridge, agent, history);
          const result = await consumeGenerator(gen, tuiEventBus);
          if (result) {
            history.push({ role: "user", content: input });
            history.push({ role: "assistant", content: result });
            writeln(result);
          }
          break;
        }
        case "talk": {
          const gen = talkMode(input, bridge, history);
          const result = await consumeGenerator(gen, tuiEventBus);
          if (result) {
            history.push({ role: "user", content: input });
            history.push({ role: "assistant", content: result });
            writeln(result);
          }
          break;
        }
        case "plan": {
          const gen = planMode(input, bridge, agent, {
            nodes: [],
            intent: input,
            approved: false,
            reviewStatus: "pending",
          }, history);
          const result = await consumeGenerator(gen, tuiEventBus);
          if (result) writeln(result);
          break;
        }
        case "party": {
          const gen = partyMode(input, bridge, [agent], history);
          const result = await consumeGenerator(gen, tuiEventBus);
          if (result) writeln(result);
          break;
        }
      }
    } catch (err) {
      writeln(`✗ 错误: ${err instanceof Error ? err.message : String(err)}`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    tokenMonitor.dispose();
  });

  // 等待 readline 关闭
  await new Promise<void>((resolve) => rl.on("close", resolve));

  return 0;
}

// ═══════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════

function buildPrompt(mode: ReplMode, agent: AgentType): string {
  const modeIcons: Record<ReplMode, string> = {
    command: "⌨",
    chat: "💬",
    talk: "🗣",
    plan: "📋",
    party: "👥",
  };
  return `${modeIcons[mode]} ${agent} > `;
}

async function handleInternalCommand(
  input: string,
  rl: readline.Interface,
  setMode: (m: ReplMode) => void,
  setAgent: (a: AgentType) => void,
  _onStop: () => void,
): Promise<boolean> {
  const args = input.slice(1).split(/\s+/);
  const cmd = args[0];

  switch (cmd) {
    case "exit":
    case "quit":
      writeln("👋 再见！");
      rl.close();
      return false;

    case "help":
      writeln("");
      writeln(`  ${bold("Cortex TUI 内部命令")}`);
      writeln(`  ${dim("─────────────────────────")}`);
      writeln(`  .mode chat|talk|plan|party|command   切换模式`);
      writeln(`  .agent code|review|analysis|...      切换角色`);
      writeln(`  .help                                显示帮助`);
      writeln(`  .exit                                退出`);
      writeln("");
      return true;

    case "mode":
      if (args[1]) {
        const newMode = args[1] as ReplMode;
        if (["chat", "talk", "plan", "party", "command"].includes(newMode)) {
          setMode(newMode);
          writeln(`✓ 已切换到 ${newMode} 模式`);
          rl.setPrompt(buildPrompt(newMode, "code" as AgentType));
        } else {
          writeln(`✗ 未知模式: ${args[1]}`);
        }
      }
      return true;

    case "agent":
      if (args[1]) {
        const newAgent = args[1] as AgentType;
        setAgent(newAgent);
        rl.setPrompt(buildPrompt("chat" as ReplMode, newAgent));
        writeln(`✓ 已切换到 ${newAgent}`);
        renderAgentTransition("code" as AgentType, newAgent);
      }
      return true;

    default:
      writeln(`✗ 未知命令: .${cmd}（.help 查看帮助）`);
      return true;
  }
}

/** 消费 async generator，将所有事件转发到事件总线 */
async function consumeGenerator<T>(
  gen: AsyncGenerator<TuiEvent, T, void>,
  bus: typeof tuiEventBus,
): Promise<T> {
  let result: IteratorResult<TuiEvent, T>;
  while (!(result = await gen.next()).done) {
    bus.emit(result.value);
  }
  return result.value;
}
