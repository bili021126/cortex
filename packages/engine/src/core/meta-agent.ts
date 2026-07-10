// @cortex/engine/core/meta-agent —— MetaAgent 战术中枢（甘雨）
// @layer 规划-执行层
// @role 事轴起点——意图拆解为粗粒度 TaskNode 树

import { extractJsonBlock, PipelinePriority, PipelineEventType, type IPipelineObserver, type ImpactScope, type ObservableEvent, type ReplanResult, type SafeErrorReporter, type SkillTemplate, type Tag, type TaskNode } from "@cortex/shared";
import { PRESET_CONTEXT_POLICIES } from "@cortex/config";
import type { LlmAdapter } from "@cortex/llm";
import type { ContextManager } from "@cortex/context-manager";
import {
  buildPlanningSystem,
  buildPlanningSystemBlank,
  REPLAN_SYSTEM,
  PIPELINE_CTX_MAX_OUTPUT_LEN,
  PIPELINE_CTX_MAX_ERROR_LEN,
  PIPELINE_CTX_RECENT_LIMIT,
  PIPELINE_CTX_HARD_CAP,
  VALID_TIERS,
} from "@cortex/config";
import type { SkillRegistry } from "@cortex/skill-kit";
import type { PromptManager, PlanningPromptBlocks } from "./prompt-manager.js";
import { DegradationBoundary } from "./degradation-boundary.js";
import type { LoopStrategyRegistry } from "./loop-strategy-registry.js";

/**
 * MetaAgent —— 战术引擎。
 * 接收用户意图，拆解为 TaskNode 树，写入 TaskBoard。
 * 独享 DeepSeek V4 Flash 思考模式（reasoner 模型，仅甘雨/钟离/霜凝升格为 V4 Pro）。
 *
 * @contract 模块边界契约（久岐忍 P1-5：模块边界缺少显式契约化定义 → 已闭合）
 *
 *   plan(intent) → TaskNode[]：纯函数式规划，不写板
 *   requestReplan(failedNode, reason, count) → ReplanResult：基于失败诊断生成替代方案
 *
 *   调用方（Scheduler）的责任：
 *   - plan() 返回的 TaskNode[] 由调用方 add 到 TaskBoard
 *   - requestReplan() 返回的 nodes 由 Scheduler._drainReplanQueue add 到 TaskBoard（领而不执）
 *   - 调用方负责节点在 TaskBoard 中的生命周期管理
 *
 *   异常语义：
 *   - JSON 解析失败不抛异常——回退为单个 generic fallbackNode
 *   - LLM 调用失败由 LlmAdapter 抛出，调用方 catch
 *   - skillRegistry 缺失不阻塞规划——跳过技能增强
 *
 * 可选集成 SkillRegistry：规划时查询已沉淀的技能模板，
 * 注入 prompt 上下文，提升任务拆解精准度。
 *
 * @fix 久岐忍 P1-3：SkillRegistry 实现类从 @cortex/shared 移入本包。
 *   shared 仅保留 SerializedSkillRegistry 类型。
 * @fix D5 — _parseReplanResult 支持简洁数组格式中的 impactScope 字段，
 *   防止 LLM 输出数组格式时 impactScope 被静默认为 "local"。
 */

export class MetaAgent {
  private _nodeCounter = 0; // 防 Date.now() 高频碰撞
  private _safeReporter?: SafeErrorReporter;
  private _skillRegistry?: SkillRegistry;
  private _observer?: IPipelineObserver;
  /** 处理函数引用——用于 shutdown 时精确退订 */
  private _onNodeComplete?: (event: ObservableEvent) => void;
  private _onNodeFailed?: (event: ObservableEvent) => void;
  /** 管线事件积累——plan() 调用时注入 prompt 上下文 */
  private _pipelineContext: string[] = [];
  private readonly _planningSystem: string;
  private readonly _replanSystem: string;
  private _workspaceRoot?: string;
  private _promptManager?: PromptManager;
  private _loopStrategyRegistry?: LoopStrategyRegistry;
  /** Phase 3: 上下文管理器（可选注入——保留 fallback 逻辑） */
  private _contextManager?: ContextManager;

