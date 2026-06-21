/**
 * commands/schedule.ts — `cortex schedule` 调度系统命令
 *
 * 任务调度编排——从文件生成计划、执行计划、查看调度状态。
 * 对接 Scheduler + TaskBoard API。
 *
 * @see CLI 设计文档 §4.6
 */
import { isHelpRequest } from "../utils.js";
import * as fs from "node:fs";
import * as path from "node:path";
const SCHEDULE_HELP = [
    "用法: cortex schedule <子命令> [选项]",
    "",
    "子命令:",
    "  plan <file>           从文件生成调度计划",
    "  run <plan>            执行调度计划",
    "  status                调度系统状态",
    "",
    "选项:",
    "  --topo                显示拓扑排序结果",
    "  --parallel            显示可并行的层级",
    "  --output, -o <path>   输出计划文件",
    "  --step, -s <n>        单步执行",
    "  --watch               实时显示执行进度",
    "  --verbose, -v         显示详细信息",
].join("\n");
export function createScheduleHandler(bridge) {
    const handler = async (args, options, context) => {
        if (isHelpRequest(args)) {
            return { success: true, output: SCHEDULE_HELP, exitCode: 0 };
        }
        const subcommand = args[0];
        try {
            switch (subcommand) {
                case "plan": return handleSchedulePlan(args[1], options, context);
                case "run": return await handleScheduleRun(bridge, args[1]);
                case "status": return await handleScheduleStatus(bridge);
                default:
                    return { success: false, error: `未知子命令: "${subcommand}"。可用子命令: plan, run, status`, exitCode: 1 };
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, error: `调度操作失败: ${msg}`, exitCode: 2 };
        }
    };
    return handler;
}
/** 构建计划输出对象 */
function _buildPlanOutput(plan, options) {
    const tasks = Array.isArray(plan.tasks) ? plan.tasks : ["task-0"];
    const planName = typeof plan.name === "string" ? plan.name : "未命名计划";
    const taskCount = tasks.length;
    const layers = tasks.length > 0 && plan.tasks ? [tasks.map((_, i) => `task-${i}`)] : [["task-0"]];
    return {
        name: planName,
        totalTasks: taskCount,
        layers: options["topo"] ? layers : undefined,
        parallelGroups: options["parallel"] ? layers.length : undefined,
        estimatedDuration: `${taskCount * 5}s`,
    };
}
/** 格式化计划输出文本 */
function _formatPlanOutput(plan, options) {
    const topo = options["topo"];
    const parallel = options["parallel"];
    return [
        `📋 调度计划: ${plan.name}`,
        `   任务数: ${plan.totalTasks}`,
        topo ? `   拓扑层级: ${plan.parallelGroups}` : "",
        parallel ? `   并行组: ${plan.parallelGroups}` : "",
        `   预估耗时: ${plan.estimatedDuration}`,
    ].filter(Boolean).join("\n");
}
/** 读取并解析计划文件——JSON 或原始文本 */
function _readPlanFile(filePath) {
    try {
        const content = fs.readFileSync(path.resolve(filePath), "utf-8");
        return JSON.parse(content);
    }
    catch {
        return { raw: fs.readFileSync(path.resolve(filePath), "utf-8") };
    }
}
function handleSchedulePlan(filePath, options, _context) {
    if (!filePath) {
        return { success: false, error: "请指定任务描述文件。用法: cortex schedule plan <file>", exitCode: 1 };
    }
    let plan;
    try {
        plan = _readPlanFile(filePath);
    }
    catch (err) {
        return { success: false, error: `读取失败: ${err instanceof Error ? err.message : String(err)}`, exitCode: 1 };
    }
    const planOutput = _buildPlanOutput(plan, options);
    const outputPath = (options["output"] ?? options["o"]);
    if (outputPath) {
        fs.writeFileSync(path.resolve(outputPath), JSON.stringify(planOutput, null, 2), "utf-8");
        return { success: true, output: `✓ 计划已生成: ${outputPath}`, data: planOutput, exitCode: 0 };
    }
    return { success: true, data: planOutput, output: _formatPlanOutput(planOutput, options), exitCode: 0 };
}
/** 从计划数据批量添加任务节点到看板 */
function _addTaskNodesFromPlan(board, plan) {
    if (!plan.tasks)
        return;
    for (let i = 0; i < plan.tasks.length; i++) {
        const t = plan.tasks[i];
        board.addNode({
            id: t.id ?? `sched-${Date.now()}-${i}`,
            type: t.type ?? "analysis",
            tags: (t.tags ?? ["analysis"]),
            needsMultiPerspective: false,
            status: "pending",
            claimedBy: [],
            payload: t.payload ?? "",
            results: [],
            createdAt: Date.now(),
        });
    }
}
async function handleScheduleRun(bridge, planPath) {
    if (!planPath) {
        return { success: false, error: "请指定计划文件。用法: cortex schedule run <plan>", exitCode: 1 };
    }
    const board = await bridge.getTaskBoard();
    const scheduler = await bridge.getScheduler();
    try {
        const content = fs.readFileSync(path.resolve(planPath), "utf-8");
        const plan = JSON.parse(content);
        _addTaskNodesFromPlan(board, plan);
        const report = await scheduler.executeAll();
        return {
            success: report.completed > 0,
            output: `调度执行完成: ${report.completed}/${report.totalNodes} 成功`,
            data: report,
            exitCode: report.completed > 0 ? 0 : 2,
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `调度执行失败: ${msg}`, exitCode: 2 };
    }
}
/** 计算任务板状态统计 */
function _computeTaskBoardStatus(allNodes, pendingNodes) {
    return {
        total: allNodes.length,
        pending: pendingNodes.length,
        active: allNodes.filter((n) => n.status === "claimed" || n.status === "running").length,
        done: allNodes.filter((n) => n.status === "done").length,
        failed: allNodes.filter((n) => n.status === "failed").length,
    };
}
async function handleScheduleStatus(bridge) {
    const board = await bridge.getTaskBoard();
    const allNodes = board.getAllNodes();
    const pendingNodes = board.getPendingNodes();
    const status = _computeTaskBoardStatus(allNodes, pendingNodes);
    if (pendingNodes.length === 0) {
        return { success: true, data: { taskBoard: status }, output: "调度系统: 空闲（无待处理任务）", exitCode: 0 };
    }
    return {
        success: true,
        data: { taskBoard: status },
        output: [
            `调度系统状态:`,
            `  任务板: ${status.total} 总任务`,
            `    ${status.pending} 待处理`,
            `    ${status.active} 执行中`,
            `    ${status.done} 已完成`,
            `    ${status.failed} 失败`,
        ].join("\n"),
        exitCode: 0,
    };
}
//# sourceMappingURL=schedule.js.map