// @layer 规划-执行层
// ============================================================
// @cortex/engine 内部 Bootstrap 配置流水线 · 配置引擎类型域
//（包内模块，非独立包）
//
// factory 模块是 Cortex engine 的唯一配置读取入口。
// 所有运行时配置经此加载、校验、组装。
// ============================================================

import type { AgentType } from "@cortex/shared";
import type { RouteTableMap, MergeRule } from "@cortex/notification";

// ─── agents 配置域类型 ─────────────────────────

/** 单个 Agent 定义 */
export interface AgentManifest {
  /** Agent 标识（如 "ganyu", "albedo"） */
  id: string;
  /** Agent 类型 */
  type: AgentType;
  /** 角色名（人类可读，格式："短名 — 头衔"） */
  role: string;
  /** 系统提示词（内联字符串，与 systemPromptFile 二选一） */
  systemPrompt?: string;
  /** 系统提示词文件路径（相对项目根，与 systemPrompt 二选一） */
  systemPromptFile?: string;
  /** 展示信息——统一的 emoji + 短名 + 头衔（收敛自 agent-registry.json） */
  display?: AgentDisplay;
  /** 圆桌会议 Persona——仅参与圆桌的 Agent 有此字段（收敛自 persona-prompts.json） */
  roundtable?: AgentRoundtable;
  /** 生产的事件类型列表 */
  produces: string[];
  /** 使用的模型 */
  model: string;
  /** API key 分组 */
  key: string;
  /** 最大实例数（默认 1） */
  maxInstances?: number;
  /** 认领标签（用于 Scheduler 匹配分发） */
  tags?: string[];
  /** 工具权限列表（用于 Toolkit 权限校验） */
  toolPermissions?: string[];
  /** 记忆查询策略名（如 "code", "review", "analysis"，用于 MemoryStore 检索） */
  memoryQueryStrategy?: string;
  /** 规划系统提示词（仅 meta agent 使用，与 planningPromptFile 二选一） */
  planningPrompt?: string;
  /** 规划系统提示词文件路径（相对项目根） */
  planningPromptFile?: string;
  /** 重规划系统提示词（仅 meta agent 使用，与 replanPromptFile 二选一） */
  replanPrompt?: string;
  /** 重规划系统提示词文件路径（相对项目根） */
  replanPromptFile?: string;
}

/** Agent 展示信息（统一收敛自此） */
export interface AgentDisplay {
  emoji: string;
  shortName: string;
  title: string;
}

/** Agent 圆桌会议 Persona */
export interface AgentRoundtable {
  /** 圆桌 persona 提示词（内联字符串，与 personaPromptFile 二选一） */
  personaPrompt?: string;
  /** 圆桌 persona 提示词文件路径（相对项目根） */
  personaPromptFile?: string;
  roundtableTitle: string;
}

/** 事件路由配置 */
export interface EventRoutingConfig {
  /** 路由表——eventType → channel + ackRequired */
  routeTable: RouteTableMap;
  /** 通道配置覆盖 */
  channels?: Record<string, unknown>;
  /** 归并规则 */
  mergeRules?: MergeRule[];
  /** 委员会召集规则 */
  committeeRules?: CommitteeRule[];
}

/** 委员会召集规则 */
export interface CommitteeRule {
  /** 规则 ID */
  id: string;
  /** 触发事件类型 */
  triggerEvent: string;
  /** 参与的 Agent 类型列表 */
  members: AgentType[];
  /** 是否紧急召集（跳过议程队列） */
  urgent: boolean;
}

/** 圆桌会议模板 */
export interface RoundtableTemplate {
  /** 模板名称（用于 `cortex roundtable start <name>`） */
  name: string;
  /** 人类可读描述 */
  description: string;
  /** 参与 Persona 数 */
  personas: number;
  /** 轮次数 */
  rounds: number;
  /** 参与的 Agent Persona 名列表 */
  agents: string[];
  /** 自定义规则（追加在通用规则之后） */
  rules?: string[];
}

/** agents 配置域顶层结构 */
export interface CortexAgentsConfig {
  agents: Record<string, AgentManifest>;
  eventRouting: EventRoutingConfig;
  /** 圆桌会议模板 */
  roundtableTemplates?: RoundtableTemplate[];
  /** 搜索提供商配置 */
  searchProviders?: SearchProvidersConfig;
  /** 自审视脚本配置（收敛自 self-examination-config.json） */
  selfExamination?: SelfExaminationConfig;
  /** 交叉验证配对表（收敛自 cross-verification-pairs.json） */
  crossVerification?: CrossVerificationConfig;
  /** 种子记忆（收敛自 seed-memories.json） */
  seedMemories?: SeedMemoriesConfig;
  /** 治理管线配置 */
  governancePipeline?: GovernancePipelineConfig;
  /** 工具元数据定义（供 Toolkit.setToolMeta() 注入） */
  tools?: Record<string, unknown>;
}

