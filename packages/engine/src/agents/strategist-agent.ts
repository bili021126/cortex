import { AgentType as AT, AgentStatus as AS, PipelineEventType, type AgentType, type AgentStatus, type TaskNode, type NodeResult, type SafeErrorReporter, type ObservableEvent } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { AgentPool } from "@cortex/scheduler";
import { PoolAwareState } from "../execution/pool-aware.js";

/**
 * StrategistAgent（钟离）—— 岩王帝君，战略 MetaAgent。
 *
 * ⚠️ Core-2+ 未来阶段预留——Core-1 不导出、不注册、不参与调度。
 *    当前仅源码预埋，合约就绪但阶段未到。
 *
 * 与甘雨（MetaAgent）的分工：
 * - 甘雨：战术规划——"这个需求拆成几个任务、怎么排顺序"
 * - 钟离：战略把关——"这个方向对不对、架构契约有没有破坏、长期会出什么问题"
 *
 * 职责：
 * 1. 战略分析：评估长期架构方向的合理性
 * 2. 契约守护：对照宪法/设计契约判断某项变更是否合规
 * 3. 阶段跃迁判定：判断 Core-1→Core-2 等阶段跃迁条件是否满足
 * 4. 圆桌参与：在审议圆桌中以千年视角提供战略判断
 *
 * 不参与 Scheduler 任务派发（与 MetaAgent 同）。仅通过显式调用和 Roundtable 激活。
 *
 * 激活时机：Core-2 启动后，阶段跃迁判定场景首次触发时激活。
 *
 * @fix D1 — 治理判例 NG-2026-0511-CopyPaste-StateMachine：
 *   使用 PoolAwareState 共享组件替代内部状态管理，消除与 PoolAwareState 的代码重复。
 */
export class StrategistAgent {
  readonly type: AgentType = AT.Strategist;
  readonly systemPrompt: string;

  // 方案B：状态所有权归一，委托给 PoolAwareState 共享组件
  // 使用 `() => this.type` 延迟求值，避免初始化顺序问题
  private readonly _state = new PoolAwareState(() => this.type);

  /** 方案B：status 只读 getter —— 委托到 PoolAwareState */
  get status(): AgentStatus {
    return this._state.status;
  }

  /** SafeErrorReporter —— 统一错误上报，杜绝静默吞错 */
  private _safeReporter: SafeErrorReporter | null = null;

  constructor(private readonly llm: LlmAdapter, systemPrompt?: string) {
    this.systemPrompt = systemPrompt ?? '';
  }

  /** 注入 AgentPool 引用（方案B：状态所有权归一） */
  setPool(pool: AgentPool, instanceId: string): void {
    this._state.setPool(pool, instanceId);
  }

  /** 注入 SafeErrorReporter（由 bootstrap 在上层统一注入）。双路径：自身 + PoolAwareState */
  setSafeReporter(reporter: SafeErrorReporter): void {
    this._safeReporter = reporter;
    this._state.setSafeReporter(reporter);
  }

  /** 方案B：内部状态变更——委托到 PoolAwareState.transition() */
  private _setStatus(status: AgentStatus): void {
    this._state.transition(status);
  }

  async wakeup(): Promise<void> {
    this._setStatus(AS.Awake);
  }

  /**
   * 治理事件处理——仅 ConstitutionViolation 级别事件。
   * 不阻塞执行，纯分析产出。
   */
  onGovernanceEvent(event: ObservableEvent): void {
    if (event.type !== PipelineEventType.ConstitutionViolation) return;
    const ts = new Date(event.timestamp ?? Date.now()).toISOString();
    process.stderr.write(`[Strategist] ${ts} 宪法违规: ${JSON.stringify(event.payload).slice(0, 500)}\n`);
  }

  /**
   * 执行战略分析任务。
   * 钟离不参与 Scheduler 的常规任务派发——此方法由上层显式调用
   * （如战略分析场景、阶段跃迁判定）。
   */
  async execute(node: TaskNode, model: string): Promise<NodeResult> {
    this._setStatus(AS.Active);
    try {
      const messages = [
        { role: "system" as const, content: this.systemPrompt },
        { role: "user" as const, content: node.payload },
      ];

      const res = await this.llm.chat(model, messages, undefined, node.reasoningEffort);
      const output = res.content ?? undefined;

      return {
        nodeId: node.id,
        agentType: this.type,
        success: output !== undefined,
        output,
        error: output === undefined ? "无产出" : undefined,
      };
    } catch (e) {
      if (this._safeReporter) {
        this._safeReporter({
          source: "StrategistAgent.execute",
          error: e,
          severity: "degraded",
          hint: `节点 ${node.id} 战略分析失败`,
        });
      }
      return {
        nodeId: node.id,
        agentType: this.type,
        success: false,
        error: String(e),
      };
    } finally {
      if (this.status === AS.Active) this._setStatus(AS.Awake);
    }
  }

  async shutdown(): Promise<void> {
    this._setStatus(AS.Draining);
    this._setStatus(AS.Destroyed);
  }
}
