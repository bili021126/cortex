/**
 * commands/schedule.ts — `cortex schedule` 调度系统命令
 *
 * 任务调度编排——从文件生成计划、执行计划、查看调度状态。
 * 对接 Scheduler + TaskBoard API。
 *
 * @see CLI 设计文档 §4.6
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import type { EngineBridge } from "../services/engine-bridge.js";
import * as fs from "node:fs";
import * as path from "node:path";

export function createScheduleHandler(bridge: EngineBridge): CommandHandler {
  return async (args, options, context): Promise<CommandResult> => {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      return {
        success: true,
        output: [
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
        ].join("\n"),
        exitCode: 0,
      };
    }

    const subcommand = args[0];

    try {
      switch (subcommand) {
        case "plan":
          return await handleSchedulePlan(args[1], options, context);
        case "run":
          return await handleScheduleRun(bridge, args[1], options, context);
        case "status":
          return await handleScheduleStatus(bridge, options, context);
        default:
          return {
            success: false,
            error: `未知子命令: "${subcommand}"。可用子命令: plan, run, status`,
            exitCode: 1,
          };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `调度操作失败: ${msg}`, exitCode: 2 };
    }
  };
}

async function handleSchedulePlan(
  filePath: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
  if (!filePath) {
    return { success: false, error: "请指定任务描述文件。用法: cortex schedule plan <file>", exitCode: 1 };
  }

  let content: string;
  try {
    content = fs.readFileSync(path.resolve(filePath), "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `读取失败: ${msg}`, exitCode: 1 };
  }

  let plan: any;
  try {
    plan = JSON.parse(content);
  } catch {
    plan = { raw: content, hint: "非 JSON 格式，作为原始任务描述" };
  }

  const showTopo = options["topo"] as boolean;
  const showParallel = options["parallel"] as boolean;
  const outputPath = (options["output"] ?? options["o"]) as string | undefined;

  const layers = plan.tasks ? [plan.tasks.map((_: any, i: number) => `task-${i}`)] : [["task-0"]];

  const planOutput = {
    name: plan.name ?? "未命名计划",
    totalTasks: plan.tasks?.length ?? 1,
    layers: showTopo ? layers : undefined,
    parallelGroups: showParallel ? layers.length : undefined,
    estimatedDuration: `${(plan.tasks?.length ?? 1) * 5}s`,
  };

  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), JSON.stringify(planOutput, null, 2), "utf-8");
    return {
      success: true,
      output: `✓ 计划已生成: ${outputPath}`,
      data: planOutput,
      exitCode: 0,
    };
  }

  return {
    success: true,
    data: planOutput,
    output: [
      `📋 调度计划: ${planOutput.name}`,
      `   任务数: ${planOutput.totalTasks}`,
      showTopo ? `   拓扑层级: ${layers.length}` : "",
      showParallel ? `   并行组: ${planOutput.parallelGroups}` : "",
      `   预估耗时: ${planOutput.estimatedDuration}`,
    ].filter(Boolean).join("\n"),
    exitCode: 0,
  };
}

async function handleScheduleRun(
  bridge: EngineBridge,
  planPath: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
  if (!planPath) {
    return { success: false, error: "请指定计划文件。用法: cortex schedule run <plan>", exitCode: 1 };
  }

  await bridge.ensureInitialized();
  const board = await bridge.getTaskBoard();
  const scheduler = await bridge.getScheduler();

  try {
    const content = fs.readFileSync(path.resolve(planPath), "utf-8");
    const plan = JSON.parse(content);

    if (plan.tasks) {
      for (let i = 0; i < plan.tasks.length; i++) {
        const t = plan.tasks[i];
        board.addNode({
          id: t.id ?? `sched-${Date.now()}-${i}`,
          type: t.type ?? "analysis",
          tags: t.tags ?? ["analysis"],
          needsMultiPerspective: false,
          status: "pending",
          claimedBy: [],
          payload: t.payload ?? "",
          results: [],
          createdAt: Date.now(),
        });
      }
    }

    const report = await scheduler.executeAll();
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

async function handleScheduleStatus(
  bridge: EngineBridge,
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
  await bridge.ensureInitialized();
  const board = await bridge.getTaskBoard();

  if (!board) {
    return {
      success: true,
      output: "调度系统: 未初始化",
      exitCode: 0,
    };
  }

  const allNodes = board.getAllNodes();
  const pendingNodes = board.getPendingNodes();

  const status = {
    taskBoard: {
      total: allNodes.length,
      pending: pendingNodes.length,
      active: allNodes.filter((n: any) => n.status === "claimed" || n.status === "running").length,
      done: allNodes.filter((n: any) => n.status === "done").length,
      failed: allNodes.filter((n: any) => n.status === "failed").length,
    },
  };

  if (pendingNodes.length === 0) {
    return {
      success: true,
      data: status,
      output: "调度系统: 空闲（无待处理任务）",
      exitCode: 0,
    };
  }

  return {
    success: true,
    data: status,
    output: [
      `调度系统状态:`,
      `  任务板: ${status.taskBoard.total} 总任务`,
      `    ${status.taskBoard.pending} 待处理`,
      `    ${status.taskBoard.active} 执行中`,
      `    ${status.taskBoard.done} 已完成`,
      `    ${status.taskBoard.failed} 失败`,
    ].join("\n"),
    exitCode: 0,
  };
}
