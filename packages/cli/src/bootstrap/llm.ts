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
  ENV_DEEPSEEK_GANYU_CHAT_MODEL,
  ENV_DEEPSEEK_REASONER_MODEL,
  ENV_DEEPSEEK_REASONING_EFFORT,
  ENV_DEEPSEEK_API_KEY,
  ENV_DEEPSEEK_CYRENE_API_KEY,
  ENV_DEEPSEEK_GANYU_API_KEY,
  ENV_DEEPSEEK_CHAT_API_KEY,
  ENV_DEEPSEEK_REASONER_API_KEY,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_CHAT_MODEL,
  DEFAULT_LLM_REASONER_MODEL,
  LLM_KEY_NAMES,
  resolveModelCapabilities,
  type ModelStore,
  type KeyStore,
} from "@cortex/config";
import type { ModelCapabilities } from "@cortex/shared";

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
 * 初始化 LLM 适配器三路实例（昔涟 / Chat池 / Reasoner / Ganyu）。
 *
 * 共享 baseUrl / chatModel / reasonerModel / reasoningEffort 配置，
 * 仅 API Key 按三路独立解析。
 *
 * @param keyStore 可选——从 keys-context.json 装载密钥配置
 * @param modelStore 可选——从 models.json 装载能力声明，注入 capabilities/maxTokens
 */
