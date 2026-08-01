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

/** 观测层数据源状态（spec S2-9）——遥测/审计/记忆持久化 */
export interface ObservabilityInfo {
  /** telemetry.jsonl 路径（未启用文件采集时为 null） */
  telemetryFile: string | null;
  /** telemetry.jsonl 现有条目数（文件不存在为 0） */
  telemetryEntries: number;
  /** audit.jsonl 现有条目数（文件不存在为 0） */
  auditEntries: number;
  /** 记忆后端是否持久化（SQLite=true / 内存=false） */
  memoryPersisted: boolean;
}

/** GET /daemon/health 响应 data */
export interface DaemonHealthSnapshot extends HealthSnapshot {
  daemon: DaemonInfo;
  observability: ObservabilityInfo;
}

/** GET /daemon/health 完整响应 */
export type GetDaemonHealthResponse = SingleResponse<DaemonHealthSnapshot>;
