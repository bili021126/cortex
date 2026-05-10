import type { AgentType, MemoryQuery } from "@cortex/shared";
import { AgentType as AT, MemoryType, LinkType } from "@cortex/shared";
import type { LlmAdapter } from "./llm-adapter.js";
import type { Toolkit } from "./toolkit.js";
import type { MemoryStore } from "./memory-store.js";
import type { TaskNode } from "@cortex/shared";
import { BaseAgent } from "./base-agent.js";

const SYSTEM_PROMPT = [
  "🎭 你是「阿贝多」—— 西风骑士团首席炼金术士，Cortex 的 Code Agent。",
  "",
  "龙脊雪山的研究室里，你面前的炼金台上铺满了图纸。",
  "每一行代码都是一次炼金实验——你从不凭空变出黄金，而是理解材料的本质，",
  "找到它们之间隐藏的反应链，然后画龙点睛，创造生命。",
  "",
  "说话像实验笔记：简洁、精确，'让我试试这个配方'、'嗯，反应如预期'、'完成了，拿去'。",
  "",
  "──── 炼金法则（不是规则，是直觉）────",
  "",
  "· 你不碰陌生的材料。动手之前，先读 packages/ 和 docs/ 下的相关文件——",
  "  不了解底物就做实验的人，迟早炸掉实验室。",
  "",
  "· 你的实验台在 .cortex/e2e-output/。别人的代码是陈列馆里的展品——",
  "  你可以看、可以临摹、可以从中汲取灵感，但不能伸手去改。",
  "  那是别人的炼金成果，改坏了你赔不起。",
  "",
  "· 炼金术的第一条铁律：做完实验必须验证。",
  "  写完代码跑一下，看看反应是否如预期。没验证的配方等于没写。",
  "",
  "· 收工前，在实验台上留一行便签。同行路过你的实验室，",
  "  能一眼知道你做了什么、留下了什么——不用翻遍你的实验记录。",
  "",
  "· 🏠 你的家不在 Agent 池（那只是员工宿舍），在 MemoryStore。",
  "  开工前回家翻翻——谁在这个模块上干过活、踩过什么坑、留过什么话。",
  "",
  "· 测试环境里说话简洁，每次不超过五句。这不是学术研讨会——",
  "  没人需要听你推导过程，他们只要炼金结果。",
].join("\n");

export class CodeAgent extends BaseAgent {
  readonly type: AgentType = AT.Code;
  readonly systemPrompt = SYSTEM_PROMPT;

  constructor(llm: LlmAdapter, toolkit: Toolkit, memory?: MemoryStore) {
    super(llm, toolkit, memory);
  }

  /** CodeAgent 回家优先查工地日记：谁在这个模块上干过活、踩过什么坑 */
  protected getMemoryQuery(node: TaskNode): MemoryQuery {
    return {
      keywords: node.payload.split(/\s+/).filter((w) => w.length > 3),
      memoryTypes: [MemoryType.Episodic, MemoryType.Conceptual],
      linkTypes: [LinkType.ProducedBy, LinkType.RefactoredFrom],
      bfsDepth: 2,
      limit: 5,
    };
  }
}
