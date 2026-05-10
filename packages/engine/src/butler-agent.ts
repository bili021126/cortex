import type { AgentType, AgentStatus, ObservableEvent } from "@cortex/shared";
import { AgentType as AT, AgentStatus as AS, PipelinePriority } from "@cortex/shared";
import type { PipelineObserver } from "./pipeline-observer.js";
import type { PlatformBridge } from "@cortex/shared";
import type { AgentPool } from "./agent-pool.js";

/**
 * ButlerAgent（托马）—— 神里家管，唯一用户交互出口。
 *
 * 职责（Core-1）：
 * 1. 常驻 Awake，拦截 PipelineObserver 事件，格式化后经 PlatformBridge 通知用户
 * 2. ConfirmGate L2/L3 请求的二次确认（"要不要继续？"）
 * 3. MetaAgent 规划结果展示
 * 4. 故障报告直通用户（非阻塞）
 * 5. 用户状态感知（foreground/idle）→ 决定通知风格
 *
 * 通知语义分发（Core-1 架构预留）：
 *   FYI              → _onFyi    格式化后输出
 *   WARNING          → _onWarning  格式化后输出
 *   DECISION_REQUIRED → _onDecision 格式化后输出（Core-2 接入 ConfirmGate）
 *   undefined        → _onLegacy 向后兼容旧路径
 *
 * 不调用任何工具，不参与 Scheduler 派发。
 */
export class ButlerAgent {
  readonly type: AgentType = AT.Butler;

  // 方案B：AgentPool 为状态唯一权威源
  private _localStatus: AgentStatus = AS.Created;
  private _pool: AgentPool | null = null;
  private _instanceId: string | null = null;

  /** 方案B：status 只读 getter */
  get status(): AgentStatus {
    if (this._pool && this._instanceId) {
      const s = this._pool.getStatus(this._instanceId);
      if (s !== undefined) return s;
    }
    return this._localStatus;
  }

  private bridge?: PlatformBridge;

  constructor(
    private readonly observer: PipelineObserver,
    bridge?: PlatformBridge,
  ) {
    this.bridge = bridge;
  }

  /** 注入 AgentPool 引用（方案B：状态所有权归一） */
  setPool(pool: AgentPool, instanceId: string): void {
    this._pool = pool;
    this._instanceId = instanceId;
  }

  private _setStatus(status: AgentStatus): void {
    if (this._pool && this._instanceId) {
      this._pool.setStatus(this._instanceId, status);
    } else {
      this._localStatus = status;
    }
  }

  async wakeup(): Promise<void> {
    // 订阅关键事件（NORMAL 级别事件不订阅——管家无需响应全量信息流）
    // 遥测预留：memory.* 域事件（persist_failed / sql_degraded / deserialize_failed 等）
    // 当前仅由 memory-store 发射，PipelineObserver 不做消费——预留给未来遥测/监控系统接入
    this.observer.on(PipelinePriority.CRITICAL, this._onCritical.bind(this));
    this.observer.on(PipelinePriority.HIGH, this._onHigh.bind(this));
    this._setStatus(AS.Awake);
  }

  async execute(): Promise<{ nodeId: string; success: boolean; output?: string }> {
    // 管家不执行任务节点
    return { nodeId: "butler-noop", success: true, output: "ButlerAgent does not execute tasks" };
  }

  async shutdown(): Promise<void> {
    this.observer.off(PipelinePriority.CRITICAL);
    this.observer.off(PipelinePriority.HIGH);
    this._setStatus(AS.Draining);
    this._setStatus(AS.Destroyed);
  }

  /** 注入 PlatformBridge（CLI 或 Electron） */
  setBridge(bridge: PlatformBridge): void {
    this.bridge = bridge;
  }

  // ── 事件处理（按通知语义分发）──────────────────

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

  /** 按 notificationType 分发 */
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

  // ── 三条通知路径 ────────────────────────────

  /** FYI：信息告知 */
  private _onFyi(event: ObservableEvent): void {
    const ctx = this.bridge?.getPlatformContext();
    if (ctx && !ctx.foreground) return;
    const msg = this._formatLifecycle(event);
    this._output(msg, "Butler");
  }

  /** WARNING：异常警告 */
  private _onWarning(event: ObservableEvent): void {
    const ctx = this.bridge?.getPlatformContext();
    if (ctx && !ctx.foreground) return;
    const msg = this._formatCritical(event);
    this._output(msg, "Butler-CRITICAL");
  }

  /** DECISION_REQUIRED：治理呈报，需用户决策（Core-2 接入 ConfirmGate） */
  private _onDecision(event: ObservableEvent): void {
    // 治理呈报不检查 foreground——用户必须看到
    const msg = this._formatCritical(event);
    this._output(`[需决策] ${msg}`, "Butler-DECISION");
  }

  /** 向后兼容：未标 notificationType 的旧事件 */
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

  /** 统一输出 */
  private _output(msg: string, tag: string): void {
    if (this.bridge) {
      this.bridge.notify(msg);
    } else {
      console.log(`[${tag}] ${msg}`);
    }
  }

  // ── 格式化 ────────────────────────────────────

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
        return `[HIGH] ${event.type}: ${JSON.stringify(p)}`;
    }
  }
}
