/**
 * @cortex/protocol — GET /events 类型
 */

import type { PaginatedResponse, PaginationQuery } from "./pagination.js";

/** 事件记录 */
export interface EventRecord {
  type: string;
  priority?: number;
  payload?: unknown;
  timestamp: number;
  requestId?: string;
  notificationType?: string;
}

/** GET /events 查询参数 */
export interface GetEventsQuery extends PaginationQuery {
  type?: string;
}

/** GET /events 响应 */
export type GetEventsResponse = PaginatedResponse<EventRecord>;
