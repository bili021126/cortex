import { AgentType as AT, LinkType, type MemoryQuery, type AgentType, type TaskNode } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "../platform/toolkit.js";
import type { MemoryStore } from "../memory/memory-store.js";
import { BaseAgent } from "../base-agent.js";
import { createMemoryQuery } from "./registry.js";

const apiMemoryQuery = createMemoryQuery({
  kind: "TaskLog",
  linkTypes: [LinkType.DerivedFrom, LinkType.ProducedBy],
  bfsDepth: 2,
  limit: 5,
});

export class ApiAgent extends BaseAgent {
  readonly type: AgentType = AT.Api;
  readonly systemPrompt: string;

  constructor(llm: LlmAdapter, toolkit: Toolkit, systemPrompt: string, memory?: MemoryStore) {
    super(llm, toolkit, memory);
    this.systemPrompt = systemPrompt;
  }

  getMemoryQuery(node: TaskNode): MemoryQuery {
    return apiMemoryQuery(node);
  }
}
