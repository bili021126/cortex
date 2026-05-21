/**
 * commands/repl.ts — `cortex repl` REPL 交互模式
 *
 * 进入交互式 REPL 会话。支持两种模式：
 *   - command 模式：输入 cortex 命令（run/agent/task/...）
 *   - chat 模式：自然语言对话，走引擎调度管线（甘雨拆解→Agent执行→管家回话）
 *
 * 支持持久化会话上下文、历史命令记录、内部命令。
 *
 * @see CLI 设计文档 §4.14
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import type { CommandRegistry } from "./index.js";
import type { EngineBridge } from "../services/engine-bridge.js";
import { getFormatter, detectDefaultFormat } from "../formatters/index.js";
import { AgentType, AGENT_TAGS, AGENT_CHINESE_ROLE } from "@cortex/shared";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/** REPL 运行模式 */
type ReplMode = "command" | "chat" | "talk" | "plan";

const MODE_LABELS: Record<ReplMode, string> = {
  command: "⌨ 命令",
  chat: "💬 对话",
  talk: "🗣 闲聊",
  plan: "📋 规划",
};

const MODE_PROMPTS: Record<ReplMode, string> = {
  command: "cortex",
  chat: "chat",
  talk: "talk",
  plan: "plan",
};

/** 可对话的 Agent 别名 → AgentType 映射（英文 + 中文） */
const CHAT_AGENT_ALIASES: Record<string, AgentType> = {
  // 英文别名
  code: AgentType.Code,
  review: AgentType.Review,
  analysis: AgentType.Analysis,
  ops: AgentType.Ops,
  fix: AgentType.Fix,
  loop: AgentType.Loop,
  inspect: AgentType.Inspector,
  inspector: AgentType.Inspector,
  doc: AgentType.DocGovern,
  "doc-govern": AgentType.DocGovern,
  api: AgentType.Api,
  data: AgentType.Data,
  strategy: AgentType.Strategist,
  strategist: AgentType.Strategist,
  meta: AgentType.Meta,
  butler: AgentType.Butler,
  browser: AgentType.Browser,
  // 中文别名
  "阿贝多": AgentType.Code,
  "刻晴": AgentType.Review,
  "纳西妲": AgentType.Analysis,
  "北斗": AgentType.Ops,
  "希格雯": AgentType.Fix,
  "莫娜": AgentType.Loop,
  "安柏": AgentType.Inspector,
  "凝光": AgentType.DocGovern,
  "久岐忍": AgentType.Api,
  "艾尔海森": AgentType.Data,
  "钟离": AgentType.Strategist,
  "霜凝": AgentType.Strategist,
  "甘雨": AgentType.Meta,
  "托马": AgentType.Butler,
  "宵宫": AgentType.Browser,
};

/** Agent 角色展示信息（emoji + 角色名 + 签名语） */
interface AgentDisplayInfo {
  emoji: string;
  name: string;
  signature: string;
}

const AGENT_DISPLAY: Record<AgentType, AgentDisplayInfo> = {
  [AgentType.Code]:      { emoji: "🧪", name: "阿贝多", signature: "这个结构，值得研究。" },
  [AgentType.Review]:    { emoji: "⚔️", name: "刻晴",   signature: "每一行都可能藏着疏漏。" },
  [AgentType.Analysis]:  { emoji: "🌿", name: "纳西妲", signature: "有意思……让我再深挖一层。" },
  [AgentType.Ops]:       { emoji: "⚓", name: "北斗",   signature: "死兆星号，准备起航。" },
  [AgentType.Loop]:      { emoji: "🔮", name: "莫娜",   signature: "星辰不会说谎。" },
  [AgentType.DocGovern]: { emoji: "🏛️", name: "凝光",   signature: "天权定论，不得上诉。" },
  [AgentType.Butler]:    { emoji: "🏠", name: "托马",   signature: "开拓者，有什么需要？" },
  [AgentType.Inspector]: { emoji: "🦅", name: "安柏",   signature: "侦察完毕，一切正常。" },
  [AgentType.Fix]:       { emoji: "💉", name: "希格雯", signature: "让我看看伤口在哪里。" },
  [AgentType.Api]:       { emoji: "📦", name: "久岐忍", signature: "契约检查完毕。" },
  [AgentType.Browser]:   { emoji: "🎆", name: "宵宫",   signature: "咻~让烟花为你绽放！" },
  [AgentType.Data]:      { emoji: "📚", name: "艾尔海森", signature: "数据就是数据。" },
  [AgentType.Strategist]:{ emoji: "⚖️", name: "钟离",   signature: "契约既成，食言者当受食岩之罚。" },
  [AgentType.Meta]:      { emoji: "📋", name: "甘雨",   signature: "让我为你梳理任务脉络。" },
};

