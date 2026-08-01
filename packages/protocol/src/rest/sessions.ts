/**
 * @cortex/protocol — Session REST 类型
 *
 * 对话会话管理端点类型定义。
 * A4 收敛：CreateSessionResponse 别名无消费，已删除。
 */

/** 会话 DTO */
export interface SessionDTO {
  id: string;
  agent: string;
  mode: string;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
}

/** GET /sessions 响应 */
export interface SessionListResponse {
  data: SessionDTO[];
}

/** POST /sessions 请求体 */
export interface CreateSessionRequest {
  agent?: string;
  mode?: "chat" | "talk" | "plan" | "party" | "command";
}

/** DELETE /sessions/:id 响应 */
export interface DeleteSessionResponse {
  deleted: boolean;
}
