/**
 * tui/tui-repl.ts — TUI REPL 入口（v4 精简版）
 *
 * 全量重写，不继承 v3 代码。
 * 架构：rl.on("line") → 内部命令 → @路由 → intent路由 → dispatch
 *
 * @module tui/tui-repl
 * @since v4 — 精简 TUI
 */

import * as readline from "node:readline";
import { createWriteStream } from "node:fs";
import { AgentType, AGENT_DISPLAY_BY_TYPE, AGENT_DISPLAY_FALLBACK, CHINESE_NAME_TO_TYPE, AGENT_ALIAS_TO_TYPE, type LlmMessage, type ITuiEngineBridge, type TaskNode, type ICommandDispatcher, type ICommandContext } from "@cortex/shared";
import type { TuiToolStartEvent, TuiToolResultEvent, TuiTokenUsageEvent, TuiNodeStartEvent, TuiNodeCompleteEvent, TuiNodeFailedEvent, TuiEvent } from "./types.js";
import { tuiEventBus } from "./event-bus.js";
import { chatMode } from "./modes/chat-mode.js";
import { planMode, loadPlanState, savePlanState, clearPlanState } from "./modes/plan-mode.js";
import type { PlanModeState } from "./modes/plan-mode.js";
import { commandMode } from "./modes/command-mode.js";
import { classifyIntent, parseAgentFromInput } from "./intent-router.js";
import { saveSession, loadSession } from "./session-store.js";
import type { SessionSnapshot } from "./session-store.js";
import { chatLog } from "./renderer/chat-log.js";
import { groupChat } from "./group-chat.js";
import { personaHeader, renderAgentTransition } from "./renderer/persona-header.js";
import { bold, dim, writeln } from "./renderer/ansi.js";
import { setTuiQuietMode } from "@cortex/telemetry";
import { withAutoConfirm } from "@cortex/config";

// ─── 模块级状态 ──────────────────────────────────
let _stdinLocked = false;
let _lastReasoning = "";
let _contextWarned = false;

interface TuiSession {
  agent: AgentType;
  history: LlmMessage[];
  planState: PlanModeState;
  talkTrio: boolean;
  roster: AgentType[];
}

// ═══════════════════════════════════════════════════
// 内部命令表（替代 switch）
// ═══════════════════════════════════════════════════

interface InternalCmdDef {
  name: string;
  aliases?: string[];
  description: string;
  handler: (args: string[], ctx: InternalCmdCtx) => boolean | void | Promise<boolean | void>;
}

interface InternalCmdCtx {
  session: TuiSession;
  bridge: ITuiEngineBridge;
  registry: ICommandDispatcher;
  registryCtx?: ICommandContext;
  projectRoot: string;
  rl: readline.Interface;
  writeln: (s: string) => void;
}

