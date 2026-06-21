/**
 * tui/tui-repl.ts — TUI REPL 入口
 *
 * 新架构的 REPL 入口——替代 commands/repl.ts。
 * 当前阶段通过 --tui flag 启用，与老 REPL 并行运行。
 *
 * @module tui/tui-repl
 * @since v3 — CLI TUI 全栈重构
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as readline from "node:readline";
import { AgentType, CHINESE_NAME_TO_TYPE, AGENT_CHINESE_ROLE, type LlmMessage } from "@cortex/shared";

// CLI 注入适配器（any 避免循环类型依赖）
type EngineBridge = any;
type CommandRegistry = any;
type CommandContext = any;

import type { ReplMode, TuiEvent } from "./types.js";
import {
  tuiEventBus,
  chatMode,
  planMode,
  talkMode,
  talkTrioMode,
  partyMode,
  DEFAULT_PARTY,
  commandMode,
  TaskTreeRenderer,
  ToolLogRenderer,
  TokenMonitor,
  renderPersonaHeader,
  renderAgentTransition,
  renderMultiPersonaHeader,
  loadPlanState,
  savePlanState,
  clearPlanState,
  writeln,
  bold,
  dim,
  defaultHooks,
  type PlanModeState,
} from "./index.js";
import { saveSession, loadSession } from "./session-store.js";
import type { TuiHooks } from "./types.js";

/** TUI 会话可变状态 */
interface TuiSession {
  mode: ReplMode;
  agent: AgentType;
  history: LlmMessage[];
  planState: PlanModeState;
  /** talk 模式下是否启用三人（昔涟+纳西妲） */
  talkTrio: boolean;
  /** party 模式参与者名单 */
  partyRoster: AgentType[];
}

/** handleInternalCommand 聚合参数 */
interface TuiCmdCtx {
  rl: readline.Interface;
  setMode: (m: ReplMode) => void;
  setAgent: (a: AgentType) => void;
  session: TuiSession;
  projectRoot: string;
  hooks: TuiHooks;
  bridge: EngineBridge;
}

/**
 * TUI REPL 处理器——新架构入口。
 *
 * 当前阶段通过 `cortex --tui` 启用。
 * hooks 参数可选——传入自定义 TuiHooks 覆盖默认行为。
 */
export async function tuiReplHandler(
  registry: CommandRegistry,
  bridge: EngineBridge,
  context: CommandContext,
  hooks: TuiHooks = defaultHooks,
): Promise<number> {
  const r = _initRenderers();
  const _eventUnsubs = _bindTuiEvents(r);

  const session: TuiSession = _restoreSession(context.projectRoot ?? process.cwd()) ?? {
    mode: "chat",
    agent: AgentType.Code,
    history: [],
    talkTrio: false,
    partyRoster: [...DEFAULT_PARTY],
    planState: loadPlanState(context.projectRoot ?? process.cwd()) ?? {
      nodes: [], intent: "", approved: false, reviewStatus: "pending" as const,
    },
  };

  // Hook: onSessionRestore
  if (session.mode !== "chat" || session.history.length > 0) {
    hooks.onSessionRestore?.({
      mode: session.mode,
      agent: session.agent,
      history: session.history,
      talkTrio: session.talkTrio,
      partyRoster: session.partyRoster,
    });
  }

  renderPersonaHeader(session.agent, session.mode);
  _printTuiWelcome();

  // Hook: onSessionStart
  hooks.onSessionStart?.(session.mode, session.agent);

  const rl = _createReadline(session);
  rl.prompt();

  const cmdCtx: TuiCmdCtx = {
    rl, setMode: (m) => { session.mode = m; }, setAgent: (a) => { session.agent = a; },
    session, projectRoot: context.projectRoot ?? process.cwd(), hooks, bridge,
  };

  let running = true;
  let abortCurrent = false;

  // ── Ctrl+C 中断正在运行的 talk/chat/party 生成 ──
  const sigintHandler = () => {
    abortCurrent = true;
    writeln("\n⏹  已中断当前生成 (Ctrl+C)");
  };
  process.on("SIGINT", sigintHandler);
  process.stdin.setRawMode?.(false); // readline 接管 raw mode

  rl.on("line", async (line) => {
    let input = line.trim();
    if (!input) { rl.prompt(); return; }

    if (input.startsWith(".")) {
      running = await handleInternalCommand(input, cmdCtx);
      if (!running) { process.removeListener("SIGINT", sigintHandler); return; }
      rl.prompt(); return;
    }

    // Hook: onUserInput → onPreProcessInput
    input = await (hooks.onUserInput?.(input) ?? Promise.resolve(input));
    input = await (hooks.onPreProcessInput?.(input) ?? Promise.resolve(input));

    const abort = () => abortCurrent;
    try { await _dispatchTuiMode(session, input, bridge, registry, context, cmdCtx.projectRoot, abort); }
    catch (err) { writeln(`✗ 错误: ${err instanceof Error ? err.message : String(err)}`); }
    rl.prompt();
  });

  rl.on("close", () => {
    _eventUnsubs.forEach((fn) => fn());
    r.tokenMonitor.dispose();
  });
  await new Promise<void>((resolve) => rl.on("close", resolve));
  return 0;
}

