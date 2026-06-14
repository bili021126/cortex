/**
 * tui/modes/plan-mode.ts — Plan 模式
 *
 * 甘雨三审流整合：用户输入意图 → 甘雨 plan() → 任务树渲染完整计划
 * → .review 三省审议（凝光+钟离+霜凝）→ .approve 执行（实时 task-tree 更新）
 *
 * @module tui/modes/plan-mode
 * @since v3 — CLI TUI 全栈重构
 */

import type { AgentType, LlmMessage, ICortexApi, TaskNode, ExecutionReport } from "@cortex/shared";
import type { TuiEvent, TuiHooks, LlmStreamBridge } from "../types.js";
import { queryLoop } from "../query-loop.js";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

/** Plan 模式状态持久化文件路径 */
const PLAN_STATE_FILE = ".cortex/plan-state.json";

/**
 * 从项目根目录加载持久化的 Plan 状态。
 * @returns 已持久化的 PlanModeState，或 null（文件不存在/损坏/过期）
 */
export function loadPlanState(projectRoot: string): PlanModeState | null {
  try {
    const filePath = nodePath.join(projectRoot, PLAN_STATE_FILE);
    if (!nodeFs.existsSync(filePath)) return null;
    const raw = nodeFs.readFileSync(filePath, "utf-8");
    const state = JSON.parse(raw) as PlanModeState;
    // 基本合法性校验：至少得有 nodes 数组和 intent
    if (!state || !Array.isArray(state.nodes) || typeof state.intent !== "string") {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

/**
 * 将 PlanModeState 持久化到项目根目录。
 */
export function savePlanState(projectRoot: string, state: PlanModeState): void {
  try {
    const cortexDir = nodePath.join(projectRoot, ".cortex");
    if (!nodeFs.existsSync(cortexDir)) {
      nodeFs.mkdirSync(cortexDir, { recursive: true });
    }
    const filePath = nodePath.join(projectRoot, PLAN_STATE_FILE);
    nodeFs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  } catch {
    // 持久化失败不应阻塞用户操作
  }
}

/**
 * 删除持久化的 Plan 状态文件（计划执行完成或用户退出时调用）。
 */
export function clearPlanState(projectRoot: string): void {
  try {
    const filePath = nodePath.join(projectRoot, PLAN_STATE_FILE);
    if (nodeFs.existsSync(filePath)) {
      nodeFs.unlinkSync(filePath);
    }
  } catch {
    // 静默失败
  }
}

/** Plan 模式扩展桥接——增加 executeWithStream 用于计划执行 */
interface PlanModeBridge extends LlmStreamBridge, Pick<ICortexApi, "chat" | "submitTask" | "executeAll"> {
  executeWithStream(nodes: TaskNode[], onEvent: (event: TuiEvent) => void): Promise<ExecutionReport>;
}

/**
 * Plan 模式上下文——甘雨计划阶段的状态管理。
 */
export interface PlanModeState {
  /** 计划节点列表 */
  nodes: TaskNode[];
  /** 用户原始意图 */
  intent: string;
  /** 计划是否已批准 */
  approved: boolean;
  /** 审议状态 */
  reviewStatus: "pending" | "reviewing" | "reviewed";
}

/**
 * Plan 模式执行器。
 *
 * 甘雨三审流：
 * - 用户输入意图 → 甘雨拆解计划
 * - .review → 三省审议
 * - .approve → 执行计划
 */
export async function* planMode(
  input: string,
  bridge: PlanModeBridge,
  agent: AgentType,
  planState: PlanModeState,
  history?: LlmMessage[],
): AsyncGenerator<TuiEvent, string, void> {
  const hooks: TuiHooks = {
    onPreToolUse: async (_event) => {
      // Plan 模式：生成计划节点后发射 task_tree_update
      return "allow";
    },
    onNodeComplete: (_event) => {
      // 节点完成后更新计划状态
    },
    onNodeFailed: (_event) => {
      // 节点失败记录
    },
  };

  // 如果已有批准的计划，执行
  if (planState.approved && planState.nodes.length > 0) {
    // 收集执行事件——executeWithStream 通过回调推送，planMode 是 async generator
    // 需桥接：先收集全部事件，再逐条 yield
    const collectedEvents: TuiEvent[] = [];
    const report = await bridge.executeWithStream(planState.nodes, (event) => {
      collectedEvents.push(event);
    });

    // 逐条发射收集的事件
    for (const event of collectedEvents) {
      yield event;
    }

    if (report.failed > 0) {
      return `计划执行完成：${report.completed}/${report.totalNodes} 成功，${report.failed} 失败`;
    }
    return "计划执行完成";
  }

  // 否则：生成计划
  return yield* queryLoop({ input, bridge, mode: "plan", agent, hooks, history });
}
