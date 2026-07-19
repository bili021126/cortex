/**
 * tui/animation/hooks/use-fade-in.ts — 消息淡入效果
 *
 * 终端"淡入"实现：
 * - 逐行出现模式：新消息的行逐步显示
 * - 亮度渐变模式：从 dimColor → normal → bold 的亮度变化
 *
 * @module tui/animation/hooks/use-fade-in
 * @since v6
 */

import { useState, useEffect, useRef } from "react";
import { animationEngine } from "../engine.js";
import { getEasingFrames } from "../../theme/motion.js";
import { defaultTokens } from "../../theme/tokens.js";

export interface UseFadeInOptions {
  /** 淡入方向 */
  direction?: "up" | "down";
  /** 时长预设 */
  duration?: "fast" | "normal" | "slow";
  /** 淡入模式 */
  mode?: "lines" | "brightness";
  /** 总行数（lines 模式使用） */
  totalLines?: number;
}

export interface UseFadeInResult {
  /** 当前不透明度 0-1（映射到 ANSI dim/bold） */
  opacity: number;
  /** 当前可见行数（lines 模式） */
  visibleLines: number;
  /** 是否已完成淡入 */
  isDone: boolean;
  /** 直接用于 Ink <Text> 的样式 */
  style: {
    dimColor: boolean;
    bold: boolean;
  };
}

/**
 * 消息淡入 hook
 *
 * @param visible 是否应该显示
 */
export function useFadeIn(
  visible: boolean,
  options: UseFadeInOptions = {},
): UseFadeInResult {
  const {
    duration = "normal",
    mode = "brightness",
    totalLines = 1,
  } = options;

  const durationMs = defaultTokens.motion.duration[duration];
  const fps = defaultTokens.motion.maxFps;
  const frames = Math.max(2, Math.round((durationMs / 1000) * fps));
  const easingFrames = getEasingFrames("easeOut", frames);
  const frameInterval = Math.round(durationMs / frames);

  const [frameIndex, setFrameIndex] = useState(0);
  const [isDone, setIsDone] = useState(false);
  const prevVisibleRef = useRef(false);

  // 当 visible 从 false → true 时启动动画
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      setFrameIndex(0);
      setIsDone(false);

      const handle = animationEngine.register(
        `fade-${Date.now().toString(36)}`,
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

      prevVisibleRef.current = true;
      return () => handle.cancel();
    }

    if (!visible) {
      prevVisibleRef.current = false;
      setFrameIndex(0);
      setIsDone(false);
    }
  }, [visible, frames, frameInterval, easingFrames.length]);

  const opacity = visible ? (easingFrames[Math.min(frameIndex, easingFrames.length - 1)] ?? 0) : 0;
  const visibleLines = mode === "lines"
    ? Math.max(1, Math.round(opacity * totalLines))
    : totalLines;

  // 将 opacity 映射为终端样式
  const style = {
    dimColor: opacity < 0.5,
    bold: opacity > 0.9,
  };

  return {
    opacity,
    visibleLines,
    isDone: isDone || !visible,
    style,
  };
}
