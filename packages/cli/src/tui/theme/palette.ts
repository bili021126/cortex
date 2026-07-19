/**
 * tui/theme/palette.ts — 昔涟主题色板
 *
 * 基于 Tokyo Night 调色板变体，融合昔涟翡翠绿为主色调。
 * 所有颜色通过 tokens.ts 的 ColorTokens 接口消费，
 * 本文件提供额外的色板扩展（渐变、角色色等）。
 *
 * @module tui/theme/palette
 * @since v6
 */

// ─── 扩展色板（非 token 层，供渐变/特殊场景使用） ───

export const PALETTE = {
  // 昔涟翡翠色系
  xilian: {
    50: "#E8F8F0",
    100: "#C5EDD9",
    200: "#8FDBB5",
    300: "#5CC993",
    400: "#48C78E",
    500: "#3AAF7A",
    600: "#2D8B61",
    700: "#1F6B4A",
    800: "#144D35",
    900: "#0A2F20",
  },
  // 金色点缀系
  accent: {
    50: "#FEF9E7",
    100: "#FDF0C3",
    200: "#FBE38A",
    300: "#F9D652",
    400: "#F5C842",
    500: "#D4A830",
    600: "#B08A25",
    700: "#8C6D1C",
    800: "#685114",
    900: "#44350D",
  },
  // 深夜蓝黑背景系
  night: {
    50: "#E3E4F0",
    100: "#B9BBDA",
    200: "#8F92C4",
    300: "#6669AE",
    400: "#464998",
    500: "#2F3261",
    600: "#24253A",
    700: "#1E1F30",
    800: "#1A1B26",
    900: "#13141C",
  },
  // 语义色扩展
  sakura: "#F7768E",   // 樱红（错误/危险）
  amber: "#E0AF68",    // 琥珀（警告）
  mint: "#73DACA",     // 薄荷（成功）
    sky: "#7DCFFF",    // 天蓝（信息）
  violet: "#BB9AF7",   // 紫罗兰（特殊）
  coral: "#FF9E64",    // 珊瑚（高亮）
} as const;

// ─── 渐变色定义（用于进度条、状态条等） ───

export const GRADIENTS = {
  /** 翡翠渐变（昔涟主渐变） */
  emerald: ["#2D8B61", "#48C78E", "#73DACA"] as const,
  /** 金色渐变（强调/高亮） */
  gold: ["#B08A25", "#F5C842", "#FDF0C3"] as const,
  /** 热力渐变（token 使用率） */
  tokenHeat: ["#73DACA", "#E0AF68", "#F7768E"] as const,
  /** 冷色渐变（信息/思考） */
  cool: ["#2F3261", "#7DCFFF", "#BB9AF7"] as const,
} as const;

// ─── 颜色工具函数 ─────────────────────────────

/**
 * 将 hex 颜色转为 RGB 三元组
 */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/**
 * 将 RGB 三元组转为 hex 颜色
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

/**
 * 在两个 hex 颜色之间线性插值
 * @param t 0-1 之间的插值因子
 */
export function lerpColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return rgbToHex(
    clamp(r1 + (r2 - r1) * t),
    clamp(g1 + (g2 - g1) * t),
    clamp(b1 + (b2 - b1) * t),
  );
}

/**
 * 根据 token 使用百分比返回热力色
 */
export function tokenHeatColor(pct: number): string {
  if (pct >= 80) return PALETTE.sakura;
  if (pct >= 50) return PALETTE.amber;
  return PALETTE.mint;
}
