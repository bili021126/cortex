/**
 * commands/task.ts — `cortex task` 任务管理命令
 *
 * 任务的生命周期管理——提交、查询、取消、重跑。
 * 对接 TaskBoard + Scheduler API。
 *
 * @see CLI 设计文档 §4.2
 */

import type { CommandHandler, CommandResult } from "../types.js";
import { isHelpRequest } from "../utils.js";
import type { ICortexApi, TaskNode, Tag, ITaskBoard, IScheduler } from "@cortex/shared";
import * as fs from "node:fs";
import * as path from "node:path";

/** 任务操作服务依赖聚合 */
interface TaskServices {
  board: ITaskBoard;
  scheduler: IScheduler;
}

const TASK_HELP = [
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
].join("\n");

/** 读取任务文件内容 */
function _readTaskFile(filePath: string): string {
  return fs.readFileSync(path.resolve(filePath), "utf-8");
}

/** 构建 CLI 提交的 TaskNode */
function _createSubmittedTaskNode(content: string, agentType: string | undefined, label: string | undefined): TaskNode {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: agentType ?? "analysis",
    tags: (label ? [label] : agentType ? [agentType] : ["analysis"]) as Tag[],
    needsMultiPerspective: false,
    status: "pending",
    claimedBy: [],
    payload: content,
    results: [],
    createdAt: Date.now(),
  };
}

export function createTaskHandler(bridge: ICortexApi): CommandHandler {
  return async (args, options, _context): Promise<CommandResult> => {
    if (isHelpRequest(args)) {
      return { success: true, output: TASK_HELP, exitCode: 0 };
    }

    const subcommand = args[0];
    try {
      const board = await bridge.getTaskBoard();
      const scheduler = await bridge.getScheduler();
      const svc: TaskServices = { board, scheduler };

      switch (subcommand) {
        case "submit": return await handleTaskSubmit(svc, args[1], options);
        case "list":   return handleTaskList(board, options);
        case "status": return handleTaskStatus(board, args[1], options);
        case "cancel": return handleTaskCancel(board, args[1]);
        case "redo":   return await handleTaskRedo(svc, args[1]);
        default:
          return { success: false, error: `未知子命令: "${subcommand}"。可用子命令: submit, list, status, cancel, redo`, exitCode: 1 };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `任务操作失败: ${msg}`, exitCode: 2 };
    }
  };
}

/** 等待模式：立即执行并返回结果 */
async function _handleWaitExecution(svc: TaskServices, taskNode: TaskNode): Promise<CommandResult> {
  const report = await svc.scheduler.executeAll();
  const taskResult = report.results.find((r: { nodeId: string }) => r.nodeId === taskNode.id);
  return {
    success: report.completed > 0,
    output: taskResult?.output ?? `完成: ${report.completed}/${report.totalNodes}`,
    data: { taskId: taskNode.id, report },
    exitCode: report.completed > 0 ? 0 : 2,
  };
}

async function handleTaskSubmit(
  svc: TaskServices,
  filePath: string | undefined,
  options: Record<string, unknown>,
): Promise<CommandResult> {
  if (!filePath) {
    return { success: false, error: "请指定任务文件。用法: cortex task submit <file>", exitCode: 1 };
  }

  let content: string;
  try { content = _readTaskFile(filePath); }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `读取文件失败: ${msg}`, exitCode: 1 };
  }

  const agentType = (options["agent"] ?? options["a"]) as string | undefined;
  const priority = (options["priority"] ?? "P2") as string;
  const label = options["label"] as string | undefined;

  const taskNode = _createSubmittedTaskNode(content, agentType, label);
  svc.board.addNode(taskNode);

  if (options["wait"] || options["w"]) return await _handleWaitExecution(svc, taskNode);

  return {
    success: true,
    output: `✓ 任务已提交: ${taskNode.id}`,
    data: { taskId: taskNode.id, priority, agentType },
    exitCode: 0,
  };
}

function handleTaskList(
  board: ITaskBoard,
  options: Record<string, unknown>,
): CommandResult {
  const statusFilter = options["status"] as string | undefined;
  const limit = parseInt(String(options["limit"] ?? "20"), 10);

  const allNodes = board.getAllNodes();
  let nodes = allNodes;
  if (statusFilter) nodes = nodes.filter((n: TaskNode) => n.status === statusFilter);
  nodes = nodes.slice(0, limit);

  const summaries = nodes.map((n: TaskNode) => ({
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

/** 格式化任务状态输出字符串 */
function _formatTaskStatus(node: TaskNode, verbose: boolean): string {
  return [
    `任务 ID:    ${node.id}`,
    `状态:       ${node.status}`,
    `类型:       ${node.type}`,
    `标签:       ${node.tags.join(", ")}`,
    `认领者:     ${node.claimedBy.join(", ") || "(无)"}`,
    `创建时间:   ${new Date(node.createdAt).toISOString()}`,
    ...(verbose ? [`结果数:     ${node.results.length}`] : []),
  ].join("\n");
}

function handleTaskStatus(
  board: ITaskBoard,
  taskId: string | undefined,
  options: Record<string, unknown>,
): CommandResult {
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
      id: node.id, type: node.type, status: node.status,
      tags: node.tags, claimedBy: node.claimedBy, results: node.results,
      createdAt: new Date(node.createdAt).toISOString(),
    },
    output: _formatTaskStatus(node, !!verbose),
    exitCode: 0,
  };
}

function handleTaskCancel(
  board: ITaskBoard,
  taskId: string | undefined,
): CommandResult {
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
  svc: TaskServices,
  taskId: string | undefined,
): Promise<CommandResult> {
  if (!taskId) {
    return { success: false, error: "请指定任务 ID。用法: cortex task redo <id>", exitCode: 1 };
  }

  const node = svc.board.getNode(taskId);
  if (!node) {
    return { success: false, error: `任务不存在: ${taskId}`, exitCode: 1 };
  }

  // 释放认领，使节点回到 pending 状态
  for (const agentType of node.claimedBy) {
    svc.board.release(taskId, agentType);
  }

  const report = await svc.scheduler.executeAll();
  const redoResult = report.results.find((r: { nodeId: string }) => r.nodeId === taskId);

  return {
    success: report.completed > 0,
    output: redoResult?.output ?? `重跑完成: ${report.completed}/${report.totalNodes}`,
    data: { taskId, report },
    exitCode: report.completed > 0 ? 0 : 2,
  };
}
