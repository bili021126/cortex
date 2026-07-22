/**
 * @cortex/config — Agent Manifest 配置接口
 *
 * L3·Agent 层。每 agent 仅声明差异——type 决定 profile、key 决定模型，其余字段全可选覆写。
 * 此文件定义 agent-manifests.json 的顶层结构（含 _profiles + agents）。
 *
 * @module interfaces/agent-manifest
 * @layer root — 零依赖，纯类型层
 */

import type { AgentManifest } from "./agent.js";

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

/** agent-manifests.json 顶层结构 */
export interface AgentManifestConfig {
  /** profile 预置库（agent 可通过 profile 字段引用） */
  _profiles: Record<string, AgentProfile>;
  /** 标签主表——所有合法标签的单一真相源 */
  _tags?: string[];
  /** Agent 注册表——key 为 agent ID */
  agents: Record<string, AgentManifest>;
}
