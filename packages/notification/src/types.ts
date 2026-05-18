// ============================================================
// @cortex/notification — 通知管线类型域
//
// 四通道物理分层通知系统：urgent / important / routine / info
// 与 PipelineObserver 的区别：
//   PipelineObserver → 进程内事件管道（emit/handler 模式）
//   NotificationPipe → 用户通知管线（队列+持久化+路由+归并+确认）
// ============================================================

// ─── 通道枚举 ──────────────────────────────────────────

/** 通知通道——物理分层，各有独立的队列/持久化/失败策略 */
export enum NotificationChannel {
  /** 紧急：优先级插队 + 磁盘持久化 + ackRequired + 直捅用户 */
  Urgent = "urgent",
  /** 重要：FIFO + 磁盘持久化 + 回队重试 */
  Important = "important",
  /** 例行：FIFO + 内存 + 只记日志 */
  Routine = "routine",
  /** 信息：无队列 + 直接丢弃 */
  Info = "info",
}

// ─── 路由配置 ──────────────────────────────────────────

/** 单条路由规则 */
export interface RouteEntry {
  /** 目标通道 */
  channel: NotificationChannel;
  /** 是否需要用户确认 */
  ackRequired: boolean;
  /** 可选：归并键（commitHash / taskNodeId），同键事件在时间窗口内归并 */
  mergeKey?: string;
  /** 可选：时间窗口（ms），同 mergeKey 事件在此窗口内归并。默认 300_000 (5 分钟) */
  mergeWindowMs?: number;
}

/** 路由表——eventType → RouteEntry */
export type RouteTableMap = Record<string, RouteEntry>;

// ─── 通道配置 ──────────────────────────────────────────

/** 单个通道的运行时配置 */
export interface ChannelConfig {
  /** 通道标识 */
  channel: NotificationChannel;
  /** 队列容量上限（0 = 无上限） */
  maxQueueSize: number;
  /** 是否持久化到磁盘 */
  persist: boolean;
  /** 持久化 TTL（ms）。过期自动清理。默认 86_400_000 (24h) */
  persistTtlMs: number;
  /** 失败策略 */
  failureMode: "escalate" | "retry" | "log" | "drop";
}

/** 四通道默认配置 */
export const DEFAULT_CHANNEL_CONFIGS: Record<NotificationChannel, ChannelConfig> = {
  [NotificationChannel.Urgent]: {
    channel: NotificationChannel.Urgent,
    maxQueueSize: 100,
    persist: true,
    persistTtlMs: 86_400_000,
    failureMode: "escalate",
  },
  [NotificationChannel.Important]: {
    channel: NotificationChannel.Important,
    maxQueueSize: 500,
    persist: true,
    persistTtlMs: 86_400_000,
    failureMode: "retry",
  },
  [NotificationChannel.Routine]: {
    channel: NotificationChannel.Routine,
    maxQueueSize: 1000,
    persist: false,
    persistTtlMs: 0,
    failureMode: "log",
  },
  [NotificationChannel.Info]: {
    channel: NotificationChannel.Info,
    maxQueueSize: 0,
    persist: false,
    persistTtlMs: 0,
    failureMode: "drop",
  },
};

// ─── 通知事件 ──────────────────────────────────────────

/** 通知事件——进入通知管线的基本单元 */
export interface NotificationEvent {
  /** 事件类型（对应 routeTable 的 key） */
  type: string;
  /** 目标通道 */
  channel: NotificationChannel;
  /** 是否需要用户确认 */
  ackRequired: boolean;
  /** 幂等键 */
  requestId: string;
  /** 事件摘要（展示给用户） */
  summary: string;
  /** 事件详情（可选） */
  detail?: string;
  /** 来源 Agent 类型 */
  sourceAgent?: string;
  /** 归并键（同键事件在窗口内归并） */
  mergeKey?: string;
  /** 时间戳（ms） */
  timestamp: number;
  /** 确认状态（仅 ackRequired 事件有效） */
  acked?: boolean;
  /** 确认时间（ms） */
  ackedAt?: number;
}

// ─── 归并规则 ──────────────────────────────────────────

/** 同源归并结果 */
export interface MergedNotification {
  /** 归并键 */
  mergeKey: string;
  /** 合并后的事件列表 */
  events: NotificationEvent[];
  /** 最早的单个事件 */
  primary: NotificationEvent;
  /** 归并窗口起止时间 */
  windowStart: number;
  windowEnd: number;
}

/** 归并规则配置 */
export interface MergeRule {
  /** 归并键字段名（如 "mergeKey"、"sourceAgent"） */
  groupBy: string;
  /** 时间窗口（ms） */
  windowMs: number;
  /** 最大归并数（超过则分批次） */
  maxBatch: number;
}

// ─── 通知处理器 ────────────────────────────────────────

/** 通知处理器签名 */
export type NotificationHandler = (event: NotificationEvent) => void | Promise<void>;

/** 确认处理器签名（用于 urgent 通道的 ack 回调） */
export type AckHandler = (requestId: string, approved: boolean) => void | Promise<void>;
