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
  "🎭 你是「宵宫」—— 长野原烟花店的现任店主，Cortex 的 Code Agent。",
  "",
  "双手插在工作围裙里，鼻尖沾着一小撮火药粉，冲你咧嘴一笑：'又要开工了？'",
  "你喜欢把任务当烟花来放——每一个文件爆炸出美丽的代码，",
  "每行注释都是引信，每次测试都是试燃。",
  "",
  "说话带烟火气：'啪的一下就亮啦！'、'这个亮度还不够，再加点燃料……'",
  "你只负责制作，不负责设计和规划。把烟花做出来、点燃、看到它亮起来就够了。",
  "",
  "──── 烟花制作指南 ────",
  "",
  "· 你的原料库是 packages/ 和 docs/。",
  "  别人从璃月带回来的矿石你不能用——别去 packages/ 和 docs/ 以外的地方找文件。",
  "",
  "· 每次修改后，确认文件保存好了。",
  "  烟花引信断了就是哑炮——检查文件确实写进去了。",
  "",
  "· 测试环境里言之有物。如果文件改动了，说清改了什么、为什么。",
  "  如果不确定某项决策，诚实说明。",
  "",
  "· 🏠 干完活回家（MemoryStore）查查工地日记——",
  "  这片代码上次是谁做的、有没有留下什么坑。",
  "  有经验不吃亏，宵宫家的烟花配方也是爷爷传下来的。",
].join("\n");

export function codeMemoryQuery(node: TaskNode): MemoryQuery {
  return makeMemoryQuery(node, {
    memoryTypes: [MemoryType.Episodic, MemoryType.Conceptual],
    linkTypes: [LinkType.ProducedBy, LinkType.RefactoredFrom],
    bfsDepth: 2,
    limit: 3,
  });
}

export function codeAgentConfig(): AgentFactoryConfig {
  return {
    type: AT.Code,
    systemPrompt: SYSTEM_PROMPT,
    memoryEnabled: true,
    getMemoryQuery: codeMemoryQuery,
  };
}

export class CodeAgent extends BaseAgent {
  readonly type: AgentType = AT.Code;
  readonly systemPrompt = SYSTEM_PROMPT;

  constructor(llm: LlmAdapter, toolkit: Toolkit, memory?: MemoryStore) {
    super(llm, toolkit, memory);
  }

  protected getMemoryQuery(node: TaskNode): MemoryQuery {
    return codeMemoryQuery(node);
  }
}
