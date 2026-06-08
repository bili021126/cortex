// ============================================================
// @cortex/engine/agents/registry —— Agent 声明式注册表
//
// 所有 Agent 的配置（memory query 参数 + Agent 类）集中于此。
// 新增 Agent 只需在 AGENT_REGISTRY 数组中加一项。
//
// @version 3.0.0 — 声明式重构：消灭 9 个独立 agent 文件
// ============================================================

import { AgentType, type TaskNode, type MemoryQuery, type MemoryKind, type LinkType, type ReadMode } from "@cortex/shared";
import type { AgentFactoryConfig } from "../components/agent-factory.js";
import { makeMemoryQuery } from "../memory/pipeline.js";

// ─── Memory Query 参数（每个 Agent 的唯一差异点） ──────────

export interface MemoryQueryParams {
  kind?: MemoryKind;
  linkTypes: LinkType[];
  bfsDepth: number;
  limit: number;
  /** 可选读取模式 */
  readMode?: ReadMode;
}

// ─── 注册项类型 ─────────────────────────────────────

export interface AgentRegistration {
  /** Agent 类型枚举值 */
  type: AgentType;
  /** Memory query 参数——通用工厂据此生成 *MemoryQuery + *AgentConfig */
  memoryParams: MemoryQueryParams;
  /** 是否在 bootstrap 时自动注册到 Scheduler */
  autoRegister: boolean;
  /** 简短描述（用于调试/日志） */
  description: string;
  /** 可选的 Agent 类（ApiAgent/DataAgent 等有自定义子类的） */
  AgentClass?: new (...args: unknown[]) => unknown;
}

// ─── 通用工厂函数 ──────────────────────────────────

/** 从参数生成 MemoryQuery 函数 */
export function createMemoryQuery(params: MemoryQueryParams): (node: TaskNode) => MemoryQuery {
  return (node: TaskNode) => makeMemoryQuery(node, { ...params });
}

// ─── 声明式注册表（新增 Agent 只需在此追加一项） ──────────

export const AGENT_REGISTRY: AgentRegistration[] = [
  {
    type: AgentType.Code,
    memoryParams: {
      kind: "TaskLog",
      linkTypes: ["ProducedBy" as LinkType, "DerivedFrom" as LinkType],
      bfsDepth: 2,
      limit: 3,
    },
    autoRegister: true,
    description: "代码实现——阿尔贝多",
  },
  {
    type: AgentType.Review,
    memoryParams: {
      kind: "TaskLog",
      linkTypes: ["DerivedFrom" as LinkType, "DerivedFrom" as LinkType],
      bfsDepth: 2,
      limit: 5,
    },
    autoRegister: true,
    description: "代码审查——刻晴",
  },
  {
    type: AgentType.Analysis,
    memoryParams: {
      kind: "TaskLog",
      linkTypes: ["ProducedBy" as LinkType, "ConfirmedUseful" as LinkType],
      bfsDepth: 2,
      limit: 3,
    },
    autoRegister: true,
    description: "深度分析——莫娜",
  },
  {
    type: AgentType.Ops,
    memoryParams: {
      kind: "TaskLog",
      linkTypes: ["ProducedBy" as LinkType, "ConfirmedUseful" as LinkType],
      bfsDepth: 3,
      limit: 10,
    },
    autoRegister: true,
    description: "运维操作——北斗",
  },
  {
    type: AgentType.Loop,
    memoryParams: {
      kind: "TaskLog",
      linkTypes: ["ProducedBy" as LinkType, "DerivedFrom" as LinkType],
      bfsDepth: 2,
      limit: 5,
    },
    autoRegister: true,
    description: "模式发现——宵宫",
  },
  {
    type: AgentType.DocGovern,
    memoryParams: {
      kind: "TaskLog",
      linkTypes: ["DerivedFrom" as LinkType, "DerivedFrom" as LinkType],
      bfsDepth: 2,
      limit: 3,
    },
    autoRegister: true,
    description: "治理审计——凝光",
  },
  {
    type: AgentType.Api,
    memoryParams: {
      kind: "TaskLog",
      linkTypes: ["DerivedFrom" as LinkType, "ProducedBy" as LinkType],
      bfsDepth: 2,
      limit: 5,
    },
    autoRegister: true,
    description: "API 设计——久岐忍（Core-2 预埋）",
  },
  {
    type: AgentType.Data,
    memoryParams: {
      kind: "TaskLog",
      linkTypes: ["ProducedBy" as LinkType, "DerivedFrom" as LinkType],
      bfsDepth: 2,
      limit: 5,
    },
    autoRegister: true,
    description: "数据建模——艾尔海森（Core-2 预埋）",
  },
  {
    type: AgentType.Fix,
    memoryParams: {
      kind: "TaskLog",
      linkTypes: ["ProducedBy" as LinkType, "DerivedFrom" as LinkType, "ConfirmedUseful" as LinkType],
      readMode: "CSA",
      bfsDepth: 2,
      limit: 3,
    },
    autoRegister: true,
    description: "缺陷修复——希格雯",
  },
];

