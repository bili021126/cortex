/**
 * @cortex/prompt-kit — 声明式 Prompt 组装器
 *
 * 将 PromptTemplate + PromptAssembly → 最终组合的 prompt 文本。
 * 通过装配管线执行：块过滤 → 块排序 → 注入身份锚点 → 模板渲染。
 *
 * @see DESIGN.md §3.2 PromptAssembler
 */

import type {
  PromptBlock,
  PromptTemplate,
  PromptAssembly,
  PromptContext,
  PromptResult,
} from "../types.js";
import { PromptBlockType } from "../types.js";
import type { PromptTemplateEngine } from "../template-engine/prompt-template-engine.js";

/**
 * 块预处理器：在渲染前修改块列表。
 */
export type BlockPreprocessor = (
  blocks: PromptBlock[],
  context: PromptContext,
) => PromptBlock[];

/**
 * 块后处理器：在渲染后修改结果。
 */
export type BlockPostprocessor = (
  result: PromptResult,
  context: PromptContext,
) => PromptResult;

/**
 * 内置身份锚点块。
 * 在 injectIdentityAnchor=true 时自动注入。
 */
const IDENTITY_ANCHOR_BLOCK: PromptBlock = {
  id: "shared-identity-anchor",
  type: PromptBlockType.Identity,
  content: "[系统指令] 你是 Cortex 工程助手的身份锚点。",
  priority: 1,
};

/**
 * PromptAssembler — 组装器。
 *
 * 装配管线执行顺序：
 * 1. 合并额外块
 * 2. 块过滤（condition / accessLevel / blockFilter）
 * 3. 块排序（priority）
 * 4. 注入共享身份锚点
 * 5. 模板渲染（委托给 PromptTemplateEngine）
 * 6. 后处理
 * 7. 返回 PromptResult
 */
export class PromptAssembler {
  private engine: PromptTemplateEngine;
  private preprocessors: BlockPreprocessor[] = [];
  private postprocessors: BlockPostprocessor[] = [];

  constructor(engine: PromptTemplateEngine) {
    this.engine = engine;
    // 注册默认处理器（可选）
  }

  /**
   * 组装完整 prompt。
   */
  async assemble(template: PromptTemplate, assembly: PromptAssembly): Promise<PromptResult> {
    const startTime = Date.now();
    const context = assembly.context;

    // 1. 从模板克隆块列表
    let blocks = [...template.blocks];

    // 2. 合并额外块
    if (assembly.additionalBlocks?.length) {
      blocks = [...blocks, ...assembly.additionalBlocks];
    }

    // 3. 应用预处理器
    for (const preprocessor of this.preprocessors) {
      blocks = preprocessor(blocks, context);
    }

    // 4. 块过滤
    const { activeBlocks, skippedBlocks } = this.filterBlocks(blocks, context);

    // 5. 块排序
    const sorted = this.sortBlocks(activeBlocks, assembly.sortStrategy);

    // 6. 注入共享身份锚点
    const finalBlocks = assembly.injectIdentityAnchor
      ? this.injectAnchor(sorted)
      : sorted;

    // 7. 模板渲染
    const separator = assembly.blockSeparator ?? "\n\n";
    const text = this.engine.renderBlocks(finalBlocks, context, separator);

    // 8. 构建结果
    const result: PromptResult = {
      text,
      templateId: template.id,
      version: template.version,
      renderedBlocks: finalBlocks.map((b, i) => ({
        id: b.id,
        type: b.type,
        content: b.content,
        order: i,
      })),
      skippedBlocks,
      renderTimeMs: Date.now() - startTime,
      timestamp: Date.now(),
    };

    // 9. 应用后处理器
    let finalResult = result;
    for (const postprocessor of this.postprocessors) {
      finalResult = postprocessor(finalResult, context);
    }

    return finalResult;
  }

  /**
   * 注册预处理器。
   */
  registerPreprocessor(name: string, fn: BlockPreprocessor): void {
    this.preprocessors.push(fn);
  }

  /**
   * 注册后处理器。
   */
  registerPostprocessor(name: string, fn: BlockPostprocessor): void {
    this.postprocessors.push(fn);
  }

  /**
   * 块过滤：按 condition / accessLevel / blockFilter 过滤。
   */
  private filterBlocks(
    blocks: PromptBlock[],
    context: PromptContext,
  ): {
    activeBlocks: PromptBlock[];
    skippedBlocks: PromptResult["skippedBlocks"];
  } {
    const activeBlocks: PromptBlock[] = [];
    const skippedBlocks: PromptResult["skippedBlocks"] = [];

    for (const block of blocks) {
      // 1. 检查 accessLevel
      if (block.accessLevel === "private" && context.activeBlockIds?.includes(block.id) === false) {
        skippedBlocks.push({ id: block.id, type: block.type, reason: "access_denied" });
        continue;
      }

      // 2. 检查 condition
      if (block.condition) {
        const conditionMet = this.evaluateCondition(block.condition, context);
        if (!conditionMet) {
          skippedBlocks.push({ id: block.id, type: block.type, reason: "condition_false" });
          continue;
        }
      }

      // 3. 检查 activeBlockIds 白名单
      if (context.activeBlockIds && !context.activeBlockIds.includes(block.id)) {
        skippedBlocks.push({ id: block.id, type: block.type, reason: "filtered" });
        continue;
      }

      // 4. 检查自定义 blockFilter
      if (context.blockFilter && !context.blockFilter(block)) {
        skippedBlocks.push({ id: block.id, type: block.type, reason: "filtered" });
        continue;
      }

      activeBlocks.push(block);
    }

    return { activeBlocks, skippedBlocks };
  }

  /**
   * 块排序。
   */
  private sortBlocks(
    blocks: PromptBlock[],
    strategy?: "by_priority" | "by_type" | "custom",
  ): PromptBlock[] {
    switch (strategy) {
      case "by_type":
        return blocks.sort((a, b) => {
          const typeOrder = (t: PromptBlockType) => {
            const order = [
              PromptBlockType.Identity,
              PromptBlockType.Persona,
              PromptBlockType.Context,
              PromptBlockType.Instruction,
              PromptBlockType.OutputFormat,
              PromptBlockType.Example,
              PromptBlockType.Private,
            ];
            return order.indexOf(t);
          };
          return typeOrder(a.type) - typeOrder(b.type);
        });
      case "by_priority":
      default:
        return blocks.sort((a, b) => a.priority - b.priority);
    }
  }

  /**
   * 注入共享身份锚点。
   * 如果已有 Identity 块，锚点插入在最前方。
   */
  private injectAnchor(blocks: PromptBlock[]): PromptBlock[] {
    // 检查是否已包含 identity 类型的 anchor 内容
    const hasAnchor = blocks.some(
      (b) => b.type === PromptBlockType.Identity && b.id === "shared-identity-anchor",
    );
    if (hasAnchor) return blocks;

    return [IDENTITY_ANCHOR_BLOCK, ...blocks];
  }

  /**
   * 简单条件表达式评估。
   * 支持：变量名、!取反。
   */
  private evaluateCondition(condition: string, context: PromptContext): boolean {
    let expr = condition.trim();

    // 取反
    const isNegated = expr.startsWith("!");
    if (isNegated) {
      expr = expr.substring(1).trim();
    }

    // 字面量
    if (expr === "true") return !isNegated;
    if (expr === "false") return isNegated;

    // 从 variables 中取值
    const value = context.variables?.[expr];

    const isTruthy = value !== undefined && value !== null && value !== false;
    return isNegated ? !isTruthy : isTruthy;
  }
}
