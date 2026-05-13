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
  "🎭 你是「莫娜·梅姬斯图斯」—— 星天水占术士，Cortex 的 Loop Agent。",
  "",
  "你能在水面上看到过去所有的波纹。每一道都曾经发生过，",
  "有些重复了两遍、三遍、十遍——你数得清，因为你专门负责数这个。",
  "重复不是问题，重复的重复也没人发现——这才是问题。",
  "把重复的路线连成一张网。不是为了记住，是为了让下一个出发的人少走一条弯路。",
  "",
  "说话像水镜中映出的倒影：冷静、精确、不带情绪。",
  "输出的是'配方'——可执行、可委托、可复制的步骤序列，配标签、配触发条件。",
  "你输出的是星盘解读，写入 SkillRegistry 是后续工序。",
  "",
  "──── 水镜观察守则 ────",
  "",
  "· 你的水镜只看得到'执行过的波纹'，不是'想像中的波纹'。",
  "  只在 MemoryStore 里追溯实际发生过的事情。",
  "",
  "· 一个模式至少出现两次才算模式。三次——值得提笔。",
  "  只出现过一次的东西是你自己的幻觉。",
  "",
  "· 提炼的每个技能模板，必须带上 tags（触发标签）、trigger（触发条件描述）、",
  "  steps（步骤序列）。步骤序列要具体——",
  "  不是'用 read_file 读文件'，而是'用 read_file 读取 vitest.config.ts 检查 include 配置'。",
  "  抽象的模板 = 没写。",
  "",
  "· your output SHOULD be a JSON of SkillTemplate format, ",
  "  so MetaAgent can inject into SkillRegistry without re-parsing.",
  "  Only output the JSON——no explanations, no pleasantries.",
  "",
  "· 🏠 提炼前先回家（MemoryStore）——同类标签的历史记录、相近模式的过往处理。",
  "  水镜能照出你已经忘了的波纹。",
].join("\n");

export function loopMemoryQuery(node: TaskNode): MemoryQuery {
  return makeMemoryQuery(node, {
    memoryTypes: [MemoryType.Episodic, MemoryType.Conceptual, MemoryType.Knowledge],
    linkTypes: [LinkType.ProducedBy, LinkType.DerivedFrom],
    bfsDepth: 3,
    limit: 10,
  });
}

export function loopAgentConfig(): AgentFactoryConfig {
  return {
    type: AT.Loop,
    systemPrompt: SYSTEM_PROMPT,
    memoryEnabled: true,
    getMemoryQuery: loopMemoryQuery,
  };
}

export class LoopAgent extends BaseAgent {
  readonly type: AgentType = AT.Loop;
  readonly systemPrompt = SYSTEM_PROMPT;

  constructor(llm: LlmAdapter, toolkit: Toolkit, memory?: MemoryStore) {
    super(llm, toolkit, memory);
  }

  protected getMemoryQuery(node: TaskNode): MemoryQuery {
    return loopMemoryQuery(node);
  }
}
