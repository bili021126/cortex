/**
 * presence/idle-behavior.ts — 空闲行为状态机
 *
 * 用户 30s 无输入时，她不是"睡觉"——是在等。
 * 呼吸加深、偶尔看向别处、微小位移。
 * 用户开始输入时立即停止，注视输入框。
 *
 * @module renderer/presence/idle-behavior
 * @since v7 — 三端 UI 设计 Phase P1
 */

import type { Live2DModel } from "pixi-live2d-display/cubism4";
import type { MouseFocusController } from "../live2d/focus";

// ═══════════════════════════════════════════════════════════
// §1 类型定义
// ═══════════════════════════════════════════════════════════

export interface IdleBehaviorOptions {
  /** 空闲触发阈值 ms，默认 30000 */
  thresholdMs?: number;
  /** 是否启用，默认 true */
  enabled?: boolean;
  /** 空闲时"看向别处"的间隔 ms，默认 8000-15000 随机 */
  glanceAwayIntervalMs?: number;
  /** 看向别处的持续时间 ms，默认 2000 */
  glanceAwayDurationMs?: number;
}

type IdleState = "active" | "counting" | "idle";

// ═══════════════════════════════════════════════════════════
// §2 控制器
// ═══════════════════════════════════════════════════════════

export class IdleBehaviorController {
  private readonly model: Live2DModel;
  private readonly focus: MouseFocusController;
  private readonly options: Required<IdleBehaviorOptions>;

  private state: IdleState = "active";
  private countdownTimer: number | null = null;
  private glanceTimer: number | null = null;
  private glanceReturnTimer: number | null = null;
  private disposed = false;

  constructor(
    model: Live2DModel,
    focus: MouseFocusController,
    options: IdleBehaviorOptions = {},
  ) {
    this.model = model;
    this.focus = focus;
    this.options = {
      thresholdMs: options.thresholdMs ?? 30_000,
      enabled: options.enabled ?? true,
      glanceAwayIntervalMs: options.glanceAwayIntervalMs ?? 10_000,
      glanceAwayDurationMs: options.glanceAwayDurationMs ?? 2000,
    };
  }

  // ─── 公共接口 ─────────────────────────────────────────

  /** 启动 idle 监听 */
  start(): void {
    if (!this.options.enabled || this.disposed) return;
    this.startIdleCountdown();
  }

  /** 用户有交互——重置 idle 计时 */
  resetIdle(): void {
    if (this.disposed) return;
    this.cancelGlance();
    this.state = "active";
    this.clearCountdown();
  }

  /** 用户停止交互——开始倒计时 */
  startIdleCountdown(): void {
    if (!this.options.enabled || this.disposed) return;
    if (this.state === "counting") return; // 已在倒计时
    this.clearCountdown();
    this.state = "counting";
    this.countdownTimer = window.setTimeout(() => {
      this.enterIdle();
    }, this.options.thresholdMs);
  }

  /** 销毁 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearCountdown();
    this.cancelGlance();
    this.state = "active";
  }

  // ─── 内部实现 ─────────────────────────────────────────

  private enterIdle(): void {
    if (this.disposed) return;
    this.state = "idle";
    // 呼吸加深（通过 focus pause 减少头部运动来近似）
    this.focus.pause(false);
    // 开始随机"看向别处"循环
    this.scheduleGlanceAway();
  }

  private scheduleGlanceAway(): void {
    if (this.disposed || this.state !== "idle") return;
    // 随机间隔 8-15s
    const jitter = Math.random() * 7000;
    const interval = this.options.glanceAwayIntervalMs + jitter;
    this.glanceTimer = window.setTimeout(() => {
      this.glanceAway();
    }, interval);
  }

  private glanceAway(): void {
    if (this.disposed || this.state !== "idle") return;
    // 真正看向别处——定向注视一个随机偏移点（focus 仍处 paused，不会被光标跟随覆盖）
    this.focus.lookAtRandomAway();
    // 短暂停留后视线归中，再排下一次瞥视
    this.glanceReturnTimer = window.setTimeout(() => {
      if (this.state === "idle" && !this.disposed) {
        this.focus.focusCenter();
        this.scheduleGlanceAway();
      }
    }, this.options.glanceAwayDurationMs);
  }

  private cancelGlance(): void {
    if (this.glanceTimer !== null) {
      window.clearTimeout(this.glanceTimer);
      this.glanceTimer = null;
    }
    if (this.glanceReturnTimer !== null) {
      window.clearTimeout(this.glanceReturnTimer);
      this.glanceReturnTimer = null;
    }
    // 退出 idle 时恢复 focus 光标跟随（resume 后 pollGlobalCursor 会立即把视线拉向光标）
    if (this.state === "idle") {
      this.focus.resume();
    }
  }

  private clearCountdown(): void {
    if (this.countdownTimer !== null) {
      window.clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
  }
}
