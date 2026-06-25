// ============================================================
// @cortex/engine — PromptManager
//
// @layer 技能-工具层
// @role prompt-kit 编排器薄封装——声明式块组装 + 双模式回退
//
// 引擎侧的 PromptOrchestrator 薄封装层。
// 将 @cortex/prompt-kit 的编排器接入引擎 bootstrap 流程：
//   1. 创建并持有 PromptOrchestrator 实例
//   2. 提供 Agent prompt 异步增强（校验 + 缓存）
//   3. 为 MetaAgent 提供 planning prompt 组装能力
//
// 设计原则：
//   - 最小化下游改动：renderAgentPrompt() 输出仍然是 string
//   - 优雅降级：orchestrator 失败时回退到原始文本
//   - 不改 Agent.execute() 签名，不改 PipelineCtx
// ============================================================

import {
  PromptOrchestrator,
  PromptBlockType,
  type PromptAssembly,
  type PromptTemplate,
  type ValidationResult,
} from "@cortex/prompt-kit";

import { DegradationBoundary } from "./degradation-boundary.js";

/**
 * PromptManager —— 引擎的 prompt 编排管理器。
 *
 * 在 bootstrap 阶段创建，注入到 MetaAgent 和各 Agent 的 prompt 加载链路中。
 * 内部持有 PromptOrchestrator，对外暴露引擎语义的方法。
 */
export class PromptManager {
  private readonly orchestrator: PromptOrchestrator;
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.orchestrator = new PromptOrchestrator({
      baseDir: projectRoot,
      cacheMaxSize: 50, // Agent 数量有限，不需要大缓存
      cacheDefaultTtlMs: 600_000, // 10 分钟（bootstrap 期间不会频繁变动）
      injectIdentityAnchor: false, // engine 有自己的 coding standards 注入
    });
  }

  /** 获取底层编排器引用（供高级用法） */
  getOrchestrator(): PromptOrchestrator {
    return this.orchestrator;
  }

  /**
   * 通过 orchestrator 加载并渲染 Agent 的 prompt 文件。
   *
   * 将文件路径（如 "prompts/albedo/system.md"）转为 templateId（如 "albedo-system"），
   * 走 FilePromptSource → 模板解析 → 渲染 → 返回最终文本。
   *
   * 失败时返回 null，调用方应回退到同步 _readPromptFile()。
   */
  async renderAgentPrompt(filePath: string): Promise<string | null> {
    try {
      const templateId = this.filePathToTemplateId(filePath);
      const result = await this.orchestrator.renderSystemPrompt({
        baseTemplateId: templateId,
        context: { variables: {} },
        injectIdentityAnchor: false,
      });
      return result.text || null;
    } catch (err) { DegradationBoundary.handle(err, 'prompt-manager', 'trace');
      // orchestrator 加载失败（文件不存在/模板解析错误），静默回退
      return null;
    }
  }

  /**
   * 为 MetaAgent 组装 planning prompt（用户消息部分）。
   *
   * 将原来 _planningPrompt() 中手拼的 parts.join("\n") 改为声明式块组装：
   * 每个上下文片段作为独立的 PromptBlock，由 assembler 统一排序和渲染。
   *
   * @param blocks 命名上下文片段（可选字段自动跳过）
   * @returns 组装后的 prompt 文本
   */
  async assemblePlanningPrompt(blocks: PlanningPromptBlocks): Promise<string> {
    const promptBlocks = [];
    // 按语义优先级排列（低值优先）
    if (blocks.parentContext) {
      promptBlocks.push({
        id: "parent-context",
        type: PromptBlockType.Context,
        content: blocks.parentContext,
        priority: 10,
      });
    }
    if (blocks.existingTags) {
      promptBlocks.push({
        id: "existing-tags",
        type: PromptBlockType.Context,
        content: blocks.existingTags,
        priority: 20,
      });
    }
    if (blocks.pipelineContext) {
      promptBlocks.push({
        id: "pipeline-context",
        type: PromptBlockType.Context,
        content: blocks.pipelineContext,
        priority: 30,
      });
    }
    if (blocks.skillContext) {
      promptBlocks.push({
        id: "skill-context",
        type: PromptBlockType.Context,
        content: blocks.skillContext,
        priority: 40,
      });
    }
    if (blocks.advisorContext) {
      promptBlocks.push({
        id: "advisor-context",
        type: PromptBlockType.Context,
        content: blocks.advisorContext,
        priority: 45,
      });
    }
    if (blocks.intent) {
      promptBlocks.push({
        id: "user-intent",
        type: PromptBlockType.Instruction,
        content: blocks.intent,
        priority: 90,
      });
    }

    if (promptBlocks.length === 0) return "";

    // 不使用 baseTemplateId，仅用 additionalBlocks 组装
    const assembly: PromptAssembly = {
      additionalBlocks: promptBlocks,
      context: { variables: {} },
      sortStrategy: "by_priority",
      blockSeparator: "\n",
      injectIdentityAnchor: false,
    };

    const result = await this.orchestrator.renderSystemPrompt(assembly);
    return result.text;
  }

  /**
   * 校验 Agent 的 system prompt 结构完整性。
   *
   * @param agentId Agent ID（用于错误消息）
   * @param systemPrompt 已渲染的 system prompt 文本
   * @returns 校验结果（不抛异常，仅报告）
   */
  validateSystemPrompt(agentId: string, systemPrompt: string): ValidationResult {
    // 构造一个最小 PromptTemplate 供校验
    const template: PromptTemplate = {
      id: `${agentId}-system`,
      name: `${agentId}-system`,
      version: "1.0.0",
      blocks: [{
        id: `${agentId}-system-block`,
        type: PromptBlockType.Instruction,
        content: systemPrompt,
        priority: 40,
      }],
      tags: [agentId],
    };
    return this.orchestrator.validator.validateTemplate(template);
  }

  /**
   * 将文件路径转为 templateId。
   * 例："prompts/albedo/system.md" → "albedo-system"
   *      "prompts/ganyu/planning.md" → "ganyu-planning"
   */
  private filePathToTemplateId(filePath: string): string {
    // 去掉 "prompts/" 前缀和文件扩展名，路径分隔符替换为 "-"
    return filePath
      .replace(/^prompts[/\\]/, "")
      .replace(/\.(md|txt)$/, "")
      .replace(/[/\\]/g, "-")
      .toLowerCase();
  }

  /** 清空 prompt 缓存 */
  clearCache(): void {
    this.orchestrator.clearCache();
  }
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