const INTERNAL_CMDS: InternalCmdDef[] = [
  {
    name: ".think",
    aliases: [],
    description: "查看上次思维链",
    handler: (_args, ctx) => {
      if (!_lastReasoning) { ctx.writeln("\u2717 \u6CA1\u6709\u4E0A\u6B21\u601D\u8003\u94FE\u8BB0\u5F55"); return true; }
      ctx.writeln(`\u250C\u2500 \uD83E\uDDE0 \u601D\u8003\u94FE ${"\u2500".repeat(20)}`);
      process.stdout.write("\x1b[90m" + _lastReasoning + "\x1b[0m\n");
      ctx.writeln(`\u2514${"\u2500".repeat(25)}`);
      return true;
    },
  },
  {
    name: ".exit",
    aliases: [".quit"],
    description: "退出 TUI",
    handler: (_args, ctx) => {
      ctx.writeln("\uD83D\uDC4B \u518D\u89C1\uFF01");
      const snap: SessionSnapshot = {
        agent: ctx.session.agent,
        history: ctx.session.history,
        talkTrio: ctx.session.talkTrio,
        groups: groupChat.getAllSnapshots(),
      };
      saveSession(ctx.projectRoot, snap);
      clearPlanState(ctx.projectRoot);
      ctx.rl.close();
      return false;
    },
  },
  {
    name: ".help",
    description: "显示帮助",
    handler: (_args, ctx) => {
      ctx.writeln("");
      ctx.writeln(`  ${bold("Cortex TUI \u5185\u90E8\u547D\u4EE4")}`);
      ctx.writeln(`  ${dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")}`);
      for (const c of INTERNAL_CMDS) {
        ctx.writeln(`  ${c.name}${(c.aliases?.length ?? 0) > 0 ? ` (${c.aliases!.join("/")})` : ""}${c.description ? "\t" + c.description : ""}`);
      }
      ctx.writeln("");
      return true;
    },
  },
  {
    name: ".agent",
    description: "切换角色 (.agent code|review|analysis|...)",
    handler: (args, ctx) => {
      const target = args[1];
      if (!target) { ctx.writeln("\u2717 .agent <\u89D2\u8272\u540D>"); return true; }
      const resolved = _resolveAgentName(target);
      if (!resolved) { ctx.writeln(`\u2717 \u672A\u77E5\u89D2\u8272: ${target}`); return true; }
      const prev = ctx.session.agent;
      ctx.session.agent = resolved;
      ctx.session.history = [];
      personaHeader.update(resolved, "chat");
      renderAgentTransition(prev, resolved);
      ctx.writeln(`\u2713 \u5DF2\u5207\u6362\u5230 ${resolved}`);
      return true;
    },
  },
  {
    name: ".roster",
    description: "查看/管理 agent 名单 (.roster list|add|remove|reset)",
    handler: (args, ctx) => {
      const sub = args[1];
      switch (sub) {
        case "list": {
          const names = ctx.session.roster.map(a => getDisplay(a).name);
          ctx.writeln(`\uD83D\uDC65 \u7FA4\u804A\u6210\u5458\uFF1A${names.join(", ")}`);
          return true;
        }
        case "add": {
          if (!args[2]) { ctx.writeln("\u2717 .roster add <\u89D2\u8272\u540D>"); return true; }
          const resolved = _resolveAgentName(args[2]);
          if (!resolved) { ctx.writeln(`\u2717 \u672A\u77E5\u89D2\u8272: ${args[2]}`); return true; }
          if (ctx.session.roster.includes(resolved)) { ctx.writeln(`\u2717 ${resolved} \u5DF2\u5728\u7FA4\u804A\u4E2D`); return true; }
          ctx.session.roster.push(resolved);
          ctx.writeln(`\u2713 ${getDisplay(resolved).name} \u5DF2\u52A0\u5165\u7FA4\u804A`);
          return true;
        }
        case "remove": case "rm": {
          if (!args[2]) { ctx.writeln("\u2717 .roster remove <\u89D2\u8272\u540D>"); return true; }
          const resolved = _resolveAgentName(args[2]);
          if (!resolved) { ctx.writeln(`\u2717 \u672A\u77E5\u89D2\u8272: ${args[2]}`); return true; }
          const idx = ctx.session.roster.indexOf(resolved);
          if (idx < 0) { ctx.writeln(`\u2717 ${resolved} \u4E0D\u5728\u7FA4\u804A\u4E2D`); return true; }
          if (ctx.session.roster.length <= 1) { ctx.writeln("\u2717 \u81F3\u5C11\u4FDD\u7559\u4E00\u4F4D\u6210\u5458"); return true; }
          ctx.session.roster.splice(idx, 1);
          ctx.writeln(`\u2713 ${getDisplay(resolved).name} \u5DF2\u79FB\u51FA\u7FA4\u804A`);
          return true;
        }
        case "reset": {
          ctx.session.roster = [AgentType.Butler, AgentType.Analysis];
          ctx.writeln("\u2713 \u5DF2\u91CD\u7F6E\u4E3A\u9ED8\u8BA4");
          return true;
        }
        default:
          ctx.writeln("\u2717 .roster list|add <\u540D>|remove <\u540D>|reset");
          return true;
      }
    },
  },
  {
    name: ".with",
    aliases: [".without"],
    description: "三人模式 开/关",
    handler: (args, ctx) => {
      const cmd = args[0];
      ctx.session.talkTrio = cmd === ".with" ? true : false;
      ctx.session.history = [];
      if (ctx.session.talkTrio) {
        ctx.writeln("\uD83D\uDC65 \u4E09\u4EBA\u6A21\u5F0F\uFF1A\u6614\u6D9F + \u7EB3\u897F\u5B1B");
        ctx.writeln("   (\u518D\u8F93 .with \u5207\u56DE\u5355\u6614\u6D9F)");
      } else {
        ctx.writeln("\uD83D\uDDE3 \u5DF2\u5207\u56DE\u5355\u6614\u6D9F\u6A21\u5F0F");
      }
      return true;
    },
  },
  {
    name: ".save",
    description: "保存会话",
    handler: (_args, ctx) => {
      const snap: SessionSnapshot = {
        agent: ctx.session.agent,
        history: ctx.session.history,
        talkTrio: ctx.session.talkTrio,
        groups: groupChat.getAllSnapshots(),
      };
      saveSession(ctx.projectRoot, snap);
      ctx.writeln(`\uD83D\uDCBE \u4F1A\u8BDD\u5DF2\u4FDD\u5B58\uFF08\u5386\u53F2: ${ctx.session.history.length} \u6761\uFF09`);
      return true;
    },
  },
  {
    name: ".members",
    description: "查看当前群成员",
    handler: (_args, ctx) => {
      if (!groupChat.activeGroupId) {
        ctx.writeln("\u2717 \u6CA1\u6709\u6D3B\u8DC3\u7684\u7FA4\u804A");
        return true;
      }
      const group = groupChat.groups.get(groupChat.activeGroupId);
      if (!group) {
        ctx.writeln("\u2717 \u6CA1\u6709\u6D3B\u8DC3\u7684\u7FA4\u804A");
        return true;
      }
      ctx.writeln(`\uD83D\uDCCB ${group.task}`);
      for (const a of group.agents) {
        const state = group.agentStates.get(a as string);
        const statusIcon = state
          ? state.status === "working" ? "\u23F3" : state.status === "done" ? "\u2713" : state.status === "failed" ? "\u2717" : "\u25CB"
          : "\u25CB";
        const disp = getDisplay(a);
        ctx.writeln(`  ${disp.emoji} ${disp.name} ${statusIcon}`);
      }
      return true;
    },
  },
];