const AGENT_DISPLAY_FALLBACK: AgentDisplayInfo = { emoji: "🤖", name: "Agent", signature: "" };

function getAgentDisplay(agentType: AgentType): AgentDisplayInfo {
  return AGENT_DISPLAY[agentType] ?? AGENT_DISPLAY_FALLBACK;
}

/** talk 模式管家闲聊 persona —— 注入到 payload 前缀 */
const TALK_PERSONA_PROMPT = [
  "[闲聊模式]",
  "你现在以「托马」——神里家管、Cortex 管家——的身份和开拓者轻松聊天。",
  "你不需要执行代码、不需要审查设计、不需要规划任务。",
  "你只需要像一位贴心的管家那样，温和地回应开拓者的话。",
  "如果开拓者问的是技术问题，你可以用轻松的口吻给出见解，但不用'派任务'。",
  "如果开拓者只是想聊聊，你就陪他聊聊——像朋友一样。",
  "说话风格：温暖、可靠、偶尔带点幽默，像一位认识了很久的朋友。",
  "",
  `开拓者说: ${"{input}"}`,
].join("\n");

/** AgentType → 认领标签（首个标签作主标签） */
function getPrimaryTag(agentType: AgentType): string {
  const tags = AGENT_TAGS[agentType];
  if (tags && tags.length > 0) return tags[0];
  return agentType;
}

/** 解析输入中的 @agent 前缀，返回 [agentType, restOfInput] */
function parseAgentPrefix(
  input: string,
  current: AgentType,
): { agent: AgentType; input: string } {
  const match = input.match(/^@(\S+)\s+(.*)/s);
  if (!match) return { agent: current, input };
  const alias = match[1].toLowerCase();
  const resolved = CHAT_AGENT_ALIASES[alias];
  if (!resolved) return { agent: current, input };
  return { agent: resolved, input: match[2] };
}

