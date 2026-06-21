/**
 * @cortex/prompt-kit — 文件系统 Prompt 来源
 *
 * 从 prompts/ 目录按约定加载 PromptTemplate。
 * 文件 → PromptTemplate 映射规则：
 *   prompts/<agent>/system.md  → templateId: "<agent>-system"
 *   prompts/<agent>/identity.md → templateId: "<agent>-identity"
 *   prompts/shared/identity-anchor.md → templateId: "shared-identity-anchor"
 *
 * @see DESIGN.md §3.1 文件加载规则
 */
import { type PromptTemplate } from "../types.js";
import type { PromptSource } from "./prompt-loader.js";
/**
 * 文件来源选项。
 */
export interface FilePromptSourceOptions {
    /** 项目根目录（默认 process.cwd()） */
    baseDir?: string;
    /** prompts 目录名（默认 "prompts"） */
    promptsDir?: string;
}
/**
 * FilePromptSource —— 文件系统 Prompt 来源。
 *
 * 约定优于配置：
 * - prompts/<agent-type>/system.md → 模板 ID = "<agent-type>-system"
 * - prompts/<agent-type>/identity.md → 模板 ID = "<agent-type>-identity"
 * - prompts/shared/identity-anchor.md → 模板 ID = "shared-identity-anchor"
 *
 * 各文件作为独立模板，也自动聚合为 agent 级模板（合并所有块）。
 */
export declare class FilePromptSource implements PromptSource {
    private baseDir;
    private promptsDir;
    /** 内部索引：templateId → filePath */
    private index;
    /** 是否已扫描 */
    private scanned;
    constructor(options?: FilePromptSourceOptions);
    /**
     * 按模板 ID 加载。
     * 支持两种 ID 格式：
     * - "nahida-system" → 加载 prompts/nahida/system.md
     * - "shared-identity-anchor" → 加载 prompts/shared/identity-anchor.md
     */
    load(templateId: string): Promise<PromptTemplate | null>;
    /**
     * 列出所有可用模板 ID。
     */
    list(): Promise<string[]>;
    /**
     * 刷新文件索引。
     */
    refreshIndex(): void;
    /**
     * 确保索引已构建。
     */
    private ensureIndex;
    /**
     * 扫描 prompts 目录构建索引。
     */
    private scanDirectory;
    /**
     * 递归扫描目录。
     */
    private scanRecursive;
    /**
     * 解析单个文件为 PromptTemplate。
     */
    private parseFile;
    /**
     * 获取块类型的默认优先级。
     */
    private getDefaultPriority;
}
//# sourceMappingURL=file-source.d.ts.map