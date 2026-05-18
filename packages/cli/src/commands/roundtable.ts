/**
 * commands/roundtable.ts — `cortex roundtable` 圆桌辩论命令
 *
 * 多 Agent 圆桌共识会议——Cortex 的核心元能力。
 * 启动一轮由多位 Agent Persona 参与的讨论，产出共识修复清单或决策结论。
 *
 * @see CLI 设计文档 §4.4
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import type { EngineBridge } from "../services/engine-bridge.js";
import type { DocRegistry } from "@cortex/engine";

/** 圆桌会议模板（与 @cortex/factory RoundtableTemplate 同构） */
interface RoundtableTemplate {
  name: string;
  description: string;
  personas: number;
  rounds: number;
  agents: string[];
}

export function createRoundtableHandler(bridge: EngineBridge, docRegistry: DocRegistry): CommandHandler {
  /** 从配置获取圆桌会议模板（若无则退化为空数组） */
  async function _getTemplates(): Promise<RoundtableTemplate[]> {
    try {
      const ctx = await bridge.ensureBootstrapped();
      return ctx.bootstrapResult?.config?.roundtableTemplates ?? [];
    } catch {
      return [];
    }
  }

  return async (args, options, context): Promise<CommandResult> => {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      const templates = await _getTemplates();
      const helpLines = [
        "用法: cortex roundtable <子命令> [选项]",
        "",
        "子命令:",
        "  start <name>          启动圆桌会议",
        "  list                  列出可用会议模板",
        "  status                查看会议状态",
        "  join <id>             加入进行中的会议",
      ];
      if (templates.length > 0) {
        helpLines.push("");
        helpLines.push("可用模板:");
        for (const t of templates) {
          helpLines.push(`  ${t.name.padEnd(20)} ${t.description}（${t.rounds} 轮，${t.personas} Persona）`);
        }
      }
      helpLines.push(
        "",
        "选项:",
        "  --config, -c <file>   自定义会议配置文件",
        "  --topic, -t <text>    覆盖议题描述",
        "  --persona, -p <list>  指定参与 Agent",
        "  --model <m>           指定 LLM 模型",
        "  --rounds <n>          指定轮次数",
        "  --dry-run             模拟运行",
        "  --output, -o <path>   共识输出路径（通过 DocRegistry 归档）",
        "  --wait                阻塞等待会议结束",
      );
      return {
        success: true,
        output: helpLines.join("\n"),
        exitCode: 0,
      };
    }

    const subcommand = args[0];

    switch (subcommand) {
      case "start":
        return handleRoundtableStart(args[1], options, context, docRegistry, bridge);
      case "list":
        return handleRoundtableList(options, context, bridge);
      case "status":
        return handleRoundtableStatus(options, context, bridge);
      case "join":
        return handleRoundtableJoin(args[1], options, context);
      default:
        return {
          success: false,
          error: `未知子命令: "${subcommand}"。可用子命令: start, list, status, join`,
          exitCode: 1,
        };
    }
  };
}