  constructor(
    private readonly llm: LlmAdapter,
    skillRegistry?: SkillRegistry,
    planningSystemPrompt?: string,
    replanSystemPrompt?: string,
    observer?: IPipelineObserver,
    workspaceRoot?: string,
    contextManager?: ContextManager,
  ) {
    this._skillRegistry = skillRegistry;
    this._planningSystem = planningSystemPrompt ?? buildPlanningSystemBlank();
    this._replanSystem = replanSystemPrompt ?? REPLAN_SYSTEM;
    this._workspaceRoot = workspaceRoot;
    this._contextManager = contextManager;
    if (observer) this.setObserver(observer);
  }

  /** 注入上下文管理器（可后置绑定 Phase 3） */
  setContextManager(cm: ContextManager): void {
    this._contextManager = cm;
  }

  /** RLM 拆解用的 LLM 适配器（只读）。Scheduler 通过此入口注入 decompose() 的 LLM 调用能力。 */
  get llmAdapter(): LlmAdapter {
    return this.llm;
  }

  /** 注入/更新工作区根路径 */
  setWorkspaceRoot(root: string): void {
    this._workspaceRoot = root;
  }

  /** 注入技能注册表（可后置绑定） */
  setSkillRegistry(registry: SkillRegistry): void {
    this._skillRegistry = registry;
  }

  /** Core-2: 注入技能作用域上下文（包名 + agentType） */
  private _skillScope?: SkillScope;
  /** Core-2: 注入仿真运行器（依赖注入替代直接 import） */
  private _simulationRunner?: SimRunner;
  /** 注入 resolveByScope 函数（依赖注入替换 direct import） */
  private _resolveByScope?: (allSkills: SkillTemplate[], scope: SkillScope) => SkillTemplate[];

  setSkillScope(scope: SkillScope): void {
    this._skillScope = scope;
  }

  setSimulationRunner(r: SimRunner): void {
    this._simulationRunner = r;
  }

  /** 注入技能作用域解析函数 */
  setResolveByScope(fn: (allSkills: SkillTemplate[], scope: SkillScope) => SkillTemplate[]): void {
    this._resolveByScope = fn;
  }

  /** 注入 PromptManager（prompt-kit 编排器，可后置绑定） */
  setPromptManager(manager: PromptManager): void {
    this._promptManager = manager;
  }

  /** 注入循环策略注册表（策略顾问上下文注入，可后置绑定） */
  setLoopStrategyRegistry(registry: LoopStrategyRegistry): void {
    this._loopStrategyRegistry = registry;
  }

  /** 注入管线——MetaAgent 订阅节点事件以获取执行层信息 */
  setObserver(observer: IPipelineObserver): void {
    if (this._observer) this._unsubscribe();
    this._observer = observer;
    // 订阅 NodeComplete（只接——获取 Agent 执行产出）
    // NodeComplete 以 HIGH 优先级发射（cleanup-step.ts + scheduler._dispatchMulti）
    this._onNodeComplete = (event: ObservableEvent) => {
      if (event.type === PipelineEventType.NodeComplete) {
        const { nodeId, agentType, output } = event.payload as { nodeId: string; agentType: string; success: true; output?: string };
        if (output) {
          this._enqueuePipelineCtx(`[${agentType}] ${nodeId}: ${output.slice(0, PIPELINE_CTX_MAX_OUTPUT_LEN)}`);
        }
      }
    };
    observer.on(PipelinePriority.HIGH, this._onNodeComplete);
    // 订阅 NodeFailed（只收——感知执行失败）
    // NodeFailed 以 CRITICAL 优先级发射（scheduler._dispatchNode）
    this._onNodeFailed = (event: ObservableEvent) => {
      if (event.type === PipelineEventType.NodeFailed) {
        const { nodeId, error } = event.payload as { nodeId: string; error: string };
        this._enqueuePipelineCtx(`[FAILED] ${nodeId}: ${error.slice(0, PIPELINE_CTX_MAX_ERROR_LEN)}`);
      }
    };
    observer.on(PipelinePriority.CRITICAL, this._onNodeFailed);
  }

  /** 注入错误上报通道（observer 双通道模式） */
  setSafeReporter(reporter: SafeErrorReporter): void {
    this._safeReporter = reporter;
  }

