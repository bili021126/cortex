// ============================================================
// @cortex/engine/plugin/agent-factory-registry —— Agent 工厂注册表
//
// 配置驱动：新增 Agent 类型只需 registerAgentFactory() + cortex-agents.json，
// 不再需要改 scheduler.plugin.ts 的 switch 分支。
//
// @since v3.1 — 配置驱动装配
// ============================================================

import type { AgentDefinition } from "@cortex/factory";
import type { Agent } from "@cortex/shared";
import type { PluginContext } from "./types.js";

/**
 * AgentFactory —— 接收 AgentDefinition + PluginContext，产出 Agent 实例。
 * 返回 undefined 表示该类型不产生可调度 Agent（如 butler 旁听管线）。
 */
export type AgentFactory = (
  def: AgentDefinition,
  ctx: PluginContext,
) => Promise<Agent | undefined>;

// ─── 注册表 ─────────────────────────────────────

const _factories = new Map<string, AgentFactory>();

/** 注册 Agent 工厂 */
export function registerAgentFactory(type: string, factory: AgentFactory): void {
  _factories.set(type, factory);
}

/** 获取 Agent 工厂 */
export function getAgentFactory(type: string): AgentFactory | undefined {
  return _factories.get(type);
}

/** 检查是否已注册 */
export function hasAgentFactory(type: string): boolean {
  return _factories.has(type);
}

/** 列出所有已注册的 Agent 类型 */
export function getRegisteredAgentTypes(): string[] {
  return [..._factories.keys()];
}
