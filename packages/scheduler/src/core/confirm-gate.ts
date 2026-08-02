import { type ConfirmationRequest, type ConfirmationResponse, type PlatformBridge, type AgentType, type ITrustModel, type IPipelineObserver, PipelineEventType, PipelinePriority, type Disposable } from "@cortex/shared";
import { DEFAULT_ENGINE_CONFIG, ENV_CONFIRM_GATE_TIMEOUT_MS, ENV_AUTO_CONFIRM, isTestEnv, computeTrustScore, shouldAutoApprove, CONFIRM_GATE_BYPASS_TTL_MS, type TrustRecord, ReversibilityLevel as RL, type ReversibilityLevel, TrustLevel as TL } from "@cortex/config";
import { recordTelemetry } from "@cortex/telemetry";

// B4：信任分模型单源在 @cortex/config/constants/confirm-gate.ts——
// 原镜像实现（computeTrustScore/shouldAutoApprove/TrustRecord）已删除，统一 import。

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
 * @since Core-2 — 接口固化，后续新增字段需向下兼容
 */
export class ConfirmGate implements Disposable {
  private pending = new Map<string, ConfirmationRequest>();
  private resolvers = new Map<string, (approved: boolean) => void>();
  private rejecters = new Map<string, (reason: Error) => void>();
  private bridge?: PlatformBridge;
  private _bypass = false;
  private _explicitBypass = false;
  private _bypassExpiresAt = 0;
  private static readonly BYPASS_TTL_MS = CONFIRM_GATE_BYPASS_TTL_MS; // 5 分钟
  private trustModel?: ITrustModel;
  private defaultTimeoutMs: number;
  private _observer?: IPipelineObserver;
  /** 信任分历史记录——供 check() 方法做动态决策 */
  private _trustRecordsByAgent = new Map<string, TrustRecord[]>();

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
    if (!isTestEnv()) {
      throw new Error("bypassAll() 仅限 E2E 测试环境使用");
    }
    this._explicitBypass = true;
    this._bypass = true;
    this._bypassExpiresAt = Date.now() + ConfirmGate.BYPASS_TTL_MS;
  }

  /**
   * 信任分驱动的确认检查——替代纯静态 L0-L3 逻辑。
   * 信任分 ≥ 阈值则自动放行，否则回退到 needsConfirmation。
   */
  check(
    level: ReversibilityLevel,
    trustContext?: { agentType: AgentType; toolName: string },
  ): { approved: boolean; reason: string; score?: number } {
    const agentKey = trustContext?.agentType ?? "unknown";
    let records = this._trustRecordsByAgent.get(agentKey);
    if (!records) {
      records = [];
      this._trustRecordsByAgent.set(agentKey, records);
    }
    const score = computeTrustScore(records);
    if (shouldAutoApprove(score, level)) {
      records.push({
        agentType: trustContext?.agentType ?? "unknown",
        toolName: trustContext?.toolName ?? "unknown",
        success: true,
        riskLevel: level,
        timestamp: Date.now(),
      });
      // SCH-3：裸 console 伪装 telemetry → 真 recordTelemetry（与 llm-adapter 遥测收敛一致）
      void recordTelemetry("gate.trust_auto", 1, [
        { key: "tool", value: trustContext?.toolName ?? "unknown" },
        { key: "agent", value: trustContext?.agentType ?? "unknown" },
        { key: "risk", value: level },
        { key: "score", value: String(score) },
      ]).catch(() => {});
      return { approved: true, reason: "trust auto", score };
    }
    // C1 fix: 非 auto-approve 路径不在此记录信任——由外层 recordDecision() 统一记录最终结果，
    // 避免 check() 乐观记录 + recordDecision() 实际记录导致双重计数扭曲信任模型。
    const needsConfirm = this.needsConfirmation(level, trustContext);
    return { approved: !needsConfirm, reason: needsConfirm ? "manual confirm" : "low risk", score };
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
    // 自激活信任分记录——防御性填充，确保独立调用 needsConfirmation 时数据已就绪
    if (trustContext) {
      const key = trustContext.agentType ?? "unknown";
      if (!this._trustRecordsByAgent.has(key)) {
        this._trustRecordsByAgent.set(key, []);
      }
    }

    if (this._bypass && Date.now() < this._bypassExpiresAt) {
      void recordTelemetry("gate.verdict", 1, [
        { key: "verdict", value: "approved" },
        { key: "tool", value: trustContext?.toolName ?? "unknown" },
        { key: "agent", value: trustContext?.agentType ?? "unknown" },
        { key: "risk", value: level },
      ]).catch(() => {});
      return false;
    }
    if (this._bypass) this._bypass = false; // 过期后自动关闭

    // L0 永不确认
    if (level === RL.L0) {
      void recordTelemetry("gate.verdict", 1, [
        { key: "verdict", value: "approved" },
        { key: "tool", value: trustContext?.toolName ?? "unknown" },
        { key: "agent", value: trustContext?.agentType ?? "unknown" },
        { key: "risk", value: level },
      ]).catch(() => {});
      return false;
    }

    // trustScore 自动放行（信任分足够时跳过 L2/L3 确认）
    if (this.trustModel && trustContext && level !== RL.L1) {
      const records = this._trustRecordsByAgent.get(trustContext.agentType ?? "unknown") ?? [];
      const score = computeTrustScore(records);
      if (shouldAutoApprove(score, level)) {
        console.error(`[telemetry] gate.trust_auto_approve agent=${trustContext.agentType} score=${score} level=${level}`);
        return false;
      }
    }

    // L2/L3 永远确认
    if (level === RL.L2 || level === RL.L3) {
      console.error(`[telemetry] gate.verdict verdict=confirm tool=${trustContext?.toolName ?? "unknown"} agent=${trustContext?.agentType ?? "unknown"} risk=${level}`);
      return true;
    }

    // L1：信任模型判定
    if (!this.trustModel || !trustContext) {
      // 原则四 fail-open: TrustModel 离线时不阻断 L1 操作
      console.error(`[telemetry] gate.verdict verdict=approved tool=${trustContext?.toolName ?? "unknown"} agent=${trustContext?.agentType ?? "unknown"} risk=${level}`);
      return false;
    }
    const trustLevel = this.trustModel.getTrustLevelForTool(
      trustContext.agentType,
      trustContext.toolName,
    );

    const verdict = trustLevel < TL.L3 ? "confirm" : "approved";
    console.error(`[telemetry] gate.verdict verdict=${verdict} tool=${trustContext.toolName} agent=${trustContext.agentType} risk=${level}`);
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

    // 非交互环境自动判定：L0/L1 放行，L2/L3 拒绝（安全优先）
    // 环境变量 CORTEX_AUTO_CONFIRM=true 时 L0/L1 放行
    if (process.env[ENV_AUTO_CONFIRM] === 'true') {
      const req = this.pending.get(requestId);
      if (req) {
        // R5-S2 fix: AUTO_CONFIRM 不对 L3（不可逆）放行——即使设置了也必须交互确认
        const approved = req.level !== RL.L3;
        this.pending.delete(requestId);
        this.resolvers.delete(requestId);
        this.rejecters.delete(requestId);
        return approved;
      }
    }
    if (!process.stdin.isTTY) {
      const req = this.pending.get(requestId);
      if (req) {
        const approved = req.level === RL.L0 || req.level === RL.L1;
        this.pending.delete(requestId);
        this.resolvers.delete(requestId);
        this.rejecters.delete(requestId);
        return approved;
      }
    }

    // 有 bridge 时走真实用户交互
    // P2 fix: bridge 路径加超时——超时 fail-closed（拒绝）并清理三表，防 bridge 挂死
    if (this.bridge) {
      const req = this.pending.get(requestId);
      if (!req) return false;
      let bridgeTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          bridgeTimer = setTimeout(() => reject(new Error(`ConfirmGate bridge confirm 超时（${effectiveTimeout}ms）`)), effectiveTimeout);
        });
        const response = await Promise.race([this.bridge.confirm(req), timeoutPromise]);
        return response.approved;
      } catch {
        // 超时或 bridge 异常 → fail-closed（拒绝）
        return false;
      } finally {
        if (bridgeTimer) clearTimeout(bridgeTimer);
        this.pending.delete(requestId);
        this.resolvers.delete(requestId);
        this.rejecters.delete(requestId);
      }
    }

    // 无 bridge 时：创建 Promise，等待 resolve() 或超时
    // H14 fix: 无 bridge 时大幅缩短超时（120s→5s），避免 TTY 环境下静默挂死
    const noBridgeTimeout = Math.min(effectiveTimeout, 5_000);
    if (this._observer && effectiveTimeout > noBridgeTimeout) {
      this._observer.emit({
        type: PipelineEventType.ErrorReported,
        priority: PipelinePriority.NORMAL,
        payload: { source: "ConfirmGate.waitFor", severity: "degraded", error: "无 PlatformBridge——超时从 120s 缩短至 5s 防挂死" },
        timestamp: Date.now(),
      });
    }
    return await new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.resolvers.delete(requestId);
        this.rejecters.delete(requestId);
        resolve(false);
      }, noBridgeTimeout);

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
    if (this._bypass && Date.now() < this._bypassExpiresAt) return true;
    if (!this.bridge) {
      // 无 bridge 时 emit 告警——fail-open 是设计决策，但必须可观测
      // 设计决策：无 bridge 时 fail-open（非阻塞场景优先可用性）。可观测性由 _emitNoBridgeWarning 补偿。
      this._emitNoBridgeWarning();
      return true; // 设计决策：无 bridge 时 fail-open——CLI stdin 不可达场景。可观测性由 _emitNoBridgeWarning 补偿。
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
      } catch (e) {
        // 改为 fail-closed：bridge 不可用时默认拒绝，不是批准
        this._observer?.emit({
          type: PipelineEventType.InfraComponentDegraded,
          priority: PipelinePriority.HIGH,
          payload: {
            operation: "confirm-gate",
            detail: `bridge异常，fail-closed拒绝操作: ${e}`,
          },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
        return false;
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
        type: PipelineEventType.ExecNodeDelayed,
        priority: PipelinePriority.NORMAL,
        payload: { nodeId: "confirm-gate", agentId: "", elapsed: 0, action: "wait", level: "warn" },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    } else {
      console.warn("[ConfirmGate] " + message);
    }
  }
}
