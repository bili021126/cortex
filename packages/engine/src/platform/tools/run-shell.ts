// ============================================================
// @cortex/engine/platform/tools/run-shell —— run_shell 工具 Handler
// ============================================================

import type { ToolMeta } from "../toolkit.js";
import type { ToolContext } from "./types.js";
import type { ToolHandler } from "@cortex/shared";
import { ToolCategory } from "@cortex/shared";
import { ReversibilityLevel as RL } from "@cortex/shared";

export const meta: ToolMeta = {
  category: ToolCategory.Shell,
  description: "Run a shell command and return its output.",
  level: RL.L3,
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to run" },
    },
    required: ["command"],
  },
  required: ["command"],
};

export function createHandler(ctx: ToolContext): ToolHandler {
  return async (params) => {
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
  };
}