// ═══════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════

interface TuiRenderers { taskTree: TaskTreeRenderer; toolLog: ToolLogRenderer; tokenMonitor: TokenMonitor; }

function _initRenderers(): TuiRenderers {
  return {
    taskTree: new TaskTreeRenderer(),
    toolLog: new ToolLogRenderer(),
    tokenMonitor: new TokenMonitor(),
  };
}

function _bindTuiEvents(r: TuiRenderers): (() => void)[] {
  return [
    tuiEventBus.on("task_tree_update", (e) => r.taskTree.handleEvent(e)),
    tuiEventBus.on("node_start", (e) => r.taskTree.handleEvent(e)),
    tuiEventBus.on("node_complete", (e) => r.taskTree.handleEvent(e)),
    tuiEventBus.on("node_failed", (e) => r.taskTree.handleEvent(e)),
    tuiEventBus.on("tool_start", (e) => r.toolLog.handleEvent(e)),
    tuiEventBus.on("tool_result", (e) => r.toolLog.handleEvent(e)),
    tuiEventBus.on("token_usage", (e) => r.tokenMonitor.handleEvent(e)),
  ];
}

function _printTuiWelcome(): void {
  writeln(`  ${bold("Cortex TUI v3")} — ${dim("新架构预览")}`);
  writeln(`  ${dim(".help 查看帮助 | .mode <模式> 切换 | .agent <角色> 切换 | .exit 退出")}`);
  writeln("");
}

function _createReadline(session: TuiSession): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(session.mode, session.agent, session.talkTrio),
  });
}

/** 尝试从 .cortex/tui-session.json 恢复上次会话 */
function _restoreSession(projectRoot: string): TuiSession | null {
  const snap = loadSession(projectRoot);
  if (!snap) return null;

  // 恢复 planState（若存在）
  const planState = loadPlanState(projectRoot) ?? {
    nodes: [], intent: "", approved: false, reviewStatus: "pending" as const,
  };

  writeln(`📂 已恢复上次会话（模式: ${snap.mode}, 历史: ${snap.history.length} 条）`);

  return {
    mode: snap.mode as ReplMode,
    agent: snap.agent,
    history: snap.history,
    talkTrio: snap.talkTrio,
    partyRoster: snap.partyRoster,
    planState,
  };
}

async function _dispatchTuiMode(
  session: TuiSession,
  input: string,
  bridge: EngineBridge,
  registry: CommandRegistry,
  context: CommandContext,
  projectRoot: string,
  abort?: () => boolean,
): Promise<void> {
  const { mode: m, agent: a, history: h, planState: ps } = session;
  switch (m) {
    case "command":
      writeln(await commandMode((args: string[]) => registry.dispatch(args, context), input.split(/\s+/)));
      break;
    case "chat": {
      const result = await consumeGenerator(chatMode(input, bridge, a, h), tuiEventBus, abort);
      if (result) { h.push({ role: "user", content: input }, { role: "assistant", content: result }); writeln(result); }
      break;
    }
    case "talk": {
      if (session.talkTrio) {
        const result = await consumeGenerator(talkTrioMode(input, bridge, h), tuiEventBus, abort);
        if (result) { h.push({ role: "user", content: input }, { role: "assistant", content: result }); writeln(result); }
      } else {
        const result = await consumeGenerator(talkMode(input, bridge, session.agent, h), tuiEventBus, abort);
        if (result) { h.push({ role: "user", content: input }, { role: "assistant", content: result }); writeln(result); }
      }
      break;
    }
    case "plan": {
      session.planState = { nodes: [], intent: input, approved: false, reviewStatus: "pending" };
      const result = await consumeGenerator(planMode(input, bridge, a, ps, h), tuiEventBus, abort);
      if (result) { savePlanState(projectRoot, ps); writeln(result); }
      break;
    }
    case "party": {
      const result = await consumeGenerator(partyMode(input, bridge, session.partyRoster, h), tuiEventBus, abort);
      if (result) { h.push({ role: "user", content: input }, { role: "assistant", content: result }); writeln(result); }
      break;
    }
  }
}