// ═══════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════

function getDisplay(agent: AgentType) {
  return AGENT_DISPLAY_BY_TYPE[agent] ?? AGENT_DISPLAY_FALLBACK;
}

async function consumeGenerator<T>(
  gen: AsyncGenerator<TuiEvent, T, void>,
  bus: typeof tuiEventBus,
): Promise<T | null> {
  let result: IteratorResult<TuiEvent, T>;
  while (!(result = await gen.next()).done) {
    bus.emit(result.value);
  }
  return result.value;
}

/**
 * Agent 完成消息生成器——agent 用自己的 persona 发一条总结消息。
 */
function getAgentCompletionMessage(agent: AgentType, task: string): string {
  const phrases: Record<string, string[]> = {
    [AgentType.Code]: ["写好了。", "代码就位。", "编译通过。"],
    [AgentType.Review]: ["审查通过。", "没发现问题。", "代码质量合格。"],
    [AgentType.Meta]: ["任务已归档。", "计划执行完毕。"],
    [AgentType.Analysis]: ["分析完成。", "数据整理好了。"],
    [AgentType.Ops]: ["部署就绪。", "服务已启动。"],
  };
  const list = phrases[agent] ?? ["完成。"];
  return list[Math.floor(Math.random() * list.length)] + " " + task.slice(0, 50);
}

function lock(rl: readline.Interface) {
  _stdinLocked = true;
  rl.pause();
}

function unlock(rl: readline.Interface) {
  while (process.stdin.read() !== null) { /* drain */ }
  rl.resume();
  _stdinLocked = false;
}

/** withLock: 确保异常路径也释放 stdin 锁，防止 REPL 永久冻结 */
async function withLock<T>(rl: readline.Interface, fn: () => Promise<T>): Promise<T> {
  lock(rl);
  try { return await fn(); } finally { unlock(rl); }
}

