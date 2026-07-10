/**
 * tui/modes/plan-mode.ts — Plan 模式
 *
 * 甘雨三审流整合：用户输入意图 → 甘雨 plan() → 任务树渲染完整计划
 * → .review 三省审议（凝光+钟离+霜凝）→ .approve 执行（实时 task-tree 更新）
 *
 * @module tui/modes/plan-mode
 * @since v3 — CLI TUI 全栈重构
 */

import type { AgentType, LlmMessage, ITuiEngineBridge, TaskNode } from "@cortex/shared";
import type { TuiEvent, TuiHooks } from "../types.js";
import { queryLoop } from "../query-loop.js";
import { formatPlanTree } from "./plan-utils.js";
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
  } catch (err) { console.warn('[DEGRADED:tui-plan]', String(err)); return null; }
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
  } catch (err) { console.warn('[DEGRADED:tui-plan]', String(err)) }
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
  } catch (err) { console.warn('[DEGRADED:tui-plan]', String(err)) }
}

/** Plan 模式桥接——ITuiEngineBridge 包含 executeWithStream */

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
  bridge: ITuiEngineBridge,
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
    // 过滤已完成/已失败的节点——启动恢复会话或 .approve 时不重演已完成节点
    const pendingNodes = planState.nodes.filter(n => n.status !== "done" && n.status !== "failed");
    if (pendingNodes.length === 0) {
      // 所有节点已完成，重置计划状态，允许新规划
      planState.approved = false;
      planState.nodes = [];
      planState.intent = "";
      // 持久化由外部 handleInternalCommand(.exit) 或 tui-repl.ts 的 dispatch 统一管理
      // 继续走到下面 "生成计划" 分支
    } else {

    // 同步更新 planState，让后续展示和持久化反映过滤后的节点
    planState.nodes = pendingNodes;

    // 收集执行事件——executeWithStream 通过回调推送，planMode 是 async generator
    // 需桥接：先收集全部事件，再逐条 yield
    const collectedEvents: TuiEvent[] = [];
    const report = await bridge.executeWithStream(pendingNodes, (event) => {
      collectedEvents.push(event as TuiEvent);
    });

    // 逐条发射收集的事件
    for (const event of collectedEvents) {
      yield event;
    }

    if (report.failed > 0) {
      return `计划执行完成：${report.completed}/${report.totalNodes} 成功，${report.failed} 失败`;
    }
    return "计划执行完成";
    } // else: pendingNodes.length > 0
  }

  // 否则：生成计划
  const planText = yield* queryLoop({ input, bridge, mode: "plan", agent, hooks, history });

  // —— 后处理：解析甘雨输出的 JSON → TaskNode[] ——
  const parsed = _extractPlanNodes(planText);
  if (parsed && parsed.length > 0) {
    planState.nodes = parsed;
    planState.intent = input;
    planState.reviewStatus = "reviewing";
    return "\n" + formatPlanTree(parsed) + "\n\n📋 请输入 .review 启动三省审议，或 .approve 直接执行";
  }

  // 解析失败——返回原始文本
  return planText;
}

/**
 * 从甘雨的规划文本中提取 TaskNode 数组。
 * 支持三种格式：
 *   1. 纯 JSON 数组：甘雨输出格式 `[{...}, {...}]`
 *   2. Markdown 代码块包裹的 JSON
 *   3. 文本中嵌入的 JSON 数组片段
 */
function _extractPlanNodes(text: string): TaskNode[] | null {
  // 尝试 1：整个文本就是 JSON 数组
  try {
    const direct = JSON.parse(text);
    if (Array.isArray(direct)) return _normalizeNodes(direct);
  } catch { /* 继续 */ }

  // 尝试 2：Markdown 代码块中的 JSON
  const codeBlock = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlock?.[1]) {
    try {
      const parsed = JSON.parse(codeBlock[1].trim());
      if (Array.isArray(parsed)) return _normalizeNodes(parsed);
    } catch (err) { console.warn('[DEGRADED:tui-plan]', String(err)) }
  }

  // 尝试 3：文本中嵌入的 JSON 数组
  const arrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return _normalizeNodes(parsed);
    } catch (err) { console.warn('[DEGRADED:tui-plan]', String(err)) }
  }

  return null;
}

/** 规范化原始 JSON 对象为 TaskNode（补全缺失字段） */
function _normalizeNodes(raw: unknown[]): TaskNode[] {
  return raw.map((item: unknown, i: number): TaskNode => {
    const node = item as Record<string, unknown>;
    return {
      id: (node.id as string) ?? `plan-node-${i}-${Date.now()}`,
      type: (node.type as string) ?? "implementation",
      tags: (node.tags as string[]) ?? [],
      needsMultiPerspective: (node.needsMultiPerspective as boolean) ?? false,
      status: "pending" as const,
      claimedBy: [],
      payload: (node.task ?? node.payload ?? node.description ?? "") as string,
      results: [],
      createdAt: Date.now(),
      parentId: (node.parentId as string | undefined) ?? undefined,
    };
  });
}
