/**
 * @cortex/protocol — Memory REST 类型
 *
 * 对话记忆的 CRUD 端点类型定义。
 */

import type { SingleResponse, PaginatedResponse, PaginationQuery } from "./pagination.js";

/** 记忆条目 DTO */
export interface MemoryEntryDTO {
  id: string;
  content: string;
  kind: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
  // R12-H2：daemon 实际返回字段（此前 DTO 缺——客户端消费全 undefined）
  summary?: string;
  domain?: string;
  semanticState?: string;
}

/** GET /memory 查询参数 */
export interface MemoryQueryRequest extends PaginationQuery {
  query: string;
  kind?: string;
  tags?: string[];
}

/** GET /memory 响应 */
export type MemoryQueryResponse = PaginatedResponse<MemoryEntryDTO>;

/** POST /memory 请求体 */
export interface MemoryWriteRequest {
  content: string;
  kind: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/** POST /memory 响应 */
export type MemoryWriteResponse = SingleResponse<MemoryEntryDTO>;

/** DELETE /memory/:id 响应 */
export interface MemoryDeleteResponse {
  deleted: boolean;
}
