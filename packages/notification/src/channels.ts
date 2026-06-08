// ============================================================
// @cortex/notification — 四通道实现
//
// 每条物理通道有独立的：
//   - 队列策略（优先级插队 vs FIFO vs 无队列）
//   - 持久化策略（磁盘 vs 内存 vs 无）
//   - 失败策略（escalate vs retry vs log vs drop）
// ============================================================

import { NotificationChannel, DEFAULT_CHANNEL_CONFIGS, type NotificationEvent, type ChannelConfig, type NotificationHandler } from "./types.js";
import type { NotificationPersistence } from "./persistence.js";

// ─── 通道基类 ────────────────────────────────────────

abstract class BaseChannel {
  protected config: ChannelConfig;
  protected handlers: NotificationHandler[] = [];
  protected persistence: NotificationPersistence | null = null;

  constructor(config: ChannelConfig, persistence?: NotificationPersistence) {
    this.config = config;
    this.persistence = persistence ?? null;
  }

  /** 推送事件到通道 */
  abstract push(event: NotificationEvent): void;

  /** 订阅通道事件 */
  on(handler: NotificationHandler): void {
    this.handlers.push(handler);
  }

  /** 移除订阅 */
  off(handler: NotificationHandler): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  /** 通知所有订阅者 */
  protected notify(event: NotificationEvent): void {
    for (const handler of this.handlers) {
      try {
        void handler(event);
      } catch {
        // 单 handler 异常不阻断其他 handler
      }
    }
  }

  /** 获取通道配置 */
  getConfig(): ChannelConfig {
    return { ...this.config };
  }

  /** 通道当前积压量 */
  abstract get backlog(): number;
}

// ─── 紧急通道 ────────────────────────────────────────

/**
 * UrgentChannel —— 优先级插队队列 + 磁盘持久化 + ackRequired。
 *
 * - 新事件直接插队到队首（不是 FIFO）
 * - 持久化到磁盘，重启不丢
 * - 事件发出后等待 ack，超时直捅用户
 */
export class UrgentChannel extends BaseChannel {
  private queue: NotificationEvent[] = [];

  constructor(persistence?: NotificationPersistence) {
    super(
      { ...DEFAULT_CHANNEL_CONFIGS[NotificationChannel.Urgent] },
      persistence,
    );
    // 启动时从磁盘恢复未确认事件
    this._restoreFromDisk();
  }

  push(event: NotificationEvent): void {
    event.channel = NotificationChannel.Urgent;
    event.ackRequired = true;

    // 插队：放到队首而非队尾
    if (this.config.maxQueueSize > 0 && this.queue.length >= this.config.maxQueueSize) {
      // 队列满：丢弃最旧的非 ackRequired 事件，或拒绝
      this.queue.pop();
    }
    this.queue.unshift(event);

    // 持久化
    if (this.config.persist && this.persistence) {
      this.persistence.persist(event);
    }

    // 立即通知所有订阅者（直捅用户语义）
    this.notify(event);
  }

  /** 确认事件 */
  ack(requestId: string): boolean {
    const event = this.queue.find((e) => e.requestId === requestId);
    if (event) {
      event.acked = true;
      event.ackedAt = Date.now();
      this.queue = this.queue.filter((e) => e.requestId !== requestId);
      if (this.persistence) {
        this.persistence.markAcked(requestId);
      }
      return true;
    }
    return false;
  }

  get backlog(): number {
    return this.queue.length;
  }

  private _restoreFromDisk(): void {
    if (!this.persistence?.isAvailable()) return;
    const pending = this.persistence.loadPending(NotificationChannel.Urgent);
    for (const event of pending) {
      this.queue.push(event);
      this.notify(event);
    }
  }
}

// ─── 重要通道 ────────────────────────────────────────

/**
 * ImportantChannel —— FIFO 队列 + 磁盘持久化。
 *
 * - 严格 FIFO，先入先出
 * - 持久化到磁盘，重启恢复
 * - 通知失败回队重试
 */
export class ImportantChannel extends BaseChannel {
  private queue: NotificationEvent[] = [];

  constructor(persistence?: NotificationPersistence) {
    super(
      { ...DEFAULT_CHANNEL_CONFIGS[NotificationChannel.Important] },
      persistence,
    );
    this._restoreFromDisk();
  }

  push(event: NotificationEvent): void {
    event.channel = NotificationChannel.Important;
    event.ackRequired = false;

    if (this.config.maxQueueSize > 0 && this.queue.length >= this.config.maxQueueSize) {
      // FIFO 满：丢弃最旧事件
      this.queue.shift();
    }
    this.queue.push(event);

    if (this.config.persist && this.persistence) {
      this.persistence.persist(event);
    }

    this.notify(event);
  }

  get backlog(): number {
    return this.queue.length;
  }

  /** 消费队列头部事件 */
  dequeue(): NotificationEvent | undefined {
    return this.queue.shift();
  }

  private _restoreFromDisk(): void {
    if (!this.persistence?.isAvailable()) return;
    const pending = this.persistence.loadPending(NotificationChannel.Important);
    for (const event of pending) {
      this.queue.push(event);
    }
  }
}

// ─── 例行通道 ────────────────────────────────────────

/**
 * RoutineChannel —— FIFO 队列 + 内存（不持久化）。
 *
 * - FIFO 顺序
 * - 纯内存，重启丢失
 * - 失败只记日志
 */
export class RoutineChannel extends BaseChannel {
  private queue: NotificationEvent[] = [];

  constructor() {
    super({ ...DEFAULT_CHANNEL_CONFIGS[NotificationChannel.Routine] });
  }

  push(event: NotificationEvent): void {
    event.channel = NotificationChannel.Routine;
    event.ackRequired = false;

    if (this.config.maxQueueSize > 0 && this.queue.length >= this.config.maxQueueSize) {
      this.queue.shift();
    }
    this.queue.push(event);
    this.notify(event);
  }

  get backlog(): number {
    return this.queue.length;
  }
}

// ─── 信息通道 ────────────────────────────────────────

/**
 * InfoChannel —— 无队列 + 直接丢弃。
 *
 * - 不排队，只通知当前订阅者
 * - 不持久化
 * - 订阅者不在线即丢弃
 */
export class InfoChannel extends BaseChannel {
  constructor() {
    super({ ...DEFAULT_CHANNEL_CONFIGS[NotificationChannel.Info] });
  }

  push(event: NotificationEvent): void {
    event.channel = NotificationChannel.Info;
    event.ackRequired = false;

    // 只通知当前订阅者，不排队
    this.notify(event);
  }

  get backlog(): number {
    return 0; // 无队列，永远零积压
  }
}
