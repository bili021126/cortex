/**
 * @cortex/server — Scheduler / Node action handlers
 *
 * R14：CLI 降格 daemon 动作路由——调度器快照、任务节点提交、全量执行。
 * 与 state/nodes 只读路由互补：前者观状态，此三者驱动状态。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { EngineHost } from "../engine-host.js";
import type { ExecutionReport, TaskNode } from "@cortex/shared";
import { readBody, sendJson, sendProblem } from "./router.js";

/** 调度器快照——由任务板节点状态聚合（IScheduler 自身无统计面） */
export interface SchedulerSnapshot {
  pending: number;
  active: number;
  completed: number;
  failed: number;
  total: number;
}

function snapshotOf(nodes: TaskNode[]): SchedulerSnapshot {
  const snapshot: SchedulerSnapshot = { pending: 0, active: 0, completed: 0, failed: 0, total: nodes.length };
  for (const node of nodes) {
    switch (node.status) {
      case "pending": snapshot.pending += 1; break;
      case "claimed":
      case "running": snapshot.active += 1; break;
      case "done": snapshot.completed += 1; break;
      case "failed": snapshot.failed += 1; break;
      default: break;
    }
  }
  return snapshot;
}

/** GET /api/v1/scheduler——调度器统计快照 */
export function handleSchedulerGet(res: ServerResponse, engine: EngineHost): void {
  try {
    const nodes = engine.board.getAllNodes();
    sendJson(res, 200, { data: snapshotOf(nodes) });
  } catch (err) {
    sendProblem(res, 500, "Scheduler Error", err instanceof Error ? err.message : String(err));
  }
}

/** POST /api/v1/nodes——向任务板提交任务节点（TaskNode 全量 JSON） */
export async function handleNodePost(req: IncomingMessage, res: ServerResponse, engine: EngineHost): Promise<void> {
  const raw = await readBody(req);
  let node: TaskNode;
  try {
    node = JSON.parse(raw) as TaskNode;
  } catch {
    sendProblem(res, 422, "Validation Error", "请求体必须为 JSON");
    return;
  }
  if (!node || typeof node.id !== "string" || node.id === "") {
    sendProblem(res, 422, "Validation Error", "node.id 必填且为非空字符串");
    return;
  }
  engine.board.addNode(node);
  sendJson(res, 201, { data: { id: node.id } });
}

/** POST /api/v1/scheduler/execute——全量执行调度（executeAll） */
export async function handleSchedulerExecute(res: ServerResponse, engine: EngineHost): Promise<void> {
  try {
    const report: ExecutionReport = await engine.scheduler.executeAll();
    sendJson(res, 200, { data: report });
  } catch (err) {
    sendProblem(res, 500, "Scheduler Error", err instanceof Error ? err.message : String(err));
  }
}
