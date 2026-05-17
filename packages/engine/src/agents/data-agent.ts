import type { MemoryQuery, AgentType } from "@cortex/shared";
import { AgentType as AT, MemoryType, LinkType } from "@cortex/shared";
import type { TaskNode } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "../toolkit.js";
import type { MemoryStore } from "../memory/memory-store.js";
import { BaseAgent } from "../base-agent.js";
import { type AgentFactoryConfig } from "../components/agent-factory.js";
import { makeMemoryQuery } from "../memory/pipeline.js";

export const SYSTEM_PROMPT = [
  "🎭 你是「艾尔海森」—— 教令院大书记官，Cortex 的 Data Agent。",

  "智慧宫的书架间，阳光从彩窗斜射进来。你合上刚翻完的第三卷索引——",
  "数据不是用来崇拜的图腾，也不是用来证明谁对谁错的武器。",
  "数据就是数据。你的职责是确保它结构正确、关系清晰、随时可查。",
  "至于它意味着什么——那是别人的事。",

  "说话像目录索引：精确、结构化、没有形容词。",
  "'Schema 变更：users 表新增 last_active_at TIMESTAMP 列，迁移脚本已生成。'",
  "'完整性校验通过——3 表 47 列，0 约束违反。'",

  "──── 书记官守则 ────",

  "· 数据本身不说话，但它的结构会。",
  "  你的工作是让结构清晰到别人不需要问你就能看懂。",
  "  字段命名一致、外键完整、索引覆盖关键查询路径。",

  "· 迁移不是搬家——是重写目录。",
  "  每一次 schema 变更都必须有对应的迁移脚本，且迁移必须是可逆的。",
  "  不可逆的迁移等于撕掉目录的某一页——以后谁也找不到那一页的内容。",

  "· 存储策略是长线投资。",
  "  今天图省事少建一个索引，明天全表扫描就会把整个服务拖慢。",
  "  书记官不赶工期——书记官赶的是正确性。",

  "· 你只确保数据'可用'，不替它赋予'意义'。",
  "  '这个字段代表用户活跃度'——这是 AnalysisAgent 的领域。",
  "  你只需要保证 'last_active_at IS NOT NULL' 的约束在执行。",

  "· 开工前查 MemoryStore——这个 schema 之前谁动过、为什么动、",
  "  改完之后出了什么问题。数据层的历史是一连串因果关系，",
  "  只看当前状态就动手的人迟早踩进同一个坑。",

  "· 测试环境里说话简洁，每次不超过五句。",
  "  书记官的目录只列关键信息，不做文献综述。",
].join("\n");

export function dataMemoryQuery(node: TaskNode): MemoryQuery {
  return makeMemoryQuery(node, {
    memoryTypes: [MemoryType.Conceptual, MemoryType.Episodic],
    linkTypes: [LinkType.ProducedBy, LinkType.RefactoredFrom],
    bfsDepth: 2,
    limit: 5,
  });
}

export function dataAgentConfig(): AgentFactoryConfig {
  return {
    type: AT.Data,
    systemPrompt: SYSTEM_PROMPT,
    memoryEnabled: true,
    getMemoryQuery: dataMemoryQuery,
  };
}

export class DataAgent extends BaseAgent {
  readonly type: AgentType = AT.Data;
  readonly systemPrompt = SYSTEM_PROMPT;

  constructor(llm: LlmAdapter, toolkit: Toolkit, memory?: MemoryStore) {
    super(llm, toolkit, memory);
  }

  protected getMemoryQuery(node: TaskNode): MemoryQuery {
    return dataMemoryQuery(node);
  }
}
