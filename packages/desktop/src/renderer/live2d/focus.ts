import type { Live2DModel } from "pixi-live2d-display/cubism4";
import { clamp } from "@cortex/shared";

export interface FocusOptions {
  pollIntervalMs?: number;
}

/**
 * Drives Live2D eye/head focus from the system cursor position.
 *
 * Pointer events keep the focus responsive while the cursor is over the
 * transparent pet window. A lightweight IPC poll keeps the model looking at
 * the cursor after it leaves the window bounds.
 */
export class MouseFocusController {
  private readonly canvas: HTMLCanvasElement;
  private readonly model: Live2DModel;
  private readonly pollIntervalMs: number;

  private paused = false;
  private disposed = false;
  private pollTimer: number | null = null;
  private rafId: number | null = null;
  private polling = false;
  private pendingPoint: { x: number; y: number } | null = null;

  constructor(canvas: HTMLCanvasElement, model: Live2DModel, options: FocusOptions = {}) {
    this.canvas = canvas;
    this.model = model;
    this.pollIntervalMs = options.pollIntervalMs ?? 50;

    canvas.addEventListener("pointermove", this.handleMove);
    this.startPolling();
  }

  pause(reset = false): void {
    this.paused = true;
    this.cancelPending();
    if (reset) this.focusCenter();
  }

  resume(): void {
    this.paused = false;
    void this.pollGlobalCursor();
  }

  focusCenter(instant = false): void {
    const rect = this.canvas.getBoundingClientRect();
    this.model.focus(rect.width / 2, rect.height / 2, instant);
  }

  /**
   * 定向注视——看向相对画布中心的归一化偏移点 (nx, ny)，范围 [-1,1]，(0,0)=正中。
   *
   * 即使处于 paused（idle 冻结）状态也生效，且不经过光标跟随管线，
   * 因此可供 idle-behavior / presence-engine 手动调度"瞥向别处"，
   * 不会被 pollGlobalCursor 覆盖。
   */
  lookAtOffset(nx: number, ny: number, instant = false): void {
    if (this.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    const cx = clamp(nx, -1, 1);
    const cy = clamp(ny, -1, 1);
    this.model.focus((rect.width / 2) * (1 + cx), (rect.height / 2) * (1 + cy), instant);
  }

  /**
   * 随机"看向别处"——水平为主、轻微上下的一次性定向注视。
   * 供 idle 循环瞥视与 gaze:"away" 语义复用。
   */
  lookAtRandomAway(instant = false): void {
    const nx = Math.random() * 1.4 - 0.7;   // [-0.7, 0.7] 水平为主
    const ny = Math.random() * 0.8 - 0.5;   // [-0.5, 0.3] 轻微上下
    this.lookAtOffset(nx, ny, instant);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPending();
    this.stopPolling();
    this.canvas.removeEventListener("pointermove", this.handleMove);
  }

  private handleMove = (event: PointerEvent): void => {
    if (this.disposed || this.paused) return;
    this.scheduleFocus(event.clientX, event.clientY);
  };

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = window.setInterval(() => {
      void this.pollGlobalCursor();
    }, this.pollIntervalMs);
    void this.pollGlobalCursor();
  }

  private stopPolling(): void {
    if (this.pollTimer === null) return;
    window.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async pollGlobalCursor(): Promise<void> {
    if (this.disposed || this.paused || this.polling) return;
    this.polling = true;
    try {
      const cursor = await window.cyrene.getCursorPosition();
      if (!cursor || this.disposed || this.paused) return;
      this.scheduleFocus(cursor.x - window.screenX, cursor.y - window.screenY);
    } finally {
      this.polling = false;
    }
  }

  private scheduleFocus(x: number, y: number): void {
    this.pendingPoint = { x, y };
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(this.flushFocus);
    }
  }

  private flushFocus = (): void => {
    this.rafId = null;
    if (!this.pendingPoint || this.paused || this.disposed) return;
    this.model.focus(this.pendingPoint.x, this.pendingPoint.y);
    this.pendingPoint = null;
  };

  private cancelPending(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingPoint = null;
  }
}
