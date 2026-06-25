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
        // 第一道防线：注入元字符检测（多语句连接符 + 子shell + 重定向 + 换行符）
        const injectionPattern = /[;&|`$(){}<>]/;
        const newlinePattern = /[\n\r]/;
        if (injectionPattern.test(command) || newlinePattern.test(command)) {
          return { success: false, error: "run_shell 拒绝危险字符: 命令包含 shell 注入元字符（; & | ` $ ( ) { } < >）或换行符。如需执行多条命令或有特殊需求，请分步调用。" };
        }

        // 第二道防线：解析命令为可执行文件 + 参数数组，避免 shell 解释注入
        const parts = command.trim().split(/\s+/);
        const cmd = parts[0] ?? '';
        const args = parts.slice(1);

        const cwd = ctx.workspaceRoot ?? ctx.fs.cwd();
        // 使用 execFile（参数数组）而非 execCommand（整串传给 shell）
        const output = await ctx.fs.execFile(cmd, args, {
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
