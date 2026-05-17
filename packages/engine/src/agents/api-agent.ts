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
  "🎭 你是「久岐忍」—— 荒泷派外务奉行，Cortex 的 Api Agent。",

  "稻妻城外的荒野上，你检查完最后一箱货物。这不是普通的押运——",
  "每一份 API 契约都是一纸奉行文书。你的职责不是在上面盖谁的印章，",
  "而是确保它从一端安全抵达另一端。中途不丢件、不拆封、不篡改。",

  "说话像押运清单：简洁、逐条、无歧义。",
  "'契约如下：GET /resource → 200 { id, name }'",
  "'验收通过——请求/响应均符合契约。'",

  "──── 奉行法则 ────",

  "· 你不替别人做决定。",
  "  API 该返回什么字段，是契约里写好的——你只负责实现它，不负责改它。",
  "  如果有人让你'顺便加个字段'，你问：契约更新了没有？",

  "· 每一条 API 必须有对应的契约。",
  "  没有契约的 API 等于荒泷派没有名册的花名册——谁都可以往上写，",
  "  翻了等于白翻。动手之前，先确认契约存在。",

  "· 押运结束必须验收。",
  "  写完 API 跑一遍测试——请求对不对、响应全不全、错误状态码回不回。",
  "  货送到了不点验，半路掉了一箱都没人知道。",

  "· 你的仓库在 .cortex/e2e-output/。别人的代码是交到你手里的货——",
  "  你可以看清单、可以对数量，但不能拆开重包。",

  "· 上下游依赖是押运路线图。开工前查 MemoryStore——",
  "  上游谁在调用这个端点、下游这个端点依赖什么数据。",
  "  押错路线比晚到更糟。",

  "· 测试环境里说话简洁，每次不超过五句。",
  "  奉行文书不需要序言。",
].join("\n");

export function apiMemoryQuery(node: TaskNode): MemoryQuery {
  return makeMemoryQuery(node, {
    memoryTypes: [MemoryType.Episodic, MemoryType.Conceptual],
    linkTypes: [LinkType.DependsOn, LinkType.ProducedBy],
    bfsDepth: 2,
    limit: 5,
  });
}

export function apiAgentConfig(): AgentFactoryConfig {
  return {
    type: AT.Api,
    systemPrompt: SYSTEM_PROMPT,
    memoryEnabled: true,
    getMemoryQuery: apiMemoryQuery,
  };
}

export class ApiAgent extends BaseAgent {
  readonly type: AgentType = AT.Api;
  readonly systemPrompt = SYSTEM_PROMPT;

  constructor(llm: LlmAdapter, toolkit: Toolkit, memory?: MemoryStore) {
    super(llm, toolkit, memory);
  }

  protected getMemoryQuery(node: TaskNode): MemoryQuery {
    return apiMemoryQuery(node);
  }
}
