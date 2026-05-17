/**
 * commands/task.ts — `cortex task` 任务管理命令
 *
 * 任务的生命周期管理——提交、查询、取消、重跑。
 * 对接 TaskBoard + Scheduler API。
 *
 * @see CLI 设计文档 §4.2
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import type { EngineBridge } from "../services/engine-bridge.js";
import * as fs from "node:fs";
import * as path from "node:path";

export function createTaskHandler(bridge: EngineBridge): CommandHandler {
  return async (args, options, context): Promise<CommandResult> => {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      return {
        success: true,
        output: [
          "用法: cortex task <子命令> [选项]",
          "",
          "子命令:",
          "  submit <file>        提交任务文件",
          "  list                 列出任务队列",
          "  status <id>          查询任务状态",
          "  cancel <id>          取消任务",
          "  redo <id>            重新执行失败任务",
          "",
          "选项:",
          "  --priority <p>       优先级 (P0/P1/P2/P3)",
          "  --agent <type>       指定 Agent 类型",
          "  --label <tag>        添加标签（可多次）",
          "  --wait, -w           阻塞等待完成",
          "  --timeout <s>        超时秒数（默认 300）",
          "  --status <s>         按状态过滤",
          "  --limit <n>          最大返回数（默认 20）",
          "  --force, -f          强制取消",
          "  --strategy <s>       重试策略",
        ].join("\n"),
        exitCode: 0,
      };
    }

    const subcommand = args[0];

    try {
      await bridge.ensureInitialized();
      const board = await bridge.getTaskBoard();
      const scheduler = await bridge.getScheduler();

      switch (subcommand) {
        case "submit":
          return await handleTaskSubmit(board, scheduler, args[1], options, context);
        case "list":
          return await handleTaskList(board, options, context);
        case "status":
          return await handleTaskStatus(board, args[1], options, context);
        case "cancel":
          return await handleTaskCancel(board, args[1], options, context);
        case "redo":
          return await handleTaskRedo(board, scheduler, args[1], options, context);
        default:
          return {
            success: false,
            error: `未知子命令: "${subcommand}"。可用子命令: submit, list, status, cancel, redo`,
            exitCode: 1,
          };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `任务操作失败: ${msg}`, exitCode: 2 };
    }
  };
}

async function handleTaskSubmit(
  board: any,
  scheduler: any,
  filePath: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
  if (!filePath) {
    return { success: false, error: "请指定任务文件。用法: cortex task submit <file>", exitCode: 1 };
  }

  let content: string;
  try {
    content = fs.readFileSync(path.resolve(filePath), "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `读取文件失败: ${msg}`, exitCode: 1 };
  }

  const agentType = (options["agent"] ?? options["a"]) as string | undefined;
  const priority = (options["priority"] ?? "P2") as string;
  const label = options["label"] as string | undefined;
  const wait = options["wait"] || options["w"];
  const timeout = parseInt(String(options["timeout"] ?? "300"), 10);

  const taskNode: any = {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: agentType ?? "analysis",
    tags: (label ? [label] : agentType ? [agentType] : ["analysis"]),
    needsMultiPerspective: false,
    status: "pending",
    claimedBy: [],
    payload: content,
    results: [],
    createdAt: Date.now(),
  };

  board.addNode(taskNode);

  if (wait) {
    const report = await scheduler.executeAll();
    const taskResult = report.results.find((r: any) => r.nodeId === taskNode.id);
    return {
      success: report.completed > 0,
      output: taskResult?.output ?? `完成: ${report.completed}/${report.totalNodes}`,
      data: { taskId: taskNode.id, report },
      exitCode: report.completed > 0 ? 0 : 2,
    };
  }

  return {
    success: true,
    output: `✓ 任务已提交: ${taskNode.id}`,
    data: { taskId: taskNode.id, priority, agentType },
    exitCode: 0,
  };
}

async function handleTaskList(
  board: any,
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
  const statusFilter = options["status"] as string | undefined;
  const limit = parseInt(String(options["limit"] ?? "20"), 10);

  const allNodes = board.getAllNodes();
  let nodes = allNodes;

  if (statusFilter) {
    nodes = nodes.filter((n: any) => n.status === statusFilter);
  }

  nodes = nodes.slice(0, limit);

  const summaries = nodes.map((n: any) => ({
    id: n.id,
    type: n.type,
    status: n.status,
    createdAt: new Date(n.createdAt).toISOString(),
    results: n.results.length,
  }));

  return {
    success: true,
    data: { total: allNodes.length, filtered: nodes.length, tasks: summaries },
    output: `任务列表: ${nodes.length}/${allNodes.length} 个任务`,
    exitCode: 0,
  };
}

async function handleTaskStatus(
  board: any,
  taskId: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
  if (!taskId) {
    return { success: false, error: "请指定任务 ID。用法: cortex task status <id>", exitCode: 1 };
  }

  const node = board.getNode(taskId);
  if (!node) {
    return { success: false, error: `任务不存在: ${taskId}`, exitCode: 1 };
  }

  const verbose = options["verbose"] || options["v"];

  return {
    success: true,
    data: {
      id: node.id,
      type: node.type,
      status: node.status,
      tags: node.tags,
      claimedBy: node.claimedBy,
      results: node.results,
      createdAt: new Date(node.createdAt).toISOString(),
    },
    output: [
      `任务 ID:    ${node.id}`,
      `状态:       ${node.status}`,
      `类型:       ${node.type}`,
      `标签:       ${node.tags.join(", ")}`,
      `认领者:     ${node.claimedBy.join(", ") || "(无)"}`,
      `创建时间:   ${new Date(node.createdAt).toISOString()}`,
      ...(verbose ? [`结果数:     ${node.results.length}`] : []),
    ].join("\n"),
    exitCode: 0,
  };
}

async function handleTaskCancel(
  board: any,
  taskId: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
  if (!taskId) {
    return { success: false, error: "请指定任务 ID。用法: cortex task cancel <id>", exitCode: 1 };
  }

  const ok = board.failNode(taskId);
  if (!ok) {
    return { success: false, error: `取消失败: 任务 ${taskId} 不存在或已终态`, exitCode: 1 };
  }

  return {
    success: true,
    output: `✓ 任务已取消: ${taskId}`,
    data: { taskId },
    exitCode: 0,
  };
}

async function handleTaskRedo(
  board: any,
  scheduler: any,
  taskId: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
  if (!taskId) {
    return { success: false, error: "请指定任务 ID。用法: cortex task redo <id>", exitCode: 1 };
  }

  const node = board.getNode(taskId);
  if (!node) {
    return { success: false, error: `任务不存在: ${taskId}`, exitCode: 1 };
  }

  // 释放认领，使节点回到 pending 状态
  if (node.claimedBy.length > 0) {
    for (const agentType of node.claimedBy) {
      board.release(taskId, agentType);
    }
  }

  // 重新调度
  const report = await scheduler.executeAll();
  const redoResult = report.results.find((r: any) => r.nodeId === taskId);

  return {
    success: report.completed > 0,
    output: redoResult?.output ?? `重跑完成: ${report.completed}/${report.totalNodes}`,
    data: { taskId, report },
    exitCode: report.completed > 0 ? 0 : 2,
  };
}
