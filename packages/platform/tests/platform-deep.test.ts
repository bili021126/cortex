// @ci: unit
import { describe, it, expect, vi } from "vitest";
import { Toolkit } from "@cortex/platform";
import { AgentType } from "@cortex/shared";

describe("platform deep", () => {
  it("toolkit.execute L2工具经过gate", async () => {
    const toolkit = new Toolkit();
    toolkit.setWorkspaceRoot("/tmp");
    const gateMock = {
      needsConfirmation: vi.fn().mockReturnValue(false),
      check: vi.fn(),
      request: vi.fn(),
      waitFor: vi.fn(),
      recordDecision: vi.fn(),
    };
    toolkit.setGate(gateMock as any);

    // 注册一个简单工具（register 接受 name + handler）
    toolkit.register("read_file", async (_params: Record<string, unknown>) => ({
      success: true, output: "content",
    }));

    const result = await toolkit.execute(
      { toolName: "read_file", params: { path: "/tmp/file.txt" } },
      AgentType.Code,
    );

    expect(gateMock.needsConfirmation).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ toolName: "read_file" }));
    expect(result.success).toBe(true);
  });

  it("reversibilityOf 覆盖所有内置工具", () => {
    const toolkit = new Toolkit();
    toolkit.setWorkspaceRoot("/tmp");
    const builtinTools = ["read_file", "write_file", "delete_file", "glob_find", "run_shell", "search_code", "list_files"];
    for (const name of builtinTools) {
      const level = toolkit.reversibilityOf(name);
      expect(level).toBeDefined();
      expect(["L0", "L1", "L2", "L3"]).toContain(level);
    }
  });
});
