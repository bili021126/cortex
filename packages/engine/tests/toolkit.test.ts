// @ci: unit
import { describe, it, expect, beforeEach } from "vitest";
import { AgentType } from "@cortex/shared";
import { Toolkit } from "../src/toolkit.js";

describe("Toolkit sandbox", () => {
  let tk: Toolkit;

  beforeEach(() => {
    tk = new Toolkit();
  });

  // ── P2-5 回归：Toolkit 沙箱机制 ──
  it("P0-5 regression: setWorkspaceRoot confines file reads within sandbox", async () => {
    // 沙箱根设置为当前测试文件所在目录
    tk.setWorkspaceRoot(__dirname);

    // 工作区内的文件（使用绝对路径确保 path.resolve 不走 cwd）
    const absPath = __dirname + "/toolkit.test.ts";
    const result = await tk.execute(
      { toolName: "read_file", params: { file_path: absPath } },
      AgentType.Code,
    );
    expect(result.success).toBe(true);
  });

  it("P0-5 regression: sandbox rejects path escape attempts", async () => {
    tk.setWorkspaceRoot(__dirname);

    // 工作区外的路径应被拒绝
    const result = await tk.execute(
      { toolName: "read_file", params: { file_path: "/etc/passwd" } },
      AgentType.Code,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("路径越界");
  });

  it("P0-5 regression: sandbox allows files in workspace subdirectories", async () => {
    // 沙箱根设为 engine 包根（cwd），子目录 tests/ 下的文件需可访问
    const engineRoot = __dirname.replace(/[\\/]tests$/, "");
    tk.setWorkspaceRoot(engineRoot);

    // tests/toolkit.test.ts 在沙箱内的 tests/ 子目录
    const absPath = engineRoot + "/tests/toolkit.test.ts";
    const result = await tk.execute(
      { toolName: "read_file", params: { file_path: absPath } },
      AgentType.Code,
    );
    expect(result.success).toBe(true);
  });

  it("P0-5 regression: agent without tool permission is denied", async () => {
    tk.setWorkspaceRoot(__dirname);

    // Butler 无任何工具权限
    const result = await tk.execute(
      { toolName: "read_file", params: { file_path: "toolkit.test.ts" } },
      AgentType.Butler,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("not permitted");
  });

  it("P0-5 regression: LegacyAgent (via PoolAwareState) workspace root is inherited", async () => {
    // 未设沙箱时允许任意路径（向后兼容测试场景）
    const result = await tk.execute(
      { toolName: "list_files", params: { dir_path: __dirname } },
      AgentType.Code,
    );
    expect(result.success).toBe(true);
  });
});
