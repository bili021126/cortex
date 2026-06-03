#!/usr/bin/env node
 

/**
 * main.ts — Cortex CLI 统一入口
 *
 * @see CLI 设计文档 v0.2
 *
 * 用法:
 *   cortex <命令> [子命令] [选项]
 *   cortex run <file> -o <output>
 *   cortex agent list --status awake
 *   cortex memory search <query>
 *   cortex help
 *
 * 新式入口，替代旧 cli.ts 的 Markdown→HTML 专用转换器。
 * 旧 cli.ts 保留为 cortex doc convert 的后端。
 */

// ── Node built-in ────────────────────────────────
import { execSync } from "node:child_process";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

// ── Workspace packages ───────────────────────────
import { DocRegistry, NodeFileSystemAdapter, Toolkit, SearchAggregator, McpSearchBackend, DdgSearchBackend, type McpServerConfig } from "@cortex/engine";
import { LlmAdapter } from "@cortex/llm";

// ── Local modules ────────────────────────────────
import { CommandRegistry } from "./commands/index.js";
import { createRunHandler } from "./commands/run.js";
import { createAgentHandler } from "./commands/agent.js";
import { createTaskHandler } from "./commands/task.js";
import { createMemoryHandler } from "./commands/memory.js";
import { createConfigHandler } from "./commands/config.js";
import { createDocHandler } from "./commands/doc.js";
import { createVersionHandler } from "./commands/version.js";
import { createHelpHandler } from "./commands/help.js";
import { createReplHandler } from "./commands/repl.js";
import { createScheduleHandler } from "./commands/schedule.js";
import { createRoundtableHandler } from "./commands/roundtable.js";
import { createSetupHandler } from "./commands/setup.js";
import { createInspectHandler } from "./commands/inspect.js";
import { createConfirmHandler } from "./commands/confirm.js";
import { createSkillHandler } from "./commands/skill.js";
import { ConfigManager } from "./services/config-manager.js";
import { EngineBridge } from "./services/engine-bridge.js";
import { getFormatter, detectDefaultFormat } from "./formatters/index.js";
import type { OutputFormat, CommandContext, CommandResult } from "./types.js";
import {
  FILE_DOTENV,
  FILE_CORTEX_AGENTS_JSON,
  ENV_CORTEX_API_AUDIT,
  ENV_CORTEX_NO_SEARCH,
  ENV_DEEPSEEK_BASE_URL,
  ENV_DEEPSEEK_CHAT_MODEL,
  ENV_DEEPSEEK_REASONER_MODEL,
  ENV_DEEPSEEK_REASONING_EFFORT,
  ENV_DEEPSEEK_API_KEY,
  ENV_DEEPSEEK_CYRENE_API_KEY,
  ENV_DEEPSEEK_CHAT_API_KEY,
  ENV_DEEPSEEK_REASONER_API_KEY,
  ENV_PM_MASTER_KEY,
  ENV_VITEST,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_CHAT_MODEL,
  DEFAULT_LLM_REASONER_MODEL,
} from "@cortex/config";

// ── .env 加载 ────────────────────────────────────

