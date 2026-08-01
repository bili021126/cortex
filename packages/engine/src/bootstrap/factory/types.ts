// @layer 规划-执行层
// ============================================================
// @cortex/engine 内部 Bootstrap 配置流水线 · 配置引擎类型
//（包内模块，非独立包）
//
// factory 模块是 Cortex engine 的唯一配置读取入口。
// 所有运行时配置经此加载、校验、组装。
//
// B1 收敛：13 个与 @cortex/config/interfaces 语义一致的接口已删除副本，
// 统一从 config re-export（单一图纸）；AgentManifest/ActivationEntry 保留
// AgentType 收窄（config 零依赖约束用 string，engine 运行时需要枚举）。
// 旧 agents 域容器类型（Cortex*Config 等）随 B2 agentManifests 切换退役。
// ============================================================

import type { AgentType } from "@cortex/shared";
import type { RouteTableMap, MergeRule } from "@cortex/notification";
import type {
  AgentManifest as ConfigAgentManifest,
  AgentDisplay,
  AgentRoundtable,
  EventRoutingConfig as ConfigEventRoutingConfig,
  CommitteeRule,
  RoundtableTemplate,
  SelfExaminationConfig,
  CrossVerificationPair,
  CrossVerificationConfig,
  GovernancePipelineConfig,
  AttentionStrategy,
  ActivationEntry as ConfigActivationEntry,
  DocEntry,
} from "@cortex/config";

// ─── Agent 域类型（B1：config 单源 + engine 类型收窄） ───

/** 单个 Agent 定义（B1：config AgentManifest + type 收窄为 AgentType） */
export type AgentManifest = Omit<ConfigAgentManifest, "type"> & { type: AgentType };

export type { AgentDisplay, AgentRoundtable };

/** 事件路由配置（B1：config 单源 + routeTable/mergeRules 收窄为 notification 类型） */
export type EventRoutingConfig = Omit<ConfigEventRoutingConfig, "routeTable" | "mergeRules"> & {
  routeTable: RouteTableMap;
  mergeRules?: MergeRule[];
};

export type { CommitteeRule };

/** 圆桌会议模板（B1：config 单源） */
export type { RoundtableTemplate };

/** 自审视脚本配置（B1：config 单源） */
export type { SelfExaminationConfig };

/** 交叉验证配对/配置（B1：config 单源） */
export type { CrossVerificationPair, CrossVerificationConfig };

/** 治理管线配置（B1：config 单源） */
export type { GovernancePipelineConfig };

/** 注意力策略（B1：config 单源） */
export type { AttentionStrategy };

/** 文档注册项（B1：config 单源） */
export type { DocEntry };

// ─── 旧 agents 域容器类型（B2 退役——engine 切 agentManifests 后删除） ───

/** agents 配置域顶层结构（旧域容器——B2 随 agents.json 退役） */
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

/** 种子记忆配置（旧域容器——B2 随 agents.json 退役） */
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

/** 搜索提供商配置（旧域容器——B2 随 agents.json 退役） */
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

// ─── cognition 配置域类型（旧域容器——B2 随 agents.json 退役） ───

/** 激活矩阵项（B1：config 单源 + agentType 收窄为 AgentType） */
export type ActivationEntry = Omit<ConfigActivationEntry, "agentType"> & {
  agentType: AgentType;
};

/** cognition 配置域顶层结构（旧域容器——B2 随 agents.json 退役） */
export interface CortexCognitionConfig {
  /** 激活矩阵 */
  activationMatrix: ActivationEntry[];
  /** 注意力策略 */
  attention: AttentionStrategy;
}

// ─── docs 配置域类型（旧域容器——B2 随 agents.json 退役） ───

/** docs 配置域顶层结构（旧域容器——B2 随 agents.json 退役） */
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
