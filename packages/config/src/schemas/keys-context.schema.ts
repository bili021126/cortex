/**
 * L2·密钥+上下文域 JSON Schema
 */
import type { JsonSchema } from "../loader.js";

const KEY_ENTRY_SCHEMA: JsonSchema = {
  type: "object",
  required: ["label", "envVar", "modelFallback", "agents"],
  properties: {
    label: { type: "string", minLength: 1 },
    envVar: { type: "string", minLength: 1 },
    modelFallback: { type: "string", minLength: 1 },
    agents: { type: "array", items: { type: "string", minLength: 1 } },
  },
};

const CONTEXT_LIMIT_SCHEMA: JsonSchema = {
  type: "object",
  required: ["maxTokens", "description"],
  properties: {
    maxTokens: { type: "integer", minimum: 1, maximum: 200000 },
    description: { type: "string", minLength: 1 },
  },
};

export const KEYS_CONTEXT_SCHEMA: JsonSchema = {
  type: "object",
  required: ["keys", "contextLimits"],
  properties: {
    keys: { type: "object", additionalProperties: KEY_ENTRY_SCHEMA },
    contextLimits: { type: "object", additionalProperties: CONTEXT_LIMIT_SCHEMA },
  },
};
