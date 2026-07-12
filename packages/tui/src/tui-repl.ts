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
import { existsSync, createWriteStream } from "node:fs";
import { AgentType, CHINESE_NAME_TO_TYPE, AGENT_CHINESE_ROLE, AGENT_DISPLAY_BY_TYPE, AGENT_DISPLAY_FALLBACK, type LlmMessage, type ITuiEngineBridge } from "@cortex/shared";
import type { TuiToolStartEvent, TuiToolResultEvent, TuiTokenUsageEvent } from "./types.js";

// CLI 注入适配器
type EngineBridge = ITuiEngineBridge;
type CommandRegistry = any;
type CommandContext = any;

import type { TuiEvent } from "./types.js";
import {
  tuiEventBus,
  chatMode,
  planMode,
  commandMode,
  classifyIntent,
  parseAgentFromInput,
  TokenMonitor,
  renderPersonaHeader,
  renderAgentTransition,
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

import { chatLog, toolCard, overlay, personaHeader } from "./renderer/index.js";
import { SigintHandler } from "./renderer/sigint-handler.js";
import { sanitizeRenderableText } from "./renderer/sanitize.js";
import { setTuiQuietMode } from "@cortex/telemetry";

/** SIGINT 三段式处理器——模块级以便 plan/approve 路径重置 */
let sigint: SigintHandler;

/** TUI 会话可变状态（v4 群聊版） */
interface TuiSession {
  agent: AgentType;
  history: LlmMessage[];
  planState: PlanModeState;
  /** 三人模式（昔涟+纳西妲） */
  talkTrio: boolean;
  /** 群聊组 */
  groups: Map<string, Group>;
  /** 群聊成员名单 */
  roster: AgentType[];
}

// stdin 互斥锁——plan/approve 执行期间不响应 readline
let _stdinLocked = false;
let _lastReasoning = ""; // chat 模式攒的思维链——.think 命令查看
let _contextWarned = false; // 上下文告警——每会话仅输出一次

// ─── Group 管理 ──────────────────────────────

interface Group {
  agents: AgentType[];
  history: LlmMessage[];
  status: "active" | "dissolved";
  createdAt: number;
  summary?: string;
}

/** 全局群聊组存储 */
const groups = new Map<string, Group>();

/** 创建群聊组 */
function createGroup(task: string, agents: AgentType[]): string {
  const id = `g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const g: Group = { agents, history: [], status: "active", createdAt: Date.now() };
  groups.set(id, g);
  const displayNames = agents.map(a => {
    const d = AGENT_DISPLAY_BY_TYPE[a] ?? AGENT_DISPLAY_FALLBACK;
    return `${d.emoji} ${d.name}`;
  });
  chatLog.addEmbed(`📋 ${task}`, displayNames);
  return id;
}

/** 向群聊组中添加消息 */
function addToGroup(id: string, agent: AgentType, msg: string): void {
  const g = groups.get(id);
  if (g) {
    g.history.push({ role: "assistant", content: `${agent}: ${msg}` });
  }
}

/** 解散群聊组并返回摘要 */
function dissolveGroup(id: string): { summary?: string } {
  const g = groups.get(id);
  if (!g) return {};
  g.status = "dissolved";
  const duration = Math.round((Date.now() - g.createdAt) / 1000);
  const display = g.agents.map(a => AGENT_DISPLAY_BY_TYPE[a]?.name ?? a);
  const summary = `⏱️ ${duration}s · ${display.join(" + ")}`;
  chatLog.addEmbed(`✅ 群聊结束`, [summary]);
  return { summary };
}

/** handleInternalCommand 聚合参数 */
interface TuiCmdCtx {
  rl: readline.Interface;
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

  // 引擎日志隔离：重定向 stderr 到文件
  const projectRoot = context.projectRoot ?? process.cwd();
  const engineLog = createWriteStream(`${projectRoot}/.cortex/logs/engine.log`, { flags: "a" });
  const origStderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: any, ...args: any[]) => {
    const s = String(chunk);
    if (s.includes("[ConfirmGate]") || s.includes("Approve?")) {
      // gate交互透传——但截断超长参数(防止HTML淹屏)
      if (s.length > 500) return origStderr(s.slice(0, 500) + "…\n", ...args);
      return origStderr(chunk, ...args);
    }
    engineLog.write(chunk);
    return true;
  };

  // 抑制 console-bridge stderr 输出——TUI 有自己的渲染管线
  setTuiQuietMode(true);
  // 硬拦截：console.log 的 [telemetry] 前缀不输出到 stdout
  const _realLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    const s = typeof args[0] === "string" ? args[0] : "";
    if (s.startsWith("[telemetry]")) return;
    _realLog(...args);
  };

  // 清屏——避免 build 输出等旧行残留在右侧混排
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");

  // 保存原 console.log——退出时恢复
  const _tuiSavedLog = console.log;

  const session: TuiSession = _restoreSession(context.projectRoot ?? process.cwd()) ?? {
    agent: AgentType.Butler,
    history: [],
    talkTrio: false,
    groups: new Map(),
    roster: [AgentType.Butler, AgentType.Analysis],
    planState: loadPlanState(context.projectRoot ?? process.cwd()) ?? {
      nodes: [], intent: "", approved: false, reviewStatus: "pending" as const,
    },
  };

  // 恢复 session 时回填 ChatLog
  chatLog.loadHistory(session.history);
  // 恢复提示走 ChatLog——不走 writeln
  if (session.history.length > 0) {
    chatLog.loadHistory([{ role: "assistant", content: `\uD83D\uDCC2 已恢复上次会话（${session.history.length} 条）` }]);
  }

  // 监听终端尺寸变化——纯流式模式，无需重绘
  process.stdout.on("resize", () => {
    /* 纯流式模式——尺寸变化不触发重绘 */
  });
  // 纯流式模式——无需 setTerminalSize

  // Hook: onSessionRestore
  if (session.history.length > 0) {
    hooks.onSessionRestore?.({
      agent: session.agent,
      history: session.history,
      talkTrio: session.talkTrio,
      groups: [...session.groups.entries()].map(([id, g]) => ({
        id, agents: g.agents.map(a => a.toString()),
        status: g.status as "active" | "dissolved",
        summary: g.summary,
      })),
    });
  }

  // 使用 PersonaHeader TuiComponent 替代 writeln 直出
  personaHeader.update(session.agent, "chat" as any);
  // 欢迎信息走 ChatLog——不走 writeln 避免被 DiffRenderer 覆盖
  chatLog.loadHistory([
    { role: "assistant", content: `${bold("Cortex TUI v4")} — ${dim("\u667A\u80FD\u6A21\u5F0F")}` },
  ]);

  // Hook: onSessionStart
  hooks.onSessionStart?.(session.agent);

  const rl = _createReadline();
  rl.prompt();

  // 事件驱动渲染——不再用定时器和readline抢屏幕

  const cmdCtx: TuiCmdCtx = {
    rl, setAgent: (a) => { session.agent = a; },
    session, projectRoot, hooks, bridge,
  };

  let running = true;
  let abortCurrent = false;

  // ── Ctrl+C: readline 跨平台SIGINT + 三段式确认 ──
  sigint = new SigintHandler(() => { rl.close(); });
  const sigintFn = () => {
    abortCurrent = true;  // 先中断当前操作
    const msg = sigint.handle();
    if (msg) writeln(msg);
  };
  rl.on("SIGINT", sigintFn);  // readline的SIGINT在Windows上也生效
  process.on("SIGINT", sigintFn);  // *nix fallback
  process.stdin.setRawMode?.(false); // readline 接管 raw mode

  rl.on("line", async (input) => {
    input = input.trim();
    if (!input) { rl.prompt(); return; }

    // 内部命令
    if (input.startsWith(".")) {
      const running = await handleInternalCommand(input, cmdCtx);
      if (!running) rl.close();
      else rl.prompt();
      return;
    }

    const abort = () => abortCurrent;
    try {
      const { agent: a, history: h, planState: ps } = session;
      
      // @ 路由
      const targetAgent = parseAgentFromInput(input);
      const dispatchAgent = targetAgent ?? a;
      if (targetAgent && targetAgent !== a) {
        session.agent = targetAgent;
        personaHeader.update(targetAgent, "chat");
        // 清空历史——防止旧 agent 的 persona 对话污染新 agent 上下文
        session.history = [];
      }
      
      // 剥掉 @agent
      const cleanedInput = targetAgent ? input.replace(/@\S+\s*/, "").trim() || input : input;
      
      // 意图路由
      const intent = classifyIntent(cleanedInput);
      switch (intent) {
        case "command":
          await _dispatchCommand(cleanedInput, registry, context);
          break;
        case "task":
          await _dispatchPlan(cleanedInput, bridge, dispatchAgent, ps, h, cmdCtx.projectRoot, rl, abort);
          break;
        case "chat":
          await _dispatchChat(cleanedInput, bridge, dispatchAgent, h);
          break;
      }
    } catch (err) {
      writeln(`\u2717 错误: ${err instanceof Error ? err.message : String(err)}`);
    }
    rl.prompt();
  });

  rl.on("close", () => {
    process.stderr.write = origStderr;
    engineLog.end();
    process.stdout.removeAllListeners("resize");
    rl.removeAllListeners("SIGINT");
    _eventUnsubs.forEach((fn) => fn());
    r.tokenMonitor.dispose();
    setTuiQuietMode(false);
    console.log = _tuiSavedLog;
    process.removeListener("SIGINT", sigintFn);
  });
  await new Promise<void>((resolve) => rl.on("close", resolve));
  return 0;
}

// ═══════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════

interface TuiRenderers { tokenMonitor: TokenMonitor; }

function _initRenderers(): TuiRenderers {
  return {
    tokenMonitor: new TokenMonitor(),
  };
}

function _bindTuiEvents(r: TuiRenderers): (() => void)[] {
  return [
    // llm_chunk: 不处理——由各 dispatch 函数的 for-await 循环自行输出
    // tool_start: 行内指示器
    tuiEventBus.on("tool_start", (e) => {
      const ev = e as TuiToolStartEvent;
      process.stdout.write(`  \u23F3 ${ev.tool}\n`);
    }),
    // tool_result: 覆盖上行
    tuiEventBus.on("tool_result", (e) => {
      const ev = e as TuiToolResultEvent;
      const icon = ev.success ? "\u2705" : "\u274C";
      const durStr = ev.durationMs ? ` \u00B7 ${ev.durationMs}ms` : "";
      process.stdout.write(`\x1b[1A\x1b[2K  ${icon} ${ev.tool}${durStr}\n`);
    }),
    // token_usage: 仅超90%告警一次
    tuiEventBus.on("token_usage", (e) => {
      const ev = e as TuiTokenUsageEvent;
      r.tokenMonitor.handleEvent(e);
      const pct = Math.round((ev.sessionTotalTokens / ev.contextWindowSize) * 100);
      if (pct >= 90 && !_contextWarned) {
        _contextWarned = true;
        process.stdout.write(`\n\u26A0\uFE0F \u4E0A\u4E0B\u6587 \u7528\u91CF ${pct}%\n\n`);
      }
    }),
  ];
}

function _printTuiWelcome(): void {
  writeln(`  ${bold("Cortex TUI v4")} — ${dim("\u667A\u80FD\u6A21\u5F0F")}`);
  writeln(`  ${dim(".help \u67E5\u770B\u5E2E\u52A9 | .agent <\u89D2\u8272> \u5207\u6362 | @\u540D\u5B57 \u7FA4\u804A | .exit \u9000\u51FA")}`);
  writeln("");
}

function _createReadline(): readline.Interface {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\u25B6 ",
    terminal: true,
  });
  // 劫持 _writeToOutput——只写 prompt，不写用户输入
  const origWrite = (rl as any)._writeToOutput.bind(rl);
  (rl as any)._writeToOutput = function (s: string) {
    if (s === rl.getPrompt() || s.startsWith("\x1b") || s === "\r\n") {
      origWrite(s);
    }
  };
  return rl;
}

/** 尝试从 .cortex/tui-session.json 恢复上次会话 */
function _restoreSession(projectRoot: string): TuiSession | null {
  const snap = loadSession(projectRoot);
  if (!snap) return null;

  // 恢复 planState（若存在）
  const planState = loadPlanState(projectRoot) ?? {
    nodes: [], intent: "", approved: false, reviewStatus: "pending" as const,
  };

  // 重建 groups Map
  const restoredGroups = new Map<string, Group>();
  if (snap.groups) {
    for (const g of snap.groups) {
      restoredGroups.set(g.id, {
        agents: g.agents.map(a => a as AgentType),
        history: [],
        status: g.status,
        createdAt: Date.now(),
        summary: g.summary,
      });
    }
  }

  return {
    agent: snap.agent,
    history: snap.history,
    talkTrio: snap.talkTrio,
    groups: restoredGroups,
    roster: [AgentType.Butler, AgentType.Analysis],
    planState,
  };
}

/** Chat 模式——流式 LLM 回答 */
async function _dispatchChat(
  input: string,
  bridge: EngineBridge,
  agent: AgentType,
  history: LlmMessage[],
): Promise<void> {
  // 用户消息
  chatLog.addUser(input);
  
  // Agent 前缀
  const display = AGENT_DISPLAY_BY_TYPE[agent] ?? AGENT_DISPLAY_FALLBACK;
  process.stdout.write(`${display.emoji} ${display.name}: `);
  
  // 流式输出
  let full = "";
  let reasoning = "";
  for await (const ev of chatMode(input, bridge, agent, history)) {
    if (ev.type === "llm_chunk") {
      if (ev.content?.startsWith("[telemetry]")) continue;
      if (ev.reasoning) reasoning += ev.reasoning;
      if (ev.content) {
        process.stdout.write(ev.content);
        full += ev.content;
      }
    }
  }
  
  process.stdout.write("\n\n");
  
  // 思维链
  if (reasoning) {
    _lastReasoning = reasoning;
    process.stdout.write(`\x1b[90m\uD83E\uDDE0 \u601D\u8003\u94FE\u5DF2\u8BB0\u5F55 (${Math.ceil(reasoning.length / 4)} tokens, \u8F93\u5165 .think \u67E5\u770B)\x1b[0m\n`);
  }
  
  // 历史
  if (full) {
    history.push(
      { role: "user", content: input },
      { role: "assistant", content: full, reasoning_content: reasoning || undefined }
    );
  }
}

/** Plan 模式——LLM 生成计划 → 展示 → 等待审批 */
async function _dispatchPlan(
  input: string,
  bridge: EngineBridge,
  agent: AgentType,
  ps: PlanModeState,
  history: LlmMessage[],
  projectRoot: string,
  rl: readline.Interface,
  abort?: () => boolean,
): Promise<void> {
  // plan模式：纯 writeln 输出——不走 ChatLog
  _stdinLocked = true;
  rl.pause();
  process.stdout.write("\n📋 LLM 思考中...\n");
  const result = await consumeGenerator(planMode(input, bridge, agent, ps, history), tuiEventBus, abort);
  // plan 结果通过 task-tree 的 writeln 事件已经输出了
  // 这里只保存状态，不重复输出
  if (result || ps.nodes.length > 0) {
    savePlanState(projectRoot, ps);
    if (result && result.trim()) {
      process.stdout.write("\n");
      writeln("─".repeat(60));
      writeln(result.trim());
      writeln("─".repeat(60));
      process.stdout.write("\n");
    }
    // fallback: result 为空但 ps.nodes 有内容
    if (!result && ps.nodes.length > 0) {
      writeln("📋 任务计划 (" + ps.nodes.length + " 节点)");
    }
  }
  // 完全空内容的兜底——consumeGenerator 返回 null 且无节点
  if (!result && ps.nodes.length === 0) {
    process.stdout.write("\n⚠️ 计划生成返回空内容\n");
  }
  while (process.stdin.read() !== null) { /* drain */ }
  rl.resume();
  _stdinLocked = false;
  sigint.reset();
  process.stdout.write("\n");  // 隔离旧输出
  rl.prompt();
  // 任务节点通过 ToolCard/task-tree 实时展示——不额外输出
  // TUI 落盘自检
  for (const node of ps.nodes) {
    const outputPath = node._outputPath;
    if (outputPath) {
      if (!existsSync(outputPath)) {
        console.warn(`[TUI] 预期产出文件不存在: ${outputPath}`);
      } else {
        console.log(`[TUI] ✅ 产出文件已落盘: ${outputPath}`);
      }
    }
  }
}

/** Command 模式——直接命令分发 */
async function _dispatchCommand(
  input: string,
  registry: CommandRegistry,
  ctx: CommandContext,
): Promise<void> {
  writeln(await commandMode((args: string[]) => registry.dispatch(args, ctx), input.split(/\s+/)));
}

function buildPrompt(_agent: AgentType): string {
  return "\u25B6 ";
}

async function handleInternalCommand(input: string, ctx: TuiCmdCtx): Promise<boolean> {
  const args = input.slice(1).split(/\s+/);
  const cmd = args[0];

  switch (cmd) {
    case "think": {
      if (!_lastReasoning) { writeln("\u2717 \u6CA1\u6709\u4E0A\u6B21\u601D\u8003\u94FE\u8BB0\u5F55"); return true; }
      writeln(`\u250C\u2500 \uD83E\uDDE0 \u601D\u8003\u94FE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
      process.stdout.write("\x1b[90m" + _lastReasoning + "\x1b[0m\n");
      writeln("\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
      return true;
    }
    case "exit": case "quit": {
      writeln("\uD83D\uDC4B \u518D\u89C1\uFF01");
      // Hook: onSessionSave
      const snap = {
        agent: ctx.session.agent,
        history: ctx.session.history,
        talkTrio: ctx.session.talkTrio,
        groups: [...ctx.session.groups.entries()].map(([id, g]) => ({
          id, agents: g.agents.map(a => a.toString()),
          status: g.status as "active" | "dissolved",
          summary: g.summary,
        })),
      };
      ctx.hooks.onSessionSave?.(snap);
      saveSession(ctx.projectRoot, snap);
      clearPlanState(ctx.projectRoot);
      // Hook: onSessionEnd
      await ctx.hooks.onSessionEnd?.();
      ctx.rl.close();
      return false;
    }

    case "help":
      writeln("");
      writeln(`  ${bold("Cortex TUI \u5185\u90E8\u547D\u4EE4")}`);
      writeln(`  ${dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")}`);
      writeln(`  .agent code|review|analysis|...      \u5207\u6362\u89D2\u8272`);
      writeln(`  @\u540D\u5B57                            \u7FA4\u804A @\u63D0\u53CA`);
      writeln(`  .with/.without                        \u4E09\u4EBA\u6A21\u5F0F \u5F00/\u5173`);
      writeln(`  .roster list|add|remove|reset         \u7BA1\u7406\u7FA4\u804A\u6210\u5458`);
      writeln(`  .save                                \u624B\u52A8\u4FDD\u5B58\u4F1A\u8BDD`);
      writeln(`  .help                                显示帮助`);
      writeln(`  .think                               查看上次思考链`);
      writeln(`  .exit                                退出`);
      writeln("");
      return true;

    case "agent":
      if (args[1]) {
        const resolved = _resolveAgentName(args[1]);
        if (!resolved) { writeln(`\u2717 \u672A\u77E5\u89D2\u8272: ${args[1]}`); return true; }
        const prevAgent = ctx.session.agent;
        ctx.session.agent = resolved;
        ctx.rl.setPrompt("\u25B6 ");
        writeln(`\u2713 \u5DF2\u5207\u6362\u5230 ${resolved}`);
        personaHeader.update(resolved, "chat" as any);
        renderAgentTransition(prevAgent, resolved);
        // \u5207\u6362 agent \u65F6\u6E05\u7A7A\u5386\u53F2
        ctx.session.history = [];
        // Hook: onAgentSwitch
        ctx.hooks.onAgentSwitch?.(prevAgent, resolved);
      }
      return true;

    case "roster":
      return _handleRosterCommand(args.slice(1), ctx);

    case "with": case "without":
      // .with = \u542F\u7528\u4E09\u4EBA\u6A21\u5F0F | .without = \u5173\u95ED\u4E09\u4EBA\u6A21\u5F0F
      const targetedState = cmd === "without" ? false : !ctx.session.talkTrio;
      ctx.session.talkTrio = targetedState;
      ctx.session.history = [];
      ctx.hooks.onTalkTrioToggle?.(ctx.session.talkTrio);
      if (ctx.session.talkTrio) {
        writeln("\uD83D\uDC65 \u4E09\u4EBA\u6A21\u5F0F\uFF1A\u6614\u6D9F + \u7EB3\u897F\u5B1B");
        writeln("   (\u518D\u8F93 .with \u5207\u56DE\u5355\u6614\u6D9F)");
      } else {
        writeln("\uD83D\uDDE3 \u5DF2\u5207\u56DE\u5355\u6614\u6D9F\u6A21\u5F0F");
      }
      return true;

    case "save": {
      // Hook: onSessionSave
      const saveSnap = {
        agent: ctx.session.agent,
        history: ctx.session.history,
        talkTrio: ctx.session.talkTrio,
        groups: [...ctx.session.groups.entries()].map(([id, g]) => ({
          id, agents: g.agents.map(a => a.toString()),
          status: g.status as "active" | "dissolved",
          summary: g.summary,
        })),
      };
      ctx.hooks.onSessionSave?.(saveSnap);
      saveSession(ctx.projectRoot, saveSnap);
      writeln(`\uD83D\uDCBE \u4F1A\u8BDD\u5DF2\u4FDD\u5B58\uFF08\u5386\u53F2: ${ctx.session.history.length} \u6761\uFF09`);
      return true;
    }

    default:
      // \u7A7A\u547D\u4EE4(. \u6216 \u3002)\u9759\u9ED8\u5FFD\u7565
      if (!cmd) return true;
      writeln(`\u2717 \u672A\u77E5\u547D\u4EE4: .${cmd}\uFF08.help \u67E5\u770B\u5E2E\u52A9\uFF09`);
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

/** .roster 子命令处理——管理群聊成员名单 */
function _handleRosterCommand(args: string[], ctx: TuiCmdCtx): boolean {
  const sub = args[0];
  switch (sub) {
    case "list": {
      const names = ctx.session.roster.map(a => AGENT_CHINESE_ROLE[a] ?? a);
      writeln(`\uD83D\uDC65 \u7FA4\u804A\u6210\u5458\uFF1A${names.join(", ")}`);
      return true;
    }
    case "add": {
      if (!args[1]) { writeln("\u2717 .roster add <\u89D2\u8272\u540D>"); return true; }
      const resolved = _resolveAgentName(args[1]);
      if (!resolved) { writeln(`\u2717 \u672A\u77E5\u89D2\u8272: ${args[1]}`); return true; }
      if ((ctx.session.roster as AgentType[]).includes(resolved)) {
        writeln(`\u2717 ${AGENT_CHINESE_ROLE[resolved] ?? resolved} \u5DF2\u5728\u7FA4\u804A\u4E2D`);
      } else {
        ctx.session.roster.push(resolved);
        writeln(`\u2713 ${AGENT_CHINESE_ROLE[resolved] ?? resolved} \u5DF2\u52A0\u5165\u7FA4\u804A`);
      }
      return true;
    }
    case "remove": case "rm": {
      if (!args[1]) { writeln("\u2717 .roster remove <\u89D2\u8272\u540D>"); return true; }
      const resolved = _resolveAgentName(args[1]);
      if (!resolved) { writeln(`\u2717 \u672A\u77E5\u89D2\u8272: ${args[1]}`); return true; }
      const idx = ctx.session.roster.indexOf(resolved);
      if (idx < 0) {
        writeln(`\u2717 ${AGENT_CHINESE_ROLE[resolved] ?? resolved} \u4E0D\u5728\u7FA4\u804A\u4E2D`);
      } else if (ctx.session.roster.length <= 1) {
        writeln("\u2717 \u81F3\u5C11\u4FDD\u7559\u4E00\u4F4D\u6210\u5458");
      } else {
        ctx.session.roster.splice(idx, 1);
        writeln(`\u2713 ${AGENT_CHINESE_ROLE[resolved] ?? resolved} \u5DF2\u79FB\u51FA\u7FA4\u804A`);
      }
      return true;
    }
    case "reset": {
      ctx.session.roster = [AgentType.Butler, AgentType.Analysis];
      const names = ctx.session.roster.map(a => AGENT_CHINESE_ROLE[a] ?? a).join(" + ");
      writeln(`\u2713 \u5DF2\u91CD\u7F6E\u4E3A\u9ED8\u8BA4\uFF1A${names}`);
      return true;
    }
    default:
      writeln("\u2717 .roster list|add <\u540D>|remove <\u540D>|reset");
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
