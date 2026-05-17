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
import { createInspectHandler } from "./commands/inspect.js";
import { createConfirmHandler } from "./commands/confirm.js";
import { ConfigManager } from "./services/config-manager.js";
import { EngineBridge } from "./services/engine-bridge.js";
import { DocRegistry, NodeFileSystemAdapter } from "@cortex/engine";
import { getFormatter, detectDefaultFormat } from "./formatters/index.js";
import type { OutputFormat, CommandContext, CommandResult } from "./types.js";

// ── 全局配置与桥接 ──────────────────────────────────

const configManager = new ConfigManager();
const engineBridge = new EngineBridge(configManager);
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
    name: "repl",
    alias: "re",
    description: "进入 REPL 交互模式",
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
  const argv = process.argv.slice(2);

  // cortex --version
  if (argv.length === 0 || argv[0] === "--version" || argv[0] === "-V") {
    const handler = createVersionHandler();
    const result = await handler([], {}, createDefaultContext());
    outputResult(result, detectDefaultFormat());
    return result.exitCode;
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

main().then((code) => {
  process.exit(code);
}).catch((err) => {
  console.error(`✗ 致命错误: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(8);
});
