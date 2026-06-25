// ============================================================
// @cortex/notification — 通知主管线
//
// NotificationPipe 是四通道通知系统的统一入口。
// 职责：
//   1. push(event) → 查 routeTable → 入对应物理通道
//   2. ack(requestId) → urgent 通道确认
//   3. on(channel, handler) → 按通道订阅
//   4. 同源归并（同一 mergeKey 在窗口内的事件合并为一条 MergedNotification）
// ============================================================

import { NotificationChannel, type NotificationEvent, type MergedNotification, type MergeRule, type NotificationHandler, type AckHandler, type RouteTableMap } from "./types.js";
import { RouteTable } from "./route-table.js";
import { UrgentChannel, ImportantChannel, RoutineChannel, InfoChannel } from "./channels.js";
import type { NotificationPersistence } from "./persistence.js";

/** 生成幂等 requestId */
function generateRequestId(): string {
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * NotificationPipe —— 通知管线统一入口。
 *
 * 使用示例：
 * ```typescript
 * const pipe = new NotificationPipe(persistence);
 * pipe.loadRoutes({ DISCIPLINARY_ALERT: { channel: "urgent", ackRequired: true } });
 * pipe.on(NotificationChannel.Urgent, (evt) => { / * 通知用户 * / });
 * pipe.push({ type: "DISCIPLINARY_ALERT", summary: "安柏：阿贝多连续3次违规", ... });
 * ```
 */
export class NotificationPipe {
  private routeTable: RouteTable;
  private urgent: UrgentChannel;
  private important: ImportantChannel;
  private routine: RoutineChannel;
  private info: InfoChannel;
  private persistence?: NotificationPersistence;

  /** 归并缓冲区：mergeKey → 事件列表 */
  private mergeBuffer = new Map<string, NotificationEvent[]>();
  /** 归并超时定时器：mergeKey → timer */
  private mergeTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  /** 归并超时阈值（毫秒） */
  private static readonly MERGE_TIMEOUT_MS = 5_000;
  /** 归并规则 */
  private mergeRules: MergeRule[] = [];

  /** ack 回调 */
  private ackHandlers: AckHandler[] = [];

  constructor(persistence?: NotificationPersistence) {
    this.persistence = persistence;
    this.routeTable = new RouteTable();
    this.urgent = new UrgentChannel(persistence);
    this.important = new ImportantChannel(persistence);
    this.routine = new RoutineChannel();
    this.info = new InfoChannel();
  }

  // ── 路由配置 ─────────────────────────────────────

  /** 加载路由表 */
  loadRoutes(routes: RouteTableMap): void {
    this.routeTable.load(routes);
  }

  /** 注册单条路由 */
  registerRoute(eventType: string, entry: RouteTableMap[string]): void {
    this.routeTable.register(eventType, entry);
  }

  // ── 归并配置 ─────────────────────────────────────

  /** 设置归并规则 */
  setMergeRules(rules: MergeRule[]): void {
    this.mergeRules = rules;
  }

  /**
   * 手动触发归并 flush。
   * 调用方（如 Scheduler 每轮结束后、或外部定时器）负责调用。
   * 不内置定时器——避免与运行时调度器耦合。
   */
  flushMerged(): void {
    this._flushMerged();
  }

  // ── 推送 ─────────────────────────────────────────

  /**
   * 推送事件到通知管线。
   *
   * 1. 补全 requestId + timestamp
   * 2. 查路由表确定通道
   * 3. 如果 eventType 有归并规则，先入归并缓冲区
   * 4. 否则直接入通道
   */
  push(event: Partial<NotificationEvent> & { type: string }): void {
    const route = this.routeTable.resolve(event.type);

    const fullEvent: NotificationEvent = {
      requestId: event.requestId ?? generateRequestId(),
      type: event.type,
      channel: route.channel,
      ackRequired: route.ackRequired,
      summary: event.summary ?? event.type,
      detail: event.detail,
      sourceAgent: event.sourceAgent,
      mergeKey: event.mergeKey ?? route.mergeKey,
      timestamp: event.timestamp ?? Date.now(),
    };

    // 归并检查
    if (fullEvent.mergeKey) {
      const rule = this.mergeRules.find((r) => r.groupBy === "mergeKey");
      if (rule) {
        this._bufferForMerge(fullEvent, rule);
        return;
      }
    }

    // 直接路由到通道
    this._routeToChannel(fullEvent);
  }

  // ── 确认 ─────────────────────────────────────────

  /** 确认 urgent 事件 */
  ack(requestId: string, approved: boolean): boolean {
    const result = this.urgent.ack(requestId);
    // 通知 ack 回调
    for (const handler of this.ackHandlers) {
      try {
        const result = handler(requestId, approved);
        if (result instanceof Promise) {
          result.catch(err => process.stderr.write(`[notification] ackHandler failed: ${err instanceof Error ? err.message : String(err)}\n`));
        }
      } catch {
        // 单回调异常不阻断
      }
    }
    return result;
  }

  /** 注册 ack 回调 */
  onAck(handler: AckHandler): void {
    this.ackHandlers.push(handler);
  }

  // ── 订阅 ─────────────────────────────────────────

  /** 按通道订阅 */
  on(channel: NotificationChannel, handler: NotificationHandler): void {
    switch (channel) {
      case NotificationChannel.Urgent:
        this.urgent.on(handler);
        break;
      case NotificationChannel.Important:
        this.important.on(handler);
        break;
      case NotificationChannel.Routine:
        this.routine.on(handler);
        break;
      case NotificationChannel.Info:
        this.info.on(handler);
        break;
    }
  }

  /** 订阅所有通道 */
  onAll(handler: NotificationHandler): void {
    this.urgent.on(handler);
    this.important.on(handler);
    this.routine.on(handler);
    this.info.on(handler);
  }

  /** 移除订阅 */
  off(channel: NotificationChannel, handler: NotificationHandler): void {
    switch (channel) {
      case NotificationChannel.Urgent:
        this.urgent.off(handler);
        break;
      case NotificationChannel.Important:
        this.important.off(handler);
        break;
      case NotificationChannel.Routine:
        this.routine.off(handler);
        break;
      case NotificationChannel.Info:
        this.info.off(handler);
        break;
    }
  }

  // ── 状态查询 ─────────────────────────────────────

  /** 各通道积压量 */
  backlogs(): Record<NotificationChannel, number> {
    return {
      [NotificationChannel.Urgent]: this.urgent.backlog,
      [NotificationChannel.Important]: this.important.backlog,
      [NotificationChannel.Routine]: this.routine.backlog,
      [NotificationChannel.Info]: this.info.backlog,
    };
  }

  /** 路由表快照 */
  routeSnapshot(): RouteTableMap {
    return this.routeTable.snapshot();
  }

  // ── 私有 ─────────────────────────────────────────

  /** 将事件路由到对应物理通道 */
  private _routeToChannel(event: NotificationEvent): void {
    switch (event.channel) {
      case NotificationChannel.Urgent:
        this.urgent.push(event);
        break;
      case NotificationChannel.Important:
        this.important.push(event);
        break;
      case NotificationChannel.Routine:
        this.routine.push(event);
        break;
      case NotificationChannel.Info:
        this.info.push(event);
        break;
    }
  }

  /** 归并缓冲 */
  private _bufferForMerge(event: NotificationEvent, rule: MergeRule): void {
    const key = event.mergeKey;
    if (!key) return;
    if (!this.mergeBuffer.has(key)) {
      this.mergeBuffer.set(key, []);

      // H-13: 首次创建缓冲区时启动超时定时器，到期强制 flush
      const timer = setTimeout(() => {
        this._flushMergeKey(key);
      }, NotificationPipe.MERGE_TIMEOUT_MS);
      this.mergeTimeouts.set(key, timer);
    }
    const batch = this.mergeBuffer.get(key) ?? [];
    batch.push(event);

    // 达到批大小阈值，立即 flush
    if (batch.length >= rule.maxBatch) {
      this._flushMergeKey(key);
    }
  }

  /** flush 所有归并缓冲区 */
  private _flushMerged(): void {
    const now = Date.now();
    for (const [key, events] of this.mergeBuffer) {
      if (events.length === 0) continue;

      // 检查时间窗口
      const rule = this.mergeRules.find((r) => r.groupBy === "mergeKey");
      const windowMs = rule?.windowMs ?? 300_000;
      const firstTimestamp = events[0]!.timestamp;

      // @fix N-04 — 移除 `events.length > 0` 恒真条件，仅依赖时间窗口 flush
      if (now - firstTimestamp >= windowMs) {
        this._flushMergeKey(key);
      }
    }
  }

  /** flush 单个归并键 */
  private _flushMergeKey(key: string): void {
    // H-13: 清除关联超时定时器
    const timer = this.mergeTimeouts.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.mergeTimeouts.delete(key);
    }

    const events = this.mergeBuffer.get(key);
    if (!events || events.length === 0) return;

    const merged: MergedNotification = {
      mergeKey: key,
      events: [...events],
      primary: events[0]!,
      windowStart: events[0]!.timestamp,
      windowEnd: events[events.length - 1]!.timestamp,
    };

    // 归并后的事件走 primary 的通道
    const mergedEvent: NotificationEvent = {
      ...merged.primary,
      timestamp: Date.now(),
      summary: `[归并] ${merged.events.length} 条 ${merged.primary.type} 事件`,
    };
    this._routeToChannel(mergedEvent);

    this.mergeBuffer.delete(key);
  }
}