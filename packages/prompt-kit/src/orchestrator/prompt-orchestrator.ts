/**
 * @cortex/prompt-kit — PromptOrchestrator 编排器
 *
 * 组合 Loader + Assembler + TemplateEngine + Validator + Cache + Version
 * 为一体化编排器。包外统一入口。
 *
 * @see DESIGN.md §3.7 PromptOrchestrator
 */

import type {
  PromptTemplate,
  PromptBlock,
  PromptAssembly,
  PromptContext,
  PromptResult,
  PromptLoadOptions,
  ValidationResult,
  CacheStats,
  OrchestratorOptions,
} from "../types.js";
import { PromptBlockType } from "../types.js";
import { PromptLoader } from "../loader/prompt-loader.js";
import { FilePromptSource } from "../loader/file-source.js";
import { ConfigPromptSource } from "../loader/config-source.js";
import { InlinePromptSource } from "../loader/inline-source.js";
import { PromptAssembler } from "../assembler/prompt-assembler.js";
import { PromptTemplateEngine } from "../template-engine/prompt-template-engine.js";
import { PromptValidator } from "../validator/prompt-validator.js";
import { PromptCache } from "../cache/prompt-cache.js";
import { PromptVersion } from "../version/prompt-version.js";
import { PromptError } from "../errors.js";

/**
 * PromptOrchestrator —— 提示词编排器。
 *
 * 包外统一入口，组合各子模块为完整的 prompt 编排管道：
 * 加载 → 组装 → 模板渲染 → 校验 → 返回结果
 */
export class PromptOrchestrator {
  readonly loader: PromptLoader;
  readonly assembler: PromptAssembler;
  readonly templateEngine: PromptTemplateEngine;
  readonly validator: PromptValidator;
  readonly cache: PromptCache;
  readonly version: PromptVersion;

  private options: Required<OrchestratorOptions>;

  constructor(options: OrchestratorOptions = {}) {
    this.options = {
      baseDir: options.baseDir ?? process.cwd(),
      cacheMaxSize: options.cacheMaxSize ?? 100,
      cacheDefaultTtlMs: options.cacheDefaultTtlMs ?? 300_000,
      injectIdentityAnchor: options.injectIdentityAnchor ?? true,
      enableFileWatching: options.enableFileWatching ?? false,
      engineOptions: options.engineOptions ?? {},
    };

    // 1. 模板引擎
    this.templateEngine = new PromptTemplateEngine(this.options.engineOptions);

    // 2. 加载器 + 注册默认来源
    this.loader = new PromptLoader();
    this.registerDefaultSources();

    // 3. 组装器
    this.assembler = new PromptAssembler(this.templateEngine);

    // 4. 校验器
    this.validator = new PromptValidator();

    // 5. 缓存
    this.cache = new PromptCache(this.options.cacheMaxSize, this.options.cacheDefaultTtlMs);

    // 6. 版本管理
    this.version = new PromptVersion();
  }

  /**
   * 渲染完整 system prompt。
   * 编排器主入口：加载 → 组装 → 渲染 → 校验 → 返回。
   */
  async renderSystemPrompt(assembly: PromptAssembly): Promise<PromptResult> {
    // 1. 加载模板
    let template: PromptTemplate;

    if (assembly.baseTemplateId) {
      // 从缓存获取
      let cached = this.cache.get(assembly.baseTemplateId);
      if (!cached) {
        template = await this.loader.load(assembly.baseTemplateId);
        this.cache.set(assembly.baseTemplateId, template);
      } else {
        template = cached;
      }
    } else {
      // 无基础模板：使用空模板（仅额外块）
      template = {
        id: "_inline",
        name: "_inline",
        version: "0.1.0",
        blocks: [],
        tags: [],
        source: "inline",
      };
    }

    // 2. 组装（含过滤、排序、身份锚点注入、模板渲染）
    const result = await this.assembler.assemble(template, assembly);

    // 3. 校验
    const validation = this.validator.validateResult(result);
    if (!validation.valid) {
      // 校验失败时，返回结果但包含错误信息（不阻断渲染）
      // 调用方可通过 result.metadata?.validationErrors 获取
      (result as any).metadata = {
        ...(result as any).metadata,
        validationErrors: validation.errors,
        validationWarnings: validation.warnings,
      };
    }

    return result;
  }

  /**
   * 加载并缓存模板。
   */
  async loadTemplate(
    templateId: string,
    options?: PromptLoadOptions,
  ): Promise<PromptTemplate> {
    const cached = this.cache.get(templateId);
    if (cached && options?.useCache !== false) {
      return cached;
    }

    const template = await this.loader.load(templateId, options);
    this.cache.set(templateId, template);
    return template;
  }

  /**
   * 快速渲染单块（便捷方法）。
   */
  async renderBlock(block: PromptBlock, context: PromptContext): Promise<string> {
    return this.templateEngine.renderBlock(block, context);
  }

  /**
   * 验证 assembly 的完整性。
   */
  validateAssembly(assembly: PromptAssembly): ValidationResult {
    const errors: ValidationResult["errors"] = [];
    const warnings: ValidationResult["warnings"] = [];

    if (!assembly.context || !assembly.context.variables) {
      errors.push({
        path: "context.variables",
        message: "Assembly 缺少 context.variables",
        severity: "error",
      });
    }

    // 检查 baseTemplateId 对应的模板是否存在（不加载，仅检查缓存）
    if (assembly.baseTemplateId && !this.cache.has(assembly.baseTemplateId)) {
      warnings.push({
        path: "baseTemplateId",
        message: `基础模板 "${assembly.baseTemplateId}" 未在缓存中找到，将在渲染时加载`,
        severity: "warning",
      } as any);
    }

    return {
      valid: errors.filter((e) => e.severity === "error").length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 清空缓存。
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存统计。
   */
  getCacheStats(): CacheStats {
    return this.cache.stats();
  }

  /**
   * 注册默认来源。
   */
  private registerDefaultSources(): void {
    // 文件来源
    const fileSource = new FilePromptSource({
      baseDir: this.options.baseDir,
    });
    this.loader.registerSource("file", fileSource);

    // 内联来源
    this.loader.registerSource("inline", new InlinePromptSource());

    // 配置来源
    const configSource = new ConfigPromptSource();
    this.loader.registerSource("config", configSource);
  }
}
