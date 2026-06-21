import type { AgentDefinition } from "../bootstrap/factory/index.js";
import type { Agent } from "@cortex/shared";
import type { PluginContext } from "./types.js";
/**
 * AgentFactory —— 接收 AgentDefinition + PluginContext，产出 Agent 实例。
 * 返回 undefined 表示该类型不产生可调度 Agent（如 butler 旁听管线）。
 */
export type AgentFactory = (def: AgentDefinition, ctx: PluginContext) => Promise<Agent | undefined>;
/** 注册 Agent 工厂 */
export declare function registerAgentFactory(type: string, factory: AgentFactory): void;
/** 获取 Agent 工厂 */
export declare function getAgentFactory(type: string): AgentFactory | undefined;
/** 检查是否已注册 */
export declare function hasAgentFactory(type: string): boolean;
/** 列出所有已注册的 Agent 类型 */
export declare function getRegisteredAgentTypes(): string[];
//# sourceMappingURL=agent-factory-registry.d.ts.map