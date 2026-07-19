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
import type { ICommandContext } from "@cortex/shared";
import { registerCommands } from "./commands/command-list.js";
import { tuiReplHandler, startInkTui } from "./tui/index.js";
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (argv[i]?.startsWith("--dir=")) return nodePath.resolve(argv[i]!.slice(6));
    if ((argv[i] === "--dir" || argv[i] === "-d") && i + 1 < argv.length)
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return nodePath.resolve(argv[i + 1]!);
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

// ── Ink 模式：提前重定向 stdout/stderr ────────────
// bootstrap 日志会破坏 Ink 终端布局，需在引导前拦截
const INK_MODE = process.argv.includes("--ink");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let _inkLogStream: import("node:fs").WriteStream | undefined;
let _origStdout: typeof process.stdout.write | undefined;
let _origStderr: typeof process.stderr.write | undefined;
let _origConsoleLog: typeof console.log | undefined;

/** 恢复被 Ink 模式重定向的 stdout/stderr/console.log（幂等，可安全多次调用） */
function restoreInkStreams(): void {
  if (_origStdout) { process.stdout.write = _origStdout; _origStdout = undefined; }
  if (_origStderr) { process.stderr.write = _origStderr; _origStderr = undefined; }
  if (_origConsoleLog) { console.log = _origConsoleLog; _origConsoleLog = undefined; }
  if (_inkLogStream) { _inkLogStream.end(); _inkLogStream = undefined; }
}

if (INK_MODE) {
  const { createWriteStream: _cws } = await import("node:fs");
  const logDir = nodePath.join(CONFIG_ROOT, ".cortex", "logs");
  _inkLogStream = _cws(nodePath.join(logDir, "engine.log"), { flags: "a" });
  _origStdout = process.stdout.write.bind(process.stdout);
  _origStderr = process.stderr.write.bind(process.stderr);
  _origConsoleLog = console.log.bind(console);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = ((_chunk: Uint8Array | string, ..._args: any[]) => true) as typeof process.stdout.write;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stderr.write = ((_chunk: Uint8Array | string, ..._args: any[]) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    _inkLogStream!.write(_chunk);
    return true;
  }) as typeof process.stderr.write;
  console.log = (..._args: unknown[]) => { /* suppressed during Ink boot */ };
}

// ═══════════════════════════════════════════════════
// 引导启动
// ═══════════════════════════════════════════════════

let engineBridge: EngineBridge;
let registry: CommandRegistry;

try {
  const configManager = new ConfigManager();
  engineBridge = new EngineBridge(configManager);

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

  // 命令注册
  registry = new CommandRegistry();
  registerCommands(registry, { engineBridge, configManager, docRegistry });
} catch (err) {
  // Ink 模式下 stdout/console.log 已静音、stderr 被导向日志文件；引导失败必须先
  // 恢复真实终端流，再把错误打出来，否则用户只看到进程静默退出（C5 静默崩溃）。
  restoreInkStreams();
  console.error(`✗ 引导失败: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(CLI_EXIT_INTERNAL_ERROR);
}

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

  // bare cortex → TUI（v5 Ink 或 v3 readline）
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--ink")) {
    const useInk = argv.includes("--ink");
    if (!hasAnyLlmKey()) {
      console.error("💡 未检测到任何 DEEPSEEK_*_API_KEY，chat/talk/plan 模式需要 LLM 后端。");
      console.error("   在 .env 中配置 DEEPSEEK_API_KEY（或 DEEPSEEK_CYRENE/CHAT/REASONER_API_KEY）后重启即可。");
      console.error("   直接输入命令名即可（如 ls、git status），无需切换模式。\n");
    }
    if (useInk) {
      try {
        return await startInkTui({
          registry,
          bridge: engineBridge,
          context: createDefaultContext(PROJECT_ROOT) as unknown as ICommandContext,
          origStdout: _origStdout,
        });
      } finally {
        // 无论 startInkTui 正常返回还是抛出，都恢复被重定向的流，避免异常被吞进
        // 日志文件、终端静默退出（C5）。restoreInkStreams 幂等，stdout 亦一并恢复。
        restoreInkStreams();
      }
    }
    return await tuiReplHandler(registry, engineBridge, createDefaultContext(PROJECT_ROOT) as unknown as ICommandContext);
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
    const r = await registry.dispatch(cleanArgs, context as unknown as ICommandContext);
    if (!globalQuiet) outputResult({
      success: r.code === 0,
      output: r.output,
      exitCode: r.code,
    }, globalFormat);
    return r.code;
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
