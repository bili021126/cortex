/**
 * tui/renderer/permission-dialog.ts — 权限确认对话框渲染器
 *
 * 在工具调用前显示权限确认对话框，支持 L1/L2/L3 三级可逆性评估。
 * L1（可逆读操作）自动放行，L2（可逆写操作）和 L3（不可逆操作）需要确认。
 *
 * @module tui/renderer/permission-dialog
 * @since v3 — CLI TUI 全栈重构
 */

import { write, eraseLine } from "./ansi.js";
import { ansiTheme } from "../theme/adapter-ansi.js";
import * as readline from "node:readline";

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

/**
 * 渲染 inline 权限确认提示。
 * 在工具调用行后追加 [y/n/a/s]? 单行提示——不打断输出流。
 */
export function renderInlinePermission(tool: string, input: string, level: 1 | 2 | 3): void {

  const levelLabel = level === 3
    ? ansiTheme.riskHigh("L3不可逆")
    : level === 2
      ? ansiTheme.riskMedium("L2需确认")
      : ansiTheme.riskLow("L1");

  const truncatedInput = input.length > 40 ? input.slice(0, 40) + "..." : input;
  write(` ${ansiTheme.warning("⚡")} ${ansiTheme.bold(tool)}(${levelLabel}): ${ansiTheme.dim(truncatedInput)} [y/n/a/s]? `);
}

/**
 * 清除 inline 权限提示。
 */
export function clearInlinePermission(): void {
  // 上移一行并清除
  process.stdout.write("\r" + eraseLine);
}

/**
 * 在 raw mode 下等待单键确认输入。
 * 处理单个按键后立即返回，无需回车。
 *
 * @param timeoutMs 超时毫秒数，默认 30000（30s 超时自动 deny）
 */
export async function waitForSingleKey(timeoutMs: number = 30000): Promise<"approve_once" | "approve_all" | "deny" | "skip"> {
  const prevRaw = process.stdin.isRaw;
  process.stdin.setRawMode?.(true);

  return await new Promise<"approve_once" | "approve_all" | "deny" | "skip">((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, escapeCodeTimeout: 50 });
    readline.emitKeypressEvents(process.stdin, rl);

    const timeout = setTimeout(() => {
      cleanup();
      resolve("deny"); // 超时自动 deny
    }, timeoutMs);

    const onKeypress = (_str: string, key: readline.Key) => {
      clearTimeout(timeout);
      let result: "approve_once" | "approve_all" | "deny" | "skip" | null = null;

      if (key.name) {
        switch (key.name) {
          case "y": result = "approve_once"; break;
          case "n": result = "deny"; break;
          case "a": result = "approve_all"; break;
          case "s": result = "skip"; break;
        }
      }
      // 字符 fallback
      if (!result) {
        const seq = key.sequence?.toLowerCase();
        if (seq === "y") result = "approve_once";
        else if (seq === "n") result = "deny";
        else if (seq === "a") result = "approve_all";
        else if (seq === "s") result = "skip";
      }

      if (result) {
        cleanup();
        resolve(result);
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      if (prevRaw !== undefined) process.stdin.setRawMode?.(prevRaw);
      rl.close();
    };

    process.stdin.on("keypress", onKeypress);
  });
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
