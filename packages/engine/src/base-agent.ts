import { AgentStatus as AS, type TaskNode, type NodeResult, type AgentType, type MemoryQuery, type SafeErrorReporter, type MemoryEntry, type ReadMode, type Agent } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "./platform/toolkit.js";
import type { MemoryStore } from "./memory/memory-store.js";
import type { AgentPool } from "./core/agent-pool.js";
import { executeWithMemoryPipeline, resolvePipeline } from "./memory/pipeline.js";
import { PoolAwareState } from "./components/pool-aware.js";
import { DEFAULT_ENGINE_CONFIG } from "@cortex/config";
import type { IStep } from "./core/pipeline-runner.js";

/**
 * BaseAgent —— 所有 Agent 的抽象基类。
 * 封装生命周期、记忆检索与写入、ReAct 调度。
 * 子类只需定义 type 和 systemPrompt。
 */
export abstract class BaseAgent implements Agent {
  abstract readonly type: AgentType;
  abstract readonly systemPrompt: string;

  // 方案B：状态所有权归一，委托给 PoolAwareState 共享组件（消除复制粘贴）
  // 使用 `() => this.type` 延迟求值，避免 abstract property 初始化顺序问题
  protected readonly _state = new PoolAwareState(() => this.type);

  /** 方案B：Agent.status 只读 getter —— 委托到 PoolAwareState */
  get status(): AS {
    return this._state.status;
  }

  /** ReAct 循环上限。子类可覆写（如 InspectorAgent 用 24 以降低幻觉风险）。 */
  protected maxLoops = DEFAULT_ENGINE_CONFIG.defaultMaxLoops;

  /** SafeErrorReporter —— 统一错误上报，杜绝静默吞错
   *  注意：仅用于 executeWithMemoryPipeline 等非状态机的内部错误上报。
   *  状态机相关错误由 PoolAwareState 自行上报。 */
  protected _safeReporter: SafeErrorReporter | null = null;

  /** P0-六层防御：读路径 Intent 过滤回调（由 bootstrap 层注入 ConsistencyLayer.filterRead） */
  protected _filterRead?: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[];

  constructor(
    protected readonly llm: LlmAdapter,
    protected readonly toolkit: Toolkit,
    protected readonly memory?: MemoryStore,
  ) {}

  /** 注入 SafeErrorReporter（由 bootstrap 在上层统一注入）。双路径：自身 + PoolAwareState */
  setSafeReporter(reporter: SafeErrorReporter): void {
    this._safeReporter = reporter;
    this._state.setSafeReporter(reporter);
  }

  /** 注入读路径 Intent 过滤回调（P0-六层防御） */
  setFilterRead(fn: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[]): void {
    this._filterRead = fn;
  }

  /** 注入 AgentPool 引用（方案B：状态所有权归一） */
  setPool(pool: AgentPool, instanceId: string): void {
    this._state.setPool(pool, instanceId);
  }

  /** 方案B：内部状态变更——委托到 PoolAwareState.transition()
   *
   * 治理判例 NG-2026-0511-LocalStatus-Bypass：
   * 无 Pool 的降级路径仅允许测试/诊断环境使用，仍须校验流转合法性。
   * 禁止直接写入 _localStatus 绕过状态机。 */
  private _setStatus(status: AS): void {
    this._state.transition(status);
  }

  async wakeup(): Promise<void> {
    this._setStatus(AS.Awake);
  }

  /**
   * 执行前钩子——子类可覆写此方法注入前置事实采集（如 tsc 编译结果、workspaceRoot 路径）。
   * 默认原样返回 node。
   */
  protected preExecuteHook(node: TaskNode): TaskNode | Promise<TaskNode> {
    return node;
  }

  async execute(node: TaskNode, model: string): Promise<NodeResult> {
    this._setStatus(AS.Active);
    try {
      const enrichedNode = await this.preExecuteHook(node);
      const steps = this._selectPipeline(enrichedNode);
      const result = await executeWithMemoryPipeline(
        {
          agentType: this.type,
          llm: this.llm,
          toolkit: this.toolkit,
          systemPrompt: this.systemPrompt,
          maxLoops: this.maxLoops,
          reactLoopTimeoutMs: DEFAULT_ENGINE_CONFIG.reactLoopTimeoutMs,
          memory: this.memory,
        },
        enrichedNode,
        model,
        this.memory ? (n) => this.getMemoryQuery(n) : undefined,
        this._safeReporter ?? undefined,
        this._filterRead,
        steps,
      );
      return result;
    } finally {
      if (this.status === AS.Active) this._setStatus(AS.Awake);
    }
  }

  async shutdown(): Promise<void> {
    this._setStatus(AS.Draining);
    this._setStatus(AS.Destroyed);
  }

  // ── 管道策略选择 ──────────────────────

  /**
   * 根据 TaskNode.preferredStrategy 解析对应的 Step 管道。
   * 子类可覆写此方法定制策略选择逻辑。
   *
   * - "react"   → 默认 [MemoryRetrieval, ReActLoop, MemoryWrite]
   * - "direct"  → [DirectStep, MemoryWrite]  跳过记忆检索和 ReAct
   * - undefined  → 回退默认
   * - "decompose" / "jury" → 未来扩展
   */
  protected _selectPipeline(node: TaskNode): IStep[] | undefined {
    return resolvePipeline(node.preferredStrategy);
  }

  /**
   * 记忆检索策略模板方法。
   * 子类覆盖此方法定义各自的"回家路径"：
   * - CodeAgent: 优先 PRODUCED_BY + REFACTORED_FROM（工地日记）
   * - ReviewAgent: 优先 CITED_IN_COMMITTEE + REFACTORED_FROM（审查档案）
   * - DocGovernAgent: 优先 DEPENDS_ON + 含 Archived 态（审计追溯）
   * - AnalysisAgent: 优先 DERIVED_FROM（知识谱系）
   */
  // 改为 public 以满足 Agent 接口契约（MemoryAware.getMemoryQuery 为 public）
  getMemoryQuery(node: TaskNode): MemoryQuery {
    const payload = node.payload;
    const keywords: string[] = [];

    // 1. 中文关键词：提取 CJK 字符序列，用 2-gram 滑动窗口分词
    const cjkChars = payload.replace(/[^一-鿿㐀-䶿]/g, "");
    for (let i = 0; i <= cjkChars.length - 2; i++) {
      keywords.push(cjkChars.slice(i, i + 2));
    }

    // 2. 拉丁/英文关键词：现有 split(\s+) 逻辑，保留向后兼容
    const latinWords = payload.split(/\s+/).filter((w) => w.length > 3);
    keywords.push(...latinWords);

    return {
      keywords,
      kind: "TaskLog" as const,
      limit: 5,
    };
  }

}
