/**
 * @cortex/prompt-kit — 内联 Prompt 来源
 *
 * 接受运行时动态传入的字符串作为 PromptTemplate。
 * 用于 CLI 中用户自定义 prompt、动态生成的指令等场景。
 */

import type { PromptTemplate, PromptBlock } from "../types.js";
import { PromptBlockType } from "../types.js";
import type { PromptSource } from "./prompt-loader.js";

/**
 * InlinePromptSource —— 内联来源。
 *
 * 通过 registerInline() 在运行时注册内联模板。
 * 适用于以下场景：
 * - CLI 用户自定义 prompt
 * - 动态生成的格式指令
 * - 测试中 mock prompt
 */
export class InlinePromptSource implements PromptSource {
  private templates: Map<string, PromptTemplate> = new Map();

  /**
   * 注册内联模板。
   */
  register(
    templateId: string,
    content: string,
    blockType: PromptBlockType = PromptBlockType.Instruction,
    priority: number = 50,
  ): void {
    const block: PromptBlock = {
      id: `${templateId}-inline`,
      type: blockType,
      content,
      priority,
    };

    this.templates.set(templateId, {
      id: templateId,
      name: templateId,
      version: "0.1.0",
      blocks: [block],
      tags: [templateId],
      source: "inline",
    });
  }

  /**
   * 注册多块内联模板。
   */
  registerTemplate(template: PromptTemplate): void {
    this.templates.set(template.id, template);
  }

  /**
   * 按模板 ID 加载。
   */
  async load(templateId: string): Promise<PromptTemplate | null> {
    return this.templates.get(templateId) ?? null;
  }

  /**
   * 列出所有内联模板 ID。
   */
  async list(): Promise<string[]> {
    return Array.from(this.templates.keys());
  }

  /**
   * 移除指定模板。
   */
  remove(templateId: string): void {
    this.templates.delete(templateId);
  }

  /**
   * 清空所有内联模板。
   */
  clear(): void {
    this.templates.clear();
  }
}
