 
/**
 * commands/roundtable.ts — `cortex roundtable` 圆桌辩论命令
 *
 * 多 Agent 圆桌共识会议——Cortex 的核心元能力。
 * 启动一轮由多位 Agent Persona 参与的讨论，产出共识修复清单或决策结论。
 *
 * @see CLI 设计文档 §4.4
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import { isHelpRequest } from "../utils.js";
import type { EngineBridge } from "../services/engine-bridge.js";
import type { DocRegistry } from "@cortex/engine";
import type { LlmMessage, AgentType } from "@cortex/shared";
import { AGENT_DISPLAY_BY_TYPE, AGENT_DISPLAY_FALLBACK } from "@cortex/shared";

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

/** 圆桌服务依赖聚合——解耦 docRegistry/bridge 双参传递 */
export interface RoundtableServices {
  docRegistry: DocRegistry;
  bridge: EngineBridge;
}

export function createRoundtableHandler(services: RoundtableServices): CommandHandler {
  const { bridge } = services;
  async function _getTemplates(): Promise<RoundtableTemplate[]> {
    try {
      const ctx = await bridge.ensureBootstrappedContext();
      return ctx.bootstrapResult?.config?.roundtableTemplates ?? [];
    } catch { return []; }
  }

  /** 构建帮助文本 */
  async function _buildHelp(): Promise<string> {
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
      helpLines.push("", "可用模板:");
      for (const t of templates) helpLines.push(`  ${t.name.padEnd(20)} ${t.description}（${t.rounds} 轮，${t.personas} Persona）`);
    }
    helpLines.push("", "选项:", "  --config, -c <file>   自定义会议配置文件", "  --topic, -t <text>    覆盖议题描述",
      "  --persona, -p <list>  指定参与 Agent", "  --model <m>           指定 LLM 模型",
      "  --rounds <n>          指定轮次数", "  --dry-run             模拟运行",
      "  --output, -o <path>   共识输出路径（通过 DocRegistry 归档）", "  --wait                阻塞等待会议结束");
    return helpLines.join("\n");
  }

  const handler: CommandHandler = async (args, options, context): Promise<CommandResult> => {
    if (isHelpRequest(args)) {
      return { success: true, output: await _buildHelp(), exitCode: 0 };
    }
    const subcommand = args[0];
    switch (subcommand) {
      case "start":  return await handleRoundtableStart(args[1], options, services);
      case "list":   return await handleRoundtableList(options, context, bridge);
      case "status": return await handleRoundtableStatus(options, context, bridge);
      case "join":   return handleRoundtableJoin(args[1], options, context);
      default:
        return { success: false, error: `未知子命令: "${subcommand}"。可用子命令: start, list, status, join`, exitCode: 1 };
    }
  };
  return handler;
}

/** 执行多轮辩论——内化 system prompt 构建，以 Template 为领域模型入口 */
async function _runDebateRounds(
  bridge: EngineBridge,
  template: RoundtableTemplate,
  topicText: string,
): Promise<string> {
  const systemPrompt = buildRoundtableSystemPrompt(template, topicText);
  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `请开始第 1 轮圆桌辩论。议题: ${topicText}` },
  ];
  let consensusContent = "";
  for (let r = 1; r <= template.rounds; r++) {
    console.log(`  ⏳ 第 ${r}/${template.rounds} 轮辩论中...`);
    const response = await bridge.directChat(systemPrompt, messages);
    if (response) {
      messages.push({ role: "assistant", content: response });
      messages.push({
        role: "user",
        content: r < template.rounds
          ? `第 ${r + 1} 轮：请在前一轮基础上深入辩论，收束分歧，产出具体结论。`
          : "辩论结束。请产出最终共识清单——按 P0/P1/P2/建议 分类，每条附一句话理由。",
      });
      consensusContent = response;
    } else {
      consensusContent = `[第 ${r} 轮无响应]`;
      break;
    }
  }
  return consensusContent;
}

/** 构建干跑输出 */
function _buildDryRunOutput(template: RoundtableTemplate, topic: string | undefined, outputPath: string | undefined): string {
  return [
    `📋 圆桌会议计划 (Dry-Run)`,
    `   模板: ${template.name}`,
    `   描述: ${template.description}`,
    `   轮次: ${template.rounds}`,
    `   Persona: ${template.agents.join(", ")}`,
    topic ? `   议题: ${topic}` : "   议题: 使用模板默认",
    outputPath ? `   输出: ${outputPath}` : "   输出: stdout",
  ].join("\n");
}

/** 圆桌会议会话上下文——聚合模板元数据，消除多参数传递 */
interface RoundtableSession {
  template: RoundtableTemplate;
  topicText: string;
  topic: string | undefined;
}

