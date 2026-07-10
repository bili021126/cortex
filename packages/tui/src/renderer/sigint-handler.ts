/**
 * tui/renderer/sigint-handler.ts — Ctrl+C 三段式确认
 *
 * 第一次 Ctrl+C 提示确认，第二次 1s 内触发则退出。
 * 参考 Pi TUI 的 SigintHandler 实现。
 *
 * @module tui/renderer/sigint-handler
 * @since v3 — P1 Ctrl+C 三段式
 */

type SigintState = "idle" | "first_press" | "confirmed";

export class SigintHandler {
  private _state: SigintState = "idle";
  private _timer: NodeJS.Timeout | null = null;
  private _onExit: () => void;

  constructor(onExit: () => void) {
    this._onExit = onExit;
  }

  handle(): string {
    switch (this._state) {
      case "idle":
        this._state = "first_press";
        this._timer = setTimeout(() => { this._state = "idle"; }, 1000);
        return "⏸ 再按一次 Ctrl+C 退出（1s 内）";
      case "first_press":
        this.reset();
        this._onExit();
        return "";
      default:
        return "";
    }
  }

  reset(): void {
    this._state = "idle";
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }
}
