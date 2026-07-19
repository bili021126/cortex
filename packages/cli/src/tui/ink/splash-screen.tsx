/**
 * tui/ink/splash-screen.tsx — 启动画面（v6 Token + 增强动画）
 *
 * 星空科幻风格 + 昔涟主题。随机星点背景 + 居中标题框 + 加载动画。
 * 消费 Design Token，使用 useFrame 驱动星空闪烁。
 * 显示 1.5s 后自动切换到主界面。
 *
 * @module tui/ink/splash-screen
 * @since v5 — Ink 重构 Phase 1 → v6 Token + 动画整合
 */

import { Box, Text, useStdout } from "ink";
import { useState, useEffect, useMemo } from "react";
import { inkTheme } from "../theme/adapter-ink.js";
import { animationEngine } from "../animation/engine.js";

export interface SplashScreenProps {
  /** 显示时长(ms)，到期后调用 onComplete */
  duration?: number;
  /**  splash 结束回调 */
  onComplete: () => void;
}

// ─── 星空字符池 ──────────────────────────────────

const STAR_CHARS = ["·", ".", "✦", "✧", "⋆", "*"];
const STAR_DENSITY = 0.18; // 每列 18% 概率出星

interface Star {
  char: string;
  col: number;
  row: number;
  /** 闪烁相位偏移 */
  phase: number;
}

function generateStarfield(width: number, rows: number): Star[] {
  const stars: Star[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < width; c++) {
      if (Math.random() < STAR_DENSITY) {
        stars.push({
          char: STAR_CHARS[Math.floor(Math.random() * STAR_CHARS.length)] ?? " ",
          col: c,
          row: r,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
  }
  return stars;
}

// ─── 组件 ────────────────────────────────────────

export function SplashScreen({ duration = 1500, onComplete }: SplashScreenProps) {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const height = stdout?.rows ?? 24;
  const t = inkTheme;

  const stars = useMemo(() => generateStarfield(width, height), [width, height]);
  const [frame, setFrame] = useState(0);
  const [dots, setDots] = useState(0);

  // ── 星空闪烁动画 ────────────────────────────
  useEffect(() => {
    const handle = animationEngine.register(
      "splash-twinkle",
      (f) => {
        setFrame(f);
        return true; // 持续运行
      },
      200, // 5fps 足够闪烁
      0,   // 低优先级
    );
    return () => handle.cancel();
  }, []);

  // ── 加载点动画 ──────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setDots((d) => (d + 1) % 4), 300);
    return () => clearInterval(id);
  }, []);

  // ── 自动退出 ────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(onComplete, duration);
    return () => clearTimeout(timer);
  }, [duration, onComplete]);

  // ─── 标题区 (居中) ────────────────────────────
  const titleLines = [
    "",
    "    ╔══════════════════════════════╗",
    "    ║                              ║",
    "    ║      🍀  昔  涟              ║",
    "    ║      ━━━━━━━━━━━━━━          ║",
    "    ║      三千世轮回              ║",
    "    ║                              ║",
    "    ╚══════════════════════════════╝",
    "",
  ];
  const titleStartRow = Math.max(0, Math.floor(height / 2) - Math.floor(titleLines.length / 2) - 2);

  // ─── 星空行渲染（带闪烁） ────────────────────
  const rows: React.ReactNode[] = [];

  for (let r = 0; r < height; r++) {
    // 标题行：不渲染星点，让标题清晰可读
    const titleIdx = r - titleStartRow;
    if (titleIdx >= 0 && titleIdx < titleLines.length) {
      const titleLine = titleLines[titleIdx] ?? "";
      rows.push(
        <Box key={r}>
          <Text color={t.primary.color} bold>{titleLine}</Text>
        </Box>,
      );
      continue;
    }

    // 加载提示行（标题下方 2 行）
    if (r === titleStartRow + titleLines.length + 1) {
      const loadingText = `    初始化中${".".repeat(dots || 1)}`;
      rows.push(
        <Box key={r}>
          <Text color={t.textMuted.color}>{loadingText}</Text>
        </Box>,
      );
      continue;
    }

    // 普通星空行（带闪烁效果）
    const rowStars = stars.filter((s) => s.row === r);
    if (rowStars.length === 0) {
      rows.push(<Box key={r}><Text> </Text></Box>);
      continue;
    }

    // 构建行内容：在对应列位置放置星点（闪烁 = 字符变化）
    const lineArr = new Array(width).fill(" ");
    for (const s of rowStars) {
      if (s.col < width) {
        // 闪烁：根据 frame + phase 选择字符
        const twinkle = Math.sin(frame * 0.5 + s.phase);
        if (twinkle > 0.3) {
          lineArr[s.col] = s.char;
        } else if (twinkle > -0.3) {
          lineArr[s.col] = "·";
        }
        // else: 保持空格（暗星）
      }
    }
    const lineStr = lineArr.join("");
    rows.push(
      <Box key={r}>
        <Text color={t.textMuted.color}>{lineStr}</Text>
      </Box>,
    );
  }

  return (
    <Box flexDirection="column" height={height}>
      {rows}
    </Box>
  );
}
