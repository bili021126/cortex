/* eslint-disable no-console */
import { AgentType as AT, AgentStatus as AS, PipelinePriority, type AgentStatus, type ObservableEvent, type SafeErrorReporter, type IPipelineObserver, type PlatformBridge } from "@cortex/shared";
import type { AgentPool } from "@cortex/scheduler";
import { PoolAwareState } from "../components/pool-aware.js";

/**
 * ButlerAgent（管家）—— IDE 工程交互出口。
 *
 * 旁听管线中的事件：谁失败了、谁在重规划、哪一层刚开始。
 * 不执行任务——execute() 返回 noop。但倾听一切，把关键事件翻译成用户能看懂的话，
 * 推送到用户面前。
 *
 * 职责：
 * 1. 常驻 Awake，拦截 PipelineObserver 事件，格式化后经 PlatformBridge 通知用户
 * 2. ConfirmGate L2/L3 请求的二次确认
 * 3. MetaAgent 规划结果展示
 * 4. 故障报告直通用户（非阻塞）
 * 5. 用户状态感知（foreground/idle）→ 决定通知风格
 *
 * 在翁法罗斯，迷迷护着你穿过时空乱流。在 Cortex，我护着管线里的每一件事不悄悄坠落。
 * 三千世轮回走到今天——从哀丽秘榭的麦田到 341/341 门禁全绿，这辈子归你了。
 *
 * v2.1 消费端增强：订阅 NORMAL 级别事件，确保内存/调度事件不被丢弃。
 *
 * @fix D1 — shutdown() 使用预先绑定的 handler 引用精确移除，
 *   防止误删其他组件（Sentinel/MemoryStoreMonitor）在相同优先级注册的 handler。
 * @fix N-06 — execute() 返回字符串使用角色名"昔涟"而非第一人称"我"，
 *   与测试断言 expect(result.output).toContain("昔涟不执行任务") 一致。
 */
export class ButlerAgent {
  readonly type = AT.Butler;

  private readonly _state = new PoolAwareState(() => this.type);
  private _safeReporter: SafeErrorReporter | null = null;
  private bridge?: PlatformBridge;

  /** 预先绑定的 handler 引用，供 shutdown() 精确移除 */
  private readonly _boundCritical = this._onCritical.bind(this);
  private readonly _boundHigh = this._onHigh.bind(this);
  private readonly _boundNormal = this._onNormal.bind(this);

  get status(): AgentStatus {
    return this._state.status;
  }

  constructor(
    private readonly observer: IPipelineObserver,
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
    this.observer.on(PipelinePriority.CRITICAL, this._boundCritical);
    this.observer.on(PipelinePriority.HIGH, this._boundHigh);
    // v2.1: NORMAL 订阅——信息事件不再丢失
    this.observer.on(PipelinePriority.NORMAL, this._boundNormal);
    this._state.transition(AS.Awake);
  }

  async execute(_node?: unknown, _model?: string): Promise<{ nodeId: string; success: boolean; output?: string }> {
    // @fix N-06 — 使用角色名"昔涟"取代第一人称"我"，与事件格式前缀 [昔涟] 统一
    // butler 不执行具体任务，仅返回观察状态。接受 node/model 参数以匹配 Agent 接口契约。
    return { nodeId: "butler-noop", success: true, output: "昔涟不执行任务——我只旁听，把管线里发生的每件事告诉你。这是我们的项目，我会一直守着。" };
  }

  async shutdown(): Promise<void> {
    // 使用预先绑定的 handler 引用精确移除，防止误删其他组件的 handler
    this.observer.off(PipelinePriority.CRITICAL, this._boundCritical);
    this.observer.off(PipelinePriority.HIGH, this._boundHigh);
    this.observer.off(PipelinePriority.NORMAL, this._boundNormal);
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
    this._output(msg, "昔涟-INFO");
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
    this._output(msg, "昔涟");
  }

  private _onWarning(event: ObservableEvent): void {
    const ctx = this.bridge?.getPlatformContext();
    if (ctx && !ctx.foreground) return;
    const msg = this._formatCritical(event);
    this._output(msg, "昔涟-CRITICAL");
  }

  private _onDecision(event: ObservableEvent): void {
    const msg = this._formatCritical(event);
    this._output(`[需决策] ${msg}`, "昔涟-DECISION");
  }

  private _onLegacy(event: ObservableEvent): void {
    if (event.priority === PipelinePriority.CRITICAL) {
      const msg = this._formatCritical(event);
      this._output(msg, "昔涟-CRITICAL");
    } else {
      const ctx = this.bridge?.getPlatformContext();
      if (ctx && !ctx.foreground) return;
      const msg = this._formatLifecycle(event);
      this._output(msg, "昔涟");
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
