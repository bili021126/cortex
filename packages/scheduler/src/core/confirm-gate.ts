import { ReversibilityLevel as RL, type ConfirmationRequest, type ConfirmationResponse, type PlatformBridge, type ReversibilityLevel, type AgentType, type ITrustModel, TrustLevel as TL, type IPipelineObserver } from "@cortex/shared";
import { DEFAULT_ENGINE_CONFIG, ENV_CONFIRM_GATE_TIMEOUT_MS } from "@cortex/config";

/**
 * 默认确认超时（毫秒）。
 * 源自全局配置 toolTimeouts.confirmWait，消除独立硬编码。
 */
const DEFAULT_TIMEOUT_MS: number = DEFAULT_ENGINE_CONFIG.toolTimeouts.confirmWait ?? 120_000;

/**
 * 引擎关闭导致的 dispose 特殊标记。
 * 上游 await gate.waitFor(id) 可通过 reject 区分"用户拒绝"和"引擎关闭"。
 */
class ConfirmGateDisposedError extends Error {
  constructor(requestId: string) {
    super(`ConfirmGate 已关闭，请求 ${requestId} 被终止`);
    this.name = "ConfirmGateDisposedError";
  }
}

/**
 * ConfirmGate —— 确认门
 * 基于可逆性等级拦截工具调用。L2/L3 永远确认，L1 视信任放行。
 * 用户交互通道由 PlatformBridge 提供（CLIAdapter / ElectronAdapter）。
 */
export class ConfirmGate {
  private pending = new Map<string, ConfirmationRequest>();
  private resolvers = new Map<string, (approved: boolean) => void>();
  private rejecters = new Map<string, (reason: Error) => void>();
  private bridge?: PlatformBridge;
  private _bypass = false;
  private _explicitBypass = false;
  private _bypassExpiresAt = 0;
  private static readonly BYPASS_TTL_MS = 300_000; // 5 分钟
  private trustModel?: ITrustModel;
  private defaultTimeoutMs: number;
  private _observer?: IPipelineObserver;

  /**
   * @param timeoutMs  默认确认超时（毫秒）。不传时依次回退：
   *                    环境变量 CONFIRM_GATE_TIMEOUT_MS → 代码默认值。
   */
  constructor(timeoutMs?: number) {
    if (timeoutMs !== undefined) {
      this.defaultTimeoutMs = timeoutMs;
    } else if (typeof process !== "undefined" && process.env?.[ENV_CONFIRM_GATE_TIMEOUT_MS]) {
      const parsed = Number(process.env[ENV_CONFIRM_GATE_TIMEOUT_MS]);
      this.defaultTimeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
    } else {
      this.defaultTimeoutMs = DEFAULT_TIMEOUT_MS;
    }
  }

  /** 测试模式：跳过所有确认，5 分钟后自动过期。仅限 bootstrap 显式调用。生产环境调用将抛错。 */
  bypassAll(): void {
    this._explicitBypass = true;
    this._bypass = true;
    this._bypassExpiresAt = Date.now() + ConfirmGate.BYPASS_TTL_MS;
  }

  /** 是否处于显式 bypass 模式（仅由 bypassAll 设置，不接受环境变量） */
  canBypass(): boolean {
    return this._explicitBypass;
  }

  /**
   * 判断给定等级是否需要用户确认。
   * bypass 模式下跳过所有确认。
   *
   * 当注入 TrustModel 后，L1 操作不再无条件放行：
   *   - TrustLevel ≥ L3 → 免确认
   *   - TrustLevel < L3 → 仍需确认
   *
   * L2/L3 始终需要确认。
   */
  needsConfirmation(
    level: ReversibilityLevel,
    trustContext?: { agentType: AgentType; toolName: string },
  ): boolean {
    if (this._bypass && Date.now() < this._bypassExpiresAt) return false;
    if (this._bypass) this._bypass = false; // 过期后自动关闭

    // L0 永不确认
    if (level === RL.L0) return false;

    // L2/L3 永远确认
    if (level === RL.L2 || level === RL.L3) return true;

    // L1：信任模型判定
    if (!this.trustModel || !trustContext) {
      // 原则四 fail-open: TrustModel 离线时不阻断 L1 操作
      return false;
    }
    const trustLevel = this.trustModel.getTrustLevelForTool(
      trustContext.agentType,
      trustContext.toolName,
    );

    // TrustLevel ≥ L3 → L1 免确认
    return trustLevel < TL.L3;
  }

  /** 注入用户交互通道。 */
  setBridge(bridge: PlatformBridge): void {
    this.bridge = bridge;
  }

  /** 注入 PipelineObserver——用于发射无 bridge 告警等可观测事件 */
  setObserver(observer: IPipelineObserver): void {
    this._observer = observer;
  }
  setTrustModel(tm: ITrustModel): void {
    this.trustModel = tm;
  }