  /** 订阅终止——精确退订已注册的 handler，防止误删其他组件 */
  private _unsubscribe(): void {
    if (!this._observer) return;
    if (this._onNodeComplete) this._observer.off(PipelinePriority.HIGH, this._onNodeComplete);
    if (this._onNodeFailed) this._observer.off(PipelinePriority.CRITICAL, this._onNodeFailed);
    this._onNodeComplete = undefined;
    this._onNodeFailed = undefined;
  }

  /** 将事件入队到管线上下文（带硬上限防内存泄漏） */
  private _enqueuePipelineCtx(entry: string): void {
    if (this._pipelineContext.length >= PIPELINE_CTX_HARD_CAP) {
      // 截半保留最近事件
      this._pipelineContext = this._pipelineContext.slice(-Math.floor(PIPELINE_CTX_HARD_CAP / 2));
    }
    this._pipelineContext.push(entry);
  }

  /** 清空管线上下文积累（每次 plan() 调用后重置） */
  private _clearPipelineContext(): void {
    this._pipelineContext = [];
  }

  /** 获取当前积累的管线上下文 */
  private _getPipelineContext(): string {
    if (this._pipelineContext.length === 0) return "";
    const recent = this._pipelineContext.slice(-PIPELINE_CTX_RECENT_LIMIT);
    return `\nRecent execution context (from pipeline):\n${recent.map((c) => `  ${c}`).join("\n")}\n`;
  }

  /**
   * 重规划：当节点执行失败时，基于"原始意图 vs 当前事实"的冲突生成替代方案。
   * @param failedNode 失败的节点（含 payload/tags/type 上下文）
   * @param reason 失败原因（Agent 错误信息）
   * @param replanCount 当前重规划轮次
   * @param originalIntent 原始用户意图（用于冲突对比）
   * @returns ReplanResult { nodes, impactScope }
   */
  async requestReplan(
    failedNode: TaskNode,
    reason: string,
    replanCount: number,
    originalIntent?: string,
    maxReplan = 3,
  ): Promise<ReplanResult> {
    const prompt = [
      `Original intent: ${originalIntent ?? failedNode.payload}`,
      `Original task failed (attempt ${replanCount + 1}/${maxReplan}):`,
      `Task: ${failedNode.payload}`,
      `Tags: ${failedNode.tags.join(", ")}`,
      `Error: ${reason}`,
      "",
      "Analyze the conflict between the original plan and what actually happened.",
      "Generate an ALTERNATIVE approach. Do NOT repeat the same plan.",
      `Parent node ID: ${failedNode.parentId ?? "none"}`,
      "",
      "Also assess IMPACT SCOPE:",
      '- "local": only this node needs replacing. Downstream subtasks (children of this node) are still valid.',
      '- "subtree": this node\'s failure invalidates all downstream subtasks. The entire subtree must be replaced.',
      "",
      "Output JSON with two fields:",
      '{"tasks": [...], "impactScope": "local"|"subtree"}',
      "tasks: array of alternative TaskNode objects (1-3 tasks, narrower than original. Each MUST have isRlmSubtask:true and reasoningEffort:max).",
      "impactScope: the assessed scope of impact.",
    ].join("\n");

    const res = await this.llm.chat(this.llm.reasonerModel, [
      { role: "system", content: this._replanSystem },
      { role: "user", content: prompt },
    ]);

    return this._parseReplanResult(res.content ?? "", failedNode.parentId);
  }

