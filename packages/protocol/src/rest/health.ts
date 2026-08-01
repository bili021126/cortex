/**
 * @cortex/protocol — GET /health 类型
 *
 * A4 收敛：GetHealthResponse/GetDaemonHealthResponse 别名无消费，已删除
 * （SingleResponse 包装由消费方自行选择，不做重复别名）。
 */

import type { HealthSnapshot } from "./state.js";

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
