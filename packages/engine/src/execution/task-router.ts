// ============================================================
// @cortex/engine/execution/task-router —— 任务路由器
//
// @layer 规划-执行层
// @role 事轴路由——统一策略+模型选择，三层优先级
//
// 职责：
//   统一路由决策——同时决定循环策略 (strategy) 和模型 (model)。
//   将分散在 agent-factory (策略选择) 和 scheduler (模型选择) 的路由逻辑收敛。
//
// 设计原则：
//   1. 路由是一次决策：strategy + model 同时确定，避免两处独立选择导致不一致
//   2. 零成本优先：优先使用 MetaAgent 已设定的 preferredStrategy/recommendedTier
//   3. 规则兜底：无 LLM 标注时，用规则匹配（LoopStrategyRegistry + 启发式）
//   4. 可观测性：每次路由产出 RouteDecision，供遥测/调试/成本分析
// ============================================================

import type { TaskNode } from "@cortex/shared";
import type { IModelRouter } from "@cortex/scheduler";
import { loopStrategyRegistry } from "../core/loop-strategy-registry.js";

/**
 * 路由决策——TaskRouter.route() 的产出，统一描述策略+模型选择。
 */
export interface RouteDecision {
  /** 节点 ID */
  nodeId: string;
  /** 选中的循环策略 */
  strategy: "react" | "direct" | "decompose" | "jury";
  /** 策略选择来源 */
  strategySource: "meta-agent" | "rule-routing" | "fallback";
  /** 选中的模型 */
  model: string;
  /** 模型选择来源 */
  modelSource: "recommended" | "classifier" | "fallback";
  /** 路由耗时 (ms) */
  durationMs: number;
}

/**
 * 任务路由器——统一策略选择和模型选择。
 *
 * 现状问题：
 *   - 策略选择在 agent-factory (LoopStrategyRegistry.selectByRule)
 *   - 模型选择在 scheduler (IModelRouter.route)
 *   - 两处独立决策，无法联合优化
 *
 * 目标：
 *   将路由收敛为一次决策：strategy + model 同时确定。
 *   为将来的联合优化（如 "direct 策略总是用 fast 模型"）留出空间。
 */
export class TaskRouter {
  constructor(
    private readonly modelRouter: IModelRouter,
    private readonly defaultModel: string,
  ) {}

  /**
   * 路由决策——为给定节点选择策略和模型。
   *
   * 优先级：
   *   1. MetaAgent 已标注 → 直接用 (preferredStrategy + recommendedTier)
   *   2. 规则路由 → LoopStrategyRegistry.selectByRule() + modelRouter.route()
   *   3. Fallback → "react" + defaultModel
   *
   * @param node 任务节点
   * @param agentType Agent 类型
   * @returns 路由决策（strategy + model + 来源标注）
   */
  async route(node: TaskNode, agentType: string): Promise<RouteDecision> {
    const start = Date.now();

    // ── 策略选择 ──
    let strategy: "react" | "direct" | "decompose" | "jury";
    let strategySource: "meta-agent" | "rule-routing" | "fallback";

    if (node.preferredStrategy) {
      strategy = node.preferredStrategy;
      strategySource = "meta-agent";
    } else {
      const matched = loopStrategyRegistry.selectByRule(node);
      if (matched) {
        strategy = matched.name;
        strategySource = "rule-routing";
      } else {
        strategy = "react";
        strategySource = "fallback";
      }
    }

    // ── 模型选择 ──
    const model = await this.modelRouter.route(node, agentType, this.defaultModel);
    const modelSource = node.recommendedTier
      ? "recommended"
      : (model === this.defaultModel ? "fallback" : "classifier");

    return {
      nodeId: node.id,
      strategy,
      strategySource,
      model,
      modelSource,
      durationMs: Date.now() - start,
    };
  }

  /**
   * 批量路由——为多个节点预计算路由决策。
   * 用于拓扑排序后的并行分发场景。
   */
  async routeBatch(nodes: TaskNode[], agentType: string): Promise<Map<string, RouteDecision>> {
    const decisions = new Map<string, RouteDecision>();
    await Promise.all(
      nodes.map(async (node) => {
        const decision = await this.route(node, agentType);
        decisions.set(node.id, decision);
      }),
    );
    return decisions;
  }
}
