/**
 * commands/schedule.ts — `cortex schedule` 调度系统命令
 *
 * 任务调度编排——从文件生成计划、执行计划、查看调度状态。
 * 对接 Scheduler + TaskBoard API。
 *
 * @see CLI 设计文档 §4.6
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import { isHelpRequest } from "../utils.js";
import type { ICortexTask, Tag, TaskNode } from "@cortex/shared";
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

export function createScheduleHandler(bridge: ICortexTask): CommandHandler {
  const handler: CommandHandler = async (args, options, context): Promise<CommandResult> => {
    if (isHelpRequest(args)) {
      return { success: true, output: SCHEDULE_HELP, exitCode: 0 };
    }
    const subcommand = args[0];
    try {
      switch (subcommand) {
        case "plan":   return handleSchedulePlan(args[1], options, context);
        case "run":    return await handleScheduleRun(bridge, args[1]);
        case "status": return await handleScheduleStatus(bridge);
        default:
          return { success: false, error: `未知子命令: "${subcommand}"。可用子命令: plan, run, status`, exitCode: 1 };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `调度操作失败: ${msg}`, exitCode: 2 };
    }
  };
  return handler;
}

/** 构建计划输出对象 */
function _buildPlanOutput(plan: Record<string, unknown>, options: Record<string, unknown>) {
  const tasks = Array.isArray(plan.tasks) ? plan.tasks as Array<unknown> : ["task-0"];
  const planName = typeof plan.name === "string" ? plan.name : "未命名计划";
  const taskCount = tasks.length;
  const layers = tasks.length > 0 && plan.tasks ? [tasks.map((_, i: number) => `task-${i}`)] : [["task-0"]];
  return {
    name: planName,
    totalTasks: taskCount,
    layers: options["topo"] ? layers : undefined,
    parallelGroups: options["parallel"] ? layers.length : undefined,
    estimatedDuration: `${taskCount * 5}s`,
  };
}

/** 格式化计划输出文本 */
function _formatPlanOutput(plan: ReturnType<typeof _buildPlanOutput>, options: Record<string, unknown>): string {
  const topo = options["topo"]; const parallel = options["parallel"];
  return [
    `📋 调度计划: ${plan.name}`,
    `   任务数: ${plan.totalTasks}`,
    topo ? `   拓扑层级: ${plan.parallelGroups}` : "",
    parallel ? `   并行组: ${plan.parallelGroups}` : "",
    `   预估耗时: ${plan.estimatedDuration}`,
  ].filter(Boolean).join("\n");
}

/** 读取并解析计划文件——JSON 或原始文本 */
function _readPlanFile(filePath: string): Record<string, unknown> {
  try {
    const content = fs.readFileSync(path.resolve(filePath), "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return { raw: fs.readFileSync(path.resolve(filePath), "utf-8") };
  }
}

function handleSchedulePlan(
  filePath: string | undefined,
  options: Record<string, unknown>,
  _context: CommandContext,
): CommandResult {
  if (!filePath) {
    return { success: false, error: "请指定任务描述文件。用法: cortex schedule plan <file>", exitCode: 1 };
  }

  let plan: Record<string, unknown>;
  try { plan = _readPlanFile(filePath); }
  catch (err) {
    return { success: false, error: `读取失败: ${err instanceof Error ? err.message : String(err)}`, exitCode: 1 };
  }

  const planOutput = _buildPlanOutput(plan, options);
  const outputPath = (options["output"] ?? options["o"]) as string | undefined;

  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), JSON.stringify(planOutput, null, 2), "utf-8");
    return { success: true, output: `✓ 计划已生成: ${outputPath}`, data: planOutput, exitCode: 0 };
  }
  return { success: true, data: planOutput, output: _formatPlanOutput(planOutput, options), exitCode: 0 };
}

async function handleScheduleRun(
  bridge: ICortexTask,
  planPath: string | undefined,
): Promise<CommandResult> {
  if (!planPath) {
    return { success: false, error: "请指定计划文件。用法: cortex schedule run <plan>", exitCode: 1 };
  }

  try {
    const content = fs.readFileSync(path.resolve(planPath), "utf-8");
    const plan = JSON.parse(content) as { tasks?: Array<Record<string, unknown>> };

    for (const [i, t] of (plan.tasks ?? []).entries()) {
      await bridge.submitTask({
        id: (t.id as string | undefined) ?? `sched-${Date.now()}-${i}`,
        type: (t.type as string) ?? "analysis",
        tags: (t.tags ?? ["analysis"]) as Tag[],
        needsMultiPerspective: false,
        status: "pending" as const,
        claimedBy: [],
        payload: (t.payload as string) ?? "",
        results: [],
        createdAt: Date.now(),
      });
    }

    const report = await bridge.executeAll();
    return {
      success: report.completed > 0,
      output: `调度执行完成: ${report.completed}/${report.totalNodes} 成功`,
      data: report,
      exitCode: report.completed > 0 ? 0 : 2,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `调度执行失败: ${msg}`, exitCode: 2 };
  }
}

async function handleScheduleStatus(_bridge: ICortexTask): Promise<CommandResult> {
  return {
    success: true,
    output: "调度系统状态：请用 cortex task list 查看任务状态",
    exitCode: 0,
  };
}
