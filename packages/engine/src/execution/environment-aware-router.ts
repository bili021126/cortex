// ============================================================
// @cortex/engine/execution/environment-aware-router —— 环境感知路由器
//
// @layer 规划-执行层
// @role 事轴保护——环境感知模型降级，健康检查+连续失败熔断
//
// 职责：
//   根据运行时环境状态（模型可用性、配额、延迟、成本）动态调整路由决策。
//   作为 TaskRouter 的增强层——TaskRouter 负责语义路由，本模块负责环境约束。
//
// 设计原则：
//   1. 环境约束优先于语义偏好——模型不可用时，语义再匹配也得换
//   2. 降级而非失败——首选模型挂了自动降级到备用模型
//   3. 可观测性——每次环境决策都有日志和遥测
//   4. 配置驱动——模型优先级列表、降级策略、健康检查阈值均可配置
// ============================================================

import type { TaskNode } from "@cortex/shared";
import { recordTelemetry } from "@cortex/telemetry";

/**
 * 模型健康状态——运行时动态维护。
 */
export interface ModelHealth {
  /** 模型标识符 */
  model: string;
  /** 是否可用 */
  available: boolean;
  /** 最近一次失败时间戳 (ms) */
  lastFailureAt?: number;
  /** 连续失败次数 */
  consecutiveFailures: number;
  /** 平均延迟 (ms) */
  avgLatencyMs?: number;
}

/**
 * 环境感知路由配置。
 */
export interface EnvironmentRouterOptions {
  /** 模型优先级列表——按优先级降序排列，首个可用模型被选中 */
  modelPriority: string[];
  /** 降级策略——当首选模型不可用时的回退行为 */
  fallbackStrategy: "next-in-priority" | "cheapest" | "fastest";
  /** 健康检查冷却时间 (ms)——失败后多久重试，默认 60000 (1分钟) */
  healthCheckCooldownMs?: number;
  /** 连续失败阈值——超过此值标记为不可用，默认 3 */
  failureThreshold?: number;
  /** 最大延迟阈值 (ms)——超过此值视为不可用，默认 30000 */
  maxLatencyMs?: number;
}

/**
 * 环境感知路由器——根据运行时环境约束动态调整模型选择。
 *
 * 与 TaskRouter 的关系：
 *   - TaskRouter：基于任务语义选择策略+模型（"这个任务应该用什么"）
 *   - EnvironmentAwareRouter：基于环境约束调整模型（"现在能用什么"）
 *
 * 典型用法：
 *   ```typescript
 *   const envRouter = new EnvironmentAwareRouter({
 *     modelPriority: ["gpt-4o", "claude-3.5-sonnet", "gpt-4o-mini"],
 *     fallbackStrategy: "next-in-priority",
 *   });
 *
 *   // 包装 TaskRouter 的 route 方法
 *   const semanticDecision = await taskRouter.route(node, agentType);
 *   const finalModel = await envRouter.resolve(semanticDecision.model, node);
 *   ```
 */
export class EnvironmentAwareRouter {
  /** 模型健康状态表 */
  private readonly healthMap = new Map<string, ModelHealth>();

  /** 配置（含默认值） */
  private readonly config: Required<EnvironmentRouterOptions>;

  constructor(options: EnvironmentRouterOptions) {
    this.config = {
      healthCheckCooldownMs: 60_000,
      failureThreshold: 3,
      maxLatencyMs: 30_000,
      ...options,
    };

    // 初始化所有模型为可用状态
    for (const model of this.config.modelPriority) {
      this.healthMap.set(model, {
        model,
        available: true,
        consecutiveFailures: 0,
      });
    }
  }

  /**
   * 解析最终模型——根据环境约束调整语义路由的选择。
   *
   * 逻辑：
   *   1. 首选模型可用 → 直接返回
   *   2. 首选模型不可用 → 按 fallbackStrategy 选择备用模型
   *   3. 所有模型不可用 → 返回首选模型（强制重试，避免全链路失败）
   *
   * @param preferredModel 语义路由推荐的模型
   * @param node 任务节点（用于遥测标签）
   * @returns 最终选中的模型
   */
  async resolve(preferredModel: string, node: TaskNode): Promise<string> {
    const start = Date.now();

    // 1. 首选模型可用 → 直接返回
    if (this.isAvailable(preferredModel)) {
      this._emitTelemetry(node.id, preferredModel, preferredModel, "preferred-available", Date.now() - start);
      return preferredModel;
    }

    // 2. 首选不可用 → 按策略降级
    const fallback = this._selectFallback(preferredModel);
    const durationMs = Date.now() - start;

    if (fallback) {
      this._emitTelemetry(node.id, preferredModel, fallback, "fallback", durationMs);
      console.warn(`[EnvironmentAwareRouter] 模型 ${preferredModel} 不可用，降级到 ${fallback}`);
      return fallback;
    }

    // 3. 所有模型不可用 → 强制使用首选模型（记录遥测，触发告警）
    this._emitTelemetry(node.id, preferredModel, preferredModel, "all-unavailable", durationMs);
    console.error(`[EnvironmentAwareRouter] 所有模型不可用，强制使用 ${preferredModel}`);
    return preferredModel;
  }

