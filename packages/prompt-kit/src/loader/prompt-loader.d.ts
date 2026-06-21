/**
 * @cortex/prompt-kit — 统一 Prompt 加载器
 *
 * 从多个来源加载 PromptTemplate，抽象文件系统细节。
 * 支持文件系统、配置常量、内联字符串三种来源。
 *
 * @see DESIGN.md §3.1 PromptLoader
 */
import { type PromptTemplate, type PromptLoadOptions } from "../types.js";
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
export declare class PromptLoader {
    private sources;
    private cache;
    constructor();
    /**
     * 按模板 ID 加载。
     * 按来源注册顺序依次查找，命中即返回。
     */
    load(templateId: string, options?: PromptLoadOptions): Promise<PromptTemplate>;
    /**
     * 从文件路径加载 PromptTemplate。
     * 等价于 load(templateId)，但 id 从文件路径推导。
     */
    loadFromFile(filePath: string, _options?: PromptLoadOptions): Promise<PromptTemplate>;
    /**
     * 从配置加载（如 PLANNING_SYSTEM 常量）。
     */
    loadFromConfig(configKey: string, _options?: PromptLoadOptions): Promise<PromptTemplate>;
    /**
     * 从内联字符串加载。
     */
    loadFromInline(id: string, content: string, _options?: PromptLoadOptions): PromptTemplate;
    /**
     * 注册自定义来源。
     */
    registerSource(name: string, source: PromptSource): void;
    /**
     * 清空加载缓存。
     */
    clearCache(): void;
}
//# sourceMappingURL=prompt-loader.d.ts.map