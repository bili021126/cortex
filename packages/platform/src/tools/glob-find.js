// ============================================================
// @cortex/engine/platform/tools/glob-find —— glob_find 工具
//
// 递归目录遍历 + glob 模式匹配，返回匹配文件的绝对路径列表。
// 支持 ** 递归匹配、* 通配符、? 单字符、{a,b} 选择。
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================
import { ToolCategory, ReversibilityLevel as RL } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
export function createTool(ctx) {
    return new LocalTool("glob_find", ToolCategory.Search, "Recursively find files matching a glob pattern (e.g. '**/*.test.ts', 'src/**/*.{js,ts}'). Supports **, *, ?, {a,b}.", {
        type: "object",
        properties: {
            pattern: { type: "string", description: "Glob pattern (e.g. '**/*.ts', 'src/**/*.{js,ts}')" },
            dir_path: { type: "string", description: "Root directory to search from (default: workspace root)" },
            max_results: { type: "number", description: "Maximum results to return (default: 100, max: 500)" },
        },
        required: ["pattern"],
    }, RL.L0, async (params) => {
        const pattern = params.pattern;
        if (!pattern) {
            return { success: false, error: "glob_find 缺少 pattern 参数" };
        }
        const rootDir = params.dir_path
            ? ctx.resolvePath(params.dir_path)
            : (ctx.workspaceRoot ?? ctx.fs.cwd());
        const maxResults = Math.min(params.max_results ?? 100, 500);
        try {
            const exists = await ctx.fs.exists(rootDir);
            if (!exists) {
                return { success: false, error: `目录不存在: ${rootDir}` };
            }
            const regex = globToRegex(pattern);
            const results = [];
            const walk = async (dir, depth) => {
                if (depth > 20 || results.length >= maxResults)
                    return;
                let entries;
                try {
                    entries = await ctx.fs.listDirectory(dir);
                }
                catch {
                    return;
                }
                for (const entry of entries) {
                    if (results.length >= maxResults)
                        return;
                    const fullPath = ctx.fs.resolve(dir, entry.name);
                    const relativePath = fullPath.slice(rootDir.length + 1);
                    if (entry.isDirectory) {
                        if (!entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "dist") {
                            await walk(fullPath, depth + 1);
                        }
                    }
                    else if (regex.test(relativePath) || regex.test(entry.name)) {
                        results.push(fullPath);
                    }
                }
            };
            await walk(rootDir, 0);
            if (results.length === 0) {
                return { success: true, output: JSON.stringify({ pattern, root: rootDir, count: 0, files: [], note: "无匹配文件" }) };
            }
            return { success: true, output: JSON.stringify({ pattern, root: rootDir, count: results.length, files: results }, null, 2) };
        }
        catch (e) {
            return { success: false, error: `glob 搜索失败: ${String(e)}` };
        }
    });
}
// ── glob → 正则转换（轻量，不引入外部库） ──────────
function globToRegex(pattern) {
    // 把 {a,b} 展开为 (a|b)
    let p = pattern;
    p = p.replace(/\{([^}]+)\}/g, (_, choices) => `(${choices.split(",").map((s) => escapeRegex(s.trim())).join("|")})`);
    // ** → 特殊占位符，最后替换
    const dsMarker = "\x00DS\x00";
    p = p.replace(/\*\*\/?/g, dsMarker);
    // * → [^/]*
    p = p.replace(/\*/g, "[^/]*");
    // ? → [^/]
    p = p.replace(/\?/g, "[^/]");
    // ** 替换为 .*
    p = p.replace(new RegExp(dsMarker, "g"), ".*");
    return new RegExp(`^${p}$`);
}
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
//# sourceMappingURL=glob-find.js.map