  /**
   * 上报模型调用成功——更新健康状态。
   * @param model 模型标识符
   * @param latencyMs 本次调用延迟
   */
  reportSuccess(model: string, latencyMs: number): void {
    const health = this.healthMap.get(model);
    if (!health) return;

    health.available = true;
    health.consecutiveFailures = 0;
    health.lastFailureAt = undefined;
    health.avgLatencyMs = health.avgLatencyMs
      ? Math.round((health.avgLatencyMs + latencyMs) / 2)
      : latencyMs;
  }

  /**
   * 上报模型调用失败——更新健康状态，可能标记为不可用。
   * @param model 模型标识符
   */
  reportFailure(model: string): void {
    const health = this.healthMap.get(model);
    if (!health) return;

    health.consecutiveFailures++;
    health.lastFailureAt = Date.now();

    if (health.consecutiveFailures >= this.config.failureThreshold) {
      health.available = false;
      console.warn(
        `[EnvironmentAwareRouter] 模型 ${model} 连续失败 ${health.consecutiveFailures} 次，标记为不可用`,
      );
    }
  }

  /**
   * 获取所有模型健康状态——用于可观测性。
   */
  getHealthSnapshot(): ModelHealth[] {
    return [...this.healthMap.values()].map(h => ({ ...h }));
  }

  /**
   * 检查模型是否可用——考虑健康状态和冷却时间。
   */
  private isAvailable(model: string): boolean {
    const health = this.healthMap.get(model);
    if (!health) return true; // 未知模型视为可用（首次使用）

    if (!health.available) {
      // 检查冷却时间——超过冷却期则重试
      if (health.lastFailureAt) {
        const elapsed = Date.now() - health.lastFailureAt;
        if (elapsed >= this.config.healthCheckCooldownMs) {
          health.available = true;
          health.consecutiveFailures = 0;
          return true;
        }
      }
      return false;
    }

    // 检查延迟阈值
    if (health.avgLatencyMs && health.avgLatencyMs > this.config.maxLatencyMs) {
      return false;
    }

    return true;
  }

  /**
   * 选择降级模型——按 fallbackStrategy 从优先级列表中选取。
   */
  private _selectFallback(preferredModel: string): string | null {
    const priority = this.config.modelPriority;
    const preferredIdx = priority.indexOf(preferredModel);

    switch (this.config.fallbackStrategy) {
      case "next-in-priority": {
        // 从首选模型的下一个开始，找第一个可用的
        for (let i = preferredIdx + 1; i < priority.length; i++) {
          const model = priority[i];
          if (model && this.isAvailable(model)) return model;
        }
        // 如果首选不在列表中或后面没有可用，从头开始找
        for (let i = 0; i < preferredIdx; i++) {
          const model = priority[i];
          if (model && this.isAvailable(model)) return model;
        }
        return null;
      }

      case "cheapest":
      case "fastest": {
        // 简化实现：优先级列表本身已按成本/速度排序，直接用 next-in-priority
        // 未来可接入动态成本/延迟评估
        for (const model of priority) {
          if (model !== preferredModel && this.isAvailable(model)) return model;
        }
        return null;
      }
    }
  }

  /**
   * 发射遥测数据——记录路由决策。
   */
  private _emitTelemetry(
    nodeId: string,
    preferred: string,
    selected: string,
    reason: string,
    durationMs: number,
  ): void {
    void recordTelemetry("router.environment.decision", durationMs, [
      { key: "node", value: nodeId },
      { key: "preferred", value: preferred },
      { key: "selected", value: selected },
      { key: "reason", value: reason },
    ]).catch(err => process.stderr.write(`[router] environment telemetry failed: ${err instanceof Error ? err.message : String(err)}\n`));
  }
}