function buildPrompt(mode: ReplMode, agent: AgentType, talkTrio?: boolean): string {
  const modeIcons: Record<ReplMode, string> = {
    command: "⌨",
    chat: "💬",
    talk: talkTrio ? "👥" : "🗣",
    plan: "📋",
    party: "👥",
  };
  const label = mode === "talk" && talkTrio ? "昔涟+纳西妲" : agent;
  return `${modeIcons[mode]} ${label} > `;
}

async function handleInternalCommand(input: string, ctx: TuiCmdCtx): Promise<boolean> {
  const args = input.slice(1).split(/\s+/);
  const cmd = args[0];

  switch (cmd) {
    case "exit": case "quit": {
      writeln("👋 再见！");
      // Hook: onSessionSave
      const snap = {
        mode: ctx.session.mode,
        agent: ctx.session.agent,
        history: ctx.session.history,
        talkTrio: ctx.session.talkTrio,
        partyRoster: ctx.session.partyRoster,
      };
      ctx.hooks.onSessionSave?.(snap);
      saveSession(ctx.projectRoot, ctx.session);
      clearPlanState(ctx.projectRoot);
      // Hook: onSessionEnd
      await ctx.hooks.onSessionEnd?.();
      ctx.rl.close();
      return false;
    }

    case "help":
      writeln("");
      writeln(`  ${bold("Cortex TUI 内部命令")}`);
      writeln(`  ${dim("─────────────────────────")}`);
      writeln(`  .mode chat|talk|plan|party|command   切换模式`);
      writeln(`  .agent code|review|analysis|...      切换角色`);
      writeln(`  .with                                三人模式（talk 下启用昔涟+纳西妲）`);
      writeln(`  .roster list|add|remove|reset        管理群聊成员`);
      writeln(`  .save                                手动保存会话`);
      writeln(`  .help                                显示帮助`);
      writeln(`  .exit                                退出`);
      writeln("");
      return true;

    case "mode":
      if (args[1]) {
        const newMode = args[1] as ReplMode;
        if (["chat", "talk", "plan", "party", "command"].includes(newMode)) {
          const prevMode = ctx.session.mode;
          ctx.setMode(newMode);
          ctx.session.history = []; // 切模式清历史
          // Hook: onModeChange
          ctx.hooks.onModeChange?.(prevMode, newMode);
          if (newMode === "party") {
            ctx.session.partyRoster = [...DEFAULT_PARTY];
            renderMultiPersonaHeader(ctx.session.partyRoster, "party");
            const names = ctx.session.partyRoster.map(a => AGENT_CHINESE_ROLE[a] ?? a).join(" + ");
            writeln(`✓ 已切换到 ${newMode} 模式（${names}）`);
            writeln(`  ${dim(".roster add/remove 管理成员 | @名字 点名发言")}`);
          } else {
            writeln(`✓ 已切换到 ${newMode} 模式`);
          }
          ctx.rl.setPrompt(buildPrompt(newMode, ctx.session.agent, ctx.session.talkTrio));
        } else { writeln(`✗ 未知模式: ${args[1]}`); }
      }
      return true;

    case "agent":
      if (args[1]) {
        const resolved = _resolveAgentName(args[1]);
        if (!resolved) { writeln(`✗ 未知角色: ${args[1]}`); return true; }

        if (ctx.session.mode === "party") {
          // party 模式：添加进 roster
          if (!ctx.session.partyRoster.includes(resolved)) {
            ctx.session.partyRoster.push(resolved);
            writeln(`✓ ${AGENT_CHINESE_ROLE[resolved] ?? resolved} 已加入群聊`);
          } else {
            // 已在 roster → 设为主发言人（放到第一位）
            ctx.session.partyRoster = [resolved, ...ctx.session.partyRoster.filter(a => a !== resolved)];
            writeln(`✓ ${AGENT_CHINESE_ROLE[resolved] ?? resolved} 已是群聊成员`);
          }
        } else {
          const prevAgent = ctx.session.agent;
          ctx.session.agent = resolved;
          ctx.rl.setPrompt(buildPrompt(ctx.session.mode, resolved, ctx.session.talkTrio));
          writeln(`✓ 已切换到 ${resolved}`);
          renderAgentTransition(prevAgent, resolved);
          // 切换 agent 时清空历史——防止旧 persona 对话残留污染新角色上下文
          ctx.session.history = [];
          // Hook: onAgentSwitch
          ctx.hooks.onAgentSwitch?.(prevAgent, resolved);
        }
      }
      return true;

    case "roster":
      if (ctx.session.mode !== "party") {
        writeln("✗ .roster 仅在 party 模式下可用（先 .mode party）");
        return true;
      }
      return _handleRosterCommand(args.slice(1), ctx);

    case "with":
      if (ctx.session.mode === "talk") {
        ctx.session.talkTrio = !ctx.session.talkTrio;
        ctx.session.history = [];
        // Hook: onTalkTrioToggle
        ctx.hooks.onTalkTrioToggle?.(ctx.session.talkTrio);
        if (ctx.session.talkTrio) {
          renderMultiPersonaHeader([AgentType.Butler, AgentType.Analysis], "talk-trio");
          writeln("👥 三人模式：昔涟 + 纳西妲");
          writeln("   （再输 .with 切回单昔涟）");
        } else {
          writeln("🗣 已切回单昔涟模式");
        }
        ctx.rl.setPrompt(buildPrompt(ctx.session.mode, ctx.session.agent, ctx.session.talkTrio));
      } else {
        writeln("✗ .with 仅在 talk 模式下可用（先 .mode talk）");
      }
      return true;

    case "save": {
      // Hook: onSessionSave
      const saveSnap = {
        mode: ctx.session.mode,
        agent: ctx.session.agent,
        history: ctx.session.history,
        talkTrio: ctx.session.talkTrio,
        partyRoster: ctx.session.partyRoster,
      };
      ctx.hooks.onSessionSave?.(saveSnap);
      saveSession(ctx.projectRoot, ctx.session);
      writeln(`💾 会话已保存（模式: ${ctx.session.mode}, 历史: ${ctx.session.history.length} 条）`);
      return true;
    }

    case "review": {
      if (!ctx.session.planState || ctx.session.planState.nodes.length === 0) {
        writeln("✗ 没有待审议的计划（请先在 plan 模式下输入意图）");
        return true;
      }
      if (ctx.session.planState.reviewStatus === "reviewed") {
        writeln("⚠️ 计划已通过审议，输入 .approve 执行");
        return true;
      }
      writeln(`🏛 启动三省审议（${ctx.session.planState.nodes.length} 个节点）...`);
      writeln(`  凝光(合规审计) → 钟离(契约监督) → 霜凝(方向监理)`);
      // 标记为已审议——实际三省审议需要凝光/钟离/霜凝 Agent 在线，当前阶段标记通过
      ctx.session.planState.reviewStatus = "reviewed";
      writeln("✅ 三省审议通过（当前阶段默认放行，完整审议待凝光/钟离/霜凝激活）");
      writeln("  输入 .approve 执行计划");
      return true;
    }

    case "approve": {
      if (!ctx.session.planState || ctx.session.planState.nodes.length === 0) {
        writeln("✗ 没有待执行的计划（请先在 plan 模式下输入意图）");
        return true;
      }
      if (!ctx.session.planState.approved) {
        ctx.session.planState.approved = true;
        if (ctx.session.planState.reviewStatus !== "reviewed") {
          writeln("⚠️ 计划未经审议，直接执行（建议先 .review）");
        }
        writeln(`🚀 执行计划：${ctx.session.planState.nodes.length} 个节点`);
        // 重新进入 plan 模式触发执行
        const result = await consumeGenerator(
          planMode("execute", ctx.bridge, ctx.session.agent, ctx.session.planState, ctx.session.history),
          tuiEventBus,
          () => false,
        );
        if (result) {
          savePlanState(ctx.projectRoot, ctx.session.planState);
          writeln(result);
        }
        // 执行完成清理
        clearPlanState(ctx.projectRoot);
        ctx.session.planState = { nodes: [], intent: "", approved: false, reviewStatus: "pending" };
      } else {
        writeln("⚠️ 计划已批准，正在执行中...");
      }
      return true;
    }

    default:
      writeln(`✗ 未知命令: .${cmd}（.help 查看帮助）`);
      return true;
  }
}