function _createReadline(): readline.Interface {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "",  // prompt 由 _showPrompt() 动态设置
    terminal: true,
  });

  // ReadlineInternal: 访问 readline.Interface 的私有 _writeToOutput
  interface ReadlineInternal {
    _writeToOutput(s: string): void;
  }
  type RlWithInternal = readline.Interface & ReadlineInternal;

  const origWrite = (rl as unknown as RlWithInternal)._writeToOutput.bind(rl);
  (rl as unknown as RlWithInternal)._writeToOutput = function (s: string) {
    if (s === rl.getPrompt() || s.startsWith("\x1b") || s === "\r\n") {
      origWrite(s);
    }
  };
  return rl;
}

/** Claude Code 风格：prompt 显示当前 agent 或群聊上下文 */
function _showPrompt(rl: readline.Interface, session: TuiSession): void {
  if (groupChat.activeGroupId) {
    const task = (groupChat.groups.get(groupChat.activeGroupId)?.task ?? "群聊").slice(0, 16);
    rl.setPrompt(`👥 ${task} ▸ `);
  } else {
    const display = AGENT_DISPLAY_BY_TYPE[session.agent] ?? AGENT_DISPLAY_FALLBACK;
    rl.setPrompt(`${display.emoji}  ${display.name} ▸ `);
  }
  rl.prompt();
}

function _resolveAgentName(raw: string): AgentType | null {
  const byChinese = CHINESE_NAME_TO_TYPE[raw];
  if (byChinese) return byChinese;
  const resolved = AGENT_ALIAS_TO_TYPE[raw];
  return (resolved as AgentType) ?? null;
}

function _restoreSession(projectRoot: string): TuiSession | null {
  const snap = loadSession(projectRoot);
  if (!snap) return null;
  const planState = loadPlanState(projectRoot) ?? {
    nodes: [], intent: "", approved: false, reviewStatus: "pending" as const,
  };
  return {
    agent: snap.agent,
    history: snap.history,
    talkTrio: snap.talkTrio ?? false,
    roster: [AgentType.Butler, AgentType.Analysis],
    planState,
  };
}

// ═══════════════════════════════════════════════════
// dispatch 函数
// ═══════════════════════════════════════════════════

async function dispatchChat(
  input: string,
  bridge: ITuiEngineBridge,
  agent: AgentType,
  history: LlmMessage[],
): Promise<void> {
  if (!groupChat.activeGroupId) chatLog.addUser(input);
  const d = getDisplay(agent);
  process.stdout.write(`${d.emoji} ${d.name}: `);
  let full = "", reasoning = "";
  for await (const ev of chatMode(input, bridge, agent, history)) {
    if (ev.type === "llm_chunk") {
      if (ev.content?.startsWith("[telemetry]")) continue;
      if (ev.reasoning) reasoning += ev.reasoning;
      if (ev.content) { process.stdout.write(ev.content); full += ev.content; }
    }
  }
  process.stdout.write("\n\n");
  if (reasoning) {
    _lastReasoning = reasoning;
    process.stdout.write(`\x1b[90m\uD83E\uDDE0 \u601D\u8003\u94FE\u5DF2\u8BB0\u5F55 (${Math.ceil(reasoning.length / 4)} tokens, \u8F93\u5165 .think \u67E5\u770B)\x1b[0m\n`);
  }
  if (full) history.push({ role: "user", content: input }, { role: "assistant", content: full, reasoning_content: reasoning || undefined });

  // 群聊：如果有活跃群，将聊天响应写入
  if (groupChat.activeGroupId && full) {
    const truncated = full.length > 200 ? full.slice(0, 200) + "..." : full;
    groupChat.addMessage(groupChat.activeGroupId, { agent, type: "chat", content: truncated });
  }
}

