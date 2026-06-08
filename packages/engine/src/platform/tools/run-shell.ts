// ============================================================
// @cortex/engine/platform/tools/run-shell —— run_shell 工具
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================

import { ToolCategory, ReversibilityLevel as RL, type Tool } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
import type { ToolContext } from "./types.js";

export function createTool(ctx: ToolContext): Tool {
  return new LocalTool(
    "run_shell",
    ToolCategory.Shell,
    "Run a shell command and return its output.",
    {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" },
      },
      required: ["command"],
    },
    RL.L3,
    async (params) => {
      const command = params.command as string;
      if (!command) {
        return { success: false, error: "run_shell 缺少 command 参数" };
      }
      try {
        const cwd = ctx.workspaceRoot ?? ctx.fs.cwd();
        const output = await ctx.fs.execCommand(command, {
          cwd,
          timeout: ctx.toolTimeouts.runShell,
        });
        return { success: true, output: output.slice(0, 10_000) };
      } catch (e) {
        const err = e as { stderr?: unknown; message?: string };
        const stderr = err.stderr ?? "";
        const message = err.message?.slice(0, 500) ?? String(e);
        return {
          success: false,
          error: `命令执行失败: ${message}${stderr ? `\nstderr: ${String(stderr).slice(0, 500)}` : ""}`,
        };
      }
    },
  );
}