  /**
   * 边界违规重规划——Agent 越界写入越权文件时回调。
   *
   * 与 requestReplan 的关键区别：
   * - 任务执行"成功"了，但 Agent 踩进了不该碰的文件域
   * - 下游任务（如 code agent）可能发现文件已被 analysis 写入——需重新规划
   * - impactScope 默认 subtree（越界代码可能污染整个上下游链）
   *
   * @param violatingNode 越界的节点
   * @param boundaryReason 边界违规描述（含越界文件列表）
   * @param replanCount 重规划轮次
   * @param originalIntent 原始用户意图
   */
  async requestBoundaryReplan(
    violatingNode: TaskNode,
    boundaryReason: string,
    replanCount: number,
    originalIntent?: string,
    maxReplan = 3,
  ): Promise<ReplanResult> {
    const prompt = [
      `Original intent: ${originalIntent ?? violatingNode.payload}`,
      `Boundary violation on task (attempt ${replanCount + 1}/${maxReplan}):`,
      `Task: ${violatingNode.payload}`,
      `Tags: ${violatingNode.tags.join(", ")}`,
      `Violating agent type: ${violatingNode.type}`,
      `Boundary violation detail: ${boundaryReason}`,
      "",
      "CONTEXT:",
      "The task was NOT a failure—it SUCCEEDED. But the agent wrote files outside its allowed domain.",
      "For example, an analysis agent wrote package.json/tsconfig.json/src/ files that code agent should write.",
      "This means downstream tasks may find files already exist, causing conflicts.",
      "",
      "YOUR JOB:",
      "1. If analysis wrote implementation code → the downstream implementation/code node should become a review or fix",
      "2. If review wrote implementation code → replace review with inspect + add code node",
      "3. NEVER generate a node that duplicates work already done by the violating agent",
      "4. impactScope should be 'subtree' (violation may affect all downstream)",
      "5. Keep output minimal: 1-3 nodes to patch the disruption",
      "",
      `Parent node ID: ${violatingNode.parentId ?? "none"}`,
      "",
      "Output JSON with two fields:",
      '{"tasks": [...], "impactScope": "subtree"}',
      "tasks: array of alternative TaskNode objects (1-3 tasks, each with isRlmSubtask:true, reasoningEffort:max).",
      "impactScope: use 'subtree' unless absolutely certain only local is affected.",
    ].join("\n");

    const res = await this.llm.chat(this.llm.reasonerModel, [
      { role: "system", content: this._replanSystem },
      { role: "user", content: prompt },
    ]);

    return this._parseReplanResult(res.content ?? "", violatingNode.parentId);
  }

  /**
   * 意图明晰化确认：在拆解任务前，向用户确认理解是否正确。
   * 仅解析意图关键要素（目标/类型/范围/约束），不产生 TaskNode。
   * 用户在确认后可直接 .yes 进入规划，或输入修正。
   */
  async clarifyIntent(intent: string): Promise<IntentClarification> {
    const prompt = [
      `Analyze the following user intent and extract its key elements. Return ONLY a JSON object (no markdown, no code fences):`,
      `{"goal":"<one-line summary of primary goal>","actionType":"analysis|modification|audit|refactor|generation|inquiry","scope":"<what part of the project is targeted>","constraints":"<any explicit constraints mentioned>","unclear":"<any ambiguous parts or null if clear>"}`,
      ``,
      `User intent: ${intent}`,
    ].join("\n");

    const res = await this.llm.chat(this.llm.reasonerModel, [
      { role: "system", content: "You are a precise intent parser. Extract structured intent from user input. Respond only with the JSON object, no other text." },
      { role: "user", content: prompt },
    ]);

    return this._parseClarification(res.content ?? "", intent);
  }

  /** 解析意图确认结果 */
  private _parseClarification(raw: string, originalIntent: string): IntentClarification {
    try {
      const cleaned = raw
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();
      const parsed = JSON.parse(cleaned);
      return {
        goal: typeof parsed.goal === "string" ? parsed.goal : originalIntent.slice(0, 80),
        actionType: this._normalizeActionType(parsed.actionType),
        scope: typeof parsed.scope === "string" ? parsed.scope : "未指定",
        constraints: typeof parsed.constraints === "string" ? parsed.constraints : "无",
        unclear: parsed.unclear && typeof parsed.unclear === "string" ? parsed.unclear : undefined,
        originalIntent,
      };
    } catch (err) {
      DegradationBoundary.handle(err, 'meta-agent', 'trace');
      return {
        goal: originalIntent.slice(0, 80),
        actionType: "inquiry",
        scope: "未指定",
        constraints: "无",
        originalIntent,
      };
    }
  }

  private readonly _validActionTypes = new Set(["analysis", "modification", "audit", "refactor", "generation", "inquiry"]);