async function dispatchTask(
  input: string,
  bridge: ITuiEngineBridge,
  agent: AgentType,
  ps: PlanModeState,
  history: LlmMessage[],
  rl: readline.Interface,
  projectRoot: string,
): Promise<void> {
  // 待审批 + 审批词 → 执行
  if (ps.nodes.length > 0 && /^(好的|执行|确认|可以|行|开始|跑|go|yes|ok|approve|run|start)/i.test(input)) {
    ps.approved = true;
    process.stdout.write("\n⚡ 执行中...\n");
    await withLock(rl, async () => {
      await withAutoConfirm(() => consumeGenerator(planMode("execute", bridge, agent, ps, history), tuiEventBus));
      if (ps.nodes.every(n => n.status === "done" || n.status === "failed")) {
        process.stdout.write("\n✅ 执行完成\n");
        if (groupChat.activeGroupId) {
          const successCount = ps.nodes.filter(n => n.status === "done").length;
          const failCount = ps.nodes.filter(n => n.status === "failed").length;
          groupChat.dissolveGroup(groupChat.activeGroupId, `群完成 — ${successCount}成功, ${failCount}失败`);
        }
        ps.nodes = [];
        ps.approved = false;
        savePlanState(projectRoot, ps);
      }
    });
    return;
  }

  // 新计划
  const result = await withLock(rl, async () => {
    process.stdout.write("\n📋 计划生成中...\n");
    return consumeGenerator(planMode(input, bridge, agent, ps, history), tuiEventBus);
  });

  if (ps.nodes.length > 0) {
    // 创建任务群——从节点提取参与 Agent
    const groupAgents = [agent, ...ps.nodes.map(n => n.claimedBy[0]).filter((a): a is AgentType => !!a)];
    const gid = groupChat.createGroup(input, [...new Set(groupAgents)]);
    groupChat.addMessage(gid, { agent, type: "plan", content: `${ps.nodes.length}节点: ${input.slice(0, 60)}` });

    process.stdout.write(`\n📋 任务计划 (${ps.nodes.length} 节点)\n${"\u2500".repeat(50)}\n`);
    for (const n of ps.nodes) process.stdout.write(`  \u25C9 ${n.type}: ${n.payload?.slice(0, 80) ?? ""}\n`);
    process.stdout.write(`${"\u2500".repeat(50)}\n💬 要执行吗？说"好的"就行\n`);
    savePlanState(projectRoot, ps);

  } else {
    // 空计划 → 回退 chat
    await dispatchChat(input, bridge, agent, history);
    return;
  }
}

async function dispatchCmd(
  input: string,
  registry: ICommandDispatcher,
  ctx?: ICommandContext,
): Promise<void> {
  const result = await commandMode(
    (args: string[]) => registry.dispatch(args, ctx),
    input.split(/\s+/),
  );
  writeln(result);
}

// ═══════════════════════════════════════════════════
// 内部命令
// ═══════════════════════════════════════════════════

async function handleInternalCmd(
  input: string,
  session: TuiSession,
  projectRoot: string,
  rl: readline.Interface,
  bridge: ITuiEngineBridge,
  registry: ICommandDispatcher,
  registryCtx?: ICommandContext,
): Promise<boolean> {
  const args = input.slice(1).split(/\s+/);
  const cmd = args[0];
  if (!cmd) return true;

  // 查表分发
  const entry = INTERNAL_CMDS.find(c => {
    const nameWithoutDot = c.name.startsWith(".") ? c.name.slice(1) : c.name;
    return nameWithoutDot === cmd || (c.aliases ?? []).some(a => a.startsWith(".") ? a.slice(1) === cmd : a === cmd);
  });
  if (!entry) {
    writeln(`\u2717 \u672A\u77E5\u547D\u4EE4: .${cmd}\uFF08.help \u67E5\u770B\u5E2E\u52A9\uFF09`);
    return true;
  }

  const ctx: InternalCmdCtx = { session, bridge, registry, registryCtx, projectRoot, rl, writeln };
  const result = await entry.handler(args, ctx);
  return result !== false;
}

// ═══════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════

