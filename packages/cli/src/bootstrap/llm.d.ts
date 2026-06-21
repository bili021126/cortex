/**
 * bootstrap/llm.ts — LLM 适配器初始化
 *
 * 从 main.ts 抽离的 LLM 配置与三路 Key 引导逻辑。
 * 密钥加载优先级：pm vault > DEEPSEEK_*_API_KEY > DEEPSEEK_API_KEY（兜底）
 *
 * @module bootstrap/llm
 */
import { LlmAdapter } from "@cortex/llm";
/** 初始化的 LLM 适配器映射 */
export type LlmBootstrapResult = Map<string, LlmAdapter>;
/**
 * 初始化 LLM 适配器三路实例（昔涟 / Chat池 / Reasoner）。
 *
 * 共享 baseUrl / chatModel / reasonerModel / reasoningEffort 配置，
 * 仅 API Key 按三路独立解析。
 */
export declare function bootstrapLlm(): Promise<LlmBootstrapResult>;
/** 检查是否有任何 API Key 可用 */
export declare function hasAnyLlmKey(): boolean;
/** 启用 API 审计日志 */
export declare function enableLlmAudit(): void;
//# sourceMappingURL=llm.d.ts.map