/**
 * @cortex/protocol — GET /agents, GET /agents/:type 类型
 */

import type { SingleResponse } from "./pagination.js";

/** GET /agents 响应——按 agentType 分组的状态映射 */
export type GetAgentsResponse = SingleResponse<Record<string, string[]>>;

/** GET /agents/:type 响应 */
export interface AgentTypeStatus {
  agentType: string;
  statuses: string[];
}

export type GetAgentByTypeResponse = SingleResponse<AgentTypeStatus>;
