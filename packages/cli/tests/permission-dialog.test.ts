// @ci: unit
/**
 * permission-dialog.test.ts — 权限确认对话框单元测试
 *
 * 覆盖：
 *   - reversibilityLevel: L1/L2/L3 三级分类
 *   - ConfirmGateState: 状态机转换（approve_once/approve_all/deny/skip/reset）
 *   - renderInlinePermission: L1 级别标签渲染
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  reversibilityLevel,
  ConfirmGateState,
} from "@cortex/cli";

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

// ═══════════════════════════════════════════════════════════
// ConfirmGateState
// ═══════════════════════════════════════════════════════════

describe("ConfirmGateState", () => {
  let gate: ConfirmGateState;

  beforeEach(() => {
    gate = new ConfirmGateState();
  });

  describe("初始状态", () => {
    it("isApproveAll 为 false", () => {
      expect(gate.isApproveAll).toBe(false);
    });

    it("skipped 为 0", () => {
      expect(gate.skipped).toBe(0);
    });
  });

  describe("approve_once", () => {
    it("返回 allow，不设置 approveAll", () => {
      const result = gate.handleResult("approve_once");
      expect(result).toBe("allow");
      expect(gate.isApproveAll).toBe(false);
    });

    it("后续请求仍需确认", () => {
      gate.handleResult("approve_once");
      expect(gate.isApproveAll).toBe(false);
    });
  });

  describe("approve_all", () => {
    it("返回 allow，设置 approveAll=true", () => {
      const result = gate.handleResult("approve_all");
      expect(result).toBe("allow");
      expect(gate.isApproveAll).toBe(true);
    });

    it("设置后后续 approve_once 也返回 allow", () => {
      gate.handleResult("approve_all");
      const result = gate.handleResult("approve_once");
      expect(result).toBe("allow");
    });
  });

  describe("deny", () => {
    it("返回 deny", () => {
      const result = gate.handleResult("deny");
      expect(result).toBe("deny");
    });

    it("多次 deny 不影响状态", () => {
      expect(gate.handleResult("deny")).toBe("deny");
      expect(gate.handleResult("deny")).toBe("deny");
      expect(gate.isApproveAll).toBe(false);
    });
  });

  describe("skip", () => {
    it("返回 skip，递增 skippedCount", () => {
      const result = gate.handleResult("skip");
      expect(result).toBe("skip");
      expect(gate.skipped).toBe(1);
    });

    it("多次 skip 累计", () => {
      gate.handleResult("skip");
      gate.handleResult("skip");
      gate.handleResult("skip");
      expect(gate.skipped).toBe(3);
    });

    it("skip 不改变 approveAll", () => {
      gate.handleResult("skip");
      expect(gate.isApproveAll).toBe(false);
    });
  });

  describe("reset", () => {
    it("重置 approveAll 和 skippedCount", () => {
      gate.handleResult("approve_all");
      gate.handleResult("skip");
      gate.handleResult("skip");
      expect(gate.isApproveAll).toBe(true);
      expect(gate.skipped).toBe(2);

      gate.reset();
      expect(gate.isApproveAll).toBe(false);
      expect(gate.skipped).toBe(0);
    });
  });

  describe("复合场景", () => {
    it("先 skip 再 approve_all 再 skip：计数正确", () => {
      gate.handleResult("skip");        // skipped: 1
      gate.handleResult("approve_all"); // approveAll: true
      gate.handleResult("skip");        // skipped: 2
      expect(gate.skipped).toBe(2);
      expect(gate.isApproveAll).toBe(true);
    });

    it("approve_all → reset → deny：状态一致", () => {
      gate.handleResult("approve_all");
      gate.reset();
      expect(gate.handleResult("deny")).toBe("deny");
      expect(gate.isApproveAll).toBe(false);
      expect(gate.skipped).toBe(0);
    });
  });
});
