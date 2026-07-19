/**
 * tui/animation/engine.ts — 终端动画引擎
 *
 * 全局帧调度器：管理所有活跃动画的帧循环。
 * 终端约束：无 CSS transition，只能逐帧重绘。
 * 帧率上限 15fps（66ms/帧），避免终端闪烁。
 *
 * 设计：
 * - 基于 setInterval 的帧循环（React 环境下比 rAF 更可控）
 * - 使用 useRef 存储动画状态，避免 React 调度干扰
 * - 性能自适应：检测帧延迟，自动降帧
 *
 * @module tui/animation/engine
 * @since v6
 */

import { defaultTokens } from "../theme/tokens.js";

// ─── 类型定义 ─────────────────────────────────

export type FrameCallback = (frame: number, elapsed: number) => boolean;
// 返回 true = 继续动画，返回 false = 动画结束

export interface AnimationHandle {
  id: string;
  cancel: () => void;
}

interface AnimationEntry {
  id: string;
  callback: FrameCallback;
  interval: number;       // 帧间隔 (ms)
  lastFrame: number;      // 上一帧时间戳
  priority: number;       // 高优先级先执行
}

// ─── 动画引擎 ─────────────────────────────────

class AnimationEngine {
  private entries = new Map<string, AnimationEntry>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private frameCount = 0;
  private startTime = 0;
  /** 性能监测：连续慢帧计数 */
  private slowFrames = 0;
  /** 性能监测：帧率降级系数 (1.0 = 全速, 0.5 = 半速) */
  private speedFactor = 1.0;

  /** 目标帧间隔 (ms) */
  private readonly targetInterval: number;

  constructor() {
    this.targetInterval = Math.round(1000 / defaultTokens.motion.maxFps);
  }

  /**
   * 注册一个动画
   * @param id 唯一标识
   * @param callback 帧回调，返回 false 时动画自动结束
   * @param interval 帧间隔 (ms)，默认使用目标帧间隔
   * @param priority 优先级（高优先级先执行）
   */
  register(
    id: string,
    callback: FrameCallback,
    interval?: number,
    priority = 0,
  ): AnimationHandle {
    // 如果已有同 id 动画，先取消
    this.unregister(id);

    this.entries.set(id, {
      id,
      callback,
      interval: interval ?? this.targetInterval,
      lastFrame: 0,
      priority,
    });

    if (!this.running) {
      this.start();
    }

    return {
      id,
      cancel: () => this.unregister(id),
    };
  }

  /**
   * 注销动画
   */
  unregister(id: string): void {
    this.entries.delete(id);
    if (this.entries.size === 0 && this.running) {
      this.stop();
    }
  }

  /**
   * 启动帧循环
   */
  private start(): void {
    if (this.running) return;
    this.running = true;
    this.frameCount = 0;
    this.startTime = Date.now();
    this.timer = setInterval(() => this.tick(), this.targetInterval);
  }

  /**
   * 停止帧循环
   */
  private stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 帧调度
   */
  private tick(): void {
    const now = Date.now();
    const elapsed = now - this.startTime;
    this.frameCount++;

    // 性能监测：检测慢帧
    const frameDuration = now - (this.startTime + (this.frameCount - 1) * this.targetInterval);
    if (frameDuration > this.targetInterval * 2) {
      this.slowFrames++;
      if (this.slowFrames > 5) {
        // 连续慢帧，降级帧率
        this.speedFactor = Math.max(0.25, this.speedFactor * 0.5);
        this.slowFrames = 0;
      }
    } else {
      this.slowFrames = Math.max(0, this.slowFrames - 1);
    }

    // 按优先级排序执行
    const sorted = [...this.entries.values()].sort((a, b) => b.priority - a.priority);
    const toRemove: string[] = [];

    for (const entry of sorted) {
      // 检查是否到达该动画的帧间隔
      if (now - entry.lastFrame < entry.interval / this.speedFactor) {
        continue;
      }
      entry.lastFrame = now;

      try {
        const shouldContinue = entry.callback(this.frameCount, elapsed);
        if (!shouldContinue) {
          toRemove.push(entry.id);
        }
      } catch {
        // 动画回调异常，静默移除
        toRemove.push(entry.id);
      }
    }

    // 清理已结束的动画
    for (const id of toRemove) {
      this.entries.delete(id);
    }

    // 如果没有活跃动画，停止循环
    if (this.entries.size === 0) {
      this.stop();
    }
  }

  /**
   * 获取引擎状态
   */
  getStatus(): {
    running: boolean;
    activeAnimations: number;
    frameCount: number;
    speedFactor: number;
  } {
    return {
      running: this.running,
      activeAnimations: this.entries.size,
      frameCount: this.frameCount,
      speedFactor: this.speedFactor,
    };
  }

  /**
   * 强制停止所有动画
   */
  destroy(): void {
    this.entries.clear();
    this.stop();
    this.frameCount = 0;
    this.slowFrames = 0;
    this.speedFactor = 1.0;
  }
}

/** 全局动画引擎单例 */
export const animationEngine = new AnimationEngine();