  private _normalizeActionType(raw: unknown): IntentClarification["actionType"] {
    if (typeof raw === "string" && this._validActionTypes.has(raw)) {
      return raw as IntentClarification["actionType"];
    }
    return "inquiry";
  }

  /**
   * 规划：将用户意图拆解为 TaskNode 列表。
   * 返回的节点 `parentId` 关系已建立，可直接 add 到 TaskBoard。
   */
  async plan(
    intent: string,
    context?: PlanContext,
  ): Promise<TaskNode[]> {
    try {
      const t0 = Date.now();
      const nodes = await this._generatePlan(intent, context);
      // ── 遥测：MetaAgent 规划耗时 ──
      // eslint-disable-next-line no-console
      console.log(`[telemetry] meta.plan_time_ms value=${Date.now() - t0} nodesCount=${nodes.length}`);

      // ── 仿真层因果推演 ──
      // 对已规划的节点做轻量风险评估，若建议重规划则触发遥测
      if (this._simulationRunner) {
        const simResult = await this._simulationRunner.simulate({
          planNodes: nodes.map((n) => ({ type: n.type, intent: n.payload ?? "" })),
          currentState: {},
          constraints: [],
        });
        if (simResult.suggestedReplan || simResult.riskLevel === "high") {
          // eslint-disable-next-line no-console
          console.log(`[telemetry] meta.replan_from_simulation risk=${simResult.riskLevel}`);
          // 重规划：重新生成计划
          const replanResult = await this._generatePlan(intent, context);
          if (replanResult.length > 0) {
            return replanResult;
          }
        }
      }

      return nodes;
    } finally {
      // 无论 LLM 调用成功或异常，都必须清理，防止下一次 plan() 注入过期上下文
      this._clearPipelineContext();
    }
  }

  /**
   * 生成计划：调用 LLM 规划并解析为 TaskNode 列表。
   * 提取为独立方法以供 plan() 首次生成和仿真重规划复用。
   */
  private async _generatePlan(intent: string, context?: PlanContext): Promise<TaskNode[]> {
    const prompt = await this._planningPrompt(intent, context);
    const systemPrompt = this._workspaceRoot
      ? buildPlanningSystem(this._workspaceRoot)
      : this._planningSystem;
    const res = await this.llm.chat(this.llm.reasonerModel, [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ]);
    return this._parsePlan(res.content ?? "", context?.parentId);
  }

