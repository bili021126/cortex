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
