import type { CortexAgentsConfig, AgentDefinition } from "../types.js";
/**
 * 加载所有配置域（agents + eventRouting + roundtable + ...）。
 * @param projectRoot 项目根目录（用于解析 prompt 文件路径）
 * @param dataDirOverride 可选——覆盖 config data 目录路径（测试用）
 * @returns 解析后的配置
 * @throws 若必需文件缺失、JSON 解析失败、或必填字段缺失
 */
export declare function loadAgentsConfig(projectRoot: string, dataDirOverride?: string): CortexAgentsConfig;
import type { PromptManager } from "../../../core/prompt-manager.js";
/**
 * 通过 PromptManager 异步增强 Agent prompt。
 *
 * 在 loadAgentsConfig() 同步加载完成后，由 bootstrapEngine() 异步调用。
 * 对每个 Agent 的 systemPrompt / roundtable.personaPrompt / planningPrompt / replanPrompt
 * 尝试走 PromptOrchestrator 的加载→校验→缓存管线。
 *
 * 设计要点：
 * - 不替换已有的同步文本：orchestrator 渲染结果仅作为校验和缓存层
 * - 失败时静默保留同步加载的原始文本（优雅降级）
 * - 渲染后 PromptValidator 至少检查 system prompt 非空
 */
export declare function enhancePrompts(definitions: AgentDefinition[], promptManager: PromptManager): Promise<void>;
//# sourceMappingURL=agents.loader.d.ts.map