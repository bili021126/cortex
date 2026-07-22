/**
 * @cortex/config — models.json → ModelCapabilities 解析器
 *
 * 将 models.json 注册表中的模型条目转换为 shared 层的 ModelCapabilities 接口。
 * bootstrap/llm.ts 在创建 LlmAdapter 时调用此函数注入能力声明。
 *
 * @module models-capability
 */
import type { ModelCapabilities } from "@cortex/shared";
import type { ModelEntry } from "./interfaces/model.js";

/**
 * 将 models.json 的 ModelEntry 转换为 shared 的 ModelCapabilities。
 * 字段对齐：thinking/capabilities/maxOutputTokens/contextWindow → ModelCapabilities
 */
export function resolveModelCapabilities(entry: ModelEntry): ModelCapabilities {
  const capabilitySet = new Set(entry.capabilities);
  return {
    thinking: entry.thinking,
    functionCalling: capabilitySet.has("function-calling"),
    streaming: capabilitySet.has("streaming"),
    maxOutputTokens: entry.maxOutputTokens ?? 65536,
    contextWindow: entry.contextWindow ?? 1_048_576,
  };
}
