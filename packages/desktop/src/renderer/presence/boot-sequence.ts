/**
 * presence/boot-sequence.ts — 启动时序
 *
 * 她刚醒来的时候：
 * 1. Live2D 加载 → 站立 + 呼吸 + 环顾四周（3-5s）
 * 2. Daemon 检测 → 连通则嘴角微扬，断连则歪头
 * 3. WS 连接 + 订阅
 * 4. 就绪 → 转向用户 + greeting
 *    - 今天第一次启动："早安～♪"
 *    - 恢复会话："我在。上次你说..."
 *
 * @module renderer/presence/boot-sequence
 * @since v7 — 三端 UI 设计 Phase P1
 */

import type { PresenceEngine } from "./presence-engine";

// ═══════════════════════════════════════════════════════════
// §1 类型定义
// ═══════════════════════════════════════════════════════════

export type BootPhase =
  | "loading"       // Live2D 模型加载中
  | "waking"        // 环顾四周（3-5s 自主动画）
  | "connecting"    // 检测 daemon
  | "ready"         // 就绪，问候
  | "error";        // 连接失败

export interface BootSequenceCallbacks {
  /** 阶段变更通知（供 UI 层显示状态） */
  onPhaseChange?: (phase: BootPhase) => void;
  /** 问候语文本（供气泡显示） */
  onGreeting?: (text: string) => void;
  /** daemon 连接状态 */
  onDaemonStatus?: (connected: boolean, info?: DaemonBootInfo) => void;
}

export interface DaemonBootInfo {
  // R12-H6：对齐 daemon/health 实际返回（daemon 块：pid/uptimeMs/version/engineReady/activeSessions；chatModel/reasonerModel 仅 system.status 有——可选容错）
  chatModel?: string;
  reasonerModel?: string;
  uptimeMs: number;
  activeSessions: number;
  pid?: number;
  version?: string;
  engineReady?: boolean;
}

export interface BootSequenceOptions {
  /** 环顾动画持续时间 ms，默认 4000 */
  wakeDurationMs?: number;
  /** daemon 检测超时 ms，默认 5000 */
  daemonTimeoutMs?: number;
  /** daemon 健康检查 URL */
  daemonHealthUrl?: string;
}

// ═══════════════════════════════════════════════════════════
// §2 启动序列
// ═══════════════════════════════════════════════════════════

export class BootSequence {
  private readonly engine: PresenceEngine;
  private readonly callbacks: BootSequenceCallbacks;
  private readonly options: Required<BootSequenceOptions>;

  private phase: BootPhase = "loading";
  private disposed = false;

  constructor(
    engine: PresenceEngine,
    callbacks: BootSequenceCallbacks = {},
    options: BootSequenceOptions = {},
  ) {
    this.engine = engine;
    this.callbacks = callbacks;
    this.options = {
      wakeDurationMs: options.wakeDurationMs ?? 4000,
      daemonTimeoutMs: options.daemonTimeoutMs ?? 5000,
      daemonHealthUrl: options.daemonHealthUrl ?? "http://127.0.0.1:3210/api/v1/daemon/health",
    };
  }

  /** 当前阶段 */
  get currentPhase(): BootPhase {
    return this.phase;
  }

  /**
   * 执行完整启动序列。
   * 在 Live2D 模型 onLoad 回调中调用。
   */
  async run(): Promise<void> {
    if (this.disposed) return;

    // Phase 1: 环顾四周
    this.setPhase("waking");
    await this.wake();
    if (this.disposed) return;

    // Phase 2: 检测 daemon
    this.setPhase("connecting");
    const daemonInfo = await this.detectDaemon();
    if (this.disposed) return;

    // Phase 3: 就绪问候
    this.setPhase("ready");
    this.greet(daemonInfo !== null);
  }

  /** 销毁 */
  dispose(): void {
    this.disposed = true;
  }

  // ─── 内部实现 ─────────────────────────────────────────

  private setPhase(phase: BootPhase): void {
    this.phase = phase;
    this.callbacks.onPhaseChange?.(phase);
  }

  /** 环顾四周动画（3-5s） */
  private wake(): Promise<void> {
    return new Promise((resolve) => {
      // 发送 idle 事件触发环顾行为
      this.engine.handleEvent({ type: "user.idle" });
      window.setTimeout(() => {
        resolve();
      }, this.options.wakeDurationMs);
    });
  }

  /** 检测 daemon 连通性 */
  private async detectDaemon(): Promise<DaemonBootInfo | null> {
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), this.options.daemonTimeoutMs);

      const response = await fetch(this.options.daemonHealthUrl, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      window.clearTimeout(timeout);

      if (!response.ok) {
        this.callbacks.onDaemonStatus?.(false);
        return null;
      }

      const body = await response.json() as { data?: DaemonBootInfo };
      const info = body.data ?? null;
      this.callbacks.onDaemonStatus?.(true, info ?? undefined);

      // 连通 → 嘴角微扬
      this.engine.handleEvent({ type: "system.status" });
      return info;
    } catch {
      // 断连 → 歪头
      this.callbacks.onDaemonStatus?.(false);
      this.engine.handleEvent({ type: "chat.error" });
      return null;
    }
  }

  /** 问候 */
  private greet(daemonConnected: boolean): void {
    // 转向用户 + greeting 表情
    this.engine.handleEvent({ type: "session.created" });

    // 判断是今天第一次还是恢复会话
    const greeting = this.buildGreeting(daemonConnected);
    this.callbacks.onGreeting?.(greeting);
  }

  private buildGreeting(daemonConnected: boolean): string {
    const hour = new Date().getHours();
    const timeGreeting = hour < 6 ? "夜深了～"
      : hour < 12 ? "早安～♪"
      : hour < 18 ? "下午好～"
      : "晚上好～";

    if (!daemonConnected) {
      return `${timeGreeting} 不过……后端好像还没醒。我先自己待着。`;
    }

    // 检查是否今天第一次启动（简化：用 sessionStorage 标记）
    const todayKey = `cortex-boot-${new Date().toISOString().slice(0, 10)}`;
    const isFirstToday = !sessionStorage.getItem(todayKey);
    if (isFirstToday) {
      sessionStorage.setItem(todayKey, "1");
      return timeGreeting;
    }

    return "我在。继续吧。";
  }
}
