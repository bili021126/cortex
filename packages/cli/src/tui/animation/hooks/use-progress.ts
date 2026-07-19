/**
 * tui/animation/hooks/use-progress.ts — 工具调用进度条
 *
 * 与 streaming-tool-executor 的工具状态联动。
 * 支持多种进度条风格：bar / dots / percent / braille。
 *
 * @module tui/animation/hooks/use-progress
 * @since v6
 */

import { useState, useEffect } from "react";
import { animationEngine } from "../engine.js";
import { defaultTokens } from "../../theme/tokens.js";

export type ToolExecutionStatus = "pending" | "running" | "complete" | "error";
export type ProgressBarStyle = "bar" | "dots" | "percent" | "braille";

export interface UseProgressOptions {
  /** 进度条风格 */
  style?: ProgressBarStyle;
  /** 进度条宽度（字符数） */
  width?: number;
  /** 是否显示标签 */
  showLabel?: boolean;
}

export interface UseProgressResult {
  /** 渲染好的进度条字符串 */
  bar: string;
  /** 标签文字 */
  label: string;
  /** 是否为不确定进度（indeterminate） */
  isIndeterminate: boolean;
  /** 进度百分比 0-100 */
  percent: number;
}

// ─── 进度条字符集 ─────────────────────────

const BAR_CHARS = {
  empty: "░",
  fill: "█",
  head: "▓",
};

const BRAILLE_FRAMES = [
  "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏",
];

const DOT_FRAMES = [
  "●○○○○",
  "○●○○○",
  "○○●○○",
  "○○○●○",
  "○○○○●",
  "○○○●○",
  "○○●○○",
  "○●○○○",
];

/**
 * 工具调用进度条 hook
 *
 * @param status 工具执行状态
 * @param progress 已知进度 (0-100)，undefined 时为 indeterminate
 */
export function useProgress(
  status: ToolExecutionStatus,
  progress?: number,
  options: UseProgressOptions = {},
): UseProgressResult {
  const {
    style = "bar",
    width = 20,
    showLabel = true,
  } = options;

  const [frame, setFrame] = useState(0);
  const frameInterval = Math.round(1000 / defaultTokens.motion.maxFps);

  // 运行中时启动帧循环
  useEffect(() => {
    if (status !== "running") {
      setFrame(0);
      return;
    }

    const handle = animationEngine.register(
      `progress-${Date.now().toString(36)}`,
      () => {
        setFrame((f) => f + 1);
        return true; // 持续运行直到状态改变
      },
      frameInterval,
    );

    return () => handle.cancel();
  }, [status, frameInterval]);

  const isIndeterminate = progress === undefined && status === "running";
  const pct = progress ?? 0;

  let bar = "";
  switch (style) {
    case "bar": {
      if (isIndeterminate) {
        // 扫描动画
        const scanPos = frame % width;
        bar = "";
        for (let i = 0; i < width; i++) {
          if (i === scanPos) bar += BAR_CHARS.head;
          else if (Math.abs(i - scanPos) === 1) bar += BAR_CHARS.fill;
          else bar += BAR_CHARS.empty;
        }
      } else {
        const filled = Math.round((pct / 100) * width);
        bar = BAR_CHARS.fill.repeat(filled) + BAR_CHARS.empty.repeat(width - filled);
      }
      break;
    }
    case "dots": {
      const dotsFrame = DOT_FRAMES[frame % DOT_FRAMES.length] ?? "";
      bar = status === "running" ? dotsFrame : status === "complete" ? "●●●●●" : "○○○○○";
      break;
    }
    case "braille": {
      const brailleFrame = BRAILLE_FRAMES[frame % BRAILLE_FRAMES.length] ?? "";
      bar = status === "running"
        ? brailleFrame.repeat(Math.ceil(width / 2)).slice(0, width)
        : status === "complete"
          ? "█".repeat(width)
          : "░".repeat(width);
      break;
    }
    case "percent": {
      bar = isIndeterminate
        ? `${BRAILLE_FRAMES[frame % BRAILLE_FRAMES.length] ?? ""} ...`
        : `${pct}%`;
      break;
    }
  }

  let label = "";
  if (showLabel) {
    switch (status) {
      case "pending":
        label = "等待中";
        break;
      case "running":
        label = isIndeterminate ? "执行中" : `${pct}%`;
        break;
      case "complete":
        label = "完成";
        break;
      case "error":
        label = "失败";
        break;
    }
  }

  return { bar, label, isIndeterminate, percent: pct };
}
