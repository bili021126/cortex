/**
 * tui/animation/index.ts — 动画框架统一导出
 *
 * @module tui/animation
 * @since v6
 */

// ─── 引擎 ─────────────────────────────────
export { animationEngine, type FrameCallback, type AnimationHandle } from "./engine.js";

// ─── Hooks ────────────────────────────────
export { useFrame, useAnimation } from "./hooks/use-frame.js";
export { useTypewriter, useSimpleTypewriter, type UseTypewriterOptions, type UseTypewriterResult } from "./hooks/use-typewriter.js";
export { useFadeIn, type UseFadeInOptions, type UseFadeInResult } from "./hooks/use-fade-in.js";
export { useSlideIn, type UseSlideInOptions, type UseSlideInResult } from "./hooks/use-slide-in.js";
export { useProgress, type ToolExecutionStatus, type ProgressBarStyle, type UseProgressOptions, type UseProgressResult } from "./hooks/use-progress.js";
export { useSpinner, type SpinnerStyle, type UseSpinnerOptions } from "./hooks/use-spinner.js";

// ─── Ink 组件 ─────────────────────────────
export { Typewriter, type TypewriterProps } from "./components/Typewriter.js";
export { FadeIn, type FadeInProps } from "./components/FadeIn.js";
export { SlideIn, type SlideInProps } from "./components/SlideIn.js";
export { ProgressBar, type ProgressBarProps } from "./components/ProgressBar.js";
export { Spinner, type SpinnerProps } from "./components/Spinner.js";

// ─── v4 ANSI 动画 ────────────────────────
export {
  AnsiFrameRenderer,
  AnsiTypewriter,
  renderAnsiProgressBar,
  renderAnsiIndeterminate,
} from "./ansi-animation.js";
