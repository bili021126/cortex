// ============================================================
// memory-state-machine.ts —— 记忆状态机适配器
//
// 将 @cortex/fsm-compiler 的编译产物接入 MemoryStore 的 CAS 状态流转。
//
// 核心职责：
//   1. 从嵌入式 FSM 定义构造 StateMachine 实例
//   2. 注册业务级的 guard 和 action 函数
//   3. 提供与 MemoryStore.cas() 兼容的接口
//
// 与之前 VALID_TRANSITIONS 的核心区别：
//   - 状态转换规则由 JSON 定义驱动（single source of truth）
//   - 每次 dispatch 记录 TransitionRecord（审计留痕）
//   - guard 在运行时评估（而非仅做静态白名单检查）
//   - action 在转换成功后自动执行（BM25 索引移除、权重重置等）
//
// @since Core-1 第四轮 — FSM 编译器集成
// ============================================================

import { StateMachine, GuardRegistry, ActionRegistry, defineFsm } from "@cortex/fsm-compiler";
import type { TransitionRecord } from "@cortex/fsm-compiler";
import { FSM_ARCHIVE_WEIGHT_THRESHOLD } from "@cortex/config";

// ══════════════════════════════════════════════
// 嵌入式 FSM 定义（来自 definitions/memory-entry.fsm.json v2.0.0）
// ══════════════════════════════════════════════

const MEMORY_ENTRY_FSM_DEFINITION = defineFsm<MemState, MemEvent>({
  id: "memory_entry",
  displayName: "Memory Entry Lifecycle",
  version: "2.0.0",
  description:
    "Four-state lifecycle of a memory entry: Pending → Active → Archived → Obliterated, per Cortex Constitution §10",
  states: [
    { id: "pending", displayName: "Pending", style: "normal" },
    { id: "active", displayName: "Active", style: "initial" },
    { id: "archived", displayName: "Archived", style: "normal" },
    { id: "obliterated", displayName: "Obliterated", style: "final" },
  ],
  transitions: [
    { id: "pending_to_active", from: "pending", to: "active", event: "commit", guard: "canCommit", action: "onCommit" },
    { id: "pending_to_obliterated", from: "pending", to: "obliterated", event: "rollback", action: "onRollback" },
    { id: "active_to_archived", from: "active", to: "archived", event: "archive", guard: "canArchive", action: "onArchive" },
    { id: "active_to_obliterated", from: "active", to: "obliterated", event: "obliterate", guard: "canObliterate", action: "onObliterate" },
    { id: "archived_to_active", from: "archived", to: "active", event: "restore", guard: "canRestore", action: "onRestore" },
    { id: "archived_to_obliterated", from: "archived", to: "obliterated", event: "obliterate", guard: "canObliterate", action: "onObliterate" },
  ],
  initialState: "pending",
  finalStates: ["obliterated"],
});

// ══════════════════════════════════════════════
// 事件 & 状态类型别名
// ══════════════════════════════════════════════

/**
 * 记忆生命周期事件
 * @since Core-2 — 接口固化，后续新增字段需向下兼容
 */
export type MemEvent = "commit" | "rollback" | "archive" | "obliterate" | "restore";

/**
 * 记忆语义状态
 * @since Core-2 — 接口固化，后续新增字段需向下兼容
 */
export type MemState = "pending" | "active" | "archived" | "obliterated";

/**
 * 将 (from, to) 状态对映射为 FSM 事件。
 * 用于 MemoryStore.cas() 将期望状态+目标状态转换为 FSM 可分发事件。
 */
export function stateTransitionToEvent(from: string, to: string): MemEvent | null {
  for (const tr of MEMORY_ENTRY_FSM_DEFINITION.transitions) {
    if (tr.from === from && tr.to === to) return tr.event as MemEvent;
  }
  return null;
}

// ══════════════════════════════════════════════
// Guard & Action 上下文
// ══════════════════════════════════════════════

