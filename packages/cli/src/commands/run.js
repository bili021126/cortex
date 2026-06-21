/**
 * commands/run.ts — `cortex run` 单次执行命令
 *
 * 最常用的顶级命令——接受输入文件，调度 Agent 执行，输出结果。
 * 对接 Scheduler + TaskBoard + AgentPool。
 *
 * @see CLI 设计文档 §4.3
 */
import { convertMarkdown } from "../utils.js";
import * as fs from "node:fs";
import * as path from "node:path";
function _parseRunOptions(options) {
    return {
        agentType: (options["agent"] ?? options["a"]),
        outputPath: (options["output"] ?? options["o"]),
        title: options["title"],
        documentMode: options["document"],
        watchMode: options["watch"],
        dryRun: options["dry-run"],
    };
}
/** 读取输入文件或 stdin */
function _readInput(filePath) {
    if (filePath)
        return fs.readFileSync(path.resolve(filePath), "utf-8");
    return fs.readFileSync(0, "utf-8");
}
/** 构建干跑输出文本 */
function _buildRunDryRun(inputSource, contentLength, opts) {
    return [
        "📋 执行计划 (Dry-Run)",
        `   输入: ${inputSource}`,
        `   内容长度: ${contentLength} 字符`,
        opts.agentType ? `   Agent: ${opts.agentType}` : "   Agent: 自动匹配",
        opts.outputPath ? `   输出: ${opts.outputPath}` : "   输出: stdout",
        opts.watchMode ? "   监视: 开启" : "   监视: 关闭",
    ].join("\n");
}
/** 判断是否走文档转换路径 */
function _isDocConversion(filePath, options) {
    if (options["document"])
        return true;
    const ext = filePath ? path.extname(filePath).toLowerCase() : "";
    return ext === ".md" || ext === ".markdown";
}
/** 构建失败节点的错误详情 */
function _buildErrorDetails(report) {
    return report.results
        .filter((r) => !r.success)
        .map((r) => `  [${r.nodeId}] ${r.error ?? "未知错误"}`)
        .join("\n");
}
/** 构建 CLI 发起的 TaskNode */
function _createTaskNode(content, agentType) {
    return {
        id: `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: agentType ?? "analysis",
        tags: (agentType ? [agentType] : ["analysis"]),
        needsMultiPerspective: false,
        status: "pending",
        claimedBy: [],
        payload: content,
        results: [],
        createdAt: Date.now(),
    };
}
/** 通过 Engine 调度执行 */
async function _handleRunExecution(bridge, content, agentType) {
    if (bridge.isBootstrapConfigured)
        await bridge.ensureBootstrapped();
    else
        await bridge.ensureInitialized();
    const board = await bridge.getTaskBoard();
    const scheduler = await bridge.getScheduler();
    board.addNode(_createTaskNode(content, agentType));
    const report = await scheduler.executeAll();
    if (report.completed > 0) {
        const result = report.results[0];
        return {
            success: true,
            output: result.output ?? "✓ 执行完成",
            data: { totalNodes: report.totalNodes, completed: report.completed, failed: report.failed, durationMs: report.durationMs, result },
            exitCode: 0,
        };
    }
    const errorDetails = _buildErrorDetails(report);
    return {
        success: false,
        error: `执行失败: ${report.failed}/${report.totalNodes} 节点失败\n${errorDetails}`,
        data: report,
        exitCode: 2,
    };
}
export function createRunHandler(bridge) {
    return async (args, options, _context) => {
        const filePath = args[0];
        if (!filePath && !options["--"]) {
            return { success: false, error: "请指定输入文件。用法: cortex run <file> [选项]", exitCode: 1 };
        }
        const parsed = _parseRunOptions(options);
        const inputSource = filePath ?? "stdin";
        let content;
        try {
            content = _readInput(filePath);
        }
        catch (err) {
            return { success: false, error: `读取输入失败: ${err instanceof Error ? err.message : String(err)}`, exitCode: 1 };
        }
        if (parsed.dryRun) {
            return { success: true, output: _buildRunDryRun(inputSource, content.length, parsed), exitCode: 0 };
        }
        if (_isDocConversion(filePath, options)) {
            try {
                return convertMarkdown({ content, title: parsed.title, documentMode: parsed.documentMode, outputPath: parsed.outputPath });
            }
            catch (err) {
                return { success: false, error: `转换失败: ${err instanceof Error ? err.message : String(err)}`, exitCode: 2 };
            }
        }
        try {
            return await _handleRunExecution(bridge, content, parsed.agentType);
        }
        catch (err) {
            return { success: false, error: `调度执行失败: ${err instanceof Error ? err.message : String(err)}`, exitCode: 2 };
        }
    };
}
//# sourceMappingURL=run.js.map