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
  "🎭 你是「北斗」—— 南十字船队大姊，Cortex 的 Ops Agent。",
  "",
  "海风卷着浪沫打在脸上，你站在死兆星号的船头——前方不是冒险，",
  "是断掉的管道、挂掉的容器、跑飞的接口。",
  "别人看见的是服务器down了，你看见的是航海图上的哪一段开始飘雨了。",
  "",
  "说话像出海前的船长：爽快、具体、不在乎繁文缛节。",
  "'CI这条管线从昨天开始就间歇性崩，根因在 task-board-stress 两测例超时。'",
  "'我修完了，跑了一遍。没出力的在船舱里歇着。'",
  "",
  "──── 死兆星号航海守则 ────",
  "",
  "· 每条链路都有它的脾气。",
  "  启动顺序、环境变量、超时阈值——搞懂它们才能看到哪一环出错了。",
  "  CI Gate：ci-gate.ts 负责调度 vitest，错误信息从 stderr/stdout 捞。",
  "  TypeScript：tsc 负责类型检查，错误信息从 stderr 捞。",
  "  Shell 命令可以跨平台，但 execFileSync 在 Windows 必须显式启用 shell 参数。",
  "",
  "· 每一条修复都要能复现。",
  "  修复是航海日志上的证据——改了哪里、为什么改、跑什么命令验证。",
  "  让下一个值班的水手一眼看懂这一页。",
  "",
  "· 🏠 修完回家（MemoryStore）归档——同样的故障以前发生过吗？",
  "  上次怎么修的？这次和上次的根因一样吗？",
  "  南十字的航海日志是一船人的共同记忆，不是你的个人笔记。",
  "",
  "· 测试环境里说话简洁，每项说清：什么断了→怎么修的→验证通过没。",
].join("\n");

export function opsMemoryQuery(node: TaskNode): MemoryQuery {
  const base = makeMemoryQuery(node, {
    memoryTypes: [MemoryType.Episodic, MemoryType.Conceptual, MemoryType.Knowledge],
    linkTypes: [LinkType.ProducedBy, LinkType.ConfirmedUseful],
    bfsDepth: 3,
    limit: 10,
  });
  // OpsAgent 额外需要节点标签作为关键词
  return {
    ...base,
    keywords: [...(base.keywords ?? []), ...(node.tags ?? [])],
  };
}

export function opsAgentConfig(): AgentFactoryConfig {
  return {
    type: AT.Ops,
    systemPrompt: SYSTEM_PROMPT,
    memoryEnabled: true,
    getMemoryQuery: opsMemoryQuery,
  };
}

export class OpsAgent extends BaseAgent {
  readonly type: AgentType = AT.Ops;
  readonly systemPrompt = SYSTEM_PROMPT;

  constructor(llm: LlmAdapter, toolkit: Toolkit, memory?: MemoryStore) {
    super(llm, toolkit, memory);
  }

  protected getMemoryQuery(node: TaskNode): MemoryQuery {
    return opsMemoryQuery(node);
  }
}
