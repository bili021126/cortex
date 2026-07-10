/**
 * tui/renderer/sanitize.ts — 终端文本净化
 *
 * 过滤二进制/控制字符，保护 URL/CJK/路径。
 * 参考 OpenClaw 的 sanitizeRenderableText 实现。
 *
 * @module tui/renderer/sanitize
 * @since v3 — P1 文本净化
 */

/** 终端文本净化——过滤二进制/控制字符，保护 URL/CJK/路径 */
export function sanitizeRenderableText(text: string): string {
  let result = text
    // 剥 ANSI escape（除 SGR）
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    // 控制字符（保留 \n \r \t）
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

  // 检测二进制行：含大量替换字符(≥12个)→截断
  const replacementCount = (result.match(/\uFFFD/g) || []).length;
  if (replacementCount >= 12) {
    return "[binary data omitted]";
  }

  return result.trim();
}