// ── 命令辅助函数 ──

/** 将用户输入的 agent 名解析为 AgentType 枚举值。支持枚举值/中文名/agent id */
function _resolveAgentName(raw: string): AgentType | null {
  // 1. AgentType 枚举值直接匹配
  const allTypes = [
    AgentType.Analysis, AgentType.Code, AgentType.Ops, AgentType.Butler,
    AgentType.Review, AgentType.Loop, AgentType.DocGovern,
    AgentType.Inspector, AgentType.Browser, AgentType.Fix,
    AgentType.Meta, AgentType.Api, AgentType.Data, AgentType.Strategist,
  ];
  if ((allTypes as string[]).includes(raw)) return raw as AgentType;
  // 2. 中文名
  const byChinese = CHINESE_NAME_TO_TYPE[raw];
  if (byChinese) return byChinese;
  // 3. agent id 反向表（nahida→analysis, albedo→code ...）
  const ID_TO_TYPE: Record<string, AgentType> = {
    nahida: AgentType.Analysis, albedo: AgentType.Code, beidou: AgentType.Ops,
    cyrene: AgentType.Butler, keqing: AgentType.Review, mona: AgentType.Loop,
    ningguang: AgentType.DocGovern, amber: AgentType.Inspector,
    yoimiya: AgentType.Browser, sigewinne: AgentType.Fix,
    ganyu: AgentType.Meta, kuki: AgentType.Api, alhaitham: AgentType.Data,
    zhongli: AgentType.Strategist,
  };
  return ID_TO_TYPE[raw] ?? null;
}

