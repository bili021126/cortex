/**
 * tui/animation/hooks/use-frame.ts — 底层帧 hook
 *
 * 提供 React 组件级别的帧订阅能力。
 * 所有动画 hook 基于此构建。
 *
 * @module tui/animation/hooks/use-frame
 * @since v6
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { animationEngine, type AnimationHandle, type FrameCallback } from "../engine.js";

/**
 * 订阅全局帧循环
 * @param callback 帧回调，返回 false 结束动画
 * @param interval 帧间隔 (ms)
 * @param deps 依赖数组（变化时重新注册）
 */
export function useFrame(
  callback: FrameCallback,
  interval?: number,
  deps: unknown[] = [],
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const handle = animationEngine.register(
      `use-frame-${Math.random().toString(36).slice(2, 9)}`,
      (frame, elapsed) => callbackRef.current(frame, elapsed),
      interval,
    );
    return () => handle.cancel();
  }, deps);
}

/**
 * 命令式动画控制 hook
 * 返回 start/stop/isRunning，适合需要手动触发的动画
 */
export function useAnimation() {
  const handleRef = useRef<AnimationHandle | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const start = useCallback((callback: FrameCallback, interval?: number) => {
    if (handleRef.current) {
      handleRef.current.cancel();
    }
    const id = `anim-${Math.random().toString(36).slice(2, 9)}`;
    handleRef.current = animationEngine.register(id, (frame, elapsed) => {
      const shouldContinue = callback(frame, elapsed);
      if (!shouldContinue) {
        setIsRunning(false);
      }
      return shouldContinue;
    }, interval);
    setIsRunning(true);
  }, []);

  const stop = useCallback(() => {
    if (handleRef.current) {
      handleRef.current.cancel();
      handleRef.current = null;
    }
    setIsRunning(false);
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (handleRef.current) {
        handleRef.current.cancel();
      }
    };
  }, []);

  return { start, stop, isRunning };
}
