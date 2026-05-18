// ============================================================
// @cortex/factory — Agent 组装器
//
// 从 AgentDefinition[] 生成 AgentConfig（供 Scheduler 注册）。
// 不在此创建 Agent 实例——创建是 engine 层的事。
// ============================================================

import type { AgentType, AgentConfig } from "@cortex/shared";
import type { AgentDefinition } from "../types.js";

/** 组装结果 */
export interface AgentAssemblyResult {
  /** Agent 配置列表（供 Scheduler 注册） */
  configs: AgentConfig[];
  /** 按 key 分组的 Agent */
  byKey: Map<string, AgentDefinition[]>;
}

/**
 * 将 AgentDefinition[] 组装为 AgentConfig[]。
 * 此层只做数据转换，不创建实例。
 */
export function assembleAgents(definitions: AgentDefinition[]): AgentAssemblyResult {
  const configs: AgentConfig[] = [];
  const byKey = new Map<string, AgentDefinition[]>();

  for (const def of definitions) {
    configs.push({
      type: def.type as AgentType,
      maxInstances: def.maxInstances ?? 1,
    });

    if (!byKey.has(def.key)) {
      byKey.set(def.key, []);
    }
    byKey.get(def.key)!.push(def);
  }

  return { configs, byKey };
}
