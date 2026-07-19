/**
 * tui/theme/motion.ts — 动效令牌与缓动函数
 *
 * 终端动画没有 CSS transition，所有缓动效果需要离散化为帧序列。
 * 本文件提供预计算的 easing 帧序列和动画参数。
 *
 * @module tui/theme/motion
 * @since v6
 */

// ─── 缓动函数（离散化为帧序列） ─────────────

/**
 * 生成线性帧序列
 * @param frames 总帧数
 */
export function linear(frames: number): number[] {
  return Array.from({ length: frames }, (_, i) => i / (frames - 1));
}

/**
 * 生成 ease-in 帧序列（二次加速）
 */
export function easeIn(frames: number): number[] {
  return Array.from({ length: frames }, (_, i) => {
    const t = i / (frames - 1);
    return t * t;
  });
}

/**
 * 生成 ease-out 帧序列（二次减速）
 */
export function easeOut(frames: number): number[] {
  return Array.from({ length: frames }, (_, i) => {
    const t = i / (frames - 1);
    return 1 - (1 - t) * (1 - t);
  });
}

/**
 * 生成 ease-in-out 帧序列（三次加速+减速）
 */
export function easeInOut(frames: number): number[] {
  return Array.from({ length: frames }, (_, i) => {
    const t = i / (frames - 1);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  });
}

// ─── 预计算帧序列缓存 ───────────────────────

const FRAME_CACHE = new Map<string, number[]>();

/**
 * 获取指定缓动函数的帧序列（带缓存）
 */
export function getEasingFrames(
  easing: "linear" | "easeIn" | "easeOut" | "easeInOut",
  frames: number,
): number[] {
  const key = `${easing}:${frames}`;
  let cached = FRAME_CACHE.get(key);
  if (!cached) {
    switch (easing) {
      case "linear":
        cached = linear(frames);
        break;
      case "easeIn":
        cached = easeIn(frames);
        break;
      case "easeOut":
        cached = easeOut(frames);
        break;
      case "easeInOut":
        cached = easeInOut(frames);
        break;
    }
    FRAME_CACHE.set(key, cached);
  }
  return cached;
}

// ─── Spinner 帧序列 ─────────────────────────

/** 经典点旋转 */
export const SPINNER_DOTS = [".", "..", "...", "...."];

/** 弹跳球 */
export const SPINNER_BOUNCE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** 昔涟主题：四叶草旋转 */
export const SPINNER_CLOVER = ["🍀", "☘️", "🌿", "☘️"];

/** 脉冲 */
export const SPINNER_PULSE = ["●", "○", "●", "○"];

/** 进度条扫描 */
export const SPINNER_SCAN = ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "▊", "▋", "▌", "▍", "▎"];

// ─── 动画参数预设 ─────────────────────────

export interface AnimationPreset {
  /** 总帧数 */
  frames: number;
  /** 帧间隔 (ms) */
  interval: number;
  /** 缓动函数 */
  easing: "linear" | "easeIn" | "easeOut" | "easeInOut";
}

/**
 * 根据时长和帧率计算动画预设
 */
export function createPreset(
  durationMs: number,
  fps: number = 15,
  easing: "linear" | "easeIn" | "easeOut" | "easeInOut" = "easeOut",
): AnimationPreset {
  const frames = Math.max(2, Math.round((durationMs / 1000) * fps));
  return {
    frames,
    interval: Math.round(durationMs / frames),
    easing,
  };
}

/** 预设：快速淡入 */
export const PRESET_FADE_IN_FAST = createPreset(100, 15, "easeOut");

/** 预设：标准淡入 */
export const PRESET_FADE_IN_NORMAL = createPreset(200, 15, "easeOut");

/** 预设：滑入 */
export const PRESET_SLIDE_IN = createPreset(200, 15, "easeOut");

/** 预设：模式切换 */
export const PRESET_MODE_SWITCH = createPreset(400, 15, "easeInOut");

/** 预设：戏剧性过渡 */
export const PRESET_DRAMATIC = createPreset(800, 10, "easeInOut");