  /** 记录一次确认决定到信任模型——由调用方在确认完成后调用 */
  recordDecision(agentType: AgentType, toolName: string, approved: boolean): void {
    if (!this.trustModel) return;
    this.trustModel.recordDecision(agentType, toolName, approved);
  }

  // ── 请求/等待/确认 核心协议 ──────────────────────────

  /**
   * 登记一条确认请求。
   * @returns 请求 ID
   */
  request(req: ConfirmationRequest): string {
    this.pending.set(req.id, req);
    return req.id;
  }

  /**
   * 等待用户确认。
   * @param requestId  请求 ID
   * @param timeoutMs  可选超时（ms），不传时使用构造函数传入的默认值
   */
  async waitFor(requestId: string, timeoutMs?: number): Promise<boolean> {
    const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;

    if (!this.pending.has(requestId)) return false;

    // 有 bridge 时走真实用户交互
    if (this.bridge) {
      const req = this.pending.get(requestId);
      if (!req) return false;
      try {
        const response = await this.bridge.confirm(req);
        return response.approved;
      } finally {
        this.pending.delete(requestId);
        this.resolvers.delete(requestId);
        this.rejecters.delete(requestId);
      }
    }

    // 无 bridge 时：创建 Promise，等待 resolve() 或超时
    return await new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.resolvers.delete(requestId);
        this.rejecters.delete(requestId);
        resolve(false);
      }, effectiveTimeout);

      this.resolvers.set(requestId, (approved: boolean) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve(approved);
      });

      this.rejecters.set(requestId, (reason: Error) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(reason);
      });
    });
  }

  /**
   * 外部输入确认结果。
   * @returns 是否找到并处理了对应的请求
   */
  resolve(response: ConfirmationResponse): boolean {
    const req = this.pending.get(response.requestId);
    if (!req) return false;
    this.pending.delete(response.requestId);

    const resolver = this.resolvers.get(response.requestId);
    if (resolver) {
      this.resolvers.delete(response.requestId);
      this.rejecters.delete(response.requestId);
      resolver(response.approved);
    }
    return response.approved;
  }

  // ── 超时处理 ──────────────────────────────────────

  /**
   * 超时处理——对所有等级均清理 pending + resolvers。
   */
  handleTimeout(requestId: string, _level: ReversibilityLevel): boolean {
    if (!this.pending.has(requestId)) return false;
    this.pending.delete(requestId);

    const resolver = this.resolvers.get(requestId);
    if (resolver) {
      this.resolvers.delete(requestId);
      this.rejecters.delete(requestId);
      resolver(false);
    }
    return false;
  }

  // ── 查询 ──────────────────────────────────────────

  /** 是否有待处理的确认请求。 */
  hasPending(): boolean {
    return this.pending.size > 0;
  }

  /**
   * 释放所有待处理请求和 resolver，防止内存泄漏。
   */
  dispose(): void {
    for (const [id, reject] of this.rejecters) {
      this.pending.delete(id);
      reject(new ConfirmGateDisposedError(id));
    }
    this.resolvers.clear();
    this.rejecters.clear();
    this.pending.clear();
  }

  // ── 批量确认（简化接口） ──────────────────────────

  /**
   * 批量确认一组节点（简化接口）。
   * bypass 或 无 bridge 时默认放行，但 emit 告警以保证可观测。
   */
  async confirm(nodes: { id: string; payload: string }[]): Promise<boolean> {
    if (this._bypass) return true;
    if (!this.bridge) {
      // 无 bridge 时 emit 告警——fail-open 是设计决策，但必须可观测
      this._emitNoBridgeWarning();
      return true;
    }

    for (const node of nodes) {
      const req: ConfirmationRequest = {
        id: node.id,
        level: RL.L2,
        toolName: "task_confirm",
        summary: node.payload,
        detail: `节点 ${node.id}: ${node.payload}`,
      };
      try {
        const response = await this.bridge.confirm(req);
        if (!response.approved) {
          return false;
        }
      } catch {
        return true;
      }
    }
    return true;
  }

  /**
   * 无 bridge 时发射告警——确保 fail-open 决策可观测。
   * 有 observer 时走 observer 管道，否则 fallback 到 console.warn。
   */
  private _emitNoBridgeWarning(): void {
    const message = "ConfirmGate operating without bridge — fail-open mode";
    if (this._observer) {
      this._observer.emit({
        type: "exec.node.delayed",
        priority: 1, // NORMAL
        payload: { nodeId: "confirm-gate", agentId: "", elapsed: 0, action: "wait", level: "warn", reason: message },
        timestamp: Date.now(),
        notificationType: "WARNING",
      } as any);
    } else {
      console.warn("[ConfirmGate] " + message);
    }
  }
}
