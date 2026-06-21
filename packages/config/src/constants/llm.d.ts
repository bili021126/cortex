/**
 * @cortex/config — LLM 常量
 *
 * @module constants/llm
 * @layer root
 */
/** DeepSeek API 默认 Base URL */
export declare const DEFAULT_LLM_BASE_URL = "https://api.deepseek.com/v1";
/** DeepSeek V4 Flash 默认模型名（替代已退役的 deepseek-chat） */
export declare const DEFAULT_LLM_CHAT_MODEL = "deepseek-v4-flash";
/** DeepSeek V4 Flash 思考模式默认模型名（替代已退役的 deepseek-reasoner，同一模型开启 reasoning_effort 即为推理模式） */
export declare const DEFAULT_LLM_REASONER_MODEL = "deepseek-v4-flash";
/** ConfigManager 默认聊天模型 */
export declare const DEFAULT_CLI_CHAT_MODEL = "deepseek-v4-flash";
/** LLM 回退模型名（deepseek-chat 于 2026-07-24 退役） */
export declare const DEFAULT_LLM_FALLBACK_MODEL = "deepseek-v4-flash";
/** LLM 实例键名——三路隔离的标准键标识 */
export declare const LLM_KEY_NAMES: {
    readonly CYRENE: "DEEPSEEK_CYRENE";
    readonly CHAT: "DEEPSEEK_CHAT";
    readonly REASONER: "DEEPSEEK_REASONER";
};
//# sourceMappingURL=llm.d.ts.map