export function createReplHandler(
  registry: CommandRegistry,
  bridge: EngineBridge,
): CommandHandler {
  return async (args, options, context): Promise<CommandResult> => {
    const dbPath = options["db"] as string | undefined;
    const promptStr = (options["prompt"] as string) ?? undefined;
    const noHistory = options["no-history"] as boolean;
    const initFile = options["init"] as string | undefined;
    const startMode: ReplMode = (options["mode"] as ReplMode) ?? "chat";
    const historyFile = path.join(os.homedir(), ".cortex", "repl-history");

    let replFormat = detectDefaultFormat();
    let replMode: ReplMode = startMode;
    let chatAgent: AgentType = AgentType.Analysis;
    let running = true;

    // ── Plan Mode 状态 ──
    let planNodes: import("@cortex/shared").TaskNode[] = [];
    let planIntent = "";
    let sessionGeneration = 0; // 模式切换版本号，异步操作返回时校验用
    let busy = false; // 串行化 LLM 调用，防重叠输出

    // 模式切换时递增版本号，让飞出去的异步操作回来时发现模式已变
    function bumpGeneration() { sessionGeneration++; }

    console.log(`🧠 Cortex REPL (v0.2.0, Core-1)`);
    console.log(`   模式: ${MODE_LABELS[replMode]}`);
    if (replMode === "chat") {
      const display = getAgentDisplay(chatAgent);
      console.log(`   当前对话: ${display.emoji}${display.name} 「${display.signature}」`);
      console.log(`   切换: .agent <名称> | 临时指定: @<名称> <消息>`);
    }
    if (replMode === "talk") {
      const display = getAgentDisplay(AgentType.Butler);
      console.log(`   管家: ${display.emoji}${display.name} 「${display.signature}」`);
      console.log(`   闲时采集模式——管线空闲，自然闲聊。@agent 可临时叫 Agent`);
    }
    if (replMode === "plan") {
      console.log(`   规划模式——甘雨先生出计划，你审阅后 .approve 执行`);
      console.log(`   输入意图描述，甘雨会拆解为任务树。.approve 批准执行，.reject 放弃`);
    }
    console.log(`   输入 .help 查看内部命令，Ctrl+C 或 .exit 退出`);
    console.log(`   输入 .mode 切换模式\n`);

    // 初始化引擎（优先走配置驱动模式，回退轻量模式）
    if (bridge.isBootstrapConfigured) {
      await bridge.ensureBootstrapped();
    } else {
      await bridge.ensureInitialized();
    }

    // 加载初始化脚本
    if (initFile) {
      try {
        const initContent = fs.readFileSync(path.resolve(initFile), "utf-8");
        for (const line of initContent.split("\n").filter((l) => l.trim() && !l.startsWith("#"))) {
          console.log(`> ${line}`);
          await executeLine(line.trim(), registry, bridge, context, replFormat, replMode, chatAgent);
        }
      } catch (err) {
        console.error(`初始化脚本加载失败: ${err}`);
      }
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: buildPrompt(replMode, chatAgent, promptStr),
    });

    if (!noHistory && fs.existsSync(historyFile)) {
      try {
        const history = fs.readFileSync(historyFile, "utf-8").split("\n").filter(Boolean);
        (rl as any).history = history.slice(-100); // 最多 100 条
      } catch { /* 忽略 */ }
    }

    rl.on("line", async (line: string) => {
      const trimmed = line.trim();

      // ── 空行 ──
      if (!trimmed) {
        rl.prompt();
        return;
      }

      // ── 内部命令：始终立即可用，不阻塞 ──
      if (trimmed.startsWith(".")) {
        // Plan 模式专属命令
        if (replMode === "plan") {
          const planResult = await handlePlanCommand(trimmed, bridge, {
            getPlanNodes: () => planNodes,
            setPlanNodes: (nodes: import("@cortex/shared").TaskNode[]) => { planNodes = nodes; },
            getPlanIntent: () => planIntent,
            setPlanIntent: (intent: string) => { planIntent = intent; },
            getFormat: () => replFormat,
            getVerbose: () => context.verbose,
            bumpGeneration: () => bumpGeneration(),
          });
          if (planResult === "handled") {
            rl.prompt();
            return;
          }
        }

        // 通用内部命令（.mode/.agent/.help/.exit 等）
        const result = handleInternalCommand(trimmed, {
          rl, promptStr, historyFile, noHistory,
          setFormat: (f) => { replFormat = f; },
          setMode: (m) => {
            replMode = m;
            bumpGeneration(); // 模式切换 → 异步飞出去的响应回来时会发现版本过时
            rl.setPrompt(buildPrompt(replMode, chatAgent, promptStr));
            console.log(`模式已切换为: ${MODE_LABELS[m]}`);
          },
          setAgent: (a) => {
            chatAgent = a;
            rl.setPrompt(buildPrompt(replMode, chatAgent, promptStr));
            const name = AGENT_CHINESE_ROLE[a] ?? a;
            console.log(`对话 Agent 已切换为: ${name}`);
          },
          getAgent: () => chatAgent,
          getMode: () => replMode,
          stop: () => { running = false; rl.close(); },
          getPlanNodes: () => planNodes,
          setPlanNodes: (nodes) => { planNodes = nodes; },
          getPlanIntent: () => planIntent,
          setPlanIntent: (intent) => { planIntent = intent; },
        });
        if (!running) return;
        rl.prompt();
        return;
      }

      // ── LLM 调用：串行化，防重叠 ──
      if (busy) {
        console.log("⏳ 上一个操作仍在处理中，请稍候...");
        rl.prompt();
        return;
      }
      busy = true;
      const startGen = sessionGeneration;
      try {
        await executeLine(trimmed, registry, bridge, context, replFormat, replMode, chatAgent, {
          getPlanNodes: () => planNodes,
          setPlanNodes: (nodes: import("@cortex/shared").TaskNode[]) => { planNodes = nodes; },
          getPlanIntent: () => planIntent,
          setPlanIntent: (intent: string) => { planIntent = intent; },
          getGeneration: () => sessionGeneration,
          startGeneration: startGen,
        });
      } finally {
        busy = false;
        if (running) rl.prompt();
      }
    });

    rl.on("close", () => {
      if (running) {
        console.log("\n再见！");
        // 保存历史
        if (!noHistory) {
          try {
            const dir = path.dirname(historyFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const history = (rl as any).history?.slice(-100) ?? [];
            fs.writeFileSync(historyFile, history.join("\n"), "utf-8");
          } catch { /* 忽略 */ }
        }
      }
    });

    rl.prompt();

    // 保持进程运行直到用户退出
    return new Promise(() => {
      rl.on("close", () => {
        bridge.shutdown();
        process.exit(0);
      });
    });
  };
}

interface ReplContext {
  rl: readline.Interface;
  promptStr: string | undefined;
  historyFile: string;
  noHistory: boolean;
  setFormat: (f: "text" | "json" | "color") => void;
  setMode: (m: ReplMode) => void;
  getMode: () => ReplMode;
  setAgent: (a: AgentType) => void;
  getAgent: () => AgentType;
  stop: () => void;
  // Plan Mode
  getPlanNodes: () => import("@cortex/shared").TaskNode[];
  setPlanNodes: (nodes: import("@cortex/shared").TaskNode[]) => void;
  getPlanIntent: () => string;
  setPlanIntent: (intent: string) => void;
}

