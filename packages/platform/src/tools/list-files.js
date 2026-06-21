// ============================================================
// @cortex/engine/platform/tools/list-files —— list_files 工具
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================
import { ToolCategory, ReversibilityLevel as RL } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
export function createTool(ctx) {
    return new LocalTool("list_files", ToolCategory.Read, "List files and directories at the given path.", {
        type: "object",
        properties: {
            dir_path: { type: "string", description: "Absolute path to directory (default: current workspace)" },
            pattern: { type: "string", description: "Glob filter pattern (optional, e.g. '*.ts')" },
        },
        required: [],
    }, RL.L0, async (params) => {
        let dirPath;
        if (params.dir_path) {
            const given = params.dir_path;
            // 先尝试沙箱解析
            try {
                dirPath = ctx.resolvePath(given);
            }
            catch {
                // 沙箱拦截——回退到 workspaceRoot 相对路径
                if (ctx.workspaceRoot) {
                    const relative = given.replace(/^[\/]+/, "").replace(/^[A-Z]:[\/\\]/, "");
                    dirPath = ctx.resolvePath(relative);
                }
                else {
                    dirPath = given;
                }
            }
            // 如果路径不存在但 workspaceRoot 已知，尝试相对解析
            if (!(await ctx.fs.exists(dirPath)) && ctx.workspaceRoot) {
                const relative = given.replace(/^[\/]+/, "").replace(/^[A-Z]:[\/\\]/, "");
                const altPath = ctx.fs.resolve(relative);
                if (altPath !== dirPath && await ctx.fs.exists(altPath))
                    dirPath = altPath;
            }
        }
        else {
            dirPath = ctx.workspaceRoot ?? ctx.fs.cwd();
        }
        try {
            const exists = await ctx.fs.exists(dirPath);
            if (!exists) {
                return { success: false, error: `目录不存在: ${dirPath}` };
            }
            const entries = await ctx.fs.listDirectory(dirPath);
            const pattern = params.pattern;
            let listing = entries
                .map((e) => `${e.isDirectory ? "[D]" : "[F]"} ${e.name}`)
                .join("\n");
            if (pattern) {
                const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
                listing = entries
                    .filter((e) => regex.test(e.name))
                    .map((e) => `${e.isDirectory ? "[D]" : "[F]"} ${e.name}`)
                    .join("\n");
            }
            return { success: true, output: listing || "(空目录)" };
        }
        catch (e) {
            return { success: false, error: `列目录失败: ${String(e)}` };
        }
    });
}
//# sourceMappingURL=list-files.js.map