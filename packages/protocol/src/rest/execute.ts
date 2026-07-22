/**
 * @cortex/protocol — POST /execute 类型
 */

import type { SingleResponse } from "./pagination.js";

/** POST /execute 请求体 */
export interface ExecuteRequest {
  input: string;
}

/** POST /execute 响应 */
export type ExecuteResponse = SingleResponse<unknown>;
