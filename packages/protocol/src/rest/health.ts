/**
 * @cortex/protocol — GET /health 类型
 */

import type { HealthSnapshot } from "./state.js";
import type { SingleResponse } from "./pagination.js";

/** GET /health 响应 */
export type GetHealthResponse = SingleResponse<HealthSnapshot>;

/** Daemon 扩展健康信息 */
export interface DaemonInfo {
  pid: number;
  uptimeMs: number;
  version: string;
  engineReady: boolean;
  activeSessions: number;
}

/** GET /daemon/health 响应 data */
export interface DaemonHealthSnapshot extends HealthSnapshot {
  daemon: DaemonInfo;
}

/** GET /daemon/health 完整响应 */
export type GetDaemonHealthResponse = SingleResponse<DaemonHealthSnapshot>;
