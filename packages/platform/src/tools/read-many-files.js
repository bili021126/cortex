// ============================================================
// @cortex/engine/platform/tools/read-many-files —— read_many_files 工具
//
// 批量并行读取多个文件，减少 Agent 往返次数。
// 每个文件以 "=== file_path ===" 分隔，输出包含文件头。
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================
import { ToolCategory, ReversibilityLevel as RL } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
export function createTool(ctx) {
    return new LocalTool("read_many_files", ToolCategory.Read, "Read multiple files in parallel. Returns concatenated output with file headers. Use this instead of multiple read_file calls to reduce round-trips.", {
        type: "object",
        properties: {
            file_paths: {
                type: "array",
                items: { type: "string" },
                description: "Array of absolute file paths to read (max 10)",
            },
        },
        required: ["file_paths"],
    }, RL.L0, async (params) => {
        const paths = params.file_paths;
        if (!paths || !Array.isArray(paths) || paths.length === 0) {
            return { success: false, error: "read_many_files 需要 file_paths 数组参数" };
        }
        if (paths.length > 10) {
            return { success: false, error: `read_many_files 最多读取 10 个文件，收到 ${paths.length}` };
        }
        const resolvedPaths = paths.map((p) => {
            // strict: resolvePath 失败说明路径越界或无效，不降级回退
            return ctx.resolvePath(p);
        });
        const reads = resolvedPaths.map(async (filePath, i) => {
            try {
                const exists = await ctx.fs.exists(filePath);
                if (!exists) {
                    return `=== ${paths[i]} ===\n[文件不存在]\n`;
                }
                const content = await ctx.fs.readFile(filePath);
                return `=== ${paths[i]} ===\n${content}\n`;
            }
            catch (e) {
                return `=== ${paths[i]} ===\n[读取失败: ${String(e)}]\n`;
            }
        });
        const outputs = await Promise.all(reads);
        return { success: true, output: outputs.join("\n") };
    });
}
//# sourceMappingURL=read-many-files.js.map