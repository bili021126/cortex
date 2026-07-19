/**
 * tui/animation/hooks/use-slide-in.ts — 滑入效果
 *
 * 用于权限对话框、浮层等从侧边/底部滑入的效果。
 * 终端实现：通过截断宽度模拟滑入。
 *
 * @module tui/animation/hooks/use-slide-in
 * @since v6
 */

import { useState, useEffect, useRef } from "react";
import { animationEngine } from "../engine.js";
import { getEasingFrames } from "../../theme/motion.js";
import { defaultTokens } from "../../theme/tokens.js";

export interface UseSlideInOptions {
  /** 滑入方向 */
  from?: "right" | "bottom" | "left";
  /** 目标宽度（字符数） */
  width?: number;
  /** 目标高度（行数） */
  height?: number;
  /** 时长预设 */
  duration?: "fast" | "normal" | "slow";
}

export interface UseSlideInResult {
  /** 当前可见宽度（用于截断内容） */
  clipWidth: number;
  /** 当前可见高度 */
  clipHeight: number;
  /** 当前偏移量 */
  offset: number;
  /** 是否可见 */
  visible: boolean;
  /** 是否已完成动画 */
  isDone: boolean;
  /** 当前不透明度 0-1 */
  opacity: number;
}

/**
 * 滑入效果 hook
 *
 * @param active 是否应该显示
 */
export function useSlideIn(
  active: boolean,
  options: UseSlideInOptions = {},
): UseSlideInResult {
  const {
    from = "right",
    width = 40,
    height = 5,
    duration = "normal",
  } = options;

  const durationMs = defaultTokens.motion.duration[duration];
  const fps = defaultTokens.motion.maxFps;
  const frames = Math.max(2, Math.round((durationMs / 1000) * fps));
  const easingFrames = getEasingFrames("easeOut", frames);
  const frameInterval = Math.round(durationMs / frames);

  const [frameIndex, setFrameIndex] = useState(0);
  const [isDone, setIsDone] = useState(false);
  const prevActiveRef = useRef(false);

  useEffect(() => {
    if (active && !prevActiveRef.current) {
      setFrameIndex(0);
      setIsDone(false);

      const handle = animationEngine.register(
        `slide-${Date.now().toString(36)}`,
        (frame) => {
          setFrameIndex((prev) => {
            const next = Math.min(prev + 1, easingFrames.length - 1);
            if (next >= easingFrames.length - 1) {
              setIsDone(true);
              return next;
            }
            return next;
          });
          return frame < frames;
        },
        frameInterval,
      );

      prevActiveRef.current = true;
      return () => handle.cancel();
    }

    if (!active) {
      prevActiveRef.current = false;
      setFrameIndex(0);
      setIsDone(false);
    }
  }, [active, frames, frameInterval, easingFrames.length]);

  const progress = active
    ? (easingFrames[Math.min(frameIndex, easingFrames.length - 1)] ?? 0)
    : 0;

  const isHorizontal = from === "right" || from === "left";

  return {
    clipWidth: isHorizontal ? Math.max(1, Math.round(progress * width)) : width,
    clipHeight: !isHorizontal ? Math.max(1, Math.round(progress * height)) : height,
    offset: Math.round((1 - progress) * (isHorizontal ? width : height)),
    visible: active,
    isDone: isDone || !active,
    opacity: progress,
  };
}
