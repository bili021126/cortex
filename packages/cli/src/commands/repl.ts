 
/**
 * commands/repl.ts — `cortex repl` REPL 交互模式
 *
 * 进入交互式 REPL 会话。支持四种模式：
 *   - command 模式：输入 cortex 命令（run/agent/task/...）
 *   - chat 模式：自然语言对话，走引擎调度管线（甘雨拆解→Agent执行→管家回话）
 *   - talk 模式：昔涟独立陪聊，不经调度器
 *   - plan 模式：甘雨出计划→审阅→.approve 执行
 *
 * 代码架构（slim skeleton）：
 *   - repl/types.ts     类型、常量、Agent 展示
 *   - repl/display.ts    persona、意图分类、Agent 前缀
 *   - repl/executors.ts  chat/talk/plan 三种执行器
 *   - repl/commands.ts   内部命令（.help/.mode/.exit 等）
 *
 * @see CLI 设计文档 §4.14
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import type { CommandRegistry } from "./index.js";
import type { ICortexApi } from "@cortex/shared";
import {
  CORTEX_VERSION,
  CORTEX_PHASE,
  DIR_CORTEX,
  FILE_REPL_HISTORY,
} from "@cortex/config";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  ReplMode,
  MODE_LABELS,
  getAgentDisplay,
  PlanExecutionContext,
} from "./repl/types.js";
import { parseAgentPrefix, buildPrompt } from "./repl/display.js";
import {
  executeChatInput,
  executeTalkInput,
  executeTrioInput,
  executePartyInput,
  executePlanInput,
  handlePlanCommand,
  clearTalkHistory,
} from "./repl/executors.js";
import { handleInternalCommand } from "./repl/commands.js";
import { createPartyState } from "./repl/party.js";
import { getFormatter, detectDefaultFormat } from "../formatters/index.js";
import { AgentType, AGENT_CHINESE_ROLE } from "@cortex/shared";

// 重新导出 injectAgentDisplayFromConfig 供外部使用
export { injectAgentDisplayFromConfig } from "./repl/types.js";

// ── REPL 主入口 ──────────────────────────────────

export function createReplHandler(
  registry: CommandRegistry,
  bridge: ICortexApi,
): CommandHandler {
  return async (args, options, context): Promise<CommandResult> => {
    const _dbPath = options["db"] as string | undefined;
    const promptStr = (options["prompt"] as string) ?? undefined;
    const noHistory = options["no-history"] as boolean;
    const initFile = options["init"] as string | undefined;
    const startMode: ReplMode = (options["mode"] as ReplMode) ?? "chat";
    const historyFile = path.join(os.homedir(), DIR_CORTEX, FILE_REPL_HISTORY);

    let replFormat = detectDefaultFormat();
    let replMode: ReplMode = startMode;
    let chatAgent: AgentType = AgentType.Analysis;
    let running = true;

    // ── Plan Mode 状态 ──
    let planNodes: import("@cortex/shared").TaskNode[] = [];
    let planIntent = "";
    let sessionGeneration = 0;
    let busy = false;

    // ── Talk Companion（三人对话）──
    let talkCompanion: AgentType | null = null;

    // ── Party State（群聊）──
    let partyState = createPartyState();

    function bumpGeneration() { sessionGeneration++; }

    console.log(`🧠 Cortex REPL (v${CORTEX_VERSION}, ${CORTEX_PHASE})`);
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
      console.log(`   .with <名称> 可邀请人加入三人对话，.without 请离`);
    }
    if (replMode === "party") {
      console.log(`   群聊模式——自由抢麦+@点名，完全角色化`);
      console.log(`   .group create <群名> 创建群聊，.group invite <名称> 拉人`);
      console.log(`   .group list 查看成员，.groups 列出所有群`);
    }
    if (replMode === "plan") {
      console.log(`   规划模式——甘雨先生出计划，你审阅后 .review 三省审议 → .approve 执行`);
      console.log(`   输入意图描述，甘雨会拆解为任务树。.approve 批准执行，.reject 放弃`);
    }
    console.log(`   输入 .help 查看内部命令，Ctrl+C 或 .exit 退出`);
    console.log(`   输入 .mode 切换模式\n`);

    // 初始化引擎
    try {
      await bridge.ensureBootstrapped();
    } catch {
      await bridge.ensureReady();
    }

    // P1: 生产环境 MemoryStore 强制走 SQLite——启动阶段不阻塞检查

    // 加载初始化脚本
    if (initFile) {
      try {
        const initContent = fs.readFileSync(path.resolve(initFile), "utf-8");
        for (const line of initContent.split("\n").filter((l) => l.trim() && !l.startsWith("#"))) {
          console.log(`> ${line}`);
          await executeLine(line.trim(), registry, bridge, context, replFormat, replMode, chatAgent, talkCompanion, partyState);
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
        (rl as any).history = history.slice(-100);
      } catch { /* 忽略 */ }
    }

    rl.on("line", async (line: string) => {
      const trimmed = line.trim();

      if (!trimmed) {
        rl.prompt();
        return;
      }

      // 内部命令：始终立即可用，不阻塞
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

        // 通用内部命令
        const _consumed = handleInternalCommand(trimmed, {
          rl, promptStr, historyFile, noHistory,
          setFormat: (f) => { replFormat = f; },
          setMode: (m) => {
            replMode = m;
            clearTalkHistory();
            bumpGeneration();
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
          getTalkCompanion: () => talkCompanion,
          setTalkCompanion: (a) => { talkCompanion = a; },
          getPartyState: () => partyState,
          syncPartyState: (s) => { partyState = s; },
        });
        if (!running) return;
        rl.prompt();
        return;
      }

      // LLM 调用：串行化，防重叠
      if (busy) {
        console.log("⏳ 上一个操作仍在处理中，请稍候...");
        rl.prompt();
        return;
      }
      busy = true;
      const startGen = sessionGeneration;
      try {
        await executeLine(trimmed, registry, bridge, context, replFormat, replMode, chatAgent, talkCompanion, partyState, {
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

    // eslint-disable-next-line @typescript-eslint/return-await
    return new Promise(() => {
      rl.on("close", () => {
        bridge.shutdown();
        process.exit(0);
      });
    });
  };
}

// ── 行执行分发 ──────────────────────────────────

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
  bridge: ICortexApi,
  context: CommandContext,
  format: ReturnType<typeof detectDefaultFormat>,
  mode: ReplMode,
  currentAgent: AgentType,
  talkCompanion: AgentType | null,
  partyState: ReturnType<typeof createPartyState>,
  planCtx?: PlanExecutionContext,
): Promise<void> {
  const fmt = getFormatter(format);

  // ── chat 模式：自然语言 → 引擎 ──
  if (mode === "chat") {
    const { agent, input } = parseAgentPrefix(line, currentAgent);
    if (agent === AgentType.Butler) {
      await executeTalkInput(input, bridge, context, fmt);
      return;
    }
    await executeChatInput(input, bridge, context, fmt, agent,
      agent !== currentAgent ? currentAgent : undefined);
    return;
  }

  // ── plan 模式 ──
  if (mode === "plan") {
    await executePlanInput(line, bridge, context, fmt, planCtx);
    return;
  }

  // ── talk 模式：纯闲聊，@agent 临时叫 Agent，.with 开启三人对话 ──
  if (mode === "talk") {
    const { agent, input } = parseAgentPrefix(line, AgentType.Butler);
    if (agent !== AgentType.Butler) {
      const display = getAgentDisplay(agent);
      console.log(`  @${agent} → ${display.emoji}${display.name} 登场！${display.signature}`);
      await executeChatInput(input, bridge, context, fmt, agent);
    } else if (talkCompanion) {
      // 三人对话模式
      await executeTrioInput(input, bridge, context, fmt, talkCompanion);
    } else {
      // 二人独处
      await executeTalkInput(input, bridge, context, fmt);
    }
    return;
  }

  // ── party 模式：群聊 ──
  if (mode === "party") {
    await executePartyInput(line, bridge, context, fmt, partyState);
    return;
  }

  // ── command 模式：先尝试命令路由 ──
  try {
    const args = line.split(/\s+/);
    const result = await registry.dispatch(args, {
      ...context,
      format,
    });

    if (result.success || (result.error && !result.error.includes("未知命令"))) {
      console.log(result.success ? fmt.formatSuccess(result) : fmt.formatError(result));
      return;
    }

    // 未知命令 → 如果看起来像自然语言，fallthrough 到引擎
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