  /**
   * 生成规划 prompt。
   *
   * 当 PromptManager 已注入时，走声明式块组装（assembler）；
   * 否则回退到手拼 parts.join("\n") 以保持向后兼容。
   */
  private async _planningPrompt(intent: string, context?: PlanContext): Promise<string> {
    // ── PromptManager 路径：声明式块组装 ──
    if (this._promptManager) {
      const blocks: PlanningPromptBlocks = {};

      if (context?.parentId) {
        blocks.parentContext = `Parent node: ${context.parentId}`;
      }
      if (context?.existingTags && context.existingTags.length > 0) {
        blocks.existingTags = `Existing context tags: ${context.existingTags.join(", ")}`;
      }

      const pipeCtx = this._getPipelineContext();
      if (pipeCtx) {
        blocks.pipelineContext = pipeCtx;
      }

      // 技能增强
      const existingTags = context?.existingTags;
      if (this._skillRegistry && existingTags) {
        const scope = this._skillScope ?? {};
        const skills = this._resolveByScope
          ? this._resolveByScope(this._skillRegistry.getAll(), scope)
          : [];
        const matched = skills.filter((s) =>
          existingTags.some((t) => (s.triggerTags as readonly string[]).includes(t)),
        );
        if (matched.length > 0) {
          const skillLines = matched.map((s) =>
            `  · ${s.name} (id:${s.id}) [${s.kind}] tags:[${s.triggerTags.join(",")}] — ${s.trigger}`,
          );
          blocks.skillContext =
            `Available skill templates (pre-existing patterns):\n${skillLines.join("\n")}\n\n` +
            "You MAY reference these skills in your plan by mentioning their id in the payload. " +
            "These are vetted, repeatable workflows — prefer them over inventing new task sequences.";
        }
      }

      // 策略顾问上下文
      if (this._loopStrategyRegistry) {
        blocks.advisorContext =
          "Available loop strategies (set preferredStrategy on task nodes):\n" +
          this._loopStrategyRegistry.getAdvisorContext() +
          "\n\nChoose the most appropriate strategy for each task based on its nature.";
      }

      blocks.intent = `User intent: ${intent}`;

      return await this._promptManager.assemblePlanningPrompt(blocks);
    }

    // ── 回退路径：原始手拼方式（向后兼容） ──
    const parts: string[] = [];

    if (context?.parentId) {
      parts.push(`Parent node: ${context.parentId}`);
    }
    if (context?.existingTags && context.existingTags.length > 0) {
      parts.push(`Existing context tags: ${context.existingTags.join(", ")}`);
    }

    // ── 管线上下文（v2.5.41 新增——原则二双向下放后在 MetaAgent 侧的落点）──
    const pipeCtx = this._getPipelineContext();
    if (pipeCtx) {
      parts.push(pipeCtx);
    }

      // 技能增强
      const existingTags = context?.existingTags;
      if (this._skillRegistry && existingTags) {
        const scope = this._skillScope ?? {};
        const skills = this._resolveByScope
          ? this._resolveByScope(this._skillRegistry.getAll(), scope)
          : [];
        const matched = skills.filter((s) =>
          existingTags.some((t) => (s.triggerTags as readonly string[]).includes(t)),
        );
      if (matched.length > 0) {
        const skillLines = matched.map((s) =>
          `  · ${s.name} (id:${s.id}) [${s.kind}] tags:[${s.triggerTags.join(",")}] — ${s.trigger}`,
        );
        parts.push(
          `Available skill templates (pre-existing patterns):\n${skillLines.join("\n")}\n\n` +
          "You MAY reference these skills in your plan by mentioning their id in the payload. " +
          "These are vetted, repeatable workflows — prefer them over inventing new task sequences.",
        );
      }
    }

    // ── 策略顾问上下文 ──
    if (this._loopStrategyRegistry) {
      parts.push(
        "Available loop strategies (set preferredStrategy on task nodes):\n" +
        this._loopStrategyRegistry.getAdvisorContext() +
        "\n\nChoose the most appropriate strategy for each task based on its nature.",
      );
    }

    parts.push(`User intent: ${intent}`);

    return parts.join("\n");
  }

  /** 从 LLM 输出提取 JSON（委托 @cortex/shared 统一实现，失败时回退原始字符串）。 */
  private _extractJson(raw: string): string {
    return extractJsonBlock(raw) ?? raw;
  }

  /** 构造兜底 TaskNode（JSON 解析失败时） */
  private _fallbackNode(raw: string, parentId?: string): TaskNode {
    return {
      id: `task-${Date.now()}-0`,
      parentId,
      type: "analysis",
      tags: ["analysis"] as Tag[],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: raw,
      results: [],
      createdAt: Date.now(),
      contextPolicyId: "diagnose",
    };
  }

  /** 从 LLM 输出解析 JSON 任务树 */
  private _parsePlan(raw: string, parentId?: string): TaskNode[] {
    // 多级容错策略：extractJson → raw直接 → 修复常见JSON问题
    const candidates = [
      this._extractJson(raw),
      raw, // LLM 可能直接输出干净 JSON
    ];

    for (const candidate of candidates) {
      const items = this._tryParseItems(candidate);
      if (items !== null) {
        // 空数组是合法结果：工作区边界拒绝 / 无操作必要
        // 直接返回 [] 让调用方处理，不生成垃圾兜底节点
        if (items.length === 0) return [];
        return items.flatMap((item, i) => this._toTaskNode(item, parentId, i));
      }
    }

    const msg = `JSON 解析失败 (${raw.length} chars)，回退为单 generic 节点。原始输出前200字: ${raw.slice(0, 200)}`;
    if (this._safeReporter) {
      this._safeReporter({ source: "MetaAgent._parsePlan", error: msg, severity: "degraded" });
    } else if (this._observer) {
      this._observer.emit({
        type: PipelineEventType.InfraComponentDegraded,
        priority: PipelinePriority.NORMAL,
        payload: { component: "MetaAgent", operation: "_parsePlan", detail: msg },
        timestamp: Date.now(),
        notificationType: "FYI",
      });
    }
    return [this._fallbackNode(raw, parentId)];
  }

