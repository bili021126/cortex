/**
 * @cortex/config — 环境变量名常量
 *
 * @module constants/env
 * @layer root
 */

/** DeepSeek 昔涟（独立人格）API 密钥环境变量名 */
export const ENV_DEEPSEEK_CYRENE_API_KEY = "DEEPSEEK_CYRENE_API_KEY";

/** DeepSeek 甘雨（独立人格）API 密钥环境变量名 */
export const ENV_DEEPSEEK_GANYU_API_KEY = "DEEPSEEK_GANYU_API_KEY";

/** DeepSeek Chat 模型 API 密钥环境变量名 */
export const ENV_DEEPSEEK_CHAT_API_KEY = "DEEPSEEK_CHAT_API_KEY";

/** DeepSeek Reasoner 模型 API 密钥环境变量名 */
export const ENV_DEEPSEEK_REASONER_API_KEY = "DEEPSEEK_REASONER_API_KEY";

/** DeepSeek API 密钥环境变量名（回退 Key） */
export const ENV_DEEPSEEK_API_KEY = "DEEPSEEK_API_KEY";

/** DeepSeek Base URL 环境变量名 */
export const ENV_DEEPSEEK_BASE_URL = "DEEPSEEK_BASE_URL";

/** DeepSeek Chat 模型环境变量名 */
export const ENV_DEEPSEEK_CHAT_MODEL = "DEEPSEEK_CHAT_MODEL";

/** DeepSeek 昔涟专用 Chat 模型环境变量名（独立于通用 Chat 模型，允许昔涟使用更高规格模型） */
export const ENV_DEEPSEEK_CYRENE_CHAT_MODEL = "DEEPSEEK_CYRENE_CHAT_MODEL";

/** DeepSeek 甘雨专用 Chat 模型环境变量名（独立于通用 Chat 模型，允许甘雨使用更高规格模型） */
export const ENV_DEEPSEEK_GANYU_CHAT_MODEL = "DEEPSEEK_GANYU_CHAT_MODEL";

/** DeepSeek Reasoner 模型环境变量名 */
export const ENV_DEEPSEEK_REASONER_MODEL = "DEEPSEEK_REASONER_MODEL";

/** DeepSeek Reasoning Effort 环境变量名 */
export const ENV_DEEPSEEK_REASONING_EFFORT = "DEEPSEEK_REASONING_EFFORT";

/** Cortex 功能开关环境变量 */
export const ENV_CORTEX_API_AUDIT = "CORTEX_API_AUDIT";

/** 禁用搜索后端的 flag */
export const ENV_CORTEX_NO_SEARCH = "CORTEX_NO_SEARCH";

/** PM 主密钥环境变量名 */
export const ENV_PM_MASTER_KEY = "PM_MASTER_KEY";

/** ConfirmGate 超时环境变量名 */
export const ENV_CONFIRM_GATE_TIMEOUT_MS = "CONFIRM_GATE_TIMEOUT_MS";

/** VITEST 环境变量名（测试模式检测） */
export const ENV_VITEST = "VITEST";

/** NODE_ENV 环境变量名 */
export const ENV_NODE_ENV = "NODE_ENV";

/** CORTEX_AUTO_CONFIRM — 自动确认所有工具调用 */
export const ENV_AUTO_CONFIRM = "CORTEX_AUTO_CONFIRM";

/** CORTEX_MAX_TOOL_ROUNDS — 最大工具调用轮次 */
export const ENV_MAX_TOOL_ROUNDS = "CORTEX_MAX_TOOL_ROUNDS";

/** CORTEX_DEBUG — 调试模式开关 */
export const ENV_CORTEX_DEBUG = "CORTEX_DEBUG";

/** REACT_DEBUG — ReAct 循环调试开关 */
export const ENV_REACT_DEBUG = "REACT_DEBUG";

/** CORTEX_ROOT — 工作区根目录（e2e 测试用） */
export const ENV_CORTEX_ROOT = "CORTEX_ROOT";

/** CORTEX_ENABLE_CLI — 启用已废弃的 CLI/TUI 入口 */
export const ENV_CORTEX_ENABLE_CLI = "CORTEX_ENABLE_CLI";

/** 临时设置 AUTO_CONFIRM 执行 fn，完成后恢复 */
export async function withAutoConfirm<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env[ENV_AUTO_CONFIRM];
  process.env[ENV_AUTO_CONFIRM] = "true";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[ENV_AUTO_CONFIRM];
    else process.env[ENV_AUTO_CONFIRM] = prev;
  }
}