/** 自审视脚本配置 */
export interface SelfExaminationConfig {
  description: string;
  agents: {
    hard: string[];
    soft: string[];
  };
  consensusAgents: string[];
  agentTypes: {
    hard: string[];
    soft: string[];
  };
  outputDir: {
    hard: string;
    soft: string;
  };
  consensusOutput: string;
  archiveBase: string;
  cleanupFiles: string[];
  templates: {
    hard: string;
    soft: string;
  };
  reportMaxCharsDefault: number;
}

/** 交叉验证配对 */
export interface CrossVerificationPair {
  reporterKey: string;
  reporterName: string;
  reporterEmoji: string;
  verifierKey: string;
  verifierName: string;
  verifierEmoji: string;
  reportFilePattern: string;
}

/** 交叉验证配置 */
export interface CrossVerificationConfig {
  description: string;
  pairs: CrossVerificationPair[];
}

/** 种子记忆配置 */
export interface SeedMemoriesConfig {
  description: string;
  entries: Array<{
    taskId: string;
    memoryType: string;
    agentType: string;
    content: unknown;
    summary: string;
    linkTo?: string;
  }>;
}

/** 搜索提供商配置 */
export interface SearchProvidersConfig {
  backends: Array<{
    id: string;
    command: string;
    args: string[];
    enabled: boolean;
  }>;
  aggregation: {
    deduplicateBy: string;
    resultTimeout: number;
    minBackends: number;
  };
}

/** 治理管线配置 */
export interface GovernancePipelineConfig {
  enabled: boolean;
  stages: string[];
  ciGate: {
    script: string;
    timeoutMs: number;
    blockOnFailure: boolean;
  };
  triggers: {
    onAmendmentProposed: boolean;
    onSchedule: boolean;
    onCommit: boolean;
  };
}

// ─── cognition 配置域类型 ─────────────────────

/** 激活矩阵项 */
export interface ActivationEntry {
  /** Agent 类型 */
  agentType: AgentType;
  /** 默认是否激活 */
  active: boolean;
  /** 取向覆写 */
  orientation?: string;
}

/** 注意力策略 */
export interface AttentionStrategy {
  /** HCA 权重（近期上下文注意力） */
  hcaWeight: number;
  /** CSA 权重（压缩语义注意力） */
  csaWeight: number;
  /** 最大记忆条数 */
  maxMemoryItems: number;
}

/** cognition 配置域顶层结构 */
export interface CortexCognitionConfig {
  /** 激活矩阵 */
  activationMatrix: ActivationEntry[];
  /** 注意力策略 */
  attention: AttentionStrategy;
}

// ─── docs 配置域类型 ─────────────────────────

/** 文档注册项 */
export interface DocEntry {
  /** 文档路径（相对项目根） */
  path: string;
  /** 文档类型 */
  type: "constitution" | "design" | "audit" | "review" | "governance";
  /** 版本 */
  version: string;
  /** 是否正史文档 */
  canonical: boolean;
}

/** docs 配置域顶层结构 */
export interface CortexDocsConfig {
  /** 宪法路径 */
  constitutionPath: string;
  /** 文档注册表 */
  docRegistry: DocEntry[];
}

// ─── Bootstrap 结果 ─────────────────────────────────

/** Bootstrap 完整结果——所有组装好的运行时对象 */
export interface BootstrapResult {
  /** Agent 定义列表（供 Scheduler 注册） */
  agentDefinitions: AgentManifest[];
  /** 事件路由配置（供 NotificationPipe 加载） */
  eventRouting: EventRoutingConfig;
  /** 认知配置（供激活矩阵加载） */
  cognition: CortexCognitionConfig;
  /** 文档配置（供 DocRegistry 加载） */
  docs: CortexDocsConfig;
  /** 圆桌会议模板（供 roundtable 命令加载） */
  roundtableTemplates: RoundtableTemplate[];
  /** 工具元数据（供 Toolkit.setToolMeta() 注入） */
  tools?: Record<string, unknown>;
  /** 校验警告 */
  warnings: string[];
}