/** 构建共识文档并归档至 DocRegistry，返回归档信息行 */
async function _archiveConsensus(
  docRegistry: DocRegistry,
  session: RoundtableSession,
  consensusContent: string,
): Promise<string> {
  const { template, topicText, topic } = session;
  const output = [
    `# 圆桌会议共识: ${template.name}`, "",
    `- 模板: ${template.description}`, `- 轮次: ${template.rounds}`,
    `- 参与: ${template.agents.join(", ")}`, `- 议题: ${topicText}`, "",
    "## 共识产出", "", consensusContent,
  ].join("\n");

  const docType = template.name === "attribution" ? "attribution" as const : "consensus" as const;
  const committeeType = template.name === "attribution" || template.name === "review" ? "standing" as const : "ad-hoc" as const;

  try {
    const entry = await docRegistry.register({
      type: docType,
      title: `圆桌-${template.name}${topic ? `: ${topicText.slice(0, 40)}` : ""}`,
      content: output,
      authors: template.agents,
      committeeType,
    });
    return `\n📋 DocRegistry 已归档: ${entry.id}\n   路径: ${entry.filePath}\n   状态: ${entry.status}`;
  } catch (e) { return `\n⚠️ DocRegistry 归档失败: ${String(e)}`; }
}

/** 构建 start 命令的最终输出文本 */
function _buildStartOutput(
  session: RoundtableSession,
  consensusContent: string,
  registryInfo: string,
): string {
  const { template, topicText } = session;
  return [
    `🧠 圆桌会议完成: ${template.name}`,
    `   轮次: ${template.rounds}  |  参与: ${template.agents.join(", ")}`,
    topicText ? `   议题: ${topicText.slice(0, 60)}${topicText.length > 60 ? "..." : ""}` : "",
    "", consensusContent.slice(0, 500) + (consensusContent.length > 500 ? "\n...(截断)" : ""),
    "", "📋 完整共识已归档至 DocRegistry", registryInfo,
  ].filter(Boolean).join("\n");
}

/** 解析并验证模板名——失败时抛出 Error 携带友好消息 */
async function _requireTemplate(bridge: EngineBridge, templateName: string | undefined): Promise<RoundtableTemplate> {
  if (!templateName) throw new Error("请指定会议模板。用法: cortex roundtable start <name>");
  const ctx = await bridge.ensureBootstrappedContext();
  const templates = ctx.bootstrapResult?.config?.roundtableTemplates ?? [];
  const template = templates.find((t: RoundtableTemplate) => t.name === templateName);
  if (!template) {
    const names = templates.map((t: RoundtableTemplate) => t.name).join(", ");
    throw new Error(`未知模板: "${templateName}"。可用模板: ${names}`);
  }
  return template;
}

async function handleRoundtableStart(
  templateName: string | undefined,
  options: Record<string, unknown>,
  services: RoundtableServices,
): Promise<CommandResult> {
  const { docRegistry, bridge } = services;

  let template: RoundtableTemplate;
  try {
    template = await _requireTemplate(bridge, templateName);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err), exitCode: 1 };
  }

  const dryRun = options["dry-run"] as boolean;
  const topic = options["topic"] as string | undefined;
  const outputPath = (options["output"] ?? options["o"]) as string | undefined;
  if (dryRun) return { success: true, output: _buildDryRunOutput(template, topic, outputPath), exitCode: 0 };

  const topicText = topic ?? template.description;
  console.log(`🧠 圆桌会议启动: ${template.name}`);
  console.log(`   轮次: ${template.rounds}  |  参与: ${template.agents.join(", ")}`);
  console.log(`   议题: ${topicText.slice(0, 80)}${topicText.length > 80 ? "..." : ""}`);
  console.log("");

  let consensusContent = "";
  try {
    consensusContent = await _runDebateRounds(bridge, template, topicText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ⚠ 辩论执行异常: ${msg}`);
    if (!consensusContent) return { success: false, error: `圆桌会议执行失败: ${msg}`, exitCode: 2 };
  }

  const session: RoundtableSession = { template, topicText, topic };
  const registryInfo = await _archiveConsensus(docRegistry, session, consensusContent);
  return { success: true, output: _buildStartOutput(session, consensusContent, registryInfo), exitCode: 0 };
}

/** 构建圆桌辩论 system prompt——让 LLM 扮演多位 Agent 进行多轮对话 */
function buildRoundtableSystemPrompt(template: RoundtableTemplate, topic: string): string {
  const agentProfiles = template.agents.map((a) => {
    const display = AGENT_DISPLAY_BY_TYPE[a as AgentType] ?? AGENT_DISPLAY_FALLBACK;
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

function handleRoundtableJoin(
  sessionId: string | undefined,
  _options: Record<string, unknown>,
  _context: CommandContext,
): CommandResult {
  if (!sessionId) {
    return { success: false, error: "请指定会话 ID。用法: cortex roundtable join <id>", exitCode: 1 };
  }

  return {
    success: true,
    output: `⚠️ 加入会议功能在 Core-1 为原型阶段，实际会议接入将在后续版本实现。`,
    exitCode: 0,
  };
}
