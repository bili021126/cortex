// ============================================================
// @cortex/engine/agents/registry —— Agent 声明式注册表
//
// 所有 Agent 的配置（memory query 参数 + Agent 类）集中于此。
// 新增 Agent 只需在 AGENT_REGISTRY 数组中加一项。
//
// @version 3.0.0 — 声明式重构：消灭 9 个独立 agent 文件
// ============================================================

import { AgentType, type TaskNode, type MemoryQuery, type MemoryKind, type LinkType, type ReadMode, type AgentCapability } from "@cortex/shared";
import type { AgentFactoryConfig } from "../components/agent-factory.js";
import { makeMemoryQuery } from "../memory/pipeline.js";
import { capabilityRegistry } from "../core/capability-registry.js";

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
  /** Agent 自声明——能力画像 */
  capability: AgentCapability;
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
    memoryParams: { kind: "TaskLog", linkTypes: ["ProducedBy" as LinkType, "DerivedFrom" as LinkType], bfsDepth: 2, limit: 3 },
    autoRegister: true,
    description: "代码实现——阿尔贝多",
    capability: {
      id: AgentType.Code, type: AgentType.Code, role: "阿尔贝多 — 首席工匠", emoji: "🎨",
      tags: ["implementation", "code", "refactor", "bugfix"], produces: ["implementation"],
      toolPermissions: ["write_file", "search_replace", "read_file", "run_shell"],
      memoryQueryStrategy: "code", maxInstances: 3, modelKey: "code",
      applicableScenarios: ["代码实现", "重构", "Bug 修复"], outputFormat: "code", collaborationMode: "solo",
    },
  },
  {
    type: AgentType.Review,
    memoryParams: { kind: "TaskLog", linkTypes: ["DerivedFrom" as LinkType, "DerivedFrom" as LinkType], bfsDepth: 2, limit: 5 },
    autoRegister: true,
    description: "代码审查——刻晴",
    capability: {
      id: AgentType.Review, type: AgentType.Review, role: "刻晴 — 玉衡星", emoji: "⚡",
      tags: ["review", "audit"], produces: ["review"],
      toolPermissions: ["read_file", "run_shell"],
      memoryQueryStrategy: "review", maxInstances: 2, modelKey: "review",
      applicableScenarios: ["代码审查", "质量审计"], outputFormat: "report", collaborationMode: "reviewer",
    },
  },
  {
    type: AgentType.Analysis,
    memoryParams: { kind: "TaskLog", linkTypes: ["ProducedBy" as LinkType, "ConfirmedUseful" as LinkType], bfsDepth: 2, limit: 3 },
    autoRegister: true,
    description: "深度分析——莫娜",
    capability: {
      id: AgentType.Analysis, type: AgentType.Analysis, role: "莫娜 — 占星术士", emoji: "🔮",
      tags: ["analysis", "research"], produces: ["analysis"],
      toolPermissions: ["read_file", "search_code", "web_search"],
      memoryQueryStrategy: "analysis", maxInstances: 2, modelKey: "analysis",
      applicableScenarios: ["深度分析", "架构审查", "根因分析"], outputFormat: "report", collaborationMode: "solo",
    },
  },
  {
    type: AgentType.Ops,
    memoryParams: { kind: "TaskLog", linkTypes: ["ProducedBy" as LinkType, "ConfirmedUseful" as LinkType], bfsDepth: 3, limit: 10 },
    autoRegister: true,
    description: "运维操作——北斗",
    capability: {
      id: AgentType.Ops, type: AgentType.Ops, role: "北斗 — 南十字船长", emoji: "⚓",
      tags: ["ops", "deploy", "config"], produces: ["ops"],
      toolPermissions: ["run_shell", "write_file", "search_replace"],
      memoryQueryStrategy: "ops", maxInstances: 2, modelKey: "ops",
      applicableScenarios: ["部署操作", "配置变更", "环境管理"], outputFormat: "structured", collaborationMode: "solo",
    },
  },
  {
    type: AgentType.Loop,
    memoryParams: { kind: "TaskLog", linkTypes: ["ProducedBy" as LinkType, "DerivedFrom" as LinkType], bfsDepth: 2, limit: 5 },
    autoRegister: true,
    description: "模式发现——莫娜",
    capability: {
      id: AgentType.Loop, type: AgentType.Loop, role: "莫娜 — 占星术士", emoji: "🔮",
      tags: ["loop", "pattern_scan"], produces: ["pattern"],
      toolPermissions: ["read_file", "search_code"],
      memoryQueryStrategy: "loop", maxInstances: 1, modelKey: "loop",
      applicableScenarios: ["模式发现", "重复检测", "跨模块分析"], outputFormat: "report", collaborationMode: "solo",
    },
  },
  {
    type: AgentType.DocGovern,
    memoryParams: { kind: "TaskLog", linkTypes: ["DerivedFrom" as LinkType, "DerivedFrom" as LinkType], bfsDepth: 2, limit: 3 },
    autoRegister: true,
    description: "治理审计——凝光",
    capability: {
      id: AgentType.DocGovern, type: AgentType.DocGovern, role: "凝光 — 天权星", emoji: "💎",
      tags: ["doc-govern", "audit"], produces: ["governance"],
      toolPermissions: ["read_file", "write_file", "search_replace"],
      memoryQueryStrategy: "doc-govern", maxInstances: 1, modelKey: "govern",
      applicableScenarios: ["治理审计", "合规审查", "修宪提案"], outputFormat: "decision", collaborationMode: "reviewer",
    },
  },
  {
    type: AgentType.Api,
    memoryParams: { kind: "TaskLog", linkTypes: ["DerivedFrom" as LinkType, "ProducedBy" as LinkType], bfsDepth: 2, limit: 5 },
    autoRegister: true,
    description: "API 设计——久岐忍",
    capability: {
      id: AgentType.Api, type: AgentType.Api, role: "久岐忍 — 律法咨询", emoji: "📋",
      tags: ["api", "design"], produces: ["api"],
      toolPermissions: ["write_file", "read_file", "search_code"],
      memoryQueryStrategy: "api", maxInstances: 1, modelKey: "api",
      applicableScenarios: ["API 设计", "接口契约", "协议定义"], outputFormat: "structured", collaborationMode: "solo",
    },
  },
  {
    type: AgentType.Data,
    memoryParams: { kind: "TaskLog", linkTypes: ["ProducedBy" as LinkType, "DerivedFrom" as LinkType], bfsDepth: 2, limit: 5 },
    autoRegister: true,
    description: "数据建模——艾尔海森",
    capability: {
      id: AgentType.Data, type: AgentType.Data, role: "艾尔海森 — 知论派", emoji: "📚",
      tags: ["data", "modeling"], produces: ["data"],
      toolPermissions: ["write_file", "read_file", "search_code"],
      memoryQueryStrategy: "data", maxInstances: 1, modelKey: "data",
      applicableScenarios: ["数据建模", "Schema 设计", "存储优化"], outputFormat: "structured", collaborationMode: "solo",
    },
  },
  {
    type: AgentType.Fix,
    memoryParams: { kind: "TaskLog", linkTypes: ["ProducedBy" as LinkType, "DerivedFrom" as LinkType, "ConfirmedUseful" as LinkType], readMode: "CSA", bfsDepth: 2, limit: 3 },
    autoRegister: true,
    description: "缺陷修复——希格雯",
    capability: {
      id: AgentType.Fix, type: AgentType.Fix, role: "希格雯 — 医护长", emoji: "💉",
      tags: ["fix", "bugfix", "urgent"], produces: ["fix"],
      toolPermissions: ["write_file", "search_replace", "read_file", "run_shell"],
      memoryQueryStrategy: "fix", maxInstances: 2, modelKey: "fix",
      applicableScenarios: ["紧急修复", "缺陷定位", "回滚操作"], outputFormat: "code", collaborationMode: "solo",
    },
  },
];

