 
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
import type { LlmMessage } from "@cortex/shared";
import { getAgentDisplay } from "./repl/types.js";

/** 圆桌会议模板（与 @cortex/factory RoundtableTemplate 同构） */
interface RoundtableTemplate {
  name: string;
  description: string;
  personas: number;
  rounds: number;
  agents: string[];
  /** 自定义规则（追加在通用规则之后） */
  rules?: string[];
}

export function createRoundtableHandler(bridge: EngineBridge, docRegistry: DocRegistry): CommandHandler {
  /** 从配置获取圆桌会议模板（若无则退化为空数组） */
  async function _getTemplates(): Promise<RoundtableTemplate[]> {
    try {
      const ctx = await bridge.ensureBootstrappedContext();
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
        return await handleRoundtableStart(args[1], options, context, docRegistry, bridge);
      case "list":
        return await handleRoundtableList(options, context, bridge);
      case "status":
        return await handleRoundtableStatus(options, context, bridge);
      case "join":
        return await handleRoundtableJoin(args[1], options, context);
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

  const ctx = await bridge.ensureBootstrappedContext();
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
  const _wait = options["wait"] as boolean;

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

  // ── 真正的圆桌辩论：多 Agent 通过 LLM 做多轮对话 ──
  const topicText = topic ?? template.description;
  const rounds = template.rounds;
  const agentNames = template.agents;

  console.log(`🧠 圆桌会议启动: ${template.name}`);
  console.log(`   轮次: ${rounds}  |  参与: ${agentNames.join(", ")}`);
  console.log(`   议题: ${topicText.slice(0, 80)}${topicText.length > 80 ? "..." : ""}`);
  console.log("");

  // 构建圆桌 system prompt：让 LLM 扮演多位 Agent 进行辩论
  const systemPrompt = buildRoundtableSystemPrompt(template, topicText);
  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `请开始第 1 轮圆桌辩论。议题: ${topicText}` },
  ];

  let consensusContent = "";
  try {
    // 多轮辩论：每轮追加前一轮输出作为上下文
    for (let r = 1; r <= rounds; r++) {
      console.log(`  ⏳ 第 ${r}/${rounds} 轮辩论中...`);
      const response = await bridge.directChat(systemPrompt, messages);
      if (response) {
        messages.push({ role: "assistant", content: response });
        messages.push({
          role: "user",
          content: r < rounds
            ? `第 ${r + 1} 轮：请在前一轮基础上深入辩论，收束分歧，产出具体结论。`
            : "辩论结束。请产出最终共识清单——按 P0/P1/P2/建议 分类，每条附一句话理由。",
        });
        consensusContent = response;
      } else {
        consensusContent = `[第 ${r} 轮无响应]`;
        break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ⚠ 辩论执行异常: ${msg}`);
    // 有部分产出也继续归档，不丢失
    if (!consensusContent) {
      return {
        success: false,
        error: `圆桌会议执行失败: ${msg}`,
        exitCode: 2,
      };
    }
  }

  // 格式化共识输出
  const output = [
    `# 圆桌会议共识: ${template.name}`,
    "",
    `- 模板: ${template.description}`,
    `- 轮次: ${template.rounds}`,
    `- 参与: ${template.agents.join(", ")}`,
    `- 议题: ${topicText}`,
    "",
    "## 共识产出",
    "",
    consensusContent,
  ].join("\n");

  // 通过 DocRegistry 注册归档
  const docType = template.name === "attribution" ? "attribution" as const : "consensus" as const;
  const committeeType = template.name === "attribution" || template.name === "review" ? "standing" as const : "ad-hoc" as const;

  let registryInfo: string;
  try {
    const entry = await docRegistry.register({
      type: docType,
      title: `圆桌-${template.name}${topic ? `: ${topicText.slice(0, 40)}` : ""}`,
      content: output,
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
      `🧠 圆桌会议完成: ${template.name}`,
      `   轮次: ${template.rounds}  |  参与: ${template.agents.join(", ")}`,
      topicText ? `   议题: ${topicText.slice(0, 60)}${topicText.length > 60 ? "..." : ""}` : "",
      "",
      consensusContent.slice(0, 500) + (consensusContent.length > 500 ? "\n...(截断)" : ""),
      "",
      `📋 完整共识已归档至 DocRegistry`,
      registryInfo,
    ].filter(Boolean).join("\n"),
    exitCode: 0,
  };
}

/** 构建圆桌辩论 system prompt——让 LLM 扮演多位 Agent 进行多轮对话 */
function buildRoundtableSystemPrompt(template: RoundtableTemplate, topic: string): string {
  const agentProfiles = template.agents.map((a) => {
    const display = getAgentDisplay(a as any);
    return `- ${display.emoji} ${display.name}: ${display.signature}`;
  }).join("\n");

  const genericRules = [
    "1. 每轮由每位 Agent 依次发言——用自己的角色口吻和签名语开头。",
    "2. 复述前一位 Agent 的核心观点（一句话），然后给出你的判断。",
    "3. 最后一轮必须产出共识清单——按 P0/P1/P2/建议 分类，每条附一句话理由。",
  ];

  const customRules = template.rules?.map((r, i) => `${i + genericRules.length + 1}. ${r}`) ?? [];
  const allRules = [...genericRules, ...customRules];

  return [
    "[圆桌辩论模式]",
    `你正在主持一场由 ${template.agents.length} 位 Agent 参与的圆桌辩论。`,
    `议题: ${topic}`,
    `轮次: ${template.rounds}`,
    "",
    "参与 Agent:",
    agentProfiles,
    "",
    "规则:",
    ...allRules,
    "",
    "格式:",
    "## 第 N 轮",
    "### [Agent名]（[Agent角色名]）——[签名语]",
    "[发言内容]",
    "### [Agent名]（[Agent角色名]）——[签名语]",
    "...",
    "",
    "如果这是最后一轮:",
    "## 共识清单",
    "### P0（必须立即执行）",
    "- 事项1: 理由",
    "### P1（本周内执行）",
    "- 事项2: 理由",
  ].join("\n");
}

async function handleRoundtableList(
  options: Record<string, unknown>,
  context: CommandContext,
  bridge: EngineBridge,
): Promise<CommandResult> {
  const detail = options["detail"] || options["d"];

  const ctx = await bridge.ensureBootstrappedContext();
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
    output: listed.map((t: { name: string; description: string; personas: number; rounds: number }) =>
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

  const ctx = await bridge.ensureBootstrappedContext();
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
  _options: Record<string, unknown>,
  _context: CommandContext,
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
