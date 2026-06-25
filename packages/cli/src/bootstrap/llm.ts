/**
 * bootstrap/llm.ts — LLM 适配器初始化
 *
 * 从 main.ts 抽离的 LLM 配置与三路 Key 引导逻辑。
 * 密钥加载优先级：pm vault > DEEPSEEK_*_API_KEY > DEEPSEEK_API_KEY（兜底）
 *
 * @module bootstrap/llm
 */

import { LlmAdapter } from "@cortex/llm";
import {
  ENV_DEEPSEEK_BASE_URL,
  ENV_DEEPSEEK_CHAT_MODEL,
  ENV_DEEPSEEK_CYRENE_CHAT_MODEL,
  ENV_DEEPSEEK_REASONER_MODEL,
  ENV_DEEPSEEK_REASONING_EFFORT,
  ENV_DEEPSEEK_API_KEY,
  ENV_DEEPSEEK_CYRENE_API_KEY,
  ENV_DEEPSEEK_CHAT_API_KEY,
  ENV_DEEPSEEK_REASONER_API_KEY,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_CHAT_MODEL,
  DEFAULT_LLM_REASONER_MODEL,
  LLM_KEY_NAMES,
} from "@cortex/config";

/** 密码条目数据结构（原 @cortex/pm 内联） */
interface PasswordEntry {
  id: string;
  name: string;
  username: string;
  password: string;
  createdAt: string;
  updatedAt: string;
}

/** pm vault 的最小接口 */
interface PmStore {
  getEntry(name: string): PasswordEntry | undefined;
}

/** 初始化的 LLM 适配器映射 */
export type LlmBootstrapResult = Map<string, LlmAdapter>;

/** 按优先级解析 API Key：vault → 专用环境变量 → DEEPSEEK_API_KEY 兜底 */
function resolveKey(
  pmStore: PmStore | undefined,
  pmKey: string,
  envVarName: string,
  fallbackKey?: string,
): string | undefined {
  if (pmStore) {
    try {
      const entry = pmStore.getEntry(pmKey);
      if (entry) return entry.password;
    } catch {
      // vault 读取失败，继续回退
    }
  }
  return process.env[envVarName] || fallbackKey || undefined;
}

/**
 * 初始化 LLM 适配器三路实例（昔涟 / Chat池 / Reasoner）。
 *
 * 共享 baseUrl / chatModel / reasonerModel / reasoningEffort 配置，
 * 仅 API Key 按三路独立解析。
 */
export async function bootstrapLlm(): Promise<LlmBootstrapResult> {
  const llms = new Map<string, LlmAdapter>();

  // 共享的模型/URL 配置
  const llmBaseUrl = process.env[ENV_DEEPSEEK_BASE_URL] || DEFAULT_LLM_BASE_URL;
  const llmChatModel = process.env[ENV_DEEPSEEK_CHAT_MODEL] || DEFAULT_LLM_CHAT_MODEL;
  // 昔涟独立 Chat 模型——若未设置则回退到通用 Chat 模型
  const llmCyreneChatModel = process.env[ENV_DEEPSEEK_CYRENE_CHAT_MODEL] || llmChatModel;
  const llmReasonerModel = process.env[ENV_DEEPSEEK_REASONER_MODEL] || DEFAULT_LLM_REASONER_MODEL;
  const llmReasoningEffort = (process.env[ENV_DEEPSEEK_REASONING_EFFORT] as "high" | "max") || undefined;

  const fallbackKey = process.env[ENV_DEEPSEEK_API_KEY];

  // 若设置了 PM_MASTER_KEY，尝试从 pm 加密 vault 加载密钥
  const pmStore: PmStore | undefined = undefined;

  const adapter = (key: string, label: string, chatModelOverride?: string, extra?: Partial<{ reasoningEffort: "high" | "max" }>) =>
    new LlmAdapter({
      apiKey: key,
      baseUrl: llmBaseUrl,
      chatModel: chatModelOverride ?? llmChatModel,
      reasonerModel: llmReasonerModel,
      reasoningEffort: extra?.reasoningEffort,
      label,
      // DeepSeek 专有参数：由 URL 驱动注入，非 DeepSeek 供应商自动跳过
      extraBody: llmBaseUrl.includes("deepseek") ? { thinking: { type: "enabled" } } : undefined,
    });

  // 昔涟独立 Key + 独立 Chat 模型（不谈 reasoning，不注入 reasoning_effort）
  const cyreneKey = resolveKey(pmStore, LLM_KEY_NAMES.CYRENE, ENV_DEEPSEEK_CYRENE_API_KEY, fallbackKey);
  if (cyreneKey) llms.set(LLM_KEY_NAMES.CYRENE, adapter(cyreneKey, "cyrene", llmCyreneChatModel));

  // Chat 池 Key（通用 Chat 模型，不注入 reasoning_effort——会破坏 function calling）
  const chatKey = resolveKey(pmStore, LLM_KEY_NAMES.CHAT, ENV_DEEPSEEK_CHAT_API_KEY, fallbackKey);
  if (chatKey) llms.set(LLM_KEY_NAMES.CHAT, adapter(chatKey, "chat"));

  // Reasoner Key——仅此路注入 reasoning_effort
  const reasonerKey = resolveKey(pmStore, LLM_KEY_NAMES.REASONER, ENV_DEEPSEEK_REASONER_API_KEY, fallbackKey);
  if (reasonerKey) llms.set(LLM_KEY_NAMES.REASONER, adapter(reasonerKey, "reasoner", undefined, { reasoningEffort: llmReasoningEffort }));

  return llms;
}

/** 检查是否有任何 API Key 可用 */
export function hasAnyLlmKey(): boolean {
  return !!(
    process.env[ENV_DEEPSEEK_API_KEY] ||
    process.env[ENV_DEEPSEEK_CYRENE_API_KEY] ||
    process.env[ENV_DEEPSEEK_CHAT_API_KEY] ||
    process.env[ENV_DEEPSEEK_REASONER_API_KEY]
  );
}

/** 启用 API 审计日志 */
export function enableLlmAudit(): void {
  if (process.env["CORTEX_API_AUDIT"] !== "0") {
    LlmAdapter.enableAudit();
  }
}
