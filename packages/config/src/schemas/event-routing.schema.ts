/**
 * 事件路由域 JSON Schema
 */
import type { JsonSchema } from "../loader.js";

export const EVENT_ROUTING_SCHEMA: JsonSchema = {
  type: "object",
  required: [],
  properties: {
    routeTable: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["channel"],
        properties: {
          channel: { type: "string", enum: ["urgent", "important", "routine", "silent"] },
          ackRequired: { type: "boolean" },
        },
      },
    },
    committeeRules: {
      type: "array",
      items: { type: "object" },
    },
  },
};
