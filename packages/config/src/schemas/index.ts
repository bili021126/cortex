/**
 * schemas/index.ts — 全部配置域的 JSON Schema 注册表
 *
 * 每个 schema 对应的 domain name 在此集中映射。
 * 调用 validateDomainWithSchema() 时自动查找。
 */
import { MODELS_SCHEMA } from "./models.schema.js";
import { KEYS_CONTEXT_SCHEMA } from "./keys-context.schema.js";
import { AGENT_MANIFEST_SCHEMA } from "./agent-manifests.schema.js";
import { TUNING_SCHEMA } from "./tuning.schema.js";
import { TOOLS_SCHEMA } from "./tools.schema.js";
import { EVENT_ROUTING_SCHEMA } from "./event-routing.schema.js";
import { ENGINE_SCHEMA, ENGINE_PLUGINS_SCHEMA, ROUNDTABLE_SCHEMA, COGNITION_SCHEMA, DOCS_SCHEMA } from "./engine-domains.schema.js";

export {
  MODELS_SCHEMA,
  KEYS_CONTEXT_SCHEMA,
  AGENT_MANIFEST_SCHEMA,
  TUNING_SCHEMA,
  TOOLS_SCHEMA,
  EVENT_ROUTING_SCHEMA,
  ENGINE_SCHEMA,
  ENGINE_PLUGINS_SCHEMA,
  ROUNDTABLE_SCHEMA,
  COGNITION_SCHEMA,
  DOCS_SCHEMA,
};