export async function bootstrapLlm(keyStore?: KeyStore, modelStore?: ModelStore): Promise<LlmBootstrapResult> {
  const llms = new Map<string, LlmAdapter>();

  // 共享的模型/URL 配置
  const llmBaseUrl = process.env[ENV_DEEPSEEK_BASE_URL] || DEFAULT_LLM_BASE_URL;
  const llmChatModel = process.env[ENV_DEEPSEEK_CHAT_MODEL] || DEFAULT_LLM_CHAT_MODEL;
  // 昔涟独立 Chat 模型——若未设置则回退到通用 Chat 模型
  const llmCyreneChatModel = process.env[ENV_DEEPSEEK_CYRENE_CHAT_MODEL] || llmChatModel;
  const llmReasonerModel = process.env[ENV_DEEPSEEK_REASONER_MODEL] || DEFAULT_LLM_REASONER_MODEL;
  // 甘雨独立 Chat 模型——若未设置则回退到 Reasoner 模型（MetaAgent 用 pro）
  const llmGanyuChatModel = process.env[ENV_DEEPSEEK_GANYU_CHAT_MODEL] || llmReasonerModel;
  const llmReasoningEffort = (process.env[ENV_DEEPSEEK_REASONING_EFFORT] as "high" | "max") || undefined;

  const fallbackKey = process.env[ENV_DEEPSEEK_API_KEY];

  // 从 models.json 解析模型能力声明——驱动 _shouldEnableThinking() + maxTokens
  const modelCaps = resolveModelCaps(modelStore);
  const chatCaps = modelCaps.get(llmChatModel) ?? modelCaps.get(DEFAULT_LLM_CHAT_MODEL);
  const reasonerCaps = modelCaps.get(llmReasonerModel) ?? modelCaps.get(DEFAULT_LLM_REASONER_MODEL);

  // 若设置了 PM_MASTER_KEY，尝试从 pm 加密 vault 加载密钥
  const pmStore: PmStore | undefined = undefined;

  const adapter = (key: string, label: string, chatModelOverride?: string, extra?: Partial<{ reasoningEffort: "high" | "max" }>, caps?: ModelCapabilities) =>
    new LlmAdapter({
      apiKey: key,
      baseUrl: llmBaseUrl,
      chatModel: chatModelOverride ?? llmChatModel,
      reasonerModel: llmReasonerModel,
      reasoningEffort: extra?.reasoningEffort,
      label,
      capabilities: caps,
      maxTokens: caps?.maxOutputTokens,
      // thinking 模式由 LlmAdapter._shouldEnableThinking() 基于 capabilities 自动判定
      // 不再通过 extraBody 重复注入——避免与 adapter 内部逻辑冲突
    });

  // 昔涟独立 Key + 独立 Chat 模型（不谈 reasoning，走 flash 能力）
  const cyreneKey = resolveKey(pmStore, LLM_KEY_NAMES.CYRENE, ENV_DEEPSEEK_CYRENE_API_KEY, fallbackKey);
  if (cyreneKey) llms.set(LLM_KEY_NAMES.CYRENE, adapter(cyreneKey, "cyrene", llmCyreneChatModel, undefined, chatCaps));

  // 甘雨独立 Key + 独立模型（MetaAgent 需要 reasoning + thinking，走 pro 能力）
  const ganyuKey = resolveKey(pmStore, LLM_KEY_NAMES.GANYU, ENV_DEEPSEEK_GANYU_API_KEY, fallbackKey);
  if (ganyuKey) {
    const ganyuAdapter = adapter(ganyuKey, "reasoner", llmGanyuChatModel, { reasoningEffort: llmReasoningEffort }, reasonerCaps);
    llms.set(LLM_KEY_NAMES.GANYU, ganyuAdapter);
  }

  // Chat 池 Key（通用 Chat 模型，走 flash 能力——不注入 reasoning_effort）
  const chatKey = resolveKey(pmStore, LLM_KEY_NAMES.CHAT, ENV_DEEPSEEK_CHAT_API_KEY, fallbackKey);
  if (chatKey) llms.set(LLM_KEY_NAMES.CHAT, adapter(chatKey, "chat", undefined, undefined, chatCaps));

  // Reasoner Key——仅此路注入 reasoning_effort，走 pro 能力
  const reasonerKey = resolveKey(pmStore, LLM_KEY_NAMES.REASONER, ENV_DEEPSEEK_REASONER_API_KEY, fallbackKey);
  if (reasonerKey) llms.set(LLM_KEY_NAMES.REASONER, adapter(reasonerKey, "reasoner", undefined, { reasoningEffort: llmReasoningEffort }, reasonerCaps));

  // config-driven key resolution——从 keys-context.json 装载额外密钥配置
  // 仅补充硬编码四路（CYRENE/GANYU/CHAT/REASONER）未覆盖的密钥
  const existingKeys = new Set(llms.keys());
  const configKeys = loadKeysFromConfig(keyStore, existingKeys);
  for (const [keyName, keyValue] of configKeys) {
    if (keyValue) llms.set(keyName, adapter(keyValue, "chat"));
  }

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

/**
 * 从 keys-context.json 装载密钥条目，返回 { keyName → envResolvedKey } 映射。
 * 仅读取 config 中存在但 existingKeys 未覆盖的额外密钥。
 */
function loadKeysFromConfig(keyStore: KeyStore | undefined, existingKeys: Set<string>): Map<string, string> {
  const result = new Map<string, string>();
  if (!keyStore) return result;
  try {
    const keys = keyStore.listKeys2();
    for (const [keyName, entry] of Object.entries(keys)) {
      if (!existingKeys.has(keyName)) {
        const val = process.env[entry.envVar];
        if (val) result.set(keyName, val);
      }
    }
  } catch {
    // keys-context.json 不可用时静默降级
  }
  return result;
}

/**
 * 从 models.json 解析模型能力声明——返回 { modelName → ModelCapabilities } 映射。
 * modelStore 不可用时静默降级为空 Map，adapter 回退到字符串匹配。
 */
function resolveModelCaps(modelStore?: ModelStore): Map<string, ModelCapabilities> {
  const result = new Map<string, ModelCapabilities>();
  if (!modelStore) return result;
  try {
    const models = modelStore.listModels();
    for (const [modelName, entry] of Object.entries(models)) {
      result.set(modelName, resolveModelCapabilities(entry));
    }
  } catch {
    // models.json 不可用时静默降级
  }
  return result;
}

/** 启用 API 审计日志 */
export function enableLlmAudit(): void {
  if (process.env["CORTEX_API_AUDIT"] !== "0") {
    LlmAdapter.enableAudit();
  }
}
