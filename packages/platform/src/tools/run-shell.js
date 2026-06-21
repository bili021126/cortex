// ============================================================
// @cortex/engine/platform/tools/run-shell —— run_shell 工具
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================
import { ToolCategory, ReversibilityLevel as RL } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
export function createTool(ctx) {
    return new LocalTool("run_shell", ToolCategory.Shell, "Run a shell command and return its output.", {
        type: "object",
        properties: {
            command: { type: "string", description: "Shell command to run" },
        },
        required: ["command"],
    }, RL.L3, async (params) => {
        const command = params.command;
        if (!command) {
            return { success: false, error: "run_shell 缺少 command 参数" };
        }
        try {
            // 命令安全检查：禁止注入元字符（多语句连接符 + 子shell + 重定向）
            const injectionPattern = /[;&|`$(){}<>]/;
            if (injectionPattern.test(command)) {
                return { success: false, error: "run_shell 拒绝危险字符: 命令包含 shell 注入元字符（; & | ` $ ( ) { } < >）。如需执行多条命令或有特殊需求，请分步调用。" };
            }
            const cwd = ctx.workspaceRoot ?? ctx.fs.cwd();
            const output = await ctx.fs.execCommand(command, {
                cwd,
                timeout: ctx.toolTimeouts.runShell,
            });
            return { success: true, output: output.slice(0, 10_000) };
        }
        catch (e) {
            const err = e;
            const stderr = err.stderr ?? "";
            const message = err.message?.slice(0, 500) ?? String(e);
            return {
                success: false,
                error: `命令执行失败: ${message}${stderr ? `\nstderr: ${String(stderr).slice(0, 500)}` : ""}`,
            };
        }
    });
}
//# sourceMappingURL=run-shell.js.map