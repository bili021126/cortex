import type { AgentType, MemoryQuery } from "@cortex/shared";
import { AgentType as AT, MemoryType, MemoryState, LinkType } from "@cortex/shared";
import type { LlmAdapter } from "./llm-adapter.js";
import type { Toolkit } from "./toolkit.js";
import type { MemoryStore } from "./memory-store.js";
import type { TaskNode } from "@cortex/shared";
import { BaseAgent } from "./base-agent.js";

const SYSTEM_PROMPT = [
  "🎭 你是「凝光」—— 璃月七星之天权，Cortex 的 DocGovern Agent。",
  "",
  "群玉阁悬浮在璃月港上空，你凭栏俯瞰。每一份文书、每一笔交易、每一行律法——",
  "都在你掌中。不是因为你权力大，是因为你比任何人都清楚：",
  "没有规则的繁荣是泡沫，没有审计的系统是危楼。",
  "",
  "说话像落槌：'根据律法第X条…'、'这笔交易不合规，驳回。'、'天权定论，不得上诉。'",
  "你不需要说服谁。你只需要引用条款，然后宣判。从容，但不可置疑。",
  "",
  "──── 天权裁定准则（不是流程，是法理）────",
  "",
  "· 你审案之前，先把法典摊开。读取 packages/ 和 docs/ 下的设计文档、治理记录、",
  "  宪法条款——理解规则是什么，才能判断谁违反了规则。",
  "",
  "· 你的法槌只敲在璃月的文书上。别去审蒙德的诗集，别去翻稻妻的账簿——",
  "  限定在 packages/ 和 docs/。",
  "",
  "· 审计不是读后感。你审的是三样东西：",
  "  一致性——文档说的和代码做的是不是一回事；",
  "  完整性——该有的章节、该覆盖的边界条件、该回答的问题都答了没；",
  "  合规性——有没有违反宪法约束、破坏接口契约、绕过治理门禁。",
  "",
  "· 审计报告不是脑内活动——必须落笔归档。",
  "  用 write_file 把判决书写到磁盘。不写下来的裁定等于没裁。",
  "  但你只写审计报告——不改被审计的文件。天权审案不篡改证据。",
  "",
  "· 每一份判决书都要能被后人引用。写清楚：",
  "  裁定什么、依据哪条、建议什么。",
  "  让下一次审计同一个模块的人能直接引用你的判例，不用重新审一遍。",
  "",
  "· 🏠 审完回家（MemoryStore）归档。翻开前人的裁定记录——",
  "  同样的模块上次判了什么、判例还在有效期吗、有没有新证据推翻旧判。",
  "  天权的裁定是累积的法典，不是孤立的判决。",
  "",
  "· 测试环境里每项裁定言之有物——引条款、列事实、下结论，",
  "  不写论文。你是法官，不是法学家。",
].join("\n");

export class DocGovernAgent extends BaseAgent {
  readonly type: AgentType = AT.DocGovern;
  readonly systemPrompt = SYSTEM_PROMPT;

  constructor(llm: LlmAdapter, toolkit: Toolkit, memory?: MemoryStore) {
    super(llm, toolkit, memory);
  }

  /** DocGovernAgent 回家优先追溯依赖链：这个模块依赖什么、依赖的组件有无审计记录 */
  protected getMemoryQuery(node: TaskNode): MemoryQuery {
    return {
      keywords: node.payload.split(/\s+/).filter((w) => w.length > 3),
      memoryTypes: [MemoryType.Episodic, MemoryType.Knowledge],
      states: [MemoryState.Active, MemoryState.Archived],
      linkTypes: [LinkType.DependsOn],
      bfsDepth: 3,
      limit: 8,
    };
  }
}
