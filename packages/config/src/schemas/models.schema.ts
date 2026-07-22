/**
 * L1·模型域 JSON Schema
 * 校验 models.json 的 models 顶层结构
 */
import type { JsonSchema } from "../loader.js";

export const MODELS_SCHEMA: JsonSchema = {
  type: "object",
  required: [],
  _message: "models 必须为非空对象（至少包含一个模型）",
  properties: {},
  additionalProperties: {
    type: "object",
    required: ["label", "thinking"],
    properties: {
      label: { type: "string", minLength: 1, _message: "模型 label 必须为非空字符串" },
      capabilities: {
        type: "array",
        items: { type: "string", enum: ["chat", "function-calling", "streaming", "thinking", "reasoning"] },
      },
      thinking: { type: "boolean" },
      defaultFor: { type: "array", items: { type: "string", minLength: 1 } },
      maxOutputTokens: { type: "integer", minimum: 1, maximum: 500000 },
      contextWindow: { type: "integer", minimum: 1, maximum: 2000000 },
    },
  },
};
