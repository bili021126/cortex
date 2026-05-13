import type { AgentStatus, ObservableEvent, SafeErrorReporter } from "@cortex/shared";
import { AgentType as AT, AgentStatus as AS, PipelinePriority } from "@cortex/shared";
import type { PipelineObserver } from "../pipeline-observer.js";
import type { PlatformBridge } from "@cortex/shared";
import type { AgentPool } from "../agent-pool.js";
import { PoolAwareState } from "../pool-aware.js";

/**
 * ButlerAgent（托马）—— 神里家管，唯一用户交互出口。
 *
 * 职责：
 * 1. 常驻 Awake，拦截 PipelineObserver 事件，格式化后经 PlatformBridge 通知用户
 * 2. ConfirmGate L2/L3 请求的二次确认
 * 3. MetaAgent 规划结果展示
 * 4. 故障报告直通用户（非阻塞）
 * 5. 用户状态感知（foreground/idle）→ 决定通知风格
 *
 * v2.1 消费端增强：订阅 NORMAL 级别事件，确保内存/调度事件不被丢弃。
 */
export class ButlerAgent {
  readonly type = AT.Butler;

  private readonly _state = new PoolAwareState(() => this.type);
  private _safeReporter: SafeErrorReporter | null = null;
  private bridge?: PlatformBridge;

  get status(): AgentStatus {
    return this._state.status;
  }

  constructor(
    private readonly observer: PipelineObserver,
    bridge?: PlatformBridge,
  ) {
    this.bridge = bridge;
  }

  setPool(pool: AgentPool, instanceId: string): void {
    this._state.setPool(pool, instanceId);
  }

  setSafeReporter(reporter: SafeErrorReporter): void {
    this._safeReporter = reporter;
    this._state.setSafeReporter(reporter);
  }

  async wakeup(): Promise<void> {
    this.observer.on(PipelinePriority.CRITICAL, this._onCritical.bind(this));
    this.observer.on(PipelinePriority.HIGH, this._onHigh.bind(this));
    // v2.1: NORMAL 订阅——信息事件不再丢失
    this.observer.on(PipelinePriority.NORMAL, this._onNormal.bind(this));
    this._state.transition(AS.Awake);
  }

  async execute(): Promise<{ nodeId: string; success: boolean; output?: string }> {
    return { nodeId: "butler-noop", success: true, output: "ButlerAgent does not execute tasks" };
  }

  async shutdown(): Promise<void> {
    this.observer.off(PipelinePriority.CRITICAL);
    this.observer.off(PipelinePriority.HIGH);
    this.observer.off(PipelinePriority.NORMAL);
    this._state.transition(AS.Draining);
    this._state.transition(AS.Destroyed);
  }

  setBridge(bridge: PlatformBridge): void {
    this.bridge = bridge;
  }

  // ── 事件处理 ────────────────────────────────────

  private _onCritical(event: ObservableEvent): void {
    if (event.notificationType !== undefined) {
      this._dispatchByType(event);
    } else {
      this._onLegacy(event);
    }
  }

  private _onHigh(event: ObservableEvent): void {
    if (event.notificationType !== undefined) {
      this._dispatchByType(event);
    } else {
      this._onLegacy(event);
    }
  }

  /** v2.1: NORMAL 事件处理——信息归档 */
  private _onNormal(event: ObservableEvent): void {
    const ctx = this.bridge?.getPlatformContext();
    if (ctx && !ctx.foreground) return;
    const msg = this._formatLifecycle(event);
    this._output(msg, "Butler-INFO");
  }

  private _dispatchByType(event: ObservableEvent): void {
    switch (event.notificationType) {
      case "DECISION_REQUIRED":
        this._onDecision(event);
        return;
      case "WARNING":
        this._onWarning(event);
        return;
      case "FYI":
        this._onFyi(event);
        return;
      default:
        this._onLegacy(event);
    }
  }

  private _onFyi(event: ObservableEvent): void {
    const ctx = this.bridge?.getPlatformContext();
    if (ctx && !ctx.foreground) return;
    const msg = this._formatLifecycle(event);
    this._output(msg, "Butler");
  }

  private _onWarning(event: ObservableEvent): void {
    const ctx = this.bridge?.getPlatformContext();
    if (ctx && !ctx.foreground) return;
    const msg = this._formatCritical(event);
    this._output(msg, "Butler-CRITICAL");
  }

  private _onDecision(event: ObservableEvent): void {
    const msg = this._formatCritical(event);
    this._output(`[需决策] ${msg}`, "Butler-DECISION");
  }

  private _onLegacy(event: ObservableEvent): void {
    if (event.priority === PipelinePriority.CRITICAL) {
      const msg = this._formatCritical(event);
      this._output(msg, "Butler-CRITICAL");
    } else {
      const ctx = this.bridge?.getPlatformContext();
      if (ctx && !ctx.foreground) return;
      const msg = this._formatLifecycle(event);
      this._output(msg, "Butler");
    }
  }

  private _output(msg: string, tag: string): void {
    if (this.bridge) {
      this.bridge.notify(msg);
    } else {
      console.log(`[${tag}] ${msg}`);
    }
  }

  private _formatCritical(event: ObservableEvent): string {
    const p = event.payload as Record<string, unknown>;
    switch (event.type) {
      case "node.failed":
        return `⚠️ 节点 ${p.nodeId} 执行失败: ${p.error ?? "unknown"}`;
      case "node.replan":
        return `🔄 节点 ${p.nodeId} 正在进行第 ${p.attempt} 次重规划: ${p.reason}`;
      case "scheduler.done":
        return `✅ 管线完成: ${p.completed}/${p.total} 成功, ${p.failed} 失败, 耗时 ${p.durationMs}ms`;
      default:
        return `[CRITICAL] ${event.type}: ${JSON.stringify(p)}`;
    }
  }

  private _formatLifecycle(event: ObservableEvent): string {
    const p = event.payload as Record<string, unknown>;
    switch (event.type) {
      case "node.start":
        return `▶️ 开始执行节点 ${p.nodeId} (${p.type})`;
      case "node.complete":
        return `✅ 节点 ${p.nodeId} 完成 (${p.agentType ?? "?"}, ${p.success ? "成功" : "失败"})`;
      case "scheduler.layer.start":
        return `📊 第 ${p.layer} 层开始 (${p.nodes} 个节点)`;
      default:
        return `[NORMAL] ${event.type}: ${JSON.stringify(p)}`;
    }
  }
}
