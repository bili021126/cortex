/**
 * @cortex/prompt-kit — 配置 Prompt 来源
 *
 * 从 @cortex/config 的常量（如 PLANNING_SYSTEM, REPLAN_SYSTEM）加载 PromptTemplate。
 * 通过注册表将配置键映射到模板 ID。
 *
 * @see DESIGN.md §3.1 ConfigSource
 */
import { PromptBlockType } from "../types.js";
/**
 * ConfigPromptSource —— 配置来源。
 *
 * 将 @cortex/config 中的常量（字符串值）注册为 PromptTemplate。
 * 无需文件系统 I/O。
 */
export class ConfigPromptSource {
    entries = new Map();
    /**
     * 注册配置条目。
     */
    register(entry) {
        this.entries.set(entry.templateId, entry);
        // 同时按 config key 索引
        this.entries.set(`config:${entry.key}`, entry);
    }
    /**
     * 批量注册。
     */
    registerMany(entries) {
        for (const entry of entries) {
            this.register(entry);
        }
    }
    /**
     * 按模板 ID 加载。
     */
    async load(templateId) {
        const entry = this.entries.get(templateId);
        if (!entry) {
            return null;
        }
        const content = entry.getValue();
        if (!content) {
            return null;
        }
        return {
            id: entry.templateId,
            name: entry.templateId,
            version: "1.0.0",
            blocks: [
                {
                    id: `${entry.templateId}-content`,
                    type: entry.blockType ?? PromptBlockType.Instruction,
                    content,
                    priority: entry.priority ?? 40,
                    metadata: { configKey: entry.key },
                },
            ],
            tags: [entry.templateId],
            source: `config:${entry.key}`,
        };
    }
    /**
     * 列出所有可用的模板 ID。
     */
    async list() {
        return Array.from(this.entries.keys())
            .filter((k) => !k.startsWith("config:")); // 只导出模板 ID，不导 config: 前缀
    }
}
//# sourceMappingURL=config-source.js.map