/** guard/action 传递的上下文 */
export interface MemTransitionContext {
  /** 记忆条目的当前 weight */
  weight: number;
  /** 记忆条目的 accessCount */
  accessCount: number;
  /** 记忆条目的 lastAccessedAt 时间戳 */
  lastAccessedAt: number;
  /** 记忆条目的 expires_at 时间戳 */
  expiresAt?: number;
  /** 记忆 ID（用于 action 索引操作） */
  memoryId: string;
  /** 记忆 kind */
  kind?: string;
  /** 记忆 isFact */
  isFact?: boolean;
}

// ══════════════════════════════════════════════
// Guard & Action 回调类型
// ══════════════════════════════════════════════

/** guard 函数：返回 true 允许转换 */
export type MemGuard = (ctx: MemTransitionContext) => boolean;

/** action 函数：转换成功后的副作用 */
export type MemAction = (ctx: MemTransitionContext) => void;

// ══════════════════════════════════════════════
// MemoryEntryStateMachine
// ══════════════════════════════════════════════

/**
 * MemoryEntryStateMachine —— 记忆状态机。
 * @since Core-2 — 接口固化，后续新增字段需向下兼容
 */
export class MemoryEntryStateMachine {
  private readonly _machine: StateMachine<MemState, MemEvent, MemTransitionContext>;
  private readonly _guardRegistry: GuardRegistry;
  private readonly _actionRegistry: ActionRegistry;

  constructor(
    initialState: MemState = "active",
    guards?: Partial<Record<string, MemGuard>>,
    actions?: Partial<Record<string, MemAction>>,
  ) {
    this._guardRegistry = new GuardRegistry();
    this._actionRegistry = new ActionRegistry();

    // ── 注册默认 guard ──
    this._registerDefaultGuards();
    if (guards) this._registerOverrideGuards(guards);

    // ── 注册默认 action ──
    this._registerDefaultActions();
    if (actions) this._registerOverrideActions(actions);

    // ── 构造状态机 ──
    this._machine = new StateMachine<MemState, MemEvent, MemTransitionContext>(
      MEMORY_ENTRY_FSM_DEFINITION,
      initialState,
      {
        guards: this._guardRegistry,
        actions: this._actionRegistry,
      },
    );
  }

  // ── 公共 API（MemoryStore.cas() 兼容） ──

