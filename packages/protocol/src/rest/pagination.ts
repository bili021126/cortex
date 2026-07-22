/**
 * @cortex/protocol — 分页响应结构
 */

/** 分页元数据 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** 分页响应包装 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

/** 单资源响应包装 */
export interface SingleResponse<T> {
  data: T;
}

/** 分页查询参数 */
export interface PaginationQuery {
  page?: number;
  limit?: number;
}
