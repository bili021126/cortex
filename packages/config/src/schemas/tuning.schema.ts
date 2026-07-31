/**
 * L4·调参域 JSON Schema
 */
import type { JsonSchema } from "../loader.js";

export const TUNING_SCHEMA: JsonSchema = {
  type: "object",
  required: [],
  properties: {
    env: { type: "object" },
    tuning: {
      type: "object",
      properties: {
        execution: { type: "object" },
        trust: { type: "object" },
        verification: { type: "object" },
        memory: { type: "object" },
        rlm: { type: "object" },
      },
    },
  },
};
