/**
 * @cortex/prompt-kit — PromptOrchestrator 编排器
 *
 * 组合 Loader + Assembler + TemplateEngine + Validator + Cache + Version
 * 为一体化编排器。包外统一入口。
 *
 * @see DESIGN.md §3.7 PromptOrchestrator
 */
import type { PromptTemplate, PromptBlock, PromptAssembly, PromptContext, PromptResult, PromptLoadOptions, ValidationResult, CacheStats, OrchestratorOptions } from "../types.js";
import { PromptLoader } from "../loader/prompt-loader.js";
import { PromptAssembler } from "../assembler/prompt-assembler.js";
import { PromptTemplateEngine } from "../template-engine/prompt-template-engine.js";
import { PromptValidator } from "../validator/prompt-validator.js";
import { PromptCache } from "../cache/prompt-cache.js";
import { PromptVersion } from "../version/prompt-version.js";
/**
 * PromptOrchestrator —— 提示词编排器。
 *
 * 包外统一入口，组合各子模块为完整的 prompt 编排管道：
 * 加载 → 组装 → 模板渲染 → 校验 → 返回结果
 */
export declare class PromptOrchestrator {
    readonly loader: PromptLoader;
    readonly assembler: PromptAssembler;
    readonly templateEngine: PromptTemplateEngine;
    readonly validator: PromptValidator;
    readonly cache: PromptCache;
    readonly version: PromptVersion;
    private options;
    constructor(options?: OrchestratorOptions);
    /**
     * 渲染完整 system prompt。
     * 编排器主入口：加载 → 组装 → 渲染 → 校验 → 返回。
     */
    renderSystemPrompt(assembly: PromptAssembly): Promise<PromptResult>;
    /**
     * 加载并缓存模板。
     */
    loadTemplate(templateId: string, options?: PromptLoadOptions): Promise<PromptTemplate>;
    /**
     * 快速渲染单块（便捷方法）。
     */
    renderBlock(block: PromptBlock, context: PromptContext): Promise<string>;
    /**
     * 验证 assembly 的完整性。
     */
    validateAssembly(assembly: PromptAssembly): ValidationResult;
    /**
     * 清空缓存。
     */
    clearCache(): void;
    /**
     * 获取缓存统计。
     */
    getCacheStats(): CacheStats;
    /**
     * 注册默认来源。
     */
    private registerDefaultSources;
}
//# sourceMappingURL=prompt-orchestrator.d.ts.map