// ─── 按类型查找 ────────────────────────────────────

export function findRegistration(type: AgentType): AgentRegistration | undefined {
  return AGENT_REGISTRY.find((r) => r.type === type);
}

export function getAutoRegisterable(): AgentRegistration[] {
  return AGENT_REGISTRY.filter((r) => r.autoRegister);
}

// ─── OpsAgent 特殊逻辑（额外需要节点标签作为关键词） ──

const opsReg = AGENT_REGISTRY.find((r) => r.type === AgentType.Ops) ?? (() => { throw new Error("Ops agent not found in registry"); })();

// ─── 向后兼容：具名导出 ──

/** 通用：从注册表按类型生成具名 config + memoryQuery */
function namedExports(type: AgentType) {
  const reg = findRegistration(type);
  if (!reg) throw new Error(`Agent ${type} not found in registry`);
  const mq = createMemoryQuery(reg.memoryParams);
  const cfg = (sp: string): AgentFactoryConfig => ({
    type: reg.type,
    systemPrompt: sp,
    memoryEnabled: true,
    getMemoryQuery: mq,
  });
  return { query: mq, config: cfg };
}

const code = namedExports(AgentType.Code);
export const codeMemoryQuery = code.query;
export const codeAgentConfig = code.config;

const review = namedExports(AgentType.Review);
export const reviewMemoryQuery = review.query;
export const reviewAgentConfig = review.config;

const analysis = namedExports(AgentType.Analysis);
export const analysisMemoryQuery = analysis.query;
export const analysisAgentConfig = analysis.config;

export function opsMemoryQuery(node: TaskNode): MemoryQuery {
  const base = makeMemoryQuery(node, {
    kind: opsReg.memoryParams.kind,
    linkTypes: opsReg.memoryParams.linkTypes,
    bfsDepth: opsReg.memoryParams.bfsDepth,
    limit: opsReg.memoryParams.limit,
  });
  return {
    ...base,
    keywords: [...(base.keywords ?? []), ...(node.tags ?? [])],
  };
}
export function opsAgentConfig(systemPrompt: string): AgentFactoryConfig {
  return {
    type: AgentType.Ops,
    systemPrompt,
    memoryEnabled: true,
    getMemoryQuery: opsMemoryQuery,
  };
}

const loop = namedExports(AgentType.Loop);
export const loopMemoryQuery = loop.query;
export const loopAgentConfig = loop.config;

const docGovern = namedExports(AgentType.DocGovern);
export const docGovernMemoryQuery = docGovern.query;
export const docGovernAgentConfig = docGovern.config;

const api = namedExports(AgentType.Api);
export const apiMemoryQuery = api.query;
export const apiAgentConfig = api.config;

const data = namedExports(AgentType.Data);
export const dataMemoryQuery = data.query;
export const dataAgentConfig = data.config;

const fix = namedExports(AgentType.Fix);
export const fixMemoryQuery = fix.query;
export const fixAgentConfig = fix.config;