function loadEnv(projectRoot: string): void {
  const envPath = nodePath.join(projectRoot, FILE_DOTENV);
  if (!nodeFs.existsSync(envPath)) return;
  const content = nodeFs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // 去除外层引号（单引号或双引号）
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnv(process.cwd());

// 启用 API 审计日志（环境变量 CORTEX_API_AUDIT=0 可关闭）
if (process.env[ENV_CORTEX_API_AUDIT] !== "0") {
  LlmAdapter.enableAudit();
}

// ── 全局配置与桥接 ──────────────────────────────────

const configManager = new ConfigManager();
const engineBridge = new EngineBridge(configManager);

// ── LLM 配置（若 .env 中存在 API Key 则走配置驱动模式）──
// Agent 配置独立化：3-Key 独立模式（昔涟 / Chat池 / Reasoner）
// 密钥加载优先级：pm vault > DEEPSEEK_*_API_KEY > DEEPSEEK_API_KEY（兜底）

// 共享的模型/URL 配置（Key 不同但模型和 endpoint 相同）
const llmBaseUrl = process.env[ENV_DEEPSEEK_BASE_URL] || DEFAULT_LLM_BASE_URL;
const llmChatModel = process.env[ENV_DEEPSEEK_CHAT_MODEL] || DEFAULT_LLM_CHAT_MODEL;
const llmReasonerModel = process.env[ENV_DEEPSEEK_REASONER_MODEL] || DEFAULT_LLM_REASONER_MODEL;
const llmReasoningEffort = (process.env[ENV_DEEPSEEK_REASONING_EFFORT] as "high" | "max") || undefined;

const fallbackKey = process.env[ENV_DEEPSEEK_API_KEY];

// 若设置了 PM_MASTER_KEY，尝试从 pm 加密 vault 加载密钥
let pmStore: typeof import("@cortex/pm") | undefined;
if (process.env[ENV_PM_MASTER_KEY]) {
  try {
    pmStore = await import("@cortex/pm");
  } catch {
    // @cortex/pm 不可用，静默回退到环境变量
  }
}

/** 按优先级解析 API Key：vault → 专用环境变量 → DEEPSEEK_API_KEY 兜底 */
function resolveKey(pmKey: string, envVarName: string): string | undefined {
  if (pmStore) {
    try {
      const entry = pmStore.getEntry(pmKey);
      if (entry) return entry.password;
    } catch {
      // vault 读取失败，继续回退
    }
  }
  return process.env[envVarName] || fallbackKey || undefined;
}

const llms = new Map<string, LlmAdapter>();

// 昔涟独立 Key
const cyreneKey = resolveKey("DEEPSEEK_CYRENE", ENV_DEEPSEEK_CYRENE_API_KEY);
if (cyreneKey) {
  llms.set("DEEPSEEK_CYRENE", new LlmAdapter({
    apiKey: cyreneKey,
    baseUrl: llmBaseUrl,
    chatModel: llmChatModel,
    reasonerModel: llmReasonerModel,
    reasoningEffort: llmReasoningEffort,
    label: "cyrene",
  }));
}

// Chat 池 Key
const chatKey = resolveKey("DEEPSEEK_CHAT", ENV_DEEPSEEK_CHAT_API_KEY);
if (chatKey) {
  llms.set("DEEPSEEK_CHAT", new LlmAdapter({
    apiKey: chatKey,
    baseUrl: llmBaseUrl,
    chatModel: llmChatModel,
    reasonerModel: llmReasonerModel,
    reasoningEffort: llmReasoningEffort,
    label: "chat",
  }));
}

// Reasoner Key
const reasonerKey = resolveKey("DEEPSEEK_REASONER", ENV_DEEPSEEK_REASONER_API_KEY);
if (reasonerKey) {
  llms.set("DEEPSEEK_REASONER", new LlmAdapter({
    apiKey: reasonerKey,
    baseUrl: llmBaseUrl,
    chatModel: llmChatModel,
    reasonerModel: llmReasonerModel,
    reasoningEffort: llmReasoningEffort,
    label: "reasoner",
  }));
}

if (llms.size > 0) {
  const toolkit = new Toolkit();

  // ── 搜索后端集成（从 cortex-agents.json 读取 MCP 后端配置）──
  // 设置 CORTEX_NO_SEARCH=1 可跳过搜索后端启动
  if (process.env[ENV_CORTEX_NO_SEARCH] === "1") {
    // 搜索后端已通过环境变量禁用
  } else try {
    const configPath = nodePath.join(process.cwd(), FILE_CORTEX_AGENTS_JSON);
    if (nodeFs.existsSync(configPath)) {
      const raw = JSON.parse(nodeFs.readFileSync(configPath, "utf-8"));
      const searchProviders = raw?.searchProviders;
      if (searchProviders?.backends && Array.isArray(searchProviders.backends)) {
        const mcpBackends = (searchProviders.backends as McpServerConfig[])
          .filter((b) => b.enabled);

        if (mcpBackends.length > 0) {
          const ddgBackend = new DdgSearchBackend();
          const started: McpSearchBackend[] = [];

          for (const cfg of mcpBackends) {
            // 从 process.env 注入配置（如需）
            const env: Record<string, string> = {};

            const backend = new McpSearchBackend({ ...cfg, env });
            try {
              await backend.start();
              started.push(backend);
              if (!process.env[ENV_VITEST]) console.log(`[bootstrap] 搜索后端已连接: ${cfg.id} (${backend.serverName ?? cfg.id})`);
            } catch (e) {
              if (!process.env[ENV_VITEST]) console.warn(`[bootstrap] 搜索后端启动失败: ${cfg.id} — ${String(e)}`);
            }
          }

          if (started.length > 0) {
            const aggregator = new SearchAggregator({
              backends: [...started, ddgBackend],
            });
            toolkit.setSearchAggregator(aggregator);
          }
        }
      }
    }
  } catch (e) {
    if (!process.env[ENV_VITEST]) console.warn(`[bootstrap] 搜索后端配置加载失败: ${String(e)}`);
  }

  engineBridge.setBootstrapConfig({
    llms,
    toolkit,
    projectRoot: process.cwd(),
  });
}
const fs = new NodeFileSystemAdapter();
const docRegistry = new DocRegistry(fs, process.cwd());

// ── 命令注册表 ──────────────────────────────────────

const registry = new CommandRegistry();

registry.registerAll([
  {
    name: "run",
    alias: "r",
    description: "单次执行 — 接受输入文件，调度 Agent 执行，输出结果",
    handler: createRunHandler(engineBridge),
  },
  {
    name: "agent",
    alias: "a",
    description: "Agent 管理 — 列出、查看、启动、回收 Agent 实例",
    handler: createAgentHandler(engineBridge),
  },
  {
    name: "task",
    alias: "t",
    description: "任务管理 — 提交、查询、取消、重跑任务",
    handler: createTaskHandler(engineBridge),
  },
  {
    name: "memory",
    alias: "m",
    description: "记忆系统 — 读写记忆、搜索、关联、生命周期管理",
    handler: createMemoryHandler(engineBridge),
  },
  {
    name: "config",
    alias: "c",
    description: "配置管理 — 列出、获取、设置、校验配置",
    handler: createConfigHandler(configManager),
  },
  {
    name: "doc",
    alias: "d",
    description: "文档工具 — Markdown→HTML 转换、文档服务器、合规检查",
    handler: createDocHandler(),
  },
  {
    name: "schedule",
    alias: "s",
    description: "调度系统 — 从文件生成计划、执行计划、查看状态",
    handler: createScheduleHandler(engineBridge),
  },
  {
    name: "roundtable",
    description: "圆桌辩论 — 多 Agent 共识会议",
    handler: createRoundtableHandler(engineBridge, docRegistry),
  },
  {
    name: "inspect",
    alias: "i",
    description: "项目侦察 — 目录结构、依赖拓扑、配置漂移",
    handler: createInspectHandler(),
  },
  {
    name: "confirm",
    alias: "cf",
    description: "确认门 — 查看和操作待确认的 L2/L3 操作",
    handler: createConfirmHandler(engineBridge),
  },
  {
    name: "skill",
    alias: "sk",
    description: "技能管理 — 注册、搜索、执行、安装技能",
    handler: createSkillHandler(),
  },
  {
    name: "setup",
    alias: "su",
    description: "交互式配置界面 — 管理 cortex-agents.json / cortex-cognition.json / cortex-docs.json",
    handler: createSetupHandler(),
  },
  {
    name: "repl",
    alias: "re",
    description: "进入 REPL 交互模式（--mode command|chat 指定模式）",
    handler: createReplHandler(registry, engineBridge),
  },
  {
    name: "version",
    alias: "v",
    description: "版本信息",
    handler: createVersionHandler(),
  },
  {
    name: "help",
    alias: "h",
    description: "帮助信息",
    handler: createHelpHandler(registry),
  },
]);

// ── 参数解析与执行 ──────────────────────────────────

export async function main(): Promise<number> {
  // 修复 Windows PowerShell 中文/emoji 乱码
  try { execSync("chcp 65001", { stdio: "pipe" }); } catch { /* 非 Windows 环境忽略 */ }

  const argv = process.argv.slice(2);

  // cortex --version / -V
  if (argv[0] === "--version" || argv[0] === "-V") {
    const handler = createVersionHandler();
    const result = await handler([], {}, createDefaultContext());
    outputResult(result, detectDefaultFormat());
    return result.exitCode;
  }

  // bare cortex → 直接进入 REPL 交互模式（默认 chat）
  if (argv.length === 0) {
    // 无 API Key 时先打一个轻量提示，不阻塞进入 REPL
    if (!process.env[ENV_DEEPSEEK_API_KEY] && !process.env[ENV_DEEPSEEK_CYRENE_API_KEY] && !process.env[ENV_DEEPSEEK_CHAT_API_KEY] && !process.env[ENV_DEEPSEEK_REASONER_API_KEY]) {
      console.log("💡 未检测到任何 DEEPSEEK_*_API_KEY，chat/talk/plan 模式需要 LLM 后端。");
      console.log("   在 .env 中配置 DEEPSEEK_API_KEY（或 DEEPSEEK_CYRENE/CHAT/REASONER_API_KEY）后重启即可。");
      console.log("   command 模式无需 Key——输入 .mode command 切换。\n");
    }
    const replHandler = createReplHandler(registry, engineBridge);
    await replHandler([], {}, createDefaultContext());
    return 0;
  }

  // cortex --help / -h
  if (argv[0] === "--help" || argv[0] === "-h") {
    const handler = createHelpHandler(registry);
    const result = await handler([], {}, createDefaultContext());
    outputResult(result, detectDefaultFormat());
    return result.exitCode;
  }

  // 解析全局选项
  const globalFormat = parseGlobalFormat(argv);
  const globalQuiet = argv.includes("--quiet") || argv.includes("-q");
  const globalVerbose = argv.includes("--verbose") || argv.includes("-v");

  // 去除全局选项后的参数
  const cleanArgs = argv.filter((a) =>
    !["--quiet", "-q", "--verbose", "-v", "--no-color"].includes(a) &&
    !a.startsWith("--format=") && a !== "--format" && a !== "-f"
  );

  // 移除 --format 及其值
  const fmtIdx = cleanArgs.indexOf("--format");
  if (fmtIdx !== -1) {
    cleanArgs.splice(fmtIdx, 2);
  }
  const shortFmtIdx = cleanArgs.indexOf("-f");
  if (shortFmtIdx !== -1) {
    cleanArgs.splice(shortFmtIdx, 2);
  }

  const context: CommandContext = {
    format: globalFormat,
    quiet: globalQuiet,
    verbose: globalVerbose,
    configPath: undefined,
    rawOptions: {},
  };

  try {
    const result = await registry.dispatch(cleanArgs, context);
    if (!globalQuiet) {
      outputResult(result, globalFormat);
    }
    return result.exitCode;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ 未预期错误: ${msg}`);
    return 8; // 内部错误
  } finally {
    await engineBridge.shutdown();
  }
}

function parseGlobalFormat(argv: string[]): OutputFormat {
  // --format=json
  for (const arg of argv) {
    if (arg.startsWith("--format=")) {
      const fmt = arg.slice(9) as OutputFormat;
      if (fmt === "text" || fmt === "json" || fmt === "color") return fmt;
    }
  }
  // -f json
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--format" || argv[i] === "-f") && i + 1 < argv.length) {
      const fmt = argv[i + 1] as OutputFormat;
      if (fmt === "text" || fmt === "json" || fmt === "color") return fmt;
    }
  }
  return detectDefaultFormat();
}

function createDefaultContext(): CommandContext {
  return {
    format: detectDefaultFormat(),
    quiet: false,
    verbose: false,
    rawOptions: {},
  };
}

function outputResult(result: CommandResult, format: OutputFormat): void {
  const fmt = getFormatter(format);
  if (result.success) {
    console.log(fmt.formatSuccess(result));
  } else {
    console.error(fmt.formatError(result));
  }
}

// ── 启动 ───────────────────────────────────────────
// 仅在直接运行时自启动；被 @cortex/cli barrel 导入时跳过，避免测试中触发 process.exit
const isDirectRun = process.argv[1]?.replaceAll("\\", "/").endsWith("/src/main.ts")
  || process.argv[1]?.replaceAll("\\", "/").endsWith("/src/main.js")
  || process.argv[1]?.replaceAll("\\", "/").endsWith("/dist/main.js");
if (isDirectRun) {
  main().then((code) => {
    process.exit(code);
  }).catch((err) => {
    console.error(`✗ 致命错误: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(8);
  });
}
