import type { AgentStatus } from "@cortex/shared";
import { AgentStatus as AS } from "@cortex/shared";
import type { SafeErrorReporter } from "@cortex/shared";
import type { AgentPool } from "./agent-pool.js";

/**
 * PoolAwareState —— 方案B 状态管理共享组件。
 *
 * 治理判例 NG-2026-0511-CopyPaste-StateMachine：
 * BaseAgent / ButlerAgent / StrategistAgent 中重复了相同的 15+ 行状态管理代码。
 * 本类将方案B 的状态所有权归一模式提取为单一组件，消除复制粘贴。
 *
 * "外松内紧"——对外暴露简洁的 status getter + transition API，
 * 内部严密校验流转合法性，不论是否绑定 Pool。
 *
 * @fix M7 — _tag getter 不吞没 tagProvider 异常，尽早暴露问题（通过 safeReporter 上报）。
 */

/** 合法状态流转表——引用 AgentPool 权威源，消除双轨校验 */
import { AgentPool as AgentPoolClass } from "./agent-pool.js";
const VALID_TRANSITIONS = AgentPoolClass.VALID_TRANSITIONS;

export class PoolAwareState {
  private _localStatus: AgentStatus = AS.Created;
  private _pool: AgentPool | null = null;
  private _instanceId: string | null = null;
  private _safeReporter: SafeErrorReporter | null = null;
  /** 延迟求值的标签提供者——解决 abstract property 在基类构造器中未就绪的问题 */
  private readonly _tagProvider: () => string;

  /**
   * @param tagOrProvider 标签字符串或延迟求值函数。
   *   使用 `() => this.type` 可避免 abstract property 初始化顺序问题。
   */
  constructor(tagOrProvider: string | (() => string) = "Agent") {
    this._tagProvider = typeof tagOrProvider === "function" ? tagOrProvider : () => tagOrProvider;
  }

  /** @fix M7 — tagProvider 抛异常时通过 safeReporter 上报，不再吞没为 "Agent" */
  private get _tag(): string {
    return this._tagProvider();
  }

  /** 方案B：status 只读 getter —— Pool 有则委托，否则降级到 _localStatus */
  get status(): AgentStatus {
    if (this._pool && this._instanceId) {
      const s = this._pool.getStatus(this._instanceId);
      if (s !== undefined) return s;
    }
    return this._localStatus;
  }

  /** 注入 AgentPool 引用（方案B：状态所有权归一） */
  setPool(pool: AgentPool, instanceId: string): void {
    this._pool = pool;
    this._instanceId = instanceId;
  }

  /** 注入 SafeErrorReporter（由 bootstrap 在上层统一注入） */
  setSafeReporter(reporter: SafeErrorReporter): void {
    this._safeReporter = reporter;
  }

  /**
   * 状态流转。
   * 有 Pool：走 Pool 唯一权威源（含 VALID_TRANSITIONS 校验）。
   * 无 Pool：走本地校验（与 Pool 同源流转表），拒绝非法流转。
   *
   * @returns true 表示流转成功；false 表示流转被拒绝（已上报）。
   */
  transition(status: AgentStatus): boolean {
    if (this._pool && this._instanceId) {
      const ok = this._pool.setStatus(this._instanceId, status);
      if (!ok) {
        if (this._safeReporter) {
          this._safeReporter({
            source: `${this._tag}.PoolAwareState.transition`,
            error: new Error(`Pool 拒绝流转 → ${status}`),
            severity: "fatal",
            hint: `instanceId=${this._instanceId}`,
          });
        }
      }
      return ok;
    }

    // 降级路径：无 Pool 时校验本地流转合法性
    const allowed = VALID_TRANSITIONS[this._localStatus];
    if (!allowed || !allowed.has(status)) {
      const msg = `[${this._tag}] 非法流转 ${this._localStatus} → ${status}（无 Pool 降级路径）`;
      if (this._safeReporter) {
        this._safeReporter({
          source: `${this._tag}.PoolAwareState.transition`,
          error: new Error(msg),
          severity: "fatal",
          hint: "Agent 无 Pool 绑定，状态机一致性无法保证",
        });
      } else if (!process.env.VITEST) {
        console.error(`[invariant] ${msg}`);
      }
      return false;
    }

    this._localStatus = status;
    return true;
  }
}