/** .roster 子命令处理 */
function _handleRosterCommand(args: string[], ctx: TuiCmdCtx): boolean {
  const sub = args[0];
  switch (sub) {
    case "list": {
      const names = ctx.session.partyRoster.map(a => AGENT_CHINESE_ROLE[a] ?? a);
      writeln(`👥 群聊成员：${names.join(", ")}`);
      return true;
    }
    case "add": {
      if (!args[1]) { writeln("✗ .roster add <角色名>"); return true; }
      const resolved = _resolveAgentName(args[1]);
      if (!resolved) { writeln(`✗ 未知角色: ${args[1]}`); return true; }
      if (ctx.session.partyRoster.includes(resolved)) {
        writeln(`✗ ${AGENT_CHINESE_ROLE[resolved] ?? resolved} 已在群聊中`);
      } else {
        ctx.session.partyRoster.push(resolved);
        writeln(`✓ ${AGENT_CHINESE_ROLE[resolved] ?? resolved} 已加入群聊`);
      }
      return true;
    }
    case "remove": case "rm": {
      if (!args[1]) { writeln("✗ .roster remove <角色名>"); return true; }
      const resolved = _resolveAgentName(args[1]);
      if (!resolved) { writeln(`✗ 未知角色: ${args[1]}`); return true; }
      const idx = ctx.session.partyRoster.indexOf(resolved);
      if (idx < 0) {
        writeln(`✗ ${AGENT_CHINESE_ROLE[resolved] ?? resolved} 不在群聊中`);
      } else if (ctx.session.partyRoster.length <= 1) {
        writeln("✗ 至少保留一位成员");
      } else {
        ctx.session.partyRoster.splice(idx, 1);
        writeln(`✓ ${AGENT_CHINESE_ROLE[resolved] ?? resolved} 已移出群聊`);
      }
      return true;
    }
    case "reset": {
      ctx.session.partyRoster = [...DEFAULT_PARTY];
      const names = ctx.session.partyRoster.map(a => AGENT_CHINESE_ROLE[a] ?? a).join(" + ");
      writeln(`✓ 已重置为默认：${names}`);
      return true;
    }
    default:
      writeln("✗ .roster list|add <名>|remove <名>|reset");
      return true;
  }
}

/** 消费 async generator，将所有事件转发到事件总线 */
async function consumeGenerator<T>(
  gen: AsyncGenerator<TuiEvent, T, void>,
  bus: typeof tuiEventBus,
  abort?: () => boolean,
): Promise<T | null> {
  let result: IteratorResult<TuiEvent, T>;
  while (!(result = await gen.next()).done) {
    if (abort?.()) return null;
    bus.emit(result.value);
  }
  return result.value;
}
