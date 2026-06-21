/**
 * commands/inspect.ts — `cortex inspect` 项目侦察命令
 *
 * 安柏（InspectorAgent）的核心能力——侦察目录结构、依赖拓扑、配置漂移。
 *
 * @see CLI 设计文档 §4.9
 */
import { isHelpRequest } from "../utils.js";
import { buildEdges, collectDependencies, collectDeps, collectPackages, detectCycles, detectDrift, findProjectRoot, generateDot } from "@cortex/tools";
import * as fs from "node:fs";
import * as path from "node:path";
const INSPECT_HELP = [
    "用法: cortex inspect <子命令> [选项]",
    "",
    "子命令:",
    "  dir <path>            侦察目录结构",
    "  deps                  侦察依赖拓扑",
    "  drift                 侦察配置漂移",
    "  report                生成完整侦察报告",
    "",
    "选项:",
    "  --depth <n>           递归深度（默认 3）",
    "  --pattern <g>         glob 过滤模式",
    "  --format <fmt>        输出格式（text/json/tree）",
    "  --graph               输出 Graphviz DOT 格式",
    "  --cycles               检测循环依赖",
    "  --baseline <file>     基准配置文件",
    "  --output, -o <path>   输出路径",
    "  --sections <list>     包含的章节",
].join("\n");
export function createInspectHandler() {
    const handler = async (args, options, context) => {
        if (isHelpRequest(args)) {
            return { success: true, output: INSPECT_HELP, exitCode: 0 };
        }
        const subcommand = args[0];
        switch (subcommand) {
            case "dir": return handleInspectDir(args[1], options, context);
            case "deps": return handleInspectDeps(options, context);
            case "drift": return handleInspectDrift(options, context);
            case "report": return handleInspectReport(options, context);
            default:
                return { success: false, error: `未知子命令: "${subcommand}"。可用子命令: dir, deps, drift, report`, exitCode: 1 };
        }
    };
    return handler;
}
/** 递归扫描目录结构 */
function _scanDir(dir, currentDepth, maxDepth) {
    if (currentDepth > maxDepth)
        return [];
    const entries = [];
    try {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
            if (item.name.startsWith(".") || item.name === "node_modules")
                continue;
            entries.push({
                name: item.name,
                type: item.isDirectory() ? "directory" : "file",
                ...(item.isDirectory() ? { children: _scanDir(path.join(dir, item.name), currentDepth + 1, maxDepth) } : {}),
            });
        }
    }
    catch { /* 权限错误忽略 */ }
    return entries;
}
function handleInspectDir(dirPath, options, _context) {
    const target = dirPath ? path.resolve(dirPath) : process.cwd();
    const depth = parseInt(String(options["depth"] ?? "3"), 10);
    if (!fs.existsSync(target)) {
        return { success: false, error: `目录不存在: ${target}`, exitCode: 1 };
    }
    const tree = _scanDir(target, 0, depth);
    return {
        success: true,
        data: { root: target, depth, entries: tree },
        output: `目录结构: ${target} (深度 ${depth})`,
        exitCode: 0,
    };
}
function handleInspectDeps(options, _context) {
    const graphFormat = options["graph"];
    const detectCyclesOpt = options["cycles"];
    const root = findProjectRoot(process.cwd());
    const packages = collectPackages(root);
    const edges = buildEdges(packages, collectDeps(root, packages), false);
    const deps = _buildDepsMap(packages, edges);
    if (graphFormat) {
        const cycles = detectCyclesOpt ? detectCycles(edges) : [];
        const dot = generateDot(packages, edges, cycles);
        return { success: true, output: dot, data: { dot, deps, edges }, exitCode: 0 };
    }
    const cycles = detectCyclesOpt ? detectCycles(edges) : [];
    return { success: true, data: { deps, edges }, output: _formatDepsOutput(deps, cycles), exitCode: 0 };
}
/** 构建包名→workspace依赖映射 */
function _buildDepsMap(packages, edges) {
    const deps = {};
    for (const pkg of packages) {
        if (pkg.isRoot)
            continue;
        deps[pkg.name] = edges.filter((e) => e.from === pkg.id).map((e) => e.to);
    }
    return deps;
}
/** 格式化依赖输出文本 */
function _formatDepsOutput(deps, cycles) {
    let output = Object.entries(deps)
        .map(([pkg, targets]) => `  ${pkg} → ${targets.join(", ") || "(无 workspace 依赖)"}`)
        .join("\n");
    if (cycles.length > 0) {
        output += "\n\n⚠️ 循环依赖:";
        for (const cycle of cycles)
            output += `\n  ${cycle.path.join(" → ")}`;
    }
    else {
        output += "\n\n✅ 未发现循环依赖";
    }
    return output;
}
function handleInspectDrift(_options, _context) {
    const root = findProjectRoot(process.cwd());
    const entries = collectDependencies(root);
    const groups = detectDrift(entries);
    const drifts = groups.filter((g) => g.hasDrift);
    if (drifts.length === 0) {
        return {
            success: true,
            output: "✅ 未发现版本漂移（所有同名依赖版本一致）",
            exitCode: 0,
        };
    }
    const lines = [`❌ 发现 ${drifts.length} 处版本漂移:\n`];
    for (const drift of drifts) {
        lines.push(`  ${drift.depName}:`);
        for (const entry of drift.entries) {
            lines.push(`    ${entry.pkg}: ${entry.version}`);
        }
        lines.push("");
    }
    return {
        success: true,
        data: { drifts },
        output: lines.join("\n"),
        exitCode: 0,
    };
}
function handleInspectReport(options, _context) {
    const outputPath = (options["output"] ?? options["o"]);
    const report = {
        timestamp: new Date().toISOString(),
        dependencies: {},
        structure: {},
    };
    if (outputPath) {
        fs.writeFileSync(path.resolve(outputPath), JSON.stringify(report, null, 2), "utf-8");
        return {
            success: true,
            output: `✓ 侦察报告已生成: ${outputPath}`,
            data: report,
            exitCode: 0,
        };
    }
    return {
        success: true,
        data: report,
        output: "侦察报告已生成（使用 --output 保存到文件）",
        exitCode: 0,
    };
}
//# sourceMappingURL=inspect.js.map