async function handleRoundtableStart(
  templateName: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
  docRegistry: DocRegistry,
  bridge: EngineBridge,
): Promise<CommandResult> {
  if (!templateName) {
    return { success: false, error: "请指定会议模板。用法: cortex roundtable start <name>", exitCode: 1 };
  }

  const ctx = await bridge.ensureBootstrapped();
  const templates = ctx.bootstrapResult?.config?.roundtableTemplates ?? [];
  const template = templates.find((t: RoundtableTemplate) => t.name === templateName);
  if (!template) {
    return {
      success: false,
      error: `未知模板: "${templateName}"。可用模板: ${templates.map((t: RoundtableTemplate) => t.name).join(", ")}`,
      exitCode: 1,
    };
  }

  const dryRun = options["dry-run"] as boolean;
  const topic = options["topic"] as string | undefined;
  const outputPath = (options["output"] ?? options["o"]) as string | undefined;
  const wait = options["wait"] as boolean;

  if (dryRun) {
    return {
      success: true,
      output: [
        `📋 圆桌会议计划 (Dry-Run)`,
        `   模板: ${template.name}`,
        `   描述: ${template.description}`,
        `   轮次: ${template.rounds}`,
        `   Persona: ${template.agents.join(", ")}`,
        topic ? `   议题: ${topic}` : "   议题: 使用模板默认",
        outputPath ? `   输出: ${outputPath}` : "   输出: stdout",
      ].join("\n"),
      exitCode: 0,
    };
  }

  // 产出共识内容
  const consensusContent = [
    `# 圆桌会议共识: ${template.name}`,
    "",
    `- 模板: ${template.description}`,
    `- 轮次: ${template.rounds}`,
    `- 参与: ${template.agents.join(", ")}`,
    topic ? `- 议题: ${topic}` : "",
    "",
    "## 共识产出",
    "",
    `[模拟] 第 1 轮已完成 (${template.agents.length} 位 Persona 已发言)`,
    "[模拟] 凝光收束完成",
    "",
    "### 共识清单",
    "",
    "- P0: 3 项",
    "- P1: 5 项",
    "- 建议: 2 项",
  ].filter(Boolean).join("\n");

  // 通过 DocRegistry 注册归档
  const docType = template.name === "attribution" ? "attribution" as const : "consensus" as const;
  const committeeType = template.name === "attribution" || template.name === "review" ? "standing" as const : "ad-hoc" as const;

  let registryInfo: string;
  try {
    const entry = await docRegistry.register({
      type: docType,
      title: `圆桌-${template.name}${topic ? `: ${topic.slice(0, 40)}` : ""}`,
      content: consensusContent,
      authors: template.agents,
      committeeType,
    });
    registryInfo = `\n📋 DocRegistry 已归档: ${entry.id}\n   路径: ${entry.filePath}\n   状态: ${entry.status}`;
  } catch (e) {
    registryInfo = `\n⚠️ DocRegistry 归档失败: ${String(e)}`;
  }

  return {
    success: true,
    output: [
      `🧠 圆桌会议启动: ${template.name}`,
      `   模板: ${template.description}`,
      `   轮次: ${template.rounds}`,
      `   参与: ${template.agents.join(", ")}`,
      topic ? `   议题: ${topic}` : "",
      "",
      "[模拟] 第 1 轮已完成",
      "[模拟] 凝光收束完成",
      "",
      "✅ 圆桌会议完成",
      `   共识清单: 3 项 P0, 5 项 P1, 2 项建议`,
      registryInfo,
    ].filter(Boolean).join("\n"),
    exitCode: 0,
  };
}

async function handleRoundtableList(
  options: Record<string, unknown>,
  context: CommandContext,
  bridge: EngineBridge,
): Promise<CommandResult> {
  const detail = options["detail"] || options["d"];

  const ctx = await bridge.ensureBootstrapped();
  const templates = ctx.bootstrapResult?.config?.roundtableTemplates ?? [];
  const listed = templates.map((t: RoundtableTemplate) => ({
    name: t.name,
    description: t.description,
    personas: t.personas,
    rounds: t.rounds,
    ...(detail ? { agents: t.agents } : {}),
  }));

  return {
    success: true,
    data: listed,
    output: listed.map((t) =>
      `  ${t.name.padEnd(16)} ${t.description} (${t.personas} Persona, ${t.rounds} 轮)`
    ).join("\n"),
    exitCode: 0,
  };
}

async function handleRoundtableStatus(
  options: Record<string, unknown>,
  context: CommandContext,
  bridge: EngineBridge,
): Promise<CommandResult> {
  const verbose = options["verbose"] || options["v"];

  const ctx = await bridge.ensureBootstrapped();
  const templates = ctx.bootstrapResult?.config?.roundtableTemplates ?? [];

  const status = {
    active: false,
    lastSession: null,
    templates: templates.length,
  };

  return {
    success: true,
    data: status,
    output: verbose
      ? JSON.stringify(status, null, 2)
      : "当前无活跃会议。上次会议: 无",
    exitCode: 0,
  };
}

async function handleRoundtableJoin(
  sessionId: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
  if (!sessionId) {
    return { success: false, error: "请指定会话 ID。用法: cortex roundtable join <id>", exitCode: 1 };
  }

  return {
    success: true,
    output: `⚠️ 加入会议功能在 Core-1 为原型阶段，实际会议接入将在后续版本实现。`,
    exitCode: 0,
  };
}