/** 根据当前模式和 Agent 构建提示符 */
function buildPrompt(mode: ReplMode, agent?: AgentType, customPrompt?: string): string {
  if (customPrompt) return customPrompt;
  const prefix = MODE_PROMPTS[mode];
  if (mode === "chat" && agent) {
    const display = getAgentDisplay(agent);
    return `${prefix}[${display.name}]> `;
  }
  return `${prefix}> `;
}

/** Plan 模式执行上下文 */
interface PlanExecutionContext {
  getPlanNodes: () => import("@cortex/shared").TaskNode[];
  setPlanNodes: (nodes: import("@cortex/shared").TaskNode[]) => void;
  getPlanIntent: () => string;
  setPlanIntent: (intent: string) => void;
  /** 获取当前会话版本号——异步操作回来后校验 */
  getGeneration?: () => number;
  /** 操作发起时的版本号——与 getGeneration() 比较判断是否过时 */
  startGeneration?: number;
}

/**
 * 执行一行输入——按模式分发：
 * - command 模式：走 CommandRegistry（cortex 命令）
 * - chat 模式：自然语言走引擎调度管线
 * - plan 模式：甘雨出计划→展示→用户审批→执行
 * - talk 模式：纯闲聊
 */
async function executeLine(
  line: string,
  registry: CommandRegistry,
  bridge: EngineBridge,
  context: CommandContext,
  format: ReturnType<typeof detectDefaultFormat>,
  mode: ReplMode,
  currentAgent: AgentType,
  planCtx?: PlanExecutionContext,
): Promise<void> {
  const fmt = getFormatter(format);

  // ── chat 模式：自然语言 → 引擎 ──
  if (mode === "chat") {
    const { agent, input } = parseAgentPrefix(line, currentAgent);
    await executeChatInput(input, bridge, context, fmt, agent, 
      agent !== currentAgent ? currentAgent : undefined);
    return;
  }

  // ── plan 模式：甘雨出计划→展示→用户审批→执行 ──
  if (mode === "plan") {
    await executePlanInput(line, bridge, context, fmt, planCtx);
    return;
  }

  // ── talk 模式：纯闲聊，不派任务（但 @agent 可临时叫 Agent 切到 chat）──
  if (mode === "talk") {
    const { agent, input } = parseAgentPrefix(line, AgentType.Butler);
    if (agent !== AgentType.Butler) {
      const display = getAgentDisplay(agent);
      console.log(`  @${agent} → ${display.emoji}${display.name} 登场！${display.signature}`);
      await executeChatInput(input, bridge, context, fmt, agent);
    } else {
      await executeTalkInput(input, bridge, context, fmt);
    }
    return;
  }

  // ── command 模式：先尝试命令路由 ──
  try {
    const args = line.split(/\s+/);
    const result = await registry.dispatch(args, {
      ...context,
      format,
    });

    // 命令路由成功
    if (result.success || (result.error && !result.error.includes("未知命令"))) {
      console.log(result.success ? fmt.formatSuccess(result) : fmt.formatError(result));
      return;
    }

    // 未知命令 → 如果看起来像自然语言（包含中文或长度>20），fallthrough 到引擎
    const looksLikeNL = /[\u4e00-\u9fff]/.test(line) || line.length > 20;
    if (looksLikeNL) {
      console.log(`(未识别为命令，按自然语言处理...)`);
      const { agent, input } = parseAgentPrefix(line, currentAgent);
      await executeChatInput(input, bridge, context, fmt, agent,
        agent !== currentAgent ? currentAgent : undefined);
      return;
    }

    console.log(fmt.formatError(result));
  } catch (err) {
    console.error(`执行错误: ${err}`);
  }
}

