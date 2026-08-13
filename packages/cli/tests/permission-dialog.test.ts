// @ci: unit
/**
 * permission-dialog.test.ts — 工具可逆性评估单元测试
 *
 * 覆盖：reversibilityLevel 的 L1/L2/L3 三级分类。
 * （D1 收敛：ConfirmGateState/renderInlinePermission 随 ANSI 直写路径移除，
 *   对应测试已删除——权限确认 UI 统一走 tui/ink/permission-prompt.tsx）
 */

import { describe, it, expect } from "vitest";
import { reversibilityLevel } from "@cortex/cli";

// ═══════════════════════════════════════════════════════════
// reversibilityLevel
// ═══════════════════════════════════════════════════════════

describe("reversibilityLevel", () => {
  // ── L1 读操作 ──
  it.each([
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
  ])("%s → L1（只读可逆）", (tool) => {
    expect(reversibilityLevel(tool)).toBe(1);
  });

  // ── L3 不可逆 ──
  it.each([
    "delete_file",
    "bash",
    "write",
    "search_replace",
    "create_plan",
    "switch_mode",
  ])("%s → L3（不可逆）", (tool) => {
    expect(reversibilityLevel(tool)).toBe(3);
  });

  // ── L2 默认（可逆写操作或其未知工具） ──
  it.each([
    "edit_file",
    "update_memory",
    "todo_write",
    "unknown_tool_xyz",
  ])("%s → L2（默认可逆写操作）", (tool) => {
    expect(reversibilityLevel(tool)).toBe(2);
  });

  // 边界
  it("空字符串 → L2", () => {
    expect(reversibilityLevel("")).toBe(2);
  });

  it("大小写敏感：READ_FILE → L2（不在 L1 集合中）", () => {
    expect(reversibilityLevel("READ_FILE")).toBe(2);
  });
});
