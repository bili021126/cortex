/**
 * tui/animation/hooks/use-spinner.ts — 加载指示器
 *
 * 替代 ink-spinner 的自研 spinner hook。
 * 支持多种 spinner 风格，帧率由动画引擎统一控制。
 *
 * @module tui/animation/hooks/use-spinner
 * @since v6
 */

import { useState, useEffect } from "react";
import { animationEngine } from "../engine.js";
import { defaultTokens } from "../../theme/tokens.js";
import {
  SPINNER_DOTS,
  SPINNER_BOUNCE,
  SPINNER_CLOVER,
  SPINNER_PULSE,
  SPINNER_SCAN,
} from "../../theme/motion.js";

export type SpinnerStyle = "dots" | "bounce" | "clover" | "pulse" | "scan";

export interface UseSpinnerOptions {
  /** spinner 风格 */
  style?: SpinnerStyle;
  /** 是否激活（false 时停止动画） */
  active?: boolean;
  /** 帧间隔 (ms)，默认使用引擎帧率 */
  interval?: number;
}

/**
 * 加载指示器 hook
 *
 * @param active 是否显示旋转动画
 */
export function useSpinner(options: UseSpinnerOptions = {}): string {
  const {
    style = "bounce",
    active = true,
    interval,
  } = options;

  const [frame, setFrame] = useState(0);

  const frames = getSpinnerFrames(style);
  const frameInterval = interval ?? Math.round(1000 / defaultTokens.motion.maxFps);

  useEffect(() => {
    if (!active) {
      setFrame(0);
      return;
    }

    const handle = animationEngine.register(
      `spinner-${style}-${Math.random().toString(36).slice(2, 9)}`,
      () => {
        setFrame((f) => (f + 1) % frames.length);
        return true; // 持续运行
      },
      frameInterval,
    );

    return () => handle.cancel();
  }, [active, style, frames.length, frameInterval]);

  if (!active) return frames[0] ?? "";
  return frames[frame % frames.length] ?? "";
}

function getSpinnerFrames(style: SpinnerStyle): readonly string[] {
  switch (style) {
    case "dots":
      return SPINNER_DOTS;
    case "bounce":
      return SPINNER_BOUNCE;
    case "clover":
      return SPINNER_CLOVER;
    case "pulse":
      return SPINNER_PULSE;
    case "scan":
      return SPINNER_SCAN;
    default:
      return SPINNER_BOUNCE;
  }
}