/** 将自然语言输入作为引擎任务执行 */
async function executeChatInput(
  input: string,
  bridge: EngineBridge,
  context: CommandContext,
  fmt: ReturnType<typeof getFormatter>,
  agent: AgentType,
  previousAgent?: AgentType,
): Promise<void> {
  const display = getAgentDisplay(agent);

  // @agent 切换时显示角色转场
  if (previousAgent && previousAgent !== agent) {
    const prev = getAgentDisplay(previousAgent);
    console.log(`\n  ${prev.emoji}${prev.name} → ${display.emoji}${display.name}  ${display.signature}\n`);
  }

  try {
    await bridge.ensureInitialized();
    const board = await bridge.getTaskBoard();
    const scheduler = await bridge.getScheduler();

    const primaryTag = getPrimaryTag(agent);
    const tags = [primaryTag];

    // 对话框定：角色名 + 用户输入，替代生硬的 "Task:"
    const framedPayload = `[${display.name}, ${input}]`;

    const taskNode = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: primaryTag,
      tags,
      needsMultiPerspective: false,
      status: "pending" as const,
      claimedBy: [] as string[],
      payload: framedPayload,
      results: [] as any[],
      createdAt: Date.now(),
    };

    if (context.verbose) {
      console.log(`[调度] 任务 ${taskNode.id} → ${primaryTag} (${agent})`);
    }

    console.log(`  ${display.emoji}${display.name} 正在回应...\n`);

    board.addNode(taskNode as any);
    const report = await scheduler.executeAll();

    if (report.completed > 0) {
      const result = report.results[0];
      if (result?.output) {
        // 角色前缀输出
        console.log(`${display.emoji} [${display.name}]`);
        console.log(`${result.output}\n`);
      } else {
        console.log(`${display.emoji} [${display.name}] ✓ 执行完成\n`);
      }
    } else if (report.failed > 0) {
      const errMsg = report.results[0]?.error ?? "未知错误";
      if (errMsg.includes("No agent matches")) {
        console.log(
          `${display.emoji} [${display.name}] ⚠ 引擎就绪，但未注册可执行 Agent。\n` +
          "   请配置 LLM 并通过 bootstrapEngine 加载 Agent：\n" +
          "   1. 设置 cortex-agents.json 定义 Agent\n" +
          "   2. 在 main.ts 中调用 bridge.setBootstrapConfig()\n" +
          "   3. 使用 bridge.ensureBootstrapped() 替代 ensureInitialized()",
        );
      } else {
        console.log(`${display.emoji} [${display.name}] ${fmt.formatError({ success: false, error: errMsg, exitCode: 2 })}`);
      }
    } else {
      console.log(`${display.emoji} [${display.name}] ⚠ 引擎空闲，未找到待执行节点。（可能需先注册 Agent）`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${display.emoji} [${display.name}] 引擎调度失败: ${msg}`);
  }
}

/** 闲聊模式——管家陪聊，不派任务（@agent 可临时叫 Agent 切到 chat） */
async function executeTalkInput(
  input: string,
  bridge: EngineBridge,
  context: CommandContext,
  fmt: ReturnType<typeof getFormatter>,
): Promise<void> {
  const display = getAgentDisplay(AgentType.Butler);
  const analysisDisplay = getAgentDisplay(AgentType.Analysis);

  try {
    await bridge.ensureInitialized();
    const board = await bridge.getTaskBoard();
    const scheduler = await bridge.getScheduler();

    // 注入管家闲聊 persona，框定为轻松对话
    const talkPayload = TALK_PERSONA_PROMPT.replace("${input}", input);

    const taskNode = {
      id: `talk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "analysis",
      tags: ["analysis", "research"],
      needsMultiPerspective: false,
      status: "pending" as const,
      claimedBy: [] as string[],
      payload: talkPayload,
      results: [] as any[],
      createdAt: Date.now(),
    };

    if (context.verbose) {
      console.log(`[闲聊] 任务 ${taskNode.id} → analysis（管家模式）`);
    }

    console.log(`  ${display.emoji}${display.name} 正在聆听...\n`);

    board.addNode(taskNode as any);
    const report = await scheduler.executeAll();

    if (report.completed > 0) {
      const result = report.results[0];
      if (result?.output) {
        // 管家角色前缀输出
        console.log(`${display.emoji} [${display.name}]`);
        console.log(`${result.output}\n`);
      } else {
        console.log(`${display.emoji} [${display.name}] ✓\n`);
      }
    } else if (report.failed > 0) {
      const errMsg = report.results[0]?.error ?? "未知错误";
      if (errMsg.includes("No agent matches")) {
        console.log(
          `${display.emoji} [${display.name}] ⚠ 引擎就绪，但未注册可执行 Agent。\n` +
          "   请配置 LLM 并通过 bootstrapEngine 加载 Agent。",
        );
      } else {
        console.log(`${display.emoji} [${display.name}] ${fmt.formatError({ success: false, error: errMsg, exitCode: 2 })}`);
      }
    } else {
      console.log(`${display.emoji} [${display.name}] ⚠ 引擎空闲。（可能需先注册 Agent）`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${display.emoji} [${display.name}] 闲聊管道失败: ${msg}`);
  }
}

// ── Plan Mode 核心函数 ──────────────────────────────────

/** 规划模式：甘雨拆解意图→展示计划→等待审批 */
async function executePlanInput(
  input: string,
  bridge: EngineBridge,
  context: CommandContext,
  fmt: ReturnType<typeof getFormatter>,
  planCtx?: PlanExecutionContext,
): Promise<void> {
  const metaAgent = await bridge.getMetaAgent();
  if (!metaAgent) {
    console.log("⚠ 规划模式需要配置驱动初始化（bootstrapEngine）。请先配置 LLM。");
    return;
  }

  const startGen = planCtx?.startGeneration;
  console.log("\n🤔 甘雨正在拆解意图...");

  try {
    const nodes = await metaAgent.plan(input);

    // 版本校验：LLM 返回时模式可能已切换（用户 .mode chat 等），丢弃过期响应
    if (startGen != null && planCtx?.getGeneration && planCtx.getGeneration() !== startGen) {
      return; // 静默丢弃
    }

    if (!nodes || nodes.length === 0) {
      console.log("⚠ 甘雨未能产出有效计划，请尝试更具体地描述你的意图。");
      return;
    }

    // 存储计划
    if (planCtx) {
      planCtx.setPlanNodes(nodes);
      planCtx.setPlanIntent(input);
    }

    // 展示计划
    console.log(formatPlanTree(nodes));
    console.log(`\n📋 共 ${nodes.length} 个任务节点。`);
    console.log("输入 .approve 批准执行，.reject 放弃计划，.status 查看进度");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`规划失败: ${msg}`);
  }
}

/** 将 TaskNode 树格式化为可读的缩进展示 */
function formatPlanTree(nodes: import("@cortex/shared").TaskNode[]): string {
  // 构建 parentId → children 映射
  const childrenMap = new Map<string, import("@cortex/shared").TaskNode[]>();
  const roots: import("@cortex/shared").TaskNode[] = [];

  for (const node of nodes) {
    if (!node.parentId) {
      roots.push(node);
    } else {
      const list = childrenMap.get(node.parentId) ?? [];
      list.push(node);
      childrenMap.set(node.parentId, list);
    }
  }

  // 递归渲染
  const lines: string[] = [];
  const icon = (node: import("@cortex/shared").TaskNode): string => {
    if (node.needsMultiPerspective) return "🔀";
    const t = node.type.toLowerCase();
    if (t === "code" || t === "implementation") return "🔨";
    if (t === "review") return "🔍";
    if (t === "analysis" || t === "research") return "🧠";
    if (t === "fix" || t === "bugfix") return "💊";
    if (t === "inspect" || t === "inspector") return "🔭";
    if (t === "ops" || t === "deploy") return "⚓";
    if (t === "doc-govern" || t === "audit") return "📜";
    if (t === "browser") return "🎆";
    if (t === "loop" || t === "pattern_scan") return "🔮";
    return "📌";
  };

  const render = (node: import("@cortex/shared").TaskNode, depth: number, isLast: boolean, prefix: string) => {
    const connector = depth === 0 ? "" : isLast ? "  └─ " : "  ├─ ";
    const typeLabel = node.type ? `[${node.type}]` : "";
    const tagStr = node.tags?.length ? ` {${node.tags.join(", ")}}` : "";
    const multiStr = node.needsMultiPerspective ? " [多视角]" : "";
    lines.push(`${prefix}${connector}${icon(node)} ${typeLabel} ${node.payload}${tagStr}${multiStr}`);

    const children = childrenMap.get(node.id);
    if (children && children.length > 0) {
      for (let i = 0; i < children.length; i++) {
        const childPrefix = depth === 0 ? "" : isLast ? "    " : "  │ ";
        render(children[i], depth + 1, i === children.length - 1, prefix + childPrefix);
      }
    }
  };

  lines.push("═══════════════════════════════════════");
  lines.push("📋 任务计划（甘雨出品）");
  lines.push("═══════════════════════════════════════");

  for (let i = 0; i < roots.length; i++) {
    render(roots[i], 0, i === roots.length - 1, "");
  }

  return lines.join("\n");
}

/** Plan 模式内部命令处理器 */
async function handlePlanCommand(
  input: string,
  bridge: EngineBridge,
  ctx: {
    getPlanNodes: () => import("@cortex/shared").TaskNode[];
    setPlanNodes: (nodes: import("@cortex/shared").TaskNode[]) => void;
    getPlanIntent: () => string;
    setPlanIntent: (intent: string) => void;
    getFormat: () => string;
    getVerbose: () => boolean;
    bumpGeneration: () => void;
  },
): Promise<"handled" | "passthrough"> {
  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case ".approve": {
      const nodes = ctx.getPlanNodes();
      if (nodes.length === 0) {
        console.log("⚠ 没有待审批的计划。请先输入意图描述让甘雨生成计划。");
        return "handled";
      }

      // 立即快照并清空，防重入竞态（executeAll() 是异步的，可能让出事件循环）
      const snapshot = nodes.slice();
      ctx.setPlanNodes([]);
      ctx.setPlanIntent("");
      ctx.bumpGeneration(); // 废弃空中所有 in-flight 的 executePlanInput 响应

      console.log("\n✅ 计划已批准，开始执行...\n");

      try {
        const brCtx = await bridge.ensureBootstrapped();
        const board = brCtx.taskBoard!;
        const scheduler = brCtx.scheduler!;

        for (const node of snapshot) {
          board.addNode(node);
        }

        if (ctx.getVerbose()) {
          console.log(`[调度] 已添加 ${snapshot.length} 个节点到任务板`);
        }

        console.log("⏳ 正在调度 Agent 执行...");
        const report = await scheduler.executeAll();

        // 输出结果摘要
        const sep = "─".repeat(50);
        console.log(`\n${sep}`);
        console.log("📊 执行结果");
        console.log(`${sep}`);
        console.log(`  ✅ 完成: ${report.completed}  |  ❌ 失败: ${report.failed}  |  ⏱ ${(report.durationMs / 1000).toFixed(1)}s  |  📋 ${report.totalNodes} 节点`);

        // 展示各节点输出
        if (report.results.length > 0) {
          console.log(`\n${sep}`);
          console.log("📝 节点详情");
          console.log(`${sep}`);
          for (const r of report.results) {
            const status = r.success ? "✅" : "❌";
            const agentName = r.agentType ?? "?";
            const shortId = r.nodeId.slice(-12);
            if (r.output) {
              console.log(`\n${status} [${agentName}] ${shortId}`);
              // 智能截断：代码/审查类展示更多，闲聊类截断
              const maxLen = 600;
              const out = r.output.length > maxLen ? r.output.slice(0, maxLen) + `\n... (截断，共 ${r.output.length} 字符)` : r.output;
              console.log(`   ${out.replace(/\n/g, "\n   ")}`);
            } else if (r.error) {
              console.log(`\n${status} [${agentName}] ${shortId}`);
              console.log(`   ⚠ ${r.error.slice(0, 300)}`);
            }
          }
        }
        console.log(`\n${sep}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`执行失败: ${msg}`);
      }

      return "handled";
    }

    case ".reject": {
      const nodes = ctx.getPlanNodes();
      if (nodes.length === 0) {
        console.log("⚠ 没有待审批的计划。");
        return "handled";
      }
      console.log(`❌ 计划已放弃（${nodes.length} 个节点）。`);
      ctx.setPlanNodes([]);
      ctx.setPlanIntent("");
      return "handled";
    }

    case ".status": {
      const nodes = ctx.getPlanNodes();
      if (nodes.length === 0) {
        console.log("📋 当前无计划。输入意图描述让甘雨生成计划。");
      } else {
        const intent = ctx.getPlanIntent();
        console.log(`📋 当前计划: "${intent.slice(0, 80)}${intent.length > 80 ? "..." : ""}"`);
        console.log(`   共 ${nodes.length} 个节点，输入 .approve 执行，.reject 放弃`);
      }
      return "handled";
    }

    default:
      // 非 plan 专属命令，交给通用 handler
      return "passthrough";
  }
}

