/**
 * @cortex/prompt-kit — 配置 Prompt 来源
 *
 * 从 @cortex/config 的常量（如 PLANNING_SYSTEM, REPLAN_SYSTEM）加载 PromptTemplate。
 * 通过注册表将配置键映射到模板 ID。
 *
 * @see DESIGN.md §3.1 ConfigSource
 */
import { PromptBlockType, type PromptTemplate } from "../types.js";
import type { PromptSource } from "./prompt-loader.js";
/**
 * 配置来源注册条目。
 * 定义如何将配置常量映射为 PromptTemplate。
 */
export interface ConfigSourceEntry {
    /** 配置键（如 "PLANNING_SYSTEM"） */
    key: string;
    /** 获取配置值的函数 */
    getValue: () => string;
    /** 模板 ID */
    templateId: string;
    /** 块类型 */
    blockType?: PromptBlockType;
    /** 优先级 */
    priority?: number;
}
/**
 * ConfigPromptSource —— 配置来源。
 *
 * 将 @cortex/config 中的常量（字符串值）注册为 PromptTemplate。
 * 无需文件系统 I/O。
 */
export declare class ConfigPromptSource implements PromptSource {
    private entries;
    /**
     * 注册配置条目。
     */
    register(entry: ConfigSourceEntry): void;
    /**
     * 批量注册。
     */
    registerMany(entries: ConfigSourceEntry[]): void;
    /**
     * 按模板 ID 加载。
     */
    load(templateId: string): Promise<PromptTemplate | null>;
    /**
     * 列出所有可用的模板 ID。
     */
    list(): Promise<string[]>;
}
//# sourceMappingURL=config-source.d.ts.map