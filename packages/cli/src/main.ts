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
 * 职责：纯编排——按顺序调用引导模块，组装后启动命令分发。
 * LLM/MCP/命令注册/参数解析 均抽离到对应模块。
 */

// ── Node built-in ────────────────────────────────
import { execSync } from "node:child_process";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

// ── Workspace packages ───────────────────────────
import { DocRegistry } from "@cortex/governance";
import { NodeFileSystemAdapter, Toolkit } from "@cortex/platform";

// ── Config 常量 ──────────────────────────────────
import {
  FILE_DOTENV,
  FILE_CORTEX_AGENTS_JSON,
  CLI_EXIT_INTERNAL_ERROR,
  WINDOWS_CHCP_UTF8,
} from "@cortex/config";

// ── 引导模块 ─────────────────────────────────────
import { bootstrapLlm, hasAnyLlmKey, enableLlmAudit } from "./bootstrap/llm.js";
import { bootstrapMcp } from "./bootstrap/mcp.js";

// ── 命令 ─────────────────────────────────────────
import { CommandRegistry } from "./commands/index.js";
import { registerCommands } from "./commands/command-list.js";
import { tuiReplHandler } from "@cortex/tui";
import { createVersionHandler } from "./commands/version.js";
import { createHelpHandler } from "./commands/help.js";

// ── 基础设施 ─────────────────────────────────────
import { ConfigManager } from "./services/config-manager.js";
import { EngineBridge } from "./services/engine-bridge.js";
import { detectDefaultFormat } from "./formatters/index.js";
import {
  parseGlobalFormat,
  createDefaultContext,
  outputResult,
  stripGlobalOptions,
  isDirectRun,
} from "./utils.js";
import type { CommandContext } from "./types.js";

// ═══════════════════════════════════════════════════
// 启动前引导
// ═══════════════════════════════════════════════════

/** 解析 --dir 全局选项 */
function parseProjectRoot(): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--dir=")) return nodePath.resolve(argv[i].slice(6));
    if ((argv[i] === "--dir" || argv[i] === "-d") && i + 1 < argv.length)
      return nodePath.resolve(argv[i + 1]);
  }
  return process.cwd();
}

const PROJECT_ROOT = parseProjectRoot();

const CONFIG_ROOT = (PROJECT_ROOT !== process.cwd() &&
  !nodeFs.existsSync(nodePath.join(PROJECT_ROOT, FILE_CORTEX_AGENTS_JSON)))
  ? process.cwd()
  : PROJECT_ROOT;

/** 加载 .env */
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(CONFIG_ROOT);
enableLlmAudit();

// ═══════════════════════════════════════════════════
// 引导启动
// ═══════════════════════════════════════════════════

const configManager = new ConfigManager();
const engineBridge = new EngineBridge(configManager);

const llms = await bootstrapLlm();
let toolkit: Toolkit | undefined;

if (llms.size > 0) {
  toolkit = new Toolkit();

  // MCP 后端
  try {
    await bootstrapMcp(toolkit, CONFIG_ROOT);
  } catch (e) {
    if (!process.env["VITEST"]) console.warn(`[bootstrap] MCP 后端配置加载失败: ${String(e)}`);
  }

  engineBridge.setBootstrapConfig({
    llms,
    toolkit,
    projectRoot: CONFIG_ROOT,
    workspaceRoot: PROJECT_ROOT,
  });
}

const fs = new NodeFileSystemAdapter();
const docRegistry = new DocRegistry(fs, CONFIG_ROOT);

// ═══════════════════════════════════════════════════
// 命令注册
// ═══════════════════════════════════════════════════

const registry = new CommandRegistry();
registerCommands(registry, { engineBridge, configManager, docRegistry });

// ═══════════════════════════════════════════════════
// 入口函数
// ═══════════════════════════════════════════════════

export async function main(): Promise<number> {
  try { execSync(WINDOWS_CHCP_UTF8, { stdio: "pipe" }); } catch { /* 非 Windows */ }

  const argv = process.argv.slice(2);

  // --version / -V
  if (argv[0] === "--version" || argv[0] === "-V") {
    const r = await createVersionHandler()([], {}, createDefaultContext(PROJECT_ROOT));
    outputResult(r, detectDefaultFormat());
    return r.exitCode;
  }

  // bare cortex → TUI REPL（v3 全量替换）
  if (argv.length === 0) {
    if (!hasAnyLlmKey()) {
      console.log("💡 未检测到任何 DEEPSEEK_*_API_KEY，chat/talk/plan 模式需要 LLM 后端。");
      console.log("   在 .env 中配置 DEEPSEEK_API_KEY（或 DEEPSEEK_CYRENE/CHAT/REASONER_API_KEY）后重启即可。");
      console.log("   command 模式无需 Key——输入 .mode command 切换。\n");
    }
    return await tuiReplHandler(registry, engineBridge, createDefaultContext(PROJECT_ROOT));
  }

  // --help / -h
  if (argv[0] === "--help" || argv[0] === "-h") {
    const r = await createHelpHandler(registry)([], {}, createDefaultContext(PROJECT_ROOT));
    outputResult(r, detectDefaultFormat());
    return r.exitCode;
  }

  // 解析全局选项
  const globalFormat = parseGlobalFormat(argv);
  const globalQuiet = argv.includes("--quiet") || argv.includes("-q");
  const globalVerbose = argv.includes("--verbose") || argv.includes("-v");

  const cleanArgs = stripGlobalOptions(argv);

  const context: CommandContext = {
    format: globalFormat,
    quiet: globalQuiet,
    verbose: globalVerbose,
    configPath: undefined,
    rawOptions: {},
    projectRoot: PROJECT_ROOT,
  };

  // cortex <command> --help → cortex help <command>
  const helpFlagIdx = cleanArgs.findIndex((a) => a === "--help" || a === "-h");
  if (helpFlagIdx !== -1) {
    const cmdForHelp = helpFlagIdx > 0 ? cleanArgs[0] : undefined;
    const r = await createHelpHandler(registry)(cmdForHelp ? [cmdForHelp] : [], {}, context);
    if (!globalQuiet) outputResult(r, globalFormat);
    return r.exitCode;
  }

  try {
    const r = await registry.dispatch(cleanArgs, context);
    if (!globalQuiet) outputResult(r, globalFormat);
    return r.exitCode;
  } catch (err) {
    console.error(`✗ 未预期错误: ${err instanceof Error ? err.message : String(err)}`);
    return CLI_EXIT_INTERNAL_ERROR;
  } finally {
    await engineBridge.shutdown();
  }
}

// ═══════════════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════════════

if (isDirectRun()) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(`✗ 致命错误: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(CLI_EXIT_INTERNAL_ERROR);
  });
}
