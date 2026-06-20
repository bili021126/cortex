// ============================================================
// @cortex/notification — 桶导出
// ============================================================

export {
  NotificationChannel,
  DEFAULT_CHANNEL_CONFIGS,
} from "./types.js";

export type {
  RouteEntry,
  RouteTableMap,
  ChannelConfig,
  NotificationEvent,
  MergedNotification,
  MergeRule,
  NotificationHandler,
  AckHandler,
} from "./types.js";

export { RouteTable } from "./route-table.js";
export { NotificationPersistence } from "./persistence.js";
export { UrgentChannel, ImportantChannel, RoutineChannel, InfoChannel } from "./channels.js";
export { NotificationPipe } from "./notification-pipe.js";

// ── Core-2: 语义分层 ───────────────────────────
export { withSemantics, suggestRouting, SEMANTIC_TO_CHANNEL, SEMANTIC_DESCRIPTIONS } from "./semantic-layer.js";
export type { NotificationSemantics, SemanticNotification } from "./semantic-layer.js";
