// ============================================================
// @cortex/engine/platform/tools/file-info —— file_info 工具
//
// 获取单个文件的元信息：大小、行数、修改时间、类型等。
// 比 run_shell "wc -l / stat" 更可靠，走 IFileSystemAdapter。
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================
import { ToolCategory, ReversibilityLevel as RL } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
export function createTool(ctx) {
    return new LocalTool("file_info", ToolCategory.Read, "Get metadata for a file: size (bytes), line count, existence, file/directory type. Faster and more reliable than shell stat/wc.", {
        type: "object",
        properties: {
            file_path: { type: "string", description: "Absolute path to the file" },
        },
        required: ["file_path"],
    }, RL.L0, async (params) => {
        const filePath = ctx.resolvePath(params.file_path);
        try {
            const exists = await ctx.fs.exists(filePath);
            if (!exists) {
                return { success: true, output: JSON.stringify({ path: filePath, exists: false }) };
            }
            const [stat, content] = await Promise.all([
                ctx.fs.stat(filePath).catch(() => null),
                ctx.fs.readFile(filePath).catch(() => null),
            ]);
            const info = {
                path: filePath,
                exists: true,
                isFile: stat?.isFile ?? null,
                isDirectory: stat?.isDirectory ?? null,
                lineCount: content !== null ? content.split("\n").length : null,
                sizeBytes: content !== null ? content.length : null,
            };
            return { success: true, output: JSON.stringify(info, null, 2) };
        }
        catch (e) {
            return { success: false, error: `获取文件信息失败: ${String(e)}` };
        }
    });
}
//# sourceMappingURL=file-info.js.map