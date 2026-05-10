import type { TaskNode, NodeResult, AgentType, MemoryQuery, SafeErrorReporter } from "@cortex/shared";
import { Agent, AgentStatus as AS, MemoryType, LinkType } from "@cortex/shared";
import type { LlmAdapter } from "./llm-adapter.js";
import type { Toolkit } from "./toolkit.js";
import type { MemoryStore } from "./memory-store.js";
import type { AgentPool } from "./agent-pool.js";
import { runReActLoop } from "./react-helper.js";

/**
 * BaseAgent —— 所有 Agent 的抽象基类。
 * 封装生命周期、记忆检索与写入、ReAct 调度。
 * 子类只需定义 type 和 systemPrompt。
 */
export abstract class BaseAgent implements Agent {
  abstract readonly type: AgentType;
  abstract readonly systemPrompt: string;

  // 方案B：AgentPool 为状态唯一权威源
  // status 改为只读 getter，委托到 AgentPool
  // _localStatus 为测试环境（无 Pool）提供降级支持
  private _localStatus = AS.Created;
  private _pool: AgentPool | null = null;
  private _instanceId: string | null = null;

  /** 方案B：Agent.status 只读 getter —— Pool 有则委托，否则降级到 _localStatus */
  get status(): AS {
    if (this._pool && this._instanceId) {
      const s = this._pool.getStatus(this._instanceId);
      if (s !== undefined) return s;
    }
    return this._localStatus;
  }

  /** ReAct 循环上限。子类可覆写（如 InspectorAgent 用 24 以降低幻觉风险）。 */
  protected maxLoops = 48;

  /** SafeErrorReporter —— 统一错误上报，杜绝静默吞错 */
  protected _safeReporter: SafeErrorReporter | null = null;

  constructor(
    protected readonly llm: LlmAdapter,
    protected readonly toolkit: Toolkit,
    protected readonly memory?: MemoryStore,
  ) {}

  /** 注入 SafeErrorReporter（由 bootstrap 在上层统一注入） */
  setSafeReporter(reporter: SafeErrorReporter): void {
    this._safeReporter = reporter;
  }

  /** 注入 AgentPool 引用（方案B：状态所有权归一） */
  setPool(pool: AgentPool, instanceId: string): void {
    this._pool = pool;
    this._instanceId = instanceId;
  }

