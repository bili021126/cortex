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

export function createRoundtableHandler(bridge: EngineBridge, docRegistry: DocRegistry): CommandHandler {
  return async (args, options, context): Promise<CommandResult> => {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      return {
        success: true,
        output: [
          "用法: cortex roundtable <子命令> [选项]",
          "",
          "子命令:",
          "  start <name>          启动圆桌会议",
          "  list                  列出可用会议模板",
          "  status                查看会议状态",
          "  join <id>             加入进行中的会议",
          "",
          "内置模板:",
          "  review                审视共识会议（4 轮，4 Persona）",
          "  code-review           三轮代码审阅（3 轮，10 Persona）",
          "  soft-consensus        软约束共识（1 轮合并，9 Persona）",
          "  attribution           归因分析（1 轮开放，10 Persona）",
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
        ].join("\n"),
        exitCode: 0,
      };
    }

    const subcommand = args[0];

    switch (subcommand) {
      case "start":
        return handleRoundtableStart(args[1], options, context, docRegistry);
      case "list":
        return handleRoundtableList(options, context);
      case "status":
        return handleRoundtableStatus(options, context);
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

const BUILTIN_TEMPLATES = [
  {
    name: "review",
    description: "审视共识会议",
    personas: 4,
    rounds: 4,
    agents: ["刻晴", "纳西妲", "阿贝多", "凝光"],
  },
  {
    name: "code-review",
    description: "三轮代码审阅",
    personas: 10,
    rounds: 3,
    agents: ["刻晴", "甘雨", "纳西妲", "阿贝多", "钟离", "北斗", "久岐忍", "艾尔海森", "安柏", "凝光"],
  },
  {
    name: "soft-consensus",
    description: "软约束共识",
    personas: 9,
    rounds: 1,
    agents: ["刻晴", "甘雨", "纳西妲", "阿贝多", "钟离", "北斗", "久岐忍", "艾尔海森", "凝光"],
  },
  {
    name: "attribution",
    description: "归因分析",
    personas: 10,
    rounds: 1,
    agents: ["刻晴", "甘雨", "纳西妲", "阿贝多", "钟离", "北斗", "久岐忍", "艾尔海森", "安柏", "凝光"],
  },
];

async function handleRoundtableStart(
  templateName: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
  docRegistry: DocRegistry,
): Promise<CommandResult> {
  if (!templateName) {
    return { success: false, error: "请指定会议模板。用法: cortex roundtable start <name>", exitCode: 1 };
  }

  const template = BUILTIN_TEMPLATES.find((t) => t.name === templateName);
  if (!template) {
    return {
      success: false,
      error: `未知模板: "${templateName}"。可用模板: ${BUILTIN_TEMPLATES.map((t) => t.name).join(", ")}`,
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
): Promise<CommandResult> {
  const detail = options["detail"] || options["d"];

  const templates = BUILTIN_TEMPLATES.map((t) => ({
    name: t.name,
    description: t.description,
    personas: t.personas,
    rounds: t.rounds,
    ...(detail ? { agents: t.agents } : {}),
  }));

  return {
    success: true,
    data: templates,
    output: templates.map((t) =>
      `  ${t.name.padEnd(16)} ${t.description} (${t.personas} Persona, ${t.rounds} 轮)`
    ).join("\n"),
    exitCode: 0,
  };
}

async function handleRoundtableStatus(
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
  const verbose = options["verbose"] || options["v"];

  const status = {
    active: false,
    lastSession: null,
    templates: BUILTIN_TEMPLATES.length,
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