export async function tuiReplHandler(
  registry: ICommandDispatcher,
  bridge: ITuiEngineBridge,
  context?: ICommandContext,
): Promise<number> {
  const projectRoot = (context?.projectRoot as string) ?? process.cwd();

  // 引擎日志隔离
  const engineLog = createWriteStream(`${projectRoot}/.cortex/logs/engine.log`, { flags: "a" });
  const origStderr = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- process.stderr.write 猴子补丁，参数类型需匹配 Node.js 重载签名
  process.stderr.write = (chunk: Uint8Array | string, ...args: any[]) => {
    const s = String(chunk);
    if (s.includes("[ConfirmGate]") || s.includes("Approve?")) {
      if (s.length > 500) return origStderr(s.slice(0, 500) + "\u2026\n", ...args);
      return origStderr(chunk, ...args);
    }
    engineLog.write(chunk);
    return true;
  };

  // 抑制 telemetry
  setTuiQuietMode(true);
  const _realLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    const s = typeof args[0] === "string" ? args[0] : "";
    if (s.startsWith("[telemetry]")) return;
    _realLog(...args);
  };

  // 清屏
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");

  // 恢复会话
  const session: TuiSession = _restoreSession(projectRoot) ?? {
    agent: AgentType.Butler,
    history: [],
    talkTrio: false,
    roster: [AgentType.Butler, AgentType.Analysis],
    planState: loadPlanState(projectRoot) ?? {
      nodes: [], intent: "", approved: false, reviewStatus: "pending" as const,
    },
  };

  if (session.history.length > 0) {
    chatLog.loadHistory([{ role: "assistant", content: `\uD83D\uDCC2 \u5DF2\u6062\u590D\u4E0A\u6B21\u4F1A\u8BDD\uFF08${session.history.length} \u6761\uFF09` }]);
  }

  // 启动标语 — Claude Code 风格：极简一行
  const display = AGENT_DISPLAY_BY_TYPE[session.agent] ?? AGENT_DISPLAY_FALLBACK;
  writeln(`${display.emoji} ${display.name} ${dim("\u2014 \u8F93\u5165 .help \u67E5\u770B\u547D\u4EE4")}`);

  const rl = _createReadline();
  _showPrompt(rl, session);

  // 事件订阅
  const unsubs = [
    tuiEventBus.on("tool_start", (e) => {
      const ev = e as TuiToolStartEvent;
      if (groupChat.activeGroupId) {
        const params = { agent: ev.agent, type: "tool_start", toolName: ev.tool, content: ev.tool } as const;
        groupChat.addMessage(groupChat.activeGroupId, params);
      } else {
        process.stdout.write(`  \u23F3 ${ev.tool}\n`);
      }
    }),
    tuiEventBus.on("tool_result", (e) => {
      const ev = e as TuiToolResultEvent;
      if (groupChat.activeGroupId) {
        const params = { agent: ev.agent, type: "tool_result", toolName: ev.tool, toolSuccess: ev.success, toolDuration: ev.durationMs, content: ev.success ? ev.tool : `${ev.tool}: ${ev.error ?? ""}` } as const;
        groupChat.addMessage(groupChat.activeGroupId, params);
      } else {
        const icon = ev.success ? "\u2705" : "\u274C";
        process.stdout.write(`\x1b[1A\x1b[2K  ${icon} ${ev.tool} \u00B7 ${ev.durationMs}ms\n`);
      }
    }),
    tuiEventBus.on("node_start", (e) => {
      const ev = e as TuiNodeStartEvent;
      if (groupChat.activeGroupId) {
        groupChat.addMessage(groupChat.activeGroupId, { agent: ev.agent, type: "task_start", content: ev.description });
        groupChat.setAgentState(groupChat.activeGroupId, ev.agent, "working");
        // 仿真层：当 review agent 检查含宪法相关的代码时触发
        if (ev.agent === AgentType.Review && ev.description.includes("constitution")) {
          groupChat.addMessage(groupChat.activeGroupId, {
            agent: AgentType.Butler, type: "simulation",
            content: "宪法 §十: 检测到 as any——应替换为具体类型",
          });
        }
      }
    }),
    tuiEventBus.on("node_complete", (e) => {
      const ev = e as TuiNodeCompleteEvent;
      if (groupChat.activeGroupId) {
        // Agent 用自己 persona 发一条完成消息
        const msg = getAgentCompletionMessage(ev.agent, ev.output ?? "任务完成");
        groupChat.addMessage(groupChat.activeGroupId, {
          agent: ev.agent, type: "chat",
          content: msg
        });
        groupChat.setAgentState(groupChat.activeGroupId, ev.agent, "done");
      }
    }),
    tuiEventBus.on("node_failed", (e) => {
      const ev = e as TuiNodeFailedEvent;
      if (groupChat.activeGroupId) {
        groupChat.setAgentState(groupChat.activeGroupId, ev.agent, "failed");
        groupChat.addMessage(groupChat.activeGroupId, {
          agent: ev.agent, type: "review",
          content: `❌ 审查未通过: ${ev.error?.slice(0, 100) ?? "未知错误"}`
        });
        // 群聊暂停——等待用户决策
        groupChat.pauseGroup(groupChat.activeGroupId);
        process.stdout.write("\n💬 审查未通过——输入 '继续' 忽略, '重试' 重新执行, '@甘雨 重新规划'\n");
      }
    }),
    tuiEventBus.on("token_usage", (e) => {
      const ev = e as TuiTokenUsageEvent;
      const pct = Math.round((ev.sessionTotalTokens / ev.contextWindowSize) * 100);
      if (pct >= 90 && !_contextWarned) {
        _contextWarned = true;
        process.stdout.write(`\n\u26A0\uFE0F \u4E0A\u4E0B\u6587 ${pct}%\n`);
      }
    }),
  ];

  rl.on("line", async (input) => {
    input = input.trim();
    if (!input) { _showPrompt(rl, session); return; }

    // 内部命令
    if (input.startsWith(".")) {
      const running = await handleInternalCmd(input, session, projectRoot, rl, bridge, registry, context);
      if (!running) rl.close();
      else _showPrompt(rl, session);
      return;
    }

    try {
      const { agent: a, history: h, planState: ps } = session;

      // 暂停群聊：输入当指令
      if (groupChat.activeGroupId) {
        const g = groupChat.groups.get(groupChat.activeGroupId);
        if (g?.status === "paused") {
          if (/^(继续|跳过|忽略)/i.test(input)) {
            groupChat.resumeGroup(g.id);
            _showPrompt(rl, session);
            return;
          }
          if (/重试/i.test(input)) {
            groupChat.resumeGroup(g.id);
            ps.approved = true;
            await withLock(rl, () => withAutoConfirm(() => consumeGenerator(planMode("execute", bridge, a, ps, h), tuiEventBus)));
            _showPrompt(rl, session);
            return;
          }
          // 否则委托给甘雨（meta agent）重新规划
          groupChat.addMessage(g.id, { agent: "user", type: "chat", content: input });
          await dispatchChat(input, bridge, AgentType.Meta, h);
          _showPrompt(rl, session);
          return;
        }
      }

      // @ 路由
      const targetAgent = parseAgentFromInput(input);
      const dispatchAgent = targetAgent ?? a;
      if (targetAgent && targetAgent !== a) {
        session.agent = targetAgent;
        session.history = [];
        personaHeader.update(targetAgent, "chat");
      }

      const cleanedInput = targetAgent ? input.replace(/@\S+\s*/, "").trim() || input : input;

      // 群聊归属：用户在群内说的话自动写入群聊
      if (groupChat.activeGroupId && !input.startsWith(".") && !targetAgent) {
        groupChat.addMessage(groupChat.activeGroupId, {
          agent: "user",
          type: "chat",
          content: cleanedInput,
        });
      }

      // 意图路由
      const intent = classifyIntent(cleanedInput);
      switch (intent) {
        case "command":
          await dispatchCmd(cleanedInput, registry, context);
          break;
        case "task":
          await dispatchTask(cleanedInput, bridge, dispatchAgent, ps, h, rl, projectRoot);
          break;
        case "chat":
          await dispatchChat(cleanedInput, bridge, dispatchAgent, h);
          break;
      }
    } catch (err) {
      writeln(`\u2717 \u9519\u8BEF: ${err instanceof Error ? err.message : String(err)}`);
    }
    _showPrompt(rl, session);
  });

  rl.on("close", () => {
    process.stderr.write = origStderr;
    engineLog.end();
    unsubs.forEach((fn) => fn());
    setTuiQuietMode(false);
    console.log = _realLog;
  });

  await new Promise<void>((resolve) => rl.on("close", resolve));
  return 0;
}
