/**
 * LLM 默认值——所有 E2E/manual 脚本的统一 LLM 配置入口。
 *
 * 消除 20+ 处重复的 `process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1"` 模式。
 *
 * @module packages/engine/tests/manual/config/llm-defaults
 */
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

export interface LlmConfig {
  baseUrl: string;
  chatModel: string;
  reasonerModel: string;
  reasoningEffort: string;
}

/**
 * 解析 LLM 配置——环境变量优先，fallback 到默认值。
 * 各脚本可通过 overrides 自定义模型名。
 *
 * @example
 * // 大多数 E2E 脚本（默认 deepseek-v4-flash + 思考模式）
 * const cfg = resolveLlmConfig();
 *
 * @example
 * // self-examination / self-fix（使用 flash 提速）
 * const cfg = resolveLlmConfig({ chatModel: "deepseek-v4-flash" });
 */
export function resolveLlmConfig(overrides?: {
  baseUrl?: string;
  chatModel?: string;
  reasonerModel?: string;
  reasoningEffort?: string;
}): LlmConfig {
  return {
    baseUrl: overrides?.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? DEFAULT_DEEPSEEK_BASE_URL,
    chatModel: overrides?.chatModel ?? "deepseek-v4-flash",
    reasonerModel: overrides?.reasonerModel ?? "deepseek-v4-flash",
    reasoningEffort: overrides?.reasoningEffort ?? process.env.DEEPSEEK_REASONING_EFFORT ?? "max"};
}
