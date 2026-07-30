/**
 * L3·Agent Manifest 域 JSON Schema
 *
 * 验证 agent-manifests.json 的完整顶层结构：
 * {
 *   _profiles:  Record<string, AgentProfile>
 *   _tags?:     string[]
 *   agents:     Record<string, AgentManifest>
 * }
 */
import type { JsonSchema } from "../loader.js";

export const AGENT_MANIFEST_SCHEMA: JsonSchema = {
  type: "object",
  required: ["_profiles", "agents"],
  _message: "agent-manifests 必须包含 _profiles、agents 字段",
  properties: {
    _profiles: {
      type: "object",
      description: "profile 预置库",
      additionalProperties: {
        type: "object",
        required: ["model", "key"],
        properties: {
          model: { type: "string", minLength: 1 },
          key: { type: "string", minLength: 1 },
          tags: { type: "array", items: { type: "string" } },
          toolPermissions: { type: "array", items: { type: "string" } },
          memoryQueryStrategy: { type: "string" },
        },
      },
    },
    _tags: {
      type: "array",
      items: { type: "string" },
    },
    agents: {
      type: "object",
      _message: "agents 必须为对象",
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
          roundtable: {
            type: "object",
            properties: {
              title: { type: "string", minLength: 1 },
              persona: { type: "string", minLength: 1 },
            },
            required: ["title"],
          },
        },
      },
    },
  },
};
