/**
 * @cortex/prompt-kit — 统一 Prompt 加载器
 *
 * 从多个来源加载 PromptTemplate，抽象文件系统细节。
 * 支持文件系统、配置常量、内联字符串三种来源。
 *
 * @see DESIGN.md §3.1 PromptLoader
 */

import { PromptErrorCode, type PromptTemplate, type PromptLoadOptions, PromptBlockType } from "../types.js";
import { PromptError } from "../errors.js";

/**
 * 自定义 prompt 来源接口。
 * 实现此接口可注册自定义加载后端。
 */
export interface PromptSource {
  /** 按模板 ID 加载，返回 null 表示未找到 */
  load(templateId: string): Promise<PromptTemplate | null>;
  /** 列出此来源支持的所有模板 ID（可选） */
  list?(): Promise<string[]>;
}

/**
 * PromptLoader —— 统一加载入口。
 *
 * 支持三级来源链：文件系统 → 配置 → 内联。
 * 按顺序查找，命中即返回。
 */
export class PromptLoader {
  private sources: Map<string, PromptSource> = new Map();
  private cache: Map<string, { template: PromptTemplate; loadedAt: number }> = new Map();

  constructor() {
    // 注册系统内置来源（运行时通过 registerSource 注册自定义来源）
  }

  /**
   * 按模板 ID 加载。
   * 按来源注册顺序依次查找，命中即返回。
   */
  async load(templateId: string, options?: PromptLoadOptions): Promise<PromptTemplate> {
    // 1. 检查缓存
    if (options?.useCache !== false) {
      const cached = this.cache.get(templateId);
      if (cached) {
        return cached.template;
      }
    }

    // 2. 遍历来源查找
    for (const [, source] of this.sources) {
      const template = await source.load(templateId);
      if (template) {
        // 写入缓存
        if (options?.useCache !== false) {
          this.cache.set(templateId, {
            template,
            loadedAt: Date.now(),
          });
        }
        return template;
      }
    }

    // 3. 未找到
    throw new PromptError(
      `Prompt 模板 "${templateId}" 未在任何来源中找到`,
      PromptErrorCode.TEMPLATE_NOT_FOUND,
      { templateId },
    );
  }

  /**
   * 从文件路径加载 PromptTemplate。
   * 等价于 load(templateId)，但 id 从文件路径推导。
   */
  async loadFromFile(filePath: string, _options?: PromptLoadOptions): Promise<PromptTemplate> {
    // 查找 file-source 并委托
    const fileSource = this.sources.get("file");
    if (!fileSource) {
      throw new PromptError(
        "文件来源未注册，无法从文件加载",
        PromptErrorCode.LOAD_FAILED,
        { filePath },
      );
    }
    // file-source 的 load 方法接受路径作为 templateId
    const template = await fileSource.load(filePath);
    if (!template) {
      throw new PromptError(
        `文件加载失败: ${filePath}`,
        PromptErrorCode.LOAD_FAILED,
        { filePath },
      );
    }
    return template;
  }

  /**
   * 从配置加载（如 PLANNING_SYSTEM 常量）。
   */
  async loadFromConfig(configKey: string, _options?: PromptLoadOptions): Promise<PromptTemplate> {
    const configSource = this.sources.get("config");
    if (!configSource) {
      throw new PromptError(
        "配置来源未注册，无法从配置加载",
        PromptErrorCode.LOAD_FAILED,
        { configKey },
      );
    }
    const template = await configSource.load(configKey);
    if (!template) {
      throw new PromptError(
        `配置键 "${configKey}" 未找到对应模板`,
        PromptErrorCode.TEMPLATE_NOT_FOUND,
        { configKey },
      );
    }
    return template;
  }

  /**
   * 从内联字符串加载。
   */
  loadFromInline(id: string, content: string, _options?: PromptLoadOptions): PromptTemplate {
    const inlineSource = this.sources.get("inline");
    if (!inlineSource) {
      throw new PromptError(
        "内联来源未注册",
        PromptErrorCode.LOAD_FAILED,
        { id },
      );
    }
    // inline-source 的 loadFromInline 由外部调用，直接构造
    return {
      id,
      name: id,
      version: "0.1.0",
      blocks: [
        {
          id: `${id}-content`,
          type: PromptBlockType.Instruction,
          content,
          priority: 10,
        },
      ],
      tags: [id],
      source: "inline",
    };
  }

  /**
   * 注册自定义来源。
   */
  registerSource(name: string, source: PromptSource): void {
    this.sources.set(name, source);
  }

  /**
   * 清空加载缓存。
   */
  clearCache(): void {
    this.cache.clear();
  }
}
