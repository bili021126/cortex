/**
 * tui/renderer/permission-dialog.ts — 工具可逆性评估
 *
 * 提供 L1/L2/L3 三级可逆性评估（纯函数，供 Ink 权限路径与工具流式执行复用）。
 * ANSI 直写渲染路径（renderInlinePermission/waitForSingleKey）已于 D1 收敛
 * 移除——权限确认 UI 统一走 tui/ink/permission-prompt.tsx。
 *
 * @module tui/renderer/permission-dialog
 * @since v3 — CLI TUI 全栈重构
 */

// ═══════════════════════════════════════════════════════════
// §1 可逆性评估
// ═══════════════════════════════════════════════════════════

/** L1 可逆工具（纯读操作） */
const L1_TOOLS = new Set([
  "read_file",
  "list_dir",
  "glob",
  "grep",
  "search_codebase",
  "search_symbol",
  "search_memory",
  "get_problems",
  "get_terminal_output",
  "fetch_rules",
  "web_fetch",
  "web_search",
]);

/** L3 不可逆工具（破坏性操作） */
const L3_TOOLS = new Set([
  "delete_file",
  "bash",
  "write",
  "search_replace",
  "create_plan",
  "switch_mode",
]);

/**
 * 评估工具可逆性等级。
 * - L1: 只读操作，完全可逆
 * - L2: 可逆写操作（如 git commit 可 revert）
 * - L3: 不可逆操作（文件删除、bash 执行等）
 */
export function reversibilityLevel(tool: string): 1 | 2 | 3 {
  if (L1_TOOLS.has(tool)) return 1;
  if (L3_TOOLS.has(tool)) return 3;
  return 2;
}
