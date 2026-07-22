/**
 * L3·Agent Manifest 域 JSON Schema
 */
import type { JsonSchema } from "../loader.js";

export const AGENT_MANIFEST_SCHEMA: JsonSchema = {
  type: "object",
  required: [],
  _message: "agent-manifests agents 必须为非空对象",
  properties: {},
  additionalProperties: {
    type: "object",
    required: ["type", "role"],
    properties: {
      type: { type: "string", minLength: 1 },
      role: { type: "string", minLength: 1 },
      model: { type: "string", minLength: 1 },
      key: { type: "string", minLength: 1 },
      emoji: { type: "string" },
      maxInstances: { type: "integer", minimum: 1 },
      tags: { type: "array", items: { type: "string" } },
      toolPermissions: { type: "array", items: { type: "string" } },
      produces: { type: "array", items: { type: "string" } },
      systemPrompt: { type: "string" },
      memoryQueryStrategy: { type: "string" },
    },
  },
};