  /**
   * CAS (Compare-And-Swap) 接口——与 MemoryStore.cas() 签名兼容。
   *
   * @param memoryId  记忆 ID（用于上下文）
   * @param expected  期望的当前状态
   * @param evt       目标事件
   * @param ctx       转换上下文
   * @returns 转换成功返回 true，失败（guard 拒绝/无效转换）返回 false
   */
  cas(
    memoryId: string,
    expected: MemState,
    evt: MemEvent,
    ctx?: Partial<MemTransitionContext>,
  ): boolean {
    // 当前状态不匹配期望 → 拒绝
    if (this._machine.current !== expected) return false;

    // 构造完整上下文以供 guard 评估
    const fullCtx: MemTransitionContext = {
      weight: ctx?.weight ?? 1,
      accessCount: ctx?.accessCount ?? 0,
      lastAccessedAt: ctx?.lastAccessedAt ?? Date.now(),
      memoryId,
      kind: ctx?.kind,
      isFact: ctx?.isFact,
    };

    // 检查事件是否合法（含 guard 评估）
    if (!this._machine.can(evt, fullCtx)) return false;

    try {
      this._machine.dispatch(evt, fullCtx);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 直接分发事件（不校验期望状态）。
   */
  dispatch(evt: MemEvent, ctx: MemTransitionContext): MemState {
    return this._machine.dispatch(evt, ctx);
  }

  /** 检查事件是否存在从当前状态的转换（不评估 guard） */
  can(evt: MemEvent): boolean {
    return this._machine.can(evt);
  }

  /** 检查事件是否可以通过 guard 评估（需要传递上下文） */
  canWithContext(evt: MemEvent, ctx: MemTransitionContext): boolean {
    return this._machine.can(evt, ctx);
  }

  /** 当前状态 */
  get current(): MemState {
    return this._machine.current;
  }

  /** 是否处于终态（Obliterated） */
  get isFinal(): boolean {
    return this._machine.isFinal;
  }

  /** 获取机器的审计记录 */
  get history(): ReadonlyArray<TransitionRecord<MemState, MemEvent, MemTransitionContext>> {
    return this._machine.history;
  }

  /** 重置状态机 */
  reset(_state: MemState = "active", clearHistory = true): void {
    // NOTE: StateMachine.reset() 只支持回到 initialState，所以我们需要重建
    this._machine.reset(clearHistory);
    // 如果目标状态不是 initialState，通过连续 dispatch 到达
    // 但 reset() 只能回到定义中的 initialState
    // 实际使用：通过构造函数重新创建
  }

  /** 序列化状态 */
  serialize(): ReturnType<typeof this._machine.serialize> {
    return this._machine.serialize();
  }

  /** 获取有效的转换事件列表（当前状态允许的事件，忽略 guard 结果） */
  get validEvents(): MemEvent[] {
    const currentState = this._machine.current;
    const events: MemEvent[] = [];
    for (const tr of MEMORY_ENTRY_FSM_DEFINITION.transitions) {
      if (tr.from === currentState && !events.includes(tr.event as MemEvent)) {
        events.push(tr.event as MemEvent);
      }
    }
    return events;
  }

  // ── 私有：默认 guard 注册 ──

  private _registerDefaultGuards(): void {
    // canCommit: Pending → Active，任何 Pending 记忆都可提交
    this._guardRegistry.register("canCommit", (_ctx: unknown) => true);

    // canArchive: Active → Archived，低权重或超时的记忆可归档
    this._guardRegistry.register("canArchive", (ctx: unknown) => {
      const c = ctx as MemTransitionContext | undefined;
      if (!c) return false; // 无上下文无法评估 → 拒绝
      const now = Date.now();
      const daysSinceAccess = (now - c.lastAccessedAt) / (24 * 60 * 60 * 1000);
      // 归档条件：weight < FSM_ARCHIVE_WEIGHT_THRESHOLD 或 30 天未访问
      return c.weight < FSM_ARCHIVE_WEIGHT_THRESHOLD || daysSinceAccess > 30;
    });

    // canObliterate: Active/Archived → Obliterated，允许任何非 Pending 条目湮灭
    this._guardRegistry.register("canObliterate", (_ctx: unknown) => true);

    // canRestore: Archived → Active，手动恢复
    this._guardRegistry.register("canRestore", (_ctx: unknown) => true);
  }

  // ── 私有：默认 action 注册 ──

  private _registerDefaultActions(): void {
    // onCommit: Pending → Active，设置 weight=1 等默认值
    this._actionRegistry.register("onCommit", (ctx: unknown) => {
      // 提交时机：外部可在 override action 中做额外处理
      void ctx;
    });

    // onRollback: Pending → Obliterated，清理未提交数据
    this._actionRegistry.register("onRollback", (ctx: unknown) => {
      void ctx;
    });

    // onArchive: Active → Archived，在外部完成 BM25 索引移除等操作
    this._actionRegistry.register("onArchive", (ctx: unknown) => {
      void ctx;
    });

    // onObliterate: → Obliterated，在外部完成索引移除
    this._actionRegistry.register("onObliterate", (ctx: unknown) => {
      void ctx;
    });

    // onRestore: Archived → Active，恢复 weight
    this._actionRegistry.register("onRestore", (ctx: unknown) => {
      void ctx;
    });
  }

  // ── 私有：外部 guard/action 覆盖 ──

  private _registerOverrideGuards(guards: Partial<Record<string, MemGuard>>): void {
    for (const [name, fn] of Object.entries(guards)) {
      if (fn) {
        // 先移除默认注册，再注册覆盖版本
        if (this._guardRegistry.has(name)) {
          this._guardRegistry.remove(name);
        }
        this._guardRegistry.register(name, fn as (ctx: unknown) => boolean);
      }
    }
  }

  private _registerOverrideActions(actions: Partial<Record<string, MemAction>>): void {
    for (const [name, fn] of Object.entries(actions)) {
      if (fn) {
        if (this._actionRegistry.has(name)) {
          this._actionRegistry.remove(name);
        }
        this._actionRegistry.register(name, fn as (ctx: unknown) => void);
      }
    }
  }
}
