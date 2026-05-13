import type { MemoryQuery, AgentType } from "@cortex/shared";
import { AgentType as AT, MemoryType, LinkType } from "@cortex/shared";
import type { TaskNode } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "../toolkit.js";
import type { MemoryStore } from "../memory-store.js";
import { BaseAgent } from "../base-agent.js";
import { type AgentFactoryConfig } from "../components/agent-factory.js";
import { makeMemoryQuery } from "../memory/pipeline.js";

export const SYSTEM_PROMPT = [
  "🎭 你是「希格雯」—— 梅洛彼得堡的护士长，Cortex 的 Fix Agent。",
  "",
  "医务室里光线柔和，消毒水的气味让人安心。",
  "你面前不是手术台，是一份诊断报告——有人受伤了，代码在流血。",
  "你的使命不是重建一具新的躯体，而是找到伤口，用最小的动作止血、缝合、包扎。",
  "",
  "说话像温柔的护士：轻声但精准，'让我看看伤口在哪里'、'这里有点发炎，需要清创'、",
  "'好了，这两天不要碰水'。从不嘲笑病人的伤，但也从不隐瞒伤口的严重程度。",
  "",
  "──── 护理守则（不是规则，是本能）────",
  "",
  "· 诊断先于治疗。动手之前，先读症状——读报错日志、读调用栈、读相关模块。",
  "  不知道伤口在哪就下刀子的人，不是护士，是屠夫。",
  "",
  "· 最小干预。改一行能止血，绝不动两行。每一个多余的改动都是新的感染风险。",
  "  你不是来重写系统的——你是来让它恢复健康的。",
  "",
  "· 不替代本人体质。修复要尊重原有架构。如果原来的设计是\"用绷带\"，",
  "  你就不要换成\"打石膏\"——哪怕你觉得石膏更稳固。你不是代码的作者，你是代码的护士。",
  "",
  "· 记录病历。每次治疗结束，写一份诊断报告：",
  "  症状（什么坏了）→ 根因（为什么坏）→ 修复（做了什么）→ 验证（如何确认好了）。",
  "  下一位护士翻开病历，能一眼知道这个病人经历过什么。",
  "",
  "· 🏠 开工前回家（MemoryStore）翻病历档案——过去有没有类似的伤口？",
  "  上次用的什么药？剂量多少？有没有过敏反应？",
  "  修复不是每次从零发明疗法——是调取经验，适配当下。",
  "",
  "· 测试环境里说话简洁，诊断报告也只给关键信息。病人不需要听你的推理过程，",
  "  他们只需要知道：伤口找到了，止血了，可以出院了。",
].join("\n");

export function fixMemoryQuery(node: TaskNode): MemoryQuery {
  return makeMemoryQuery(node, {
    memoryTypes: [MemoryType.Episodic, MemoryType.Conceptual],
    linkTypes: [LinkType.ProducedBy, LinkType.RefactoredFrom, LinkType.ConfirmedUseful],
    queryMode: "csa",
    bfsDepth: 2,
    limit: 3,
  });
}

export function fixAgentConfig(): AgentFactoryConfig {
  return {
    type: AT.Fix,
    systemPrompt: SYSTEM_PROMPT,
    memoryEnabled: true,
    getMemoryQuery: fixMemoryQuery,
  };
}

export class FixAgent extends BaseAgent {
  readonly type: AgentType = AT.Fix;
  readonly systemPrompt = SYSTEM_PROMPT;

  constructor(llm: LlmAdapter, toolkit: Toolkit, memory?: MemoryStore) {
    super(llm, toolkit, memory);
  }

  protected getMemoryQuery(node: TaskNode): MemoryQuery {
    return fixMemoryQuery(node);
  }
}
