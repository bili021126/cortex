/**
 * tui/animation/components/SlideIn.tsx — 滑入 Ink 组件
 *
 * @module tui/animation/components/SlideIn
 * @since v6
 */

import { Box } from "ink";
import type { ReactNode } from "react";
import { useSlideIn, type UseSlideInOptions } from "../hooks/use-slide-in.js";

export interface SlideInProps {
  /** 是否触发滑入 */
  active: boolean;
  /** 滑入选项 */
  options?: UseSlideInOptions;
  /** 子元素 */
  children: ReactNode;
}

/**
 * 滑入组件 — 从侧边/底部滑入效果
 */
export function SlideIn({ active, options = {}, children }: SlideInProps) {
  const { visible } = useSlideIn(active, options);

  if (!visible) return null;

  return (
    <Box>
      {children}
    </Box>
  );
}
