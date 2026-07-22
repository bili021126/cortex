/**
 * 工具域 JSON Schema
 */
import type { JsonSchema } from "../loader.js";

export const TOOLS_SCHEMA: JsonSchema = {
  type: "object",
  required: [],
  properties: {},
  additionalProperties: {
    type: "object",
    required: ["category", "level"],
    properties: {
      category: { type: "string", enum: ["Read", "Write", "Search", "Shell"] },
      level: { type: "string", enum: ["L0", "L1", "L2", "L3"] },
      description: { type: "string" },
    },
  },
};