  /** 尝试解析 JSON 为 PlanItem[]，自动修复常见 LLM 格式问题 */
  private _tryParseItems(jsonStr: string): PlanItem[] | null {
    if (!jsonStr || jsonStr.length < 2) return null;

    // 策略 1: 直接解析
    try { return JSON.parse(jsonStr); } catch (err) { DegradationBoundary.handle(err, 'meta-agent', 'trace'); }
    
    // 策略 2: 去除尾部多余逗号（LLM 经典错误）
    try { return JSON.parse(jsonStr.replace(/,\s*([\]}])/g, "$1")); } catch (err) { DegradationBoundary.handle(err, 'meta-agent', 'trace'); }
    
    // 策略 3: 截取首 [ 到末 ]，再做一次字符串感知提取（双保险）
    const firstBracket = jsonStr.indexOf("[");
    const lastBracket = jsonStr.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      const trimmed = jsonStr.slice(firstBracket, lastBracket + 1);
      try { return JSON.parse(trimmed); } catch (err) { DegradationBoundary.handle(err, 'meta-agent', 'trace'); }
      try { return JSON.parse(trimmed.replace(/,\s*([\]}])/g, "$1")); } catch (err) { DegradationBoundary.handle(err, 'meta-agent', 'trace'); }
    }

    return null;
  }

  /** 将 PlanItem 转为 TaskNode[]（自身 + 所有子孙） */
  private _toTaskNode(item: PlanItem, parentId: string | undefined, index: number): TaskNode[] {
    const now = Date.now();
    const nodeId = `task-${now}-${this._nodeCounter++}-${index}`;

    // 子任务递归——拿到的是扁平数组，每个子节点的 parentId 已指回当前节点
    const children: TaskNode[] = (item.children ?? []).flatMap((child, ci) =>
      this._toTaskNode(child, nodeId, ci),
    );

    // 推理深度：LLM 可显式指定，否则按标签智能默认
    const reasoningEffort: "high" | "max" =
      item.reasoningEffort ??
      (item.tags?.some((t) => t === "audit" || t === "constitution_check") ? "max" : "high");

    const self: TaskNode = {
      id: nodeId,
      parentId,
      type: item.type ?? "analysis",
      tags: (item.tags ?? ["code"]) as Tag[],
      needsMultiPerspective: item.needsMultiPerspective ?? false,
      status: "pending",
      claimedBy: [],
      payload: item.task,
      results: [],
      createdAt: now,
      reasoningEffort,
      recommendedTier: _validTier(item.recommendedTier),
      contextPolicyId: this._resolveContextPolicy(item),
    };

    // 如果 intent 中包含文件路径，注入到节点元数据
    if ((item.type === "code" || item.type === "implementation") && item.task) {
      const pathMatch = item.task.match(/["']?([\w./_-]+\.\w+)["']?/);
      if (pathMatch) {
        (self as any)._outputPath = pathMatch[1];
      }
    }

    return [self, ...children];
  }

  /** 解析 ReplanResult：从 LLM 输出提取 tasks + impactScope */
  private _parseReplanResult(raw: string, parentId?: string): ReplanResult {
    const jsonStr = this._extractJson(raw);

    try {
      const parsed = JSON.parse(jsonStr);
      // 兼容两种格式：LLM 规范输出 {"tasks":[...], "impactScope":"..."}
      // 以及简洁数组格式 [{task, type, tags, ...}]
      const items: PlanItem[] = Array.isArray(parsed) ? parsed : (parsed.tasks ?? []);
      // impactScope: 支持对象格式与简洁数组格式
      // 数组格式无 impactScope 字段，仅对象格式支持
      const impactScope: ImpactScope =
        (!Array.isArray(parsed) && parsed.impactScope === "subtree") ? "subtree" : "local";
      const nodes = items.flatMap((item, i) => this._toTaskNode(item, parentId, i));
      return { nodes, impactScope };
    } catch (err) {
      this._observer?.emit({
        type: PipelineEventType.InfraComponentDegraded,
        priority: PipelinePriority.NORMAL,
        payload: { component: "MetaAgent", operation: "_parseReplanResult", detail: `Replan JSON解析失败: ${String(err)}` },
        timestamp: Date.now(),
        notificationType: "FYI",
      });
      return { nodes: [this._fallbackNode(raw, parentId)], impactScope: "local" };
    }
  }

  /**
   * 根据 PlanItem 解析上下文策略。
   *
   * 若 ContextManager 已注入，通过场景解析；
   * 否则回退到旧版 tag→策略路由（Phase 3 fallback）。
   */
  private _resolveContextPolicy(item: PlanItem): string {
    if (this._contextManager) {
      const resolved = this._contextManager.resolve({
        scene: item.contextScene ?? "code-repair",
        persona: item.contextPersona,
        task: { type: item.type ?? "analysis", tags: item.tags ?? [] },
      });
      return resolved.policyId;
    }
    return _resolveContextPolicyFallback(item.type, item.tags);
  }
}

// ─── 类型 ───────────────────────────────────────

/** 技能作用域（从 planning/skill-scope 迁入以避免反向依赖） */
export interface SkillScope {
  /** 跨域技能目录（用户级，跨项目） */
  crossDomainDir?: string;
  /** 当前包名（task 涉及该包文件时激活包级技能） */
  packageName?: string;
  /** 目标 Agent 类型 */
  agentType?: string;
}

/** 仿真运行器接口（依赖注入用，替代 direct import from planning） */
export interface SimRunner {
  simulate(input: { planNodes: Array<{ type: string; intent: string }>; currentState: Record<string, unknown>; constraints: string[] }): Promise<{ riskLevel: string; predictedFailures: string[]; suggestedReplan: boolean; confidence: number }>;
}

interface PlanItem {
  task: string;
  type?: string;
  tags?: string[];
  needsMultiPerspective?: boolean;
  reasoningEffort?: "high" | "max";
  recommendedTier?: "fast" | "standard" | "thinking";
  children?: PlanItem[];
  /** Phase 3 上下文场景 */
  contextScene?: string;
  /** Phase 3 上下文人物 */
  contextPersona?: string;
}

interface PlanContext {
  parentId?: string;
  existingTags?: string[];
}

/** 意图确认结果——clarifyIntent() 返回 */
export interface IntentClarification {
  goal: string;
  actionType: "analysis" | "modification" | "audit" | "refactor" | "generation" | "inquiry";
  scope: string;
  constraints: string;
  unclear?: string;
  originalIntent: string;
}

// 系统提示已迁移至 @cortex/config/constants/meta-agent.ts
// 通过 buildPlanningSystem(workspaceRoot) / REPLAN_SYSTEM 导入使用

/**
 * 旧版 tag→策略路由（Phase 3 fallback —— ContextManager 未注入时使用）。
 *
 * 匹配规则：
 *   1. type 精确命中预设 ID → 直接返回
 *   2. tags 包含特征标签 → 匹配对应预设
 *   3. 回退 → "single-step"
 */
function _resolveContextPolicyFallback(type?: string, tags?: string[]): string {
  // 规则 1: type 精确命中
  if (type && PRESET_CONTEXT_POLICIES[type]) return type;

  // 规则 2: tags 匹配
  if (tags) {
    const tagSet = new Set(tags.map((t) => t.toLowerCase()));
    if (tagSet.has("audit") || tagSet.has("architecture") || tagSet.has("constitution_check")) {
      return "architecture-review";
    }
    if (tagSet.has("debug") || tagSet.has("diagnose") || tagSet.has("bugfix")) {
      return "diagnose";
    }
    if (tagSet.has("code") || tagSet.has("refactor")) {
      return "code-refactor";
    }
  }

  // 规则 3: 回退
  return "single-step";
}

/** 校验并归一化 recommendedTier：非法值 → undefined，防止甘雨 prompt 漂移注入脏数据 */
// VALID_TIERS 单源定义 @cortex/config/constants/tiers
function _validTier(t?: string): "fast" | "standard" | "thinking" | undefined {
  return t && VALID_TIERS.has(t) ? t as "fast" | "standard" | "thinking" : undefined;
}
