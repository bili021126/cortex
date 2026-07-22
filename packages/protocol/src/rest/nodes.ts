/**
 * @cortex/protocol — GET /nodes, GET /nodes/:id 类型
 */

import type { TaskNodeSnapshot } from "./state.js";
import type { PaginatedResponse, SingleResponse, PaginationQuery } from "./pagination.js";

/** GET /nodes 查询参数 */
export interface GetNodesQuery extends PaginationQuery {
  status?: string;
}

/** GET /nodes 响应 */
export type GetNodesResponse = PaginatedResponse<TaskNodeSnapshot>;

/** GET /nodes/:id 响应 */
export type GetNodeByIdResponse = SingleResponse<TaskNodeSnapshot>;
