// ============================================================
// @cortex/engine/platform/tools/read-file —— read_file 工具
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================
import { ToolCategory, ReversibilityLevel as RL } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
export function createTool(ctx) {
    return new LocalTool("read_file", ToolCategory.Read, "Read the contents of a file at the given path.", {
        type: "object",
        properties: {
            file_path: { type: "string", description: "Absolute path to file" },
        },
        required: ["file_path"],
    }, RL.L0, async (params) => {
        const filePath = ctx.resolvePath(params.file_path);
        try {
            const exists = await ctx.fs.exists(filePath);
            if (!exists) {
                return { success: false, error: `文件不存在: ${filePath}` };
            }
            const content = await ctx.fs.readFile(filePath);
            return { success: true, output: content };
        }
        catch (e) {
            return { success: false, error: `读取失败: ${String(e)}` };
        }
    });
}
//# sourceMappingURL=read-file.js.map