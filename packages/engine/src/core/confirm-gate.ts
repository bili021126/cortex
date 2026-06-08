import { ReversibilityLevel as RL, type ConfirmationRequest, type ConfirmationResponse, type PlatformBridge, type ReversibilityLevel } from "@cortex/shared";
import { DEFAULT_ENGINE_CONFIG, ENV_CONFIRM_GATE_TIMEOUT_MS, ENV_NODE_ENV } from "@cortex/config";

/**
 * 默认确认超时（毫秒）。
 * 源自全局配置 toolTimeouts.confirmWait，消除独立硬编码。
 * 防止 waitFor() 不传 timeoutMs 时永久挂起。
 *
 * 使用非空断言（!）告知编译器：DEFAULT_ENGINE_CONFIG 是字面量对象，
 * toolTimeouts.confirmWait 在运行时始终有值。
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
 *
 * @fix M1 — handleTimeout L2/L3 也会回收 pending 条目，防止内存泄漏。
 * @fix P2 — 超时默认值可配置：构造函数传入 timeoutMs，或通过
 *           环境变量 CONFIRM_GATE_TIMEOUT_MS 覆盖（优先级：构造参数 > 环境变量 > 代码默认值）。
 * @fix M-04 — dispose() 改用 reject，上游可区分"用户拒绝了"和"引擎关闭了"
 */
export class ConfirmGate {
  private pending = new Map<string, ConfirmationRequest>();
  private resolvers = new Map<string, (approved: boolean) => void>();
  private rejecters = new Map<string, (reason: Error) => void>();
  private bridge?: PlatformBridge;
  private _bypass = false;
  private defaultTimeoutMs: number;

  /**
   * @param timeoutMs  默认确认超时（毫秒）。不传时依次回退：
   *                    环境变量 CONFIRM_GATE_TIMEOUT_MS → 代码默认值（源自 config.toolTimeouts.confirmWait）。
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

  /** 测试模式：跳过所有确认，直接放行。生产过程调用将抛错。 */
  bypassAll(): void {
    if (process.env[ENV_NODE_ENV] === "production") {
      throw new Error("ConfirmGate.bypassAll() called in production — forbidden. Use setBridge() for real user interaction.");
    }
    this._bypass = true;
  }

  /**
   * 判断给定等级是否需要用户确认。
   * bypass 模式下跳过所有确认。
   */
  needsConfirmation(level: ReversibilityLevel): boolean {
    if (this._bypass) return false;
    return level === RL.L2 || level === RL.L3;
  }

  /** 注入用户交互通道。 */
  setBridge(bridge: PlatformBridge): void {
    this.bridge = bridge;
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
   * @fix M1 — L2/L3 也会回收 pending 条目，防止内存泄漏。
   */
  handleTimeout(requestId: string, _level: ReversibilityLevel): boolean {
    if (!this.pending.has(requestId)) return false;
    // M1: 所有等级统一清理 pending
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
   * @fix P1-5 — 引擎关闭时确保所有待处理的 Promise 被 reject，避免永久悬挂
   * @fix M-04 — 改用 reject(ConfirmGateDisposedError)，上游可区分"用户拒绝了"和"引擎关闭了"
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
   * bypass 或 无 bridge 时默认放行。
   */
  async confirm(nodes: { id: string; payload: string }[]): Promise<boolean> {
    if (this._bypass) return true;
    if (!this.bridge) return true; // 无交互通道时默认放行

    // 有 bridge 时逐节点展示给用户确认
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
          return false; // 任一节点被拒绝则整体拒绝
        }
      } catch {
        // bridge 异常时降级放行（先做后审原则）
        return true;
      }
    }
    return true;
  }
}
