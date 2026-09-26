/**
 * 事件架构流映射域的 JSON Schema
 *
 * 对应 data/architecture-flows.json——「五流六层 ↔ 代码落点」的单一真相源。
 * 与 layer-contract（依赖 DAG 坐标系）正交互补。
 */
import type { JsonSchema } from "../loader.js";

export const ARCHITECTURE_FLOWS_SCHEMA: JsonSchema = {
  type: "object",
  required: ["flows", "principles", "layers", "knownUnassigned"],
  properties: {
    _description: { type: "string" },
    _generatedAt: { type: "string" },
    _sources: { type: "object" },
    _knownGaps: { type: "array", items: { type: "string" } },
    flows: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "layer", "question", "directories", "principles"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          layer: { type: "string" },
          question: { type: "string" },
          directories: { type: "array", items: { type: "string" } },
          principles: { type: "array", items: { type: "string" } },
        },
      },
    },
    principles: { type: "array", items: { type: "string" } },
    layers: { type: "array", items: { type: "string" } },
    knownUnassigned: { type: "array", items: { type: "string" } },
  },
};
