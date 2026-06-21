/**
 * @cortex/prompt-kit — 声明式 Prompt 组装器
 *
 * 将 PromptTemplate + PromptAssembly → 最终组合的 prompt 文本。
 * 通过装配管线执行：块过滤 → 块排序 → 注入身份锚点 → 模板渲染。
 *
 * @see DESIGN.md §3.2 PromptAssembler
 */
import { type PromptBlock, type PromptTemplate, type PromptAssembly, type PromptContext, type PromptResult } from "../types.js";
import type { PromptTemplateEngine } from "../template-engine/prompt-template-engine.js";
/**
 * 块预处理器：在渲染前修改块列表。
 */
export type BlockPreprocessor = (blocks: PromptBlock[], context: PromptContext) => PromptBlock[];
/**
 * 块后处理器：在渲染后修改结果。
 */
export type BlockPostprocessor = (result: PromptResult, context: PromptContext) => PromptResult;
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
export declare class PromptAssembler {
    private engine;
    private preprocessors;
    private postprocessors;
    constructor(engine: PromptTemplateEngine);
    /**
     * 组装完整 prompt。
     */
    assemble(template: PromptTemplate, assembly: PromptAssembly): Promise<PromptResult>;
    /**
     * 注册预处理器。
     */
    registerPreprocessor(name: string, fn: BlockPreprocessor): void;
    /**
     * 注册后处理器。
     */
    registerPostprocessor(name: string, fn: BlockPostprocessor): void;
    /**
     * 块过滤：按 condition / accessLevel / blockFilter 过滤。
     */
    private filterBlocks;
    /**
     * 块排序。
     */
    private sortBlocks;
    /**
     * 注入共享身份锚点。
     * 如果已有 Identity 块，锚点插入在最前方。
     */
    private injectAnchor;
    /**
     * 简单条件表达式评估。
     * 支持：变量名、!取反。
     */
    private evaluateCondition;
}
//# sourceMappingURL=prompt-assembler.d.ts.map