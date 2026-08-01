/**
 * @cortex/config — Agent Manifest 配置接口
 *
 * L3·Agent 层。每 agent 仅声明差异——type 决定 profile、key 决定模型，其余字段全可选覆写。
 * 此文件定义 agent-manifests.json 的顶层结构（含 _profiles + agents）。
 *
 * @module interfaces/agent-manifest
 * @layer root — 零依赖，纯类型层
 */

/** Agent 的 profile 预置——可被 agent 声明覆写 */
export interface AgentProfile {
  /** 模型 ID */
  model: string;
  /** 密钥 ID */
  key: string;
  /** 认领标签 */
  tags?: string[];
  /** 工具权限列表 */
  toolPermissions?: string[];
  /** 记忆查询策略名 */
  memoryQueryStrategy?: string;
}

/**
 * Agent 声明（L3：仅声明差异）——agent-manifests.json 中每个 agent 条目的形态。
 * 完整字段由 engine 展开时与 _profiles[profile] 合并。
 */
export interface AgentManifestDecl {
  /** Agent 类型（映射 AgentType） */
  type: string;
  /** 引用的 profile 预置（可空——无 profile 时全字段自声明） */
  profile?: string | null;
  /** 角色名（人类可读，格式："短名 — 头衔"） */
  role?: string;
  /** 展示 emoji */
  emoji?: string;
  /** 密钥 ID（未指定时由 profile 提供） */
  key?: string;
  /** 模型 ID（未指定时由 profile 提供） */
  model?: string;
  /** 最大实例数 */
  maxInstances?: number;
  /** 认领标签 */
  tags?: string[];
  /** 工具权限列表 */
  toolPermissions?: string[];
  /** 记忆查询策略名 */
  memoryQueryStrategy?: string;
  /** 生产的事件类型列表 */
  produces?: string[];
  /** 系统提示词文件路径 */
  systemPrompt?: string;
  /** 规划系统提示词文件路径 */
  planningPrompt?: string;
  /** 重规划系统提示词文件路径 */
  replanPrompt?: string;
  /** 圆桌会议 Persona */
  roundtable?: { title?: string; persona?: string };
}

/** agent-manifests.json 顶层结构 */
export interface AgentManifestConfig {
  /** profile 预置库（agent 可通过 profile 字段引用） */
  _profiles: Record<string, AgentProfile>;
  /** 标签主表——所有合法标签的单一真相源 */
  _tags?: string[];
  /** Agent 注册表——key 为 agent ID，值为声明差异 */
  agents: Record<string, AgentManifestDecl>;
}
