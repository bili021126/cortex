import { PromptOrchestrator, type ValidationResult } from "@cortex/prompt-kit";
/**
 * PromptManager —— 引擎的 prompt 编排管理器。
 *
 * 在 bootstrap 阶段创建，注入到 MetaAgent 和各 Agent 的 prompt 加载链路中。
 * 内部持有 PromptOrchestrator，对外暴露引擎语义的方法。
 */
export declare class PromptManager {
    private readonly orchestrator;
    private readonly projectRoot;
    constructor(projectRoot: string);
    /** 获取底层编排器引用（供高级用法） */
    getOrchestrator(): PromptOrchestrator;
    /**
     * 通过 orchestrator 加载并渲染 Agent 的 prompt 文件。
     *
     * 将文件路径（如 "prompts/albedo/system.md"）转为 templateId（如 "albedo-system"），
     * 走 FilePromptSource → 模板解析 → 渲染 → 返回最终文本。
     *
     * 失败时返回 null，调用方应回退到同步 _readPromptFile()。
     */
    renderAgentPrompt(filePath: string): Promise<string | null>;
    /**
     * 为 MetaAgent 组装 planning prompt（用户消息部分）。
     *
     * 将原来 _planningPrompt() 中手拼的 parts.join("\n") 改为声明式块组装：
     * 每个上下文片段作为独立的 PromptBlock，由 assembler 统一排序和渲染。
     *
     * @param blocks 命名上下文片段（可选字段自动跳过）
     * @returns 组装后的 prompt 文本
     */
    assemblePlanningPrompt(blocks: PlanningPromptBlocks): Promise<string>;
    /**
     * 校验 Agent 的 system prompt 结构完整性。
     *
     * @param agentId Agent ID（用于错误消息）
     * @param systemPrompt 已渲染的 system prompt 文本
     * @returns 校验结果（不抛异常，仅报告）
     */
    validateSystemPrompt(agentId: string, systemPrompt: string): ValidationResult;
    /**
     * 将文件路径转为 templateId。
     * 例："prompts/albedo/system.md" → "albedo-system"
     *      "prompts/ganyu/planning.md" → "ganyu-planning"
     */
    private filePathToTemplateId;
    /** 清空 prompt 缓存 */
    clearCache(): void;
}
/**
 * planning prompt 的命名上下文片段。
 * 每个字段可选，为 undefined 时自动跳过。
 */
export interface PlanningPromptBlocks {
    /** 父节点上下文 */
    parentContext?: string;
    /** 已有标签 */
    existingTags?: string;
    /** 管线执行上下文 */
    pipelineContext?: string;
    /** 技能模板上下文 */
    skillContext?: string;
    /** 策略顾问上下文（来自 LoopStrategyRegistry） */
    advisorContext?: string;
    /** 用户意图 */
    intent?: string;
}
//# sourceMappingURL=prompt-manager.d.ts.map