  /** 方案B：内部状态变更——Pool 有则走 Pool（唯一权威源），否则写 _localStatus */
  private _setStatus(status: AS): void {
    if (this._pool && this._instanceId) {
      this._pool.setStatus(this._instanceId, status);
    } else {
      this._localStatus = status;
    }
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
      const result = this.memory
        ? await this._executeWithMemory(enrichedNode, model)
        : await runReActLoop(this.type, this.llm, this.toolkit, this.systemPrompt, enrichedNode, model, this.maxLoops);
      return result;
    } finally {
      if (this.status === AS.Active) this._setStatus(AS.Awake);
    }
  }

  async shutdown(): Promise<void> {
    this._setStatus(AS.Draining);
    this._setStatus(AS.Destroyed);
  }

  // ── 记忆增强执行 ──────────────────────────────────

  /**
   * 记忆检索策略模板方法。
   * 子类覆盖此方法定义各自的"回家路径"：
   * - CodeAgent: 优先 PRODUCED_BY + REFACTORED_FROM（工地日记）
   * - ReviewAgent: 优先 CITED_IN_COMMITTEE + REFACTORED_FROM（审查档案）
   * - DocGovernAgent: 优先 DEPENDS_ON + 含 Archived 态（审计追溯）
   * - AnalysisAgent: 优先 DERIVED_FROM（知识谱系）
   */
  protected getMemoryQuery(node: TaskNode): MemoryQuery {
    const payload = node.payload;
    const keywords: string[] = [];

    // 1. 中文关键词：提取 CJK 字符序列，用 2-gram 滑动窗口分词
    //    "修复计算器按钮点击事件" → ["修复","复计","计算","算器","器按","按钮","钮点","点击","击事","事件"]
    //    无需外部 NLP 库——bigram 在 SQL LIKE 中匹配召回率足够。
    const cjkChars = payload.replace(/[^一-鿿㐀-䶿]/g, "");
    for (let i = 0; i <= cjkChars.length - 2; i++) {
      keywords.push(cjkChars.slice(i, i + 2));
    }

    // 2. 拉丁/英文关键词：现有 split(\s+) 逻辑，保留向后兼容
    const latinWords = payload.split(/\s+/).filter((w) => w.length > 3);
    keywords.push(...latinWords);

    return {
      keywords,
      memoryTypes: [MemoryType.Episodic],
      limit: 5,
    };
  }

  private async _executeWithMemory(node: TaskNode, model: string): Promise<NodeResult> {
    if (this.memory) {
      const query = this.getMemoryQuery(node);
      const ctx = this.memory.read(query);
      if (ctx.length > 0) {
        const ctxSummary = ctx.map((m) => `[记忆] ${m.summary}`).join("\n");
        const enrichedNode: TaskNode = {
          ...node,
          payload: `上下文记忆：\n${ctxSummary}\n\n任务：${node.payload}`,
        };
        return this._executeAndRemember(enrichedNode, model);
      }
    }
    return this._executeAndRemember(node, model);
  }

  private async _executeAndRemember(node: TaskNode, model: string): Promise<NodeResult> {
    const result = await runReActLoop(
      this.type, this.llm, this.toolkit, this.systemPrompt, node, model, this.maxLoops,
    );
    if (this.memory && result.success) {
      // 结构化经验内容：区分常规任务和修复节点
      const isFix = node.type === "bugfix" || node.type === "refactor";
      const content: Record<string, unknown> = {
        taskType: node.type,
        entities: node.tags,
        decision: result.output ?? "",
        outcome: "success",
      };
      if (isFix) {
        // bugfix/refactor 节点：把这次修了什么坑记录下来
        content.pitfall = node.payload.slice(0, 300);
        content.lesson = `${this.type} successfully fixed a ${node.type}. The original error context is preserved above.`;
      }

      try {
        const memId = this.memory.write({
          memoryType: MemoryType.Episodic,
          content,
          summary: isFix
            ? `[修复记录] ${this.type} 修复了 ${node.type}: ${node.payload.slice(0, 100)}`
            : `${this.type} 完成 ${node.type} 任务: ${node.payload.slice(0, 120)}`,
          agentType: this.type,
          creatorId: this.type,
          metadata: { taskId: node.id, nodeType: node.type, tags: node.tags },
        });
        const ctxMemId = this.memory.write({
          memoryType: MemoryType.Episodic,
          content: { nodeId: node.id, nodeType: node.type, tags: node.tags },
          summary: `[上下文] 节点 ${node.id} (${node.type}): ${node.payload.slice(0, 60)}`,
          agentType: this.type,
          creatorId: this.type,
          metadata: { taskId: node.id },
        });
        this.memory.link(memId, ctxMemId, LinkType.ProducedBy, this.type);

        // 修复节点：额外链接到父任务（如果有 parentId）
        if (isFix && node.parentId) {
          const parentMemories = this.memory.read({
            metadataFilter: { taskId: node.parentId },
            limit: 1,
          });
          if (parentMemories.length > 0) {
            this.memory.link(memId, parentMemories[0].id, LinkType.ProducedBy, this.type);
          }
        }
      } catch (memErr) {
        // 记忆写入失败不阻塞任务结果——任务已完成，记忆不可靠但可恢复
        if (this._safeReporter) {
          this._safeReporter({
            source: `${this.type}._executeAndRemember`,
            error: memErr,
            severity: "degraded",
            hint: `任务 ${node.id} 已成功完成，但记忆写入失败`,
          });
        }
      }
    }
    return result;
  }
}
