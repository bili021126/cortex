import { type IPipelineObserver, type ReplanResult, type SafeErrorReporter, type TaskNode } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { SkillRegistry } from "@cortex/skill-kit";
import type { PromptManager } from "./prompt-manager.js";
import { type SkillScope } from "./skill-scope.js";
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
export declare class MetaAgent {
    private readonly llm;
    private _nodeCounter;
    private _safeReporter?;
    private _skillRegistry?;
    private _observer?;
    /** 处理函数引用——用于 shutdown 时精确退订 */
    private _onNodeComplete?;
    private _onNodeFailed?;
    /** 管线事件积累——plan() 调用时注入 prompt 上下文 */
    private _pipelineContext;
    private readonly _planningSystem;
    private readonly _replanSystem;
    private _workspaceRoot?;
    private _promptManager?;
    private _loopStrategyRegistry?;
    constructor(llm: LlmAdapter, skillRegistry?: SkillRegistry, planningSystemPrompt?: string, replanSystemPrompt?: string, observer?: IPipelineObserver, workspaceRoot?: string);
    /** RLM 拆解用的 LLM 适配器（只读）。Scheduler 通过此入口注入 decompose() 的 LLM 调用能力。 */
    get llmAdapter(): LlmAdapter;
    /** 注入/更新工作区根路径 */
    setWorkspaceRoot(root: string): void;
    /** 注入技能注册表（可后置绑定） */
    setSkillRegistry(registry: SkillRegistry): void;
    /** Core-2: 注入技能作用域上下文（包名 + agentType） */
    private _skillScope?;
    setSkillScope(scope: SkillScope): void;
    /** 注入 PromptManager（prompt-kit 编排器，可后置绑定） */
    setPromptManager(manager: PromptManager): void;
    /** 注入循环策略注册表（策略顾问上下文注入，可后置绑定） */
    setLoopStrategyRegistry(registry: LoopStrategyRegistry): void;
    /** 注入管线——MetaAgent 订阅节点事件以获取执行层信息 */
    setObserver(observer: IPipelineObserver): void;
    /** 注入错误上报通道（observer 双通道模式） */
    setSafeReporter(reporter: SafeErrorReporter): void;
    /** 订阅终止——精确退订已注册的 handler，防止误删其他组件 */
    private _unsubscribe;
    /** 将事件入队到管线上下文（带硬上限防内存泄漏） */
    private _enqueuePipelineCtx;
    /** 清空管线上下文积累（每次 plan() 调用后重置） */
    private _clearPipelineContext;
    /** 获取当前积累的管线上下文 */
    private _getPipelineContext;
    /**
     * 重规划：当节点执行失败时，基于"原始意图 vs 当前事实"的冲突生成替代方案。
     * @param failedNode 失败的节点（含 payload/tags/type 上下文）
     * @param reason 失败原因（Agent 错误信息）
     * @param replanCount 当前重规划轮次
     * @param originalIntent 原始用户意图（用于冲突对比）
     * @returns ReplanResult { nodes, impactScope }
     */
    requestReplan(failedNode: TaskNode, reason: string, replanCount: number, originalIntent?: string, maxReplan?: number): Promise<ReplanResult>;
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
    requestBoundaryReplan(violatingNode: TaskNode, boundaryReason: string, replanCount: number, originalIntent?: string, maxReplan?: number): Promise<ReplanResult>;
    /**
     * 意图明晰化确认：在拆解任务前，向用户确认理解是否正确。
     * 仅解析意图关键要素（目标/类型/范围/约束），不产生 TaskNode。
     * 用户在确认后可直接 .yes 进入规划，或输入修正。
     */
    clarifyIntent(intent: string): Promise<IntentClarification>;
    /** 解析意图确认结果 */
    private _parseClarification;
    private readonly _validActionTypes;
    private _normalizeActionType;
    /**
     * 规划：将用户意图拆解为 TaskNode 列表。
     * 返回的节点 `parentId` 关系已建立，可直接 add 到 TaskBoard。
     */
    plan(intent: string, context?: PlanContext): Promise<TaskNode[]>;
    /**
     * 生成规划 prompt。
     *
     * 当 PromptManager 已注入时，走声明式块组装（assembler）；
     * 否则回退到手拼 parts.join("\n") 以保持向后兼容。
     */
    private _planningPrompt;
    /** 从 LLM 输出提取 JSON（委托 @cortex/shared 统一实现，失败时回退原始字符串）。 */
    private _extractJson;
    /** 构造兜底 TaskNode（JSON 解析失败时） */
    private _fallbackNode;
    /** 从 LLM 输出解析 JSON 任务树 */
    private _parsePlan;
    /** 尝试解析 JSON 为 PlanItem[]，自动修复常见 LLM 格式问题 */
    private _tryParseItems;
    /** 将 PlanItem 转为 TaskNode[]（自身 + 所有子孙） */
    private _toTaskNode;
    /** 解析 ReplanResult：从 LLM 输出提取 tasks + impactScope */
    private _parseReplanResult;
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
export {};
//# sourceMappingURL=meta-agent.d.ts.map