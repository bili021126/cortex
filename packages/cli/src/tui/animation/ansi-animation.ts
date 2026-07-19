/**
 * tui/animation/ansi-animation.ts — v4 ANSI 动画渲染器
 *
 * 将动画帧转换为最小 ANSI 更新序列（帧 diff）。
 * 用于 v4 readline TUI 的动画效果。
 *
 * @module tui/animation/ansi-animation
 * @since v6
 */

import { fg24, RESET } from "../theme/adapter-ansi.js";
import { animationEngine, type AnimationHandle } from "./engine.js";
import { defaultTokens } from "../theme/tokens.js";

// ─── ANSI 动画渲染器 ─────────────────────

/**
 * 帧 diff 渲染器
 * 比较前后帧内容，只输出变化的行
 */
export class AnsiFrameRenderer {
  private prevLines: string[] = [];

  /**
   * 渲染一帧（返回最小 ANSI 更新序列）
   */
  renderFrame(newLines: string[], startY: number): string {
    const diffs: string[] = [];

    for (let i = 0; i < Math.max(this.prevLines.length, newLines.length); i++) {
      const oldLine = this.prevLines[i] ?? "";
      const newLine = newLines[i] ?? "";

      if (oldLine !== newLine) {
        // 移动光标到目标行并写入新内容
        diffs.push(`\x1b[${startY + i};1H\x1b[2K${newLine}`);
      }
    }

    this.prevLines = [...newLines];
    return diffs.join("");
  }

  /**
   * 清除之前的帧
   */
  clear(startY: number): string {
    const diffs: string[] = [];
    for (let i = 0; i < this.prevLines.length; i++) {
      diffs.push(`\x1b[${startY + i};1H\x1b[2K`);
    }
    this.prevLines = [];
    return diffs.join("");
  }
}

// ─── ANSI 打字机 ─────────────────────────

/**
 * ANSI 打字机效果
 * 用于 v4 TUI 的流式输出
 */
export class AnsiTypewriter {
  private displayedLen = 0;
  private handle: AnimationHandle | null = null;
  private readonly charsPerFrame: number;
  private readonly frameInterval: number;
  private readonly cursor: string;
  private onUpdate: ((text: string, done: boolean) => void) | null = null;

  constructor(speed: "fast" | "normal" | "slow" = "normal") {
    this.charsPerFrame = defaultTokens.motion.typewriterSpeed[speed];
    this.frameInterval = Math.round(1000 / defaultTokens.motion.maxFps);
    this.cursor = defaultTokens.typography.streamingCursor;
  }

  /**
   * 开始打字机效果
   */
  start(
    getText: () => string,
    isStreaming: () => boolean,
    onUpdate: (text: string, done: boolean) => void,
  ): void {
    this.stop();
    this.displayedLen = 0;
    this.onUpdate = onUpdate;

    this.handle = animationEngine.register(
      "ansi-typewriter",
      () => {
        const fullText = getText();
        if (this.displayedLen >= fullText.length) {
          if (!isStreaming()) {
            this.onUpdate?.(fullText, true);
            return false; // 结束
          }
          return true; // 等待更多数据
        }

        this.displayedLen = Math.min(
          this.displayedLen + this.charsPerFrame,
          fullText.length,
        );

        const displayed = fullText.slice(0, this.displayedLen);
        const showCursor = isStreaming() || this.displayedLen < fullText.length;
        this.onUpdate?.(displayed + (showCursor ? this.cursor : ""), false);
        return true;
      },
      this.frameInterval,
    );
  }

  /**
   * 停止打字机
   */
  stop(): void {
    if (this.handle) {
      this.handle.cancel();
      this.handle = null;
    }
  }

  /**
   * 重置
   */
  reset(): void {
    this.stop();
    this.displayedLen = 0;
  }
}

// ─── ANSI 进度条渲染 ─────────────────────

/**
 * 渲染 ANSI 进度条
 */
export function renderAnsiProgressBar(
  percent: number,
  width: number = 20,
  color?: string,
): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);

  if (color) {
    return `${fg24(color)}${bar}${RESET} ${percent}%`;
  }
  return `${bar} ${percent}%`;
}

/**
 * 渲染 ANSI 不确定进度条（扫描动画）
 */
export function renderAnsiIndeterminate(
  width: number,
  frame: number,
  color?: string,
): string {
  const scanPos = frame % width;
  let bar = "";
  for (let i = 0; i < width; i++) {
    if (i === scanPos) bar += "▓";
    else if (Math.abs(i - scanPos) === 1) bar += "█";
    else bar += "░";
  }

  if (color) {
    return `${fg24(color)}${bar}${RESET}`;
  }
  return bar;
}
