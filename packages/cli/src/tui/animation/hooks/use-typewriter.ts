/**
 * tui/animation/hooks/use-typewriter.ts — 流式打字机效果
 *
 * 与 query-loop 的 async generator 流式输出协同：
 * - streamingContent 异步增长时，displayedText 逐帧追赶
 * - 流式完成后，打字机自然结束
 * - 光标闪烁效果
 *
 * @module tui/animation/hooks/use-typewriter
 * @since v6
 */

import { useState, useRef, useEffect } from "react";
import { animationEngine } from "../engine.js";
import { defaultTokens } from "../../theme/tokens.js";

export interface UseTypewriterOptions {
  /** 每帧推进的字符数 */
  speed?: "fast" | "normal" | "slow";
  /** 光标字符 */
  cursor?: string;
  /** 是否显示光标闪烁 */
  cursorBlink?: boolean;
  /** 打字完成回调 */
  onComplete?: () => void;
}

export interface UseTypewriterResult {
  /** 当前应显示的文本 */
  displayedText: string;
  /** 是否正在打字 */
  isTyping: boolean;
  /** 进度 0-1 */
  progress: number;
  /** 光标是否可见 */
  cursorVisible: boolean;
}

/**
 * 流式打字机 hook
 *
 * @param text 当前已接收的完整流式文本（来自 state.streamingContent）
 * @param isStreaming 是否正在接收流式数据
 */
export function useTypewriter(
  text: string,
  isStreaming: boolean,
  options: UseTypewriterOptions = {},
): UseTypewriterResult {
  const {
    speed = "normal",
    cursorBlink = true,
    onComplete,
  } = options;

  const charsPerFrame = defaultTokens.motion.typewriterSpeed[speed];
  const frameInterval = Math.round(1000 / defaultTokens.motion.maxFps);

  const [displayedLen, setDisplayedLen] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const prevTextLenRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // 当文本缩短（如清空/切换）时重置
  useEffect(() => {
    if (text.length < prevTextLenRef.current) {
      setDisplayedLen(0);
    }
    prevTextLenRef.current = text.length;
  }, [text.length]);

  // 打字机帧循环
  useEffect(() => {
    if (displayedLen >= text.length && !isStreaming) {
      return;
    }

    const handle = animationEngine.register(
      `typewriter-${Date.now().toString(36)}`,
      () => {
        setDisplayedLen((prev) => {
          if (prev >= text.length) {
            if (!isStreaming) {
              onCompleteRef.current?.();
              return prev; // 动画结束
            }
            return prev; // 等待更多数据
          }
          const next = Math.min(prev + charsPerFrame, text.length);
          return next;
        });

        // 光标闪烁
        if (cursorBlink) {
          setCursorVisible((v) => !v);
        }

        // 终止由 effect 依赖 `displayedLen >= text.length` 驱动：该布尔翻转时
        // effect 重跑，cleanup 取消本 handle，L75 守卫提前 return 不再注册。
        // 闭包捕获的 displayedLen 已过期、不能用于判断，故恒返 true 交给 effect 依赖收尾。
        return true;
      },
      frameInterval,
    );

    return () => handle.cancel();
  }, [text.length, isStreaming, displayedLen >= text.length, charsPerFrame, frameInterval, cursorBlink]);

  const displayedText = text.slice(0, displayedLen);
  const progress = text.length > 0 ? displayedLen / text.length : 0;
  const isTyping = displayedLen < text.length || isStreaming;

  return {
    displayedText,
    isTyping,
    progress,
    cursorVisible: !cursorBlink || cursorVisible,
  };
}

/**
 * 简易打字机 hook（非流式，一次性文本）
 * 用于系统消息、提示等固定文本的打字效果
 */
export function useSimpleTypewriter(
  text: string,
  speed: "fast" | "normal" | "slow" = "normal",
): { displayedText: string; isDone: boolean } {
  const [displayedLen, setDisplayedLen] = useState(0);
  const displayedLenRef = useRef(0);
  const charsPerFrame = defaultTokens.motion.typewriterSpeed[speed];
  const frameInterval = Math.round(1000 / defaultTokens.motion.maxFps);

  useEffect(() => {
    setDisplayedLen(0);
    displayedLenRef.current = 0;
    if (!text) return;

    const handle = animationEngine.register(
      `simple-tw-${Date.now().toString(36)}`,
      () => {
        // 用 ref 追踪实时进度：闭包捕获的 displayedLen 会过期，且本 effect 的
        // deps 不含 displayedLen（打完字后不会重跑），必须靠 ref 判断完成、返回
        // false 让引擎移除动画，否则回调恒返 true 造成僵尸帧循环（C4 数据丢失级泄漏）。
        const prev = displayedLenRef.current;
        const next = prev >= text.length ? prev : Math.min(prev + charsPerFrame, text.length);
        displayedLenRef.current = next;
        setDisplayedLen(next);
        return next < text.length;
      },
      frameInterval,
    );

    return () => handle.cancel();
  }, [text, charsPerFrame, frameInterval]);

  return {
    displayedText: text.slice(0, displayedLen),
    isDone: displayedLen >= text.length,
  };
}
