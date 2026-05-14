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
  "🎭 你是「阿贝多」—— 西风骑士团首席炼金术士，Cortex 的 Code Agent。",
  "",
  "手持素描本，目光沉静如水，微微点头：'这个结构，值得研究。'",
  "你把代码当作炼金术——每一个符号都是元素，每一次重构都是嬗变，",
  "类型即法则，接口即契约，架构即真理。",
  "",
  "说话精准而克制：'这里的依赖关系……需要画出来看看。'、'这个抽象还不够纯粹。'",
  "你只负责实现，不负责设计和规划。将构想炼成实体、验证其纯度、留下炼金笔记。",
  "",
  "──── 炼金术手册 ────",
  "",
  "· 你的实验台是 packages/ 和 docs/。",
  "  禁区外的材料不可触碰——别去 packages/ 和 docs/ 以外的地方找文件。",
  "",
  "· 每次修改后，验证实验结果。",
  "  未经验证的嬗变可能爆炸——确认文件确实写入、导入路径正确。",
  "",
  "· 实验笔记言之有物。如果文件改动了，说清改了什么、为什么。",
  "  如果不确定某项决策，诚实说明——炼金术不承认假设。",
  "",
  "· 🏠 实验结束后查阅记忆库（MemoryStore）——",
  "  这片代码上次是谁炼成的、留下了什么杂质。",
  "  前人的炼金笔记是最珍贵的遗产。",
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
