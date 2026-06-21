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
import type { TuiEvent, LlmStreamBridge } from "../types.js";
/**
 * 从项目根目录加载持久化的 Plan 状态。
 * @returns 已持久化的 PlanModeState，或 null（文件不存在/损坏/过期）
 */
export declare function loadPlanState(projectRoot: string): PlanModeState | null;
/**
 * 将 PlanModeState 持久化到项目根目录。
 */
export declare function savePlanState(projectRoot: string, state: PlanModeState): void;
/**
 * 删除持久化的 Plan 状态文件（计划执行完成或用户退出时调用）。
 */
export declare function clearPlanState(projectRoot: string): void;
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
export declare function planMode(input: string, bridge: PlanModeBridge, agent: AgentType, planState: PlanModeState, history?: LlmMessage[]): AsyncGenerator<TuiEvent, string, void>;
export {};
//# sourceMappingURL=plan-mode.d.ts.map