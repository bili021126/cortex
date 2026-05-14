import type { ConfirmationRequest, ConfirmationResponse, ReversibilityLevel, PlatformBridge } from "@cortex/shared";
import { ReversibilityLevel as RL } from "@cortex/shared";

/**
 * ConfirmGate —— 确认门
 * 基于可逆性等级拦截工具调用。L2/L3 永远确认，L1 视信任放行。
 * 用户交互通道由 PlatformBridge 提供（CLIAdapter / ElectronAdapter）。
 *
 * @fix M1 — handleTimeout L2/L3 也会回收 pending 条目，防止内存泄漏。
 */
export class ConfirmGate {
  private pending = new Map<string, ConfirmationRequest>();
  private resolvers = new Map<string, (approved: boolean) => void>();
  private bridge?: PlatformBridge;
  private _bypass = false;

  /** 测试模式：跳过所有确认，直接放行。生产过程调用将抛错。 */
  bypassAll(): void {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ConfirmGate.bypassAll() called in production — forbidden. Use setBridge() for real user interaction.");
    }
    this._bypass = true;
  }

  /** 判定是否需要确认 */
  needsConfirmation(level: ReversibilityLevel): boolean {
    if (this._bypass) return false;
    return level === RL.L2 || level === RL.L3;
  }

  /** 注入 PlatformBridge（CLI 或 Electron），启用真实用户交互 */
  setBridge(bridge: PlatformBridge): void {
    this.bridge = bridge;
  }

  /** 发起确认请求，返回 requestId */
  request(req: ConfirmationRequest): string {
    this.pending.set(req.id, req);
    return req.id;
  }

  /**
   * 异步等待用户响应。
   * - 有 PlatformBridge 时：调用 bridge.confirm() 阻塞等待真实用户输入
   * - 无 bridge 时（测试模式）：挂起等待外部 resolve() 调用
   */
  async waitFor(requestId: string, timeoutMs?: number): Promise<boolean> {
    if (!this.pending.has(requestId)) return false;

    // 有 bridge → 真实用户交互
    if (this.bridge) {
      const req = this.pending.get(requestId)!;
      const response = await this.bridge.confirm(req);
      this.pending.delete(requestId);
      return response.approved;
    }

    // 无 bridge（测试模式）→ 挂起等待外部 resolve()
    return new Promise<boolean>((resolve) => {
      this.resolvers.set(requestId, resolve);

      if (timeoutMs !== undefined && timeoutMs !== null) {
        setTimeout(() => {
          if (this.resolvers.has(requestId)) {
            this.resolvers.delete(requestId);
            this.pending.delete(requestId);
            resolve(false);
          }
        }, timeoutMs);
      }
    });
  }

  /** 处理用户响应。唤醒等待中的 waitFor() */
  resolve(response: ConfirmationResponse): boolean {
    const req = this.pending.get(response.requestId);
    if (!req) return false;
    this.pending.delete(response.requestId);

    const resolver = this.resolvers.get(response.requestId);
    if (resolver) {
      this.resolvers.delete(response.requestId);
      resolver(response.approved);
    }
    return response.approved;
  }

  /** 处理超时：所有等级均移除 pending 条目，防止内存泄漏 */
  handleTimeout(requestId: string, level: ReversibilityLevel): boolean {
    if (!this.pending.has(requestId)) return false;
    // M1: L2/L3 超时时也移除 pending 条目，防止 hasPending() 永远返回 true
    this.pending.delete(requestId);
    const resolver = this.resolvers.get(requestId);
    if (resolver) {
      this.resolvers.delete(requestId);
      resolver(false);
    }
    return false;
  }

  /** 是否有待处理的确认 */
  hasPending(): boolean {
    return this.pending.size > 0;
  }
}