function handleInternalCommand(input: string, ctx: ReplContext): boolean {
  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case ".help":
      console.log([
        "REPL 内部命令:",
        "  .help                  显示此帮助",
        "  .mode [command|chat|talk|plan] 切换模式",
        "  .agent [type]          查看/切换对话 Agent（chat 模式）",
        "  .history               显示命令历史",
        "  .clear                 清屏",
        "  .exit / .quit          退出 REPL",
        "  .output <fmt>          切换输出格式 (text/json/color)",
        "  .save <file>           保存会话记录",
        "",
        "命令模式 (command): 输入 cortex 命令，如 run/agent/task/...",
        "对话模式 (chat):    派发 Agent 任务，可 @<type> 指定 Agent",
        "闲聊模式 (talk):    纯对话聊天，@agent 可临时叫出 Agent",
        "规划模式 (plan):    甘雨出计划→审阅→.approve 执行/.reject 放弃",
        "  @<type> <msg>   切换 Agent 回应（@review/@code/@analysis 等）",
        "",
        "当前模式: " + MODE_LABELS[ctx.getMode()] +
        (ctx.getMode() === "chat" ? ` → ${getAgentDisplay(ctx.getAgent()).emoji}${getAgentDisplay(ctx.getAgent()).name}` : ""),
      ].join("\n"));
      return true;

    case ".mode": {
      const raw = parts[1];
      // 简写映射: c→command, t→talk, p→plan, ch/chat→chat
      const SHORT: Record<string, ReplMode> = { c: "command", t: "talk", p: "plan" };
      const target = (SHORT[raw] ?? raw) as ReplMode | undefined;
      if (target === "command" || target === "chat" || target === "talk" || target === "plan") {
        ctx.setMode(target);
        // 模式切换时显示角色信息
        if (target === "chat") {
          const display = getAgentDisplay(ctx.getAgent());
          console.log(`\n  ${MODE_LABELS[target]} → ${display.emoji}${display.name} 「${display.signature}」\n`);
        } else if (target === "talk") {
          const display = getAgentDisplay(AgentType.Butler);
          console.log(`\n  ${MODE_LABELS[target]} → ${display.emoji}${display.name} 「${display.signature}」\n`);
        } else {
          console.log(`\n  ${MODE_LABELS[target]} 模式\n`);
        }
      } else {
        console.log(
          `当前模式: ${MODE_LABELS[ctx.getMode()]}\n` +
          "用法: .mode command | chat | talk | plan  (简写: c/ch/t/p)\n" +
          "  command  命令模式——输入 cortex 命令\n" +
          "  chat     对话模式——派发 Agent 任务\n" +
          "  talk     闲聊模式——纯对话聊天\n" +
          "  plan     规划模式——甘雨出计划→审阅→执行",
        );
      }
      return true;
    }

    case ".agent": {
      const target = parts[1]?.toLowerCase();
      if (!target) {
        const display = getAgentDisplay(ctx.getAgent());
        console.log(
          `${display.emoji} 当前对话 Agent: ${display.name}\n` +
          `   「${display.signature}」\n\n` +
          "用法: .agent <type 或中文名>\n" +
          "英文: " + Object.keys(CHAT_AGENT_ALIASES).filter(k => !/[\u4e00-\u9fff]/.test(k)).join(", ") + "\n" +
          "中文: 甘雨, 阿贝多, 刻晴, 纳西妲, 北斗, 希格雯, 莫娜, 安柏, 凝光, 久岐忍, 艾尔海森, 钟离, 霜凝, 托马, 宵宫",
        );
        return true;
      }
      const resolved = CHAT_AGENT_ALIASES[target];
      if (resolved) {
        const prevDisplay = getAgentDisplay(ctx.getAgent());
        ctx.setAgent(resolved);
        const newDisplay = getAgentDisplay(resolved);
        console.log(
          `\n  ${prevDisplay.emoji}${prevDisplay.name} → ${newDisplay.emoji}${newDisplay.name}\n` +
          `  「${newDisplay.signature}」\n`,
        );
      } else {
        console.log(
          `未知 Agent: "${target}"。\n` +
          "可用英文: " + Object.keys(CHAT_AGENT_ALIASES).filter(k => !/[\u4e00-\u9fff]/.test(k)).join(", ") + "\n" +
          "可用中文: 甘雨, 阿贝多, 刻晴, 纳西妲, 北斗, 希格雯, 莫娜, 安柏, 凝光, 久岐忍, 艾尔海森, 钟离, 霜凝, 托马, 宵宫",
        );
      }
      return true;
    }

    case ".history": {
      const history = (ctx.rl as any).history ?? [];
      console.log(history.map((h: string, i: number) => `  ${i + 1}  ${h}`).join("\n") || "  (空)");
      return true;
    }

    case ".clear":
      console.clear();
      return true;

    case ".exit":
    case ".quit": {
      const mode = ctx.getMode();
      const farewells: Record<string, string> = {
        command: "任务完成，先行告退。",
        chat: ctx.getAgent() ? `${getAgentDisplay(ctx.getAgent()).name}已收剑入鞘，后会必有期。` : "后会必有期。",
        talk: "托马：灶上还炖着汤，先告辞啦～",
        plan: "甘雨：计划已归档，随时可唤我回来。",
      };
      console.log(farewells[mode] ?? "再见！");
      ctx.stop();
      return true;
    }

    case ".output": {
      const fmt = parts[1] as string;
      if (fmt === "text" || fmt === "json" || fmt === "color") {
        ctx.setFormat(fmt);
        console.log(`输出格式已切换为: ${fmt}`);
      } else {
        console.log(`未知格式: "${fmt}"。可用: text, json, color`);
      }
      return true;
    }

    case ".save": {
      const filePath = parts[1];
      if (!filePath) {
        console.log("请指定文件路径。用法: .save <file>");
        return true;
      }
      try {
        const history = (ctx.rl as any).history ?? [];
        const content = history.join("\n");
        fs.writeFileSync(path.resolve(filePath), content, "utf-8");
        console.log(`会话已保存: ${filePath}`);
      } catch (err) {
        console.error(`保存失败: ${err}`);
      }
      return true;
    }

    default:
      console.log(`未知内部命令: "${cmd}"。输入 .help 查看可用命令。`);
      return true;
  }
}