// ─── 自声明自动注册 ────────────────────────────────

/** 将 AGENT_REGISTRY 中的全部能力声明注册到 CapabilityRegistry */
export function registerAllCapabilities(): void {
  const caps = AGENT_REGISTRY.map((r) => r.capability);
  capabilityRegistry.registerAll(caps);
}

// ─── 按类型查找 ────────────────────────────────────

export function findRegistration(type: AgentType): AgentRegistration | undefined {
  return AGENT_REGISTRY.find((r) => r.type === type);
}

export function getAutoRegisterable(): AgentRegistration[] {
  return AGENT_REGISTRY.filter((r) => r.autoRegister);
}

// ─── OpsAgent 特殊逻辑（额外需要节点标签作为关键词） ──

const opsReg = AGENT_REGISTRY.find((r) => r.type === AgentType.Ops);
if (!opsReg) throw new Error("Ops agent not found in registry");

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
  const reg = opsReg;
  if (!reg) return { kind: undefined, linkTypes: [], bfsDepth: 2, limit: 20 };
  const base = makeMemoryQuery(node, {
    kind: reg.memoryParams.kind,
    linkTypes: reg.memoryParams.linkTypes,
    bfsDepth: reg.memoryParams.bfsDepth,
    limit: reg.memoryParams.limit,
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
