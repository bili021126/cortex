/**
 * presence/presence-engine.ts — Presence 层编排引擎
 *
 * 消费 emotion-map 的 ExpressionDelta，驱动 Live2D 控制器。
 * 她是 canvas，消息流是 overlay。这个引擎决定她"怎么活着"。
 *
 * 职责：
 * - 接收 PresenceEvent（从 WS 事件转换而来）
 * - 通过 resolveExpression() 获取 ExpressionDelta
 * - 调度 MouthSync / Focus / Expression 控制器
 * - 管理表情优先级和恢复时序
 *
 * @module renderer/presence/presence-engine
 * @since v7 — 三端 UI 设计 Phase P1
 */

import type { Live2DModel } from "pixi-live2d-display/cubism4";
import type { MouthSyncController } from "../live2d/mouth-sync";
import type { MouseFocusController } from "../live2d/focus";
import type { ExpressionResetController } from "../live2d/expression-reset";
import type { ParamDriver } from "../live2d/param-driver";
import { resolveExpression, type ExpressionDelta, type PresenceEvent } from "./emotion-map";
import { IdleBehaviorController } from "./idle-behavior";

// ═══════════════════════════════════════════════════════════
// §1 类型定义
// ═══════════════════════════════════════════════════════════

export interface PresenceEngineOptions {
  /** 表情恢复超时（无新事件时回到中性），默认 3000ms */
  recoveryMs?: number;
  /** 是否启用 idle 行为，默认 true */
  enableIdle?: boolean;
  /** idle 触发阈值 ms，默认 30000 */
  idleThresholdMs?: number;
}

interface ControllerBundle {
  mouth: MouthSyncController;
  focus: MouseFocusController;
  expressionReset: ExpressionResetController;
  /** 连续情绪量驱动（微笑等标准参数）。可选——缺省时 smileDelta 静默忽略 */
  paramDriver?: ParamDriver;
}

// ═══════════════════════════════════════════════════════════
// §2 引擎
// ═══════════════════════════════════════════════════════════

export class PresenceEngine {
  private readonly model: Live2DModel;
  private readonly controllers: ControllerBundle;
  private readonly idle: IdleBehaviorController;
  private readonly options: Required<PresenceEngineOptions>;

  private recoveryTimer: number | null = null;
  private currentExpression: string | null = null;
  private disposed = false;

  constructor(
    model: Live2DModel,
    controllers: ControllerBundle,
    options: PresenceEngineOptions = {},
  ) {
    this.model = model;
    this.controllers = controllers;
    this.options = {
      recoveryMs: options.recoveryMs ?? 3000,
      enableIdle: options.enableIdle ?? true,
      idleThresholdMs: options.idleThresholdMs ?? 30_000,
    };

    this.idle = new IdleBehaviorController(model, controllers.focus, {
      thresholdMs: this.options.idleThresholdMs,
      enabled: this.options.enableIdle,
    });
  }

  // ─── 公共接口 ─────────────────────────────────────────

  /**
   * 处理一个 presence 事件。
   * 由外部（WS 消息处理器）调用，将 protocol 事件转为她的反应。
   */
  handleEvent(event: PresenceEvent): void {
    if (this.disposed) return;

    // 用户交互重置 idle 计时器
    if (event.type === "user.input_start") {
      this.idle.resetIdle();
    }

    const delta = resolveExpression(event);
    if (!delta) return;

    this.applyDelta(delta);
  }

  /**
   * 通知 presence 层用户正在输入。
   * 由输入框 focus/keydown 事件触发。
   */
  notifyUserTyping(): void {
    if (this.disposed) return;
    this.idle.resetIdle();
    this.handleEvent({ type: "user.input_start" });
  }

  /**
   * 通知 presence 层用户已停止输入。
   * 由输入框 blur 或 debounce 触发。
   */
  notifyUserStopped(): void {
    if (this.disposed) return;
    this.idle.startIdleCountdown();
  }

  /** 启动引擎（开始 idle 监听等） */
  start(): void {
    this.idle.start();
    this.controllers.paramDriver?.start();
  }

  /** 销毁引擎 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearRecovery();
    this.idle.dispose();
  }

  // ─── 内部实现 ─────────────────────────────────────────

  private applyDelta(delta: ExpressionDelta): void {
    // 打断当前表情
    if (delta.interrupt) {
      this.clearRecovery();
      // 打断时同步把微笑拉回中性，避免旧脉冲残留到新情绪
      this.controllers.paramDriver?.neutralizeSmile();
    }

    // 表情切换
    if (delta.expression !== undefined) {
      this.setExpression(delta.expression);
    }

    // 嘴型
    if (delta.mouthOpen !== undefined) {
      const duration = delta.mouthDurationMs ?? 200;
      this.controllers.mouth.start(duration);
    }

    // 视线
    if (delta.gaze) {
      this.applyGaze(delta.gaze);
    }

    // 微笑增量——经 ParamDriver 驱动 ParamMouthForm（连续微表情，非整块表情切换）
    if (delta.smileDelta !== undefined && delta.smileDelta !== 0) {
      this.controllers.paramDriver?.addSmile(delta.smileDelta);
    }

    // 呼吸深度（breathDepth）：库内置 AutoBreath 已驱动 ParamBreath，
    // 二次写入会互相覆盖抖动，需库层协调后再接，当前不消费此字段。

    // 自动恢复
    if (delta.durationMs && delta.durationMs > 0) {
      this.scheduleRecovery(delta.durationMs);
    }
  }

  private setExpression(name: string): void {
    if (this.currentExpression === name) return;
    this.currentExpression = name;
    if (name === "") {
      void this.controllers.expressionReset.resetNow();
    } else {
      void this.model.expression(name).catch(() => {
        // 表情不存在时静默忽略
      });
    }
  }

  private applyGaze(gaze: ExpressionDelta["gaze"]): void {
    switch (gaze) {
      case "user":
        // 看向窗口中心（近似"看用户"）
        this.controllers.focus.focusCenter();
        break;
      case "input":
        // 看向下方（输入框方向）
        this.controllers.focus.pause(false);
        break;
      case "away":
        // 看向别处——先冻结光标跟随（否则 pollGlobalCursor 会每 50ms 把视线拉回光标）再定向注视随机偏移点
        this.controllers.focus.pause(false);
        this.controllers.focus.lookAtRandomAway();
        break;
      case "hold":
      default:
        // 保持当前视线
        break;
    }
  }

  private scheduleRecovery(afterMs: number): void {
    this.clearRecovery();
    this.recoveryTimer = window.setTimeout(() => {
      this.recoveryTimer = null;
      this.setExpression("");
      this.controllers.focus.resume();
      this.controllers.paramDriver?.neutralizeSmile();
    }, afterMs + this.options.recoveryMs);
  }

  private clearRecovery(): void {
    if (this.recoveryTimer !== null) {
      window.clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }
}
