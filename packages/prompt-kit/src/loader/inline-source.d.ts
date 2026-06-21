/**
 * @cortex/prompt-kit — 内联 Prompt 来源
 *
 * 接受运行时动态传入的字符串作为 PromptTemplate。
 * 用于 CLI 中用户自定义 prompt、动态生成的指令等场景。
 */
import { PromptBlockType, type PromptTemplate } from "../types.js";
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
export declare class InlinePromptSource implements PromptSource {
    private templates;
    /**
     * 注册内联模板。
     */
    register(templateId: string, content: string, blockType?: PromptBlockType, priority?: number): void;
    /**
     * 注册多块内联模板。
     */
    registerTemplate(template: PromptTemplate): void;
    /**
     * 按模板 ID 加载。
     */
    load(templateId: string): Promise<PromptTemplate | null>;
    /**
     * 列出所有内联模板 ID。
     */
    list(): Promise<string[]>;
    /**
     * 移除指定模板。
     */
    remove(templateId: string): void;
    /**
     * 清空所有内联模板。
     */
    clear(): void;
}
//# sourceMappingURL=inline-source.d.ts.map