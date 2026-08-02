/**
 * C2：config 第二批 5 域 JSON Schema（Draft-07 子集，与既有 schema 同风格）
 * 覆盖：mcpServers / selfExamination / crossVerification / seedMemories / governancePipeline
 * 挂载点：CONFIG_DOMAINS（loader.ts）——加载时校验生效
 * 退役域（agents / searchProviders）不挂——向后兼容，不约束
 */
import type { JsonSchema } from "../loader.js";

/** mcp-servers.json——MCP Server 配置（dataKey=servers，校验提取后的 name→定义映射） */
export const MCP_SERVERS_SCHEMA: JsonSchema = {
  type: "object",
  _message: "mcpServers 的 servers 必须为 server 名到定义的映射",
  additionalProperties: {
    type: "object",
    required: ["transport"],
    properties: {
      transport: { type: "string", enum: ["stdio", "http", "sse"] },
      command: { type: "string", minLength: 1 },
      args: { type: "array", items: { type: "string" } },
      env: { type: "object" },
      url: { type: "string" },
      enabled: { type: "boolean" },
      _desc: { type: "string" },
    },
  },
};

/** self-examination.json——自审视脚本配置（hard/soft 模式） */
export const SELF_EXAMINATION_SCHEMA: JsonSchema = {
  type: "object",
  required: ["agents"],
  _message: "self-examination 必须包含 agents.hard 与 agents.soft 数组",
  properties: {
    description: { type: "string" },
    agents: {
      type: "object",
      required: ["hard", "soft"],
      properties: {
        hard: { type: "array", items: { type: "string", minLength: 1 } },
        soft: { type: "array", items: { type: "string", minLength: 1 } },
      },
    },
  },
};

/** cross-verification.json——交叉验证配对表（dataKey=pairs，校验提取后的数组） */
export const CROSS_VERIFICATION_SCHEMA: JsonSchema = {
  type: "array",
  items: {
    type: "object",
    required: ["reporterKey", "verifierKey", "reportFilePattern"],
    properties: {
      reporterKey: { type: "string", minLength: 1 },
      reporterName: { type: "string" },
      reporterEmoji: { type: "string" },
      verifierKey: { type: "string", minLength: 1 },
      verifierName: { type: "string" },
      verifierEmoji: { type: "string" },
      reportFilePattern: { type: "string", minLength: 1 },
    },
  },
  _message: "cross-verification 必须为配对数组（reporterKey/verifierKey/reportFilePattern）",
};

/** seed-memories.json——种子记忆（dataKey=entries，校验提取后的数组） */
export const SEED_MEMORIES_SCHEMA: JsonSchema = {
  type: "array",
  items: {
    type: "object",
    required: ["summary"],
    properties: {
      summary: { type: "string", minLength: 1 },
      semantic_gist: { type: "string" },
      content_blob: { type: "object" },
      source: { type: "object" },
      domain: { type: "string" },
      kind: { type: "string" },
    },
  },
  _message: "seed-memories 必须为种子记忆数组（summary 必填）",
};

/** governance-pipeline.json——治理管线配置（阶段列表 + CI 门 + 触发条件） */
export const GOVERNANCE_PIPELINE_SCHEMA: JsonSchema = {
  type: "object",
  required: ["enabled", "stages", "ciGate", "triggers"],
  _message: "governance-pipeline 必须包含 enabled/stages/ciGate/triggers",
  properties: {
    description: { type: "string" },
    _note: { type: "string" },
    enabled: { type: "boolean" },
    stages: { type: "array", items: { type: "string", minLength: 1 } },
    ciGate: {
      type: "object",
      required: ["script", "timeoutMs", "blockOnFailure"],
      properties: {
        script: { type: "string", minLength: 1 },
        timeoutMs: { type: "integer", minimum: 0 },
        blockOnFailure: { type: "boolean" },
      },
    },
    triggers: {
      type: "object",
      properties: {
        onAmendmentProposed: { type: "boolean" },
        onSchedule: { type: "boolean" },
        onCommit: { type: "boolean" },
      },
    },
  },
};
