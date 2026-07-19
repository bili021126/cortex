/**
 * tui/animation/components/Typewriter.tsx — 打字机 Ink 组件
 *
 * 包装 useTypewriter hook 为可直接使用的 Ink 组件。
 *
 * @module tui/animation/components/Typewriter
 * @since v6
 */

import { Text } from "ink";
import { useTypewriter, type UseTypewriterOptions } from "../hooks/use-typewriter.js";

export interface TypewriterProps {
  /** 流式文本内容 */
  text: string;
  /** 是否正在流式传输 */
  isStreaming?: boolean;
  /** 打字机选项 */
  options?: UseTypewriterOptions;
  /** 文本颜色 */
  color?: string;
  /** 是否粗体 */
  bold?: boolean;
}

/**
 * 打字机组件 — 流式文本逐字显示
 */
export function Typewriter({
  text,
  isStreaming = false,
  options = {},
  color,
  bold,
}: TypewriterProps) {
  const { displayedText, isTyping, cursorVisible } = useTypewriter(text, isStreaming, options);

  return (
    <Text color={color} bold={bold}>
      {displayedText}
      {isTyping && cursorVisible && (
        <Text color={color ?? "cyan"}>▌</Text>
      )}
    </Text>
  );
}
