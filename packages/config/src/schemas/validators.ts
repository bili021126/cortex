/**
 * schemas/validators.ts — 每域独立校验函数
 *
 * 对标 Zod 的 .parse() / .safeParse() 模式——
 * 每个配置域导出 validates_* / safeValidates_* 一对函数。
 *
 * 无外部依赖，直接使用 JsonSchema 类型 + validateJsonSchema 引擎。
 */
import {
  validateJsonSchema,
  type JsonSchema,
  type SchemaValidationError,
} from "../loader.js";

import { MODELS_SCHEMA } from "./models.schema.js";
import { KEYS_CONTEXT_SCHEMA } from "./keys-context.schema.js";
import { AGENT_MANIFEST_SCHEMA } from "./agent-manifests.schema.js";
import { TUNING_SCHEMA } from "./tuning.schema.js";
import { TOOLS_SCHEMA } from "./tools.schema.js";
import { EVENT_ROUTING_SCHEMA } from "./event-routing.schema.js";

/** 校验结果——throws 变体 */
function doValidate(data: unknown, schema: JsonSchema, label: string): void {
  const errors = validateJsonSchema(data, schema);
  if (errors.length > 0) {
    const detail = errors
      .slice(0, 8)
      .map((e) => `  ${e.path}: ${e.message}`)
      .join("\n");
    throw new Error(
      `${label} 校验失败 (${errors.length} 处):\n${detail}`,
    );
  }
}

/** 安全校验结果 */
interface SafeResult {
  ok: boolean;
  errors: SchemaValidationError[];
}

function safeValidate(
  data: unknown,
  schema: JsonSchema,
): SafeResult {
  const errors = validateJsonSchema(data, schema);
  return { ok: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════
// models
// ═══════════════════════════════════════════════════

export function validates_models(data: unknown): void {
  doValidate(data, MODELS_SCHEMA, "models");
}

export function safeValidates_models(data: unknown): SafeResult {
  return safeValidate(data, MODELS_SCHEMA);
}

// ═══════════════════════════════════════════════════
// keysContext
// ═══════════════════════════════════════════════════

export function validates_keysContext(data: unknown): void {
  doValidate(data, KEYS_CONTEXT_SCHEMA, "keysContext");
}

export function safeValidates_keysContext(data: unknown): SafeResult {
  return safeValidate(data, KEYS_CONTEXT_SCHEMA);
}

// ═══════════════════════════════════════════════════
// agentManifests
// ═══════════════════════════════════════════════════

export function validates_agentManifests(data: unknown): void {
  doValidate(data, AGENT_MANIFEST_SCHEMA, "agentManifests");
}

export function safeValidates_agentManifests(data: unknown): SafeResult {
  return safeValidate(data, AGENT_MANIFEST_SCHEMA);
}

// ═══════════════════════════════════════════════════
// tuning
// ═══════════════════════════════════════════════════

export function validates_tuning(data: unknown): void {
  doValidate(data, TUNING_SCHEMA, "tuning");
}

export function safeValidates_tuning(data: unknown): SafeResult {
  return safeValidate(data, TUNING_SCHEMA);
}

// ═══════════════════════════════════════════════════
// tools
// ═══════════════════════════════════════════════════

export function validates_tools(data: unknown): void {
  doValidate(data, TOOLS_SCHEMA, "tools");
}

export function safeValidates_tools(data: unknown): SafeResult {
  return safeValidate(data, TOOLS_SCHEMA);
}

// ═══════════════════════════════════════════════════
// eventRouting
// ═══════════════════════════════════════════════════

export function validates_eventRouting(data: unknown): void {
  doValidate(data, EVENT_ROUTING_SCHEMA, "eventRouting");
}

export function safeValidates_eventRouting(data: unknown): SafeResult {
  return safeValidate(data, EVENT_ROUTING_SCHEMA);
}
