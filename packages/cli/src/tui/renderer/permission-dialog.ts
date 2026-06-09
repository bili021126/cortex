/**
 * tui/renderer/permission-dialog.ts — 权限确认对话框渲染器
 *
 * 在工具调用前显示权限确认对话框，支持 L1/L2/L3 三级可逆性评估。
 * L1（可逆读操作）自动放行，L2（可逆写操作）和 L3（不可逆操作）需要确认。
 *
 * @module tui/renderer/permission-dialog
 * @since v3 — CLI TUI 全栈重构
 */

import { writeln, style, StyleCode, ColorCode } from "./ansi.js";

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

// ═══════════════════════════════════════════════════════════
// §2 权限对话框渲染
// ═══════════════════════════════════════════════════════════

let dialogActive = false;

/**
 * 渲染权限确认对话框。
 */
export function renderPermissionDialog(tool: string, input: string, level: 1 | 2 | 3): void {
  dialogActive = true;

  const levelLabel = level === 3
    ? style("⚠ L3 不可逆", ColorCode.red + StyleCode.bold)
    : level === 2
      ? style("⚡ L2 需确认", ColorCode.yellow)
      : style("✓ L1 可逆", ColorCode.green);

  writeln("");
  writeln(style("┌─ 权限确认 ─────────────────────────────", StyleCode.dim));
  writeln(`│ ${levelLabel}`);
  writeln(`│ 工具: ${style(tool, StyleCode.bold)}`);
  writeln(`│ 输入: ${style(input.length > 60 ? input.slice(0, 60) + "..." : input, StyleCode.dim)}`);
  writeln(style("├──────────────────────────────────────────", StyleCode.dim));
  writeln(`│ [y] 允许  [n] 拒绝  [a] 全部允许  [s] 跳过`);
  writeln(style("└──────────────────────────────────────────", StyleCode.dim));
}

/**
 * 清除权限对话框。
 */
export function clearPermissionDialog(): void {
  dialogActive = false;
}

/**
 * 监听用户确认输入。
 */
export function listenForConfirm(key: string): "approve_once" | "approve_all" | "deny" | "skip" | null {
  if (!dialogActive) return null;

  switch (key.toLowerCase()) {
    case "y": return "approve_once";
    case "n": return "deny";
    case "a": return "approve_all";
    case "s": return "skip";
    default: return null;
  }
}

// ═══════════════════════════════════════════════════════════
// §3 确认门状态
// ═══════════════════════════════════════════════════════════

export class ConfirmGateState {
  /** 是否已选择"全部允许" */
  private approveAll: boolean = false;
  /** 已跳过的工具计数 */
  private skippedCount: number = 0;

  /** 是否处于全部允许模式 */
  get isApproveAll(): boolean {
    return this.approveAll;
  }

  /** 获取已跳过计数 */
  get skipped(): number {
    return this.skippedCount;
  }

  /** 处理确认结果 */
  handleResult(result: "approve_once" | "approve_all" | "deny" | "skip"): "allow" | "deny" | "skip" {
    switch (result) {
      case "approve_all":
        this.approveAll = true;
        return "allow";
      case "approve_once":
        return "allow";
      case "deny":
        return "deny";
      case "skip":
        this.skippedCount++;
        return "skip";
    }
  }

  /** 重置状态 */
  reset(): void {
    this.approveAll = false;
    this.skippedCount = 0;
  }
}
