/**
 * C1：engine 主路径 5 域 JSON Schema（Draft-07 子集，与既有 schema 同风格）
 * 覆盖：engine / enginePlugins / roundtable / cognition / docs
 * 挂载点：CONFIG_DOMAINS（loader.ts）——加载时校验生效
 */
import type { JsonSchema } from "../loader.js";

/** engine.json——循环上限、超时、Inspector 配置 */
export const ENGINE_SCHEMA: JsonSchema = {
  type: "object",
  required: [],
  _message: "engine 必须为对象",
  properties: {
    maxReplanPerNode: { type: "integer", minimum: 0 },
    maxTotalReplans: { type: "integer", minimum: 0 },
    // R11-08：声明 defaultMaxLoops——用户经 engine.json 调循环上限有校验（此前静默忽略）
    defaultMaxLoops: { type: "integer", minimum: 1 },
    executeAllTimeoutMs: { type: "integer", minimum: 1000 },
    reactLoopTimeoutMs: { type: "integer", minimum: 1000 },
    inspectorMaxLoops: { type: "integer", minimum: 0 },
    inspector: {
      type: "object",
      properties: {
        tscTimeout: { type: "integer", minimum: 1000 },
        testTimeout: { type: "integer", minimum: 1000 },
        vitestTimeout: { type: "integer", minimum: 1000 },
      },
    },
    toolTimeouts: {
      type: "object",
      properties: {
        searchCode: { type: "integer", minimum: 1000 },
        runShell: { type: "integer", minimum: 1000 },
        confirmWait: { type: "integer", minimum: 1000 },
        webSearch: { type: "integer", minimum: 1000 },
        webSearchRetries: { type: "integer", minimum: 0 },
        webSearchCacheTTL: { type: "integer", minimum: 0 },
      },
    },
  },
};

/** engine-plugins.json——插件加载清单（dataKey=plugins，校验提取后的数组） */
export const ENGINE_PLUGINS_SCHEMA: JsonSchema = {
  type: "array",
  items: { type: "string", minLength: 1 },
  _message: "engine-plugins 必须为插件名数组",
};

/** roundtable.json——圆桌会议模板列表（dataKey=templates，校验提取后的数组） */
export const ROUNDTABLE_SCHEMA: JsonSchema = {
  type: "array",
  items: {
    type: "object",
    required: ["name", "description", "personas", "rounds", "agents"],
    properties: {
      name: { type: "string", minLength: 1 },
      description: { type: "string" },
      personas: { type: "integer", minimum: 1 },
      rounds: { type: "integer", minimum: 1 },
      agents: { type: "array", items: { type: "string", minLength: 1 } },
      rules: { type: "array", items: { type: "string" } },
    },
  },
  _message: "roundtable 必须为模板数组",
};

/** cognition.json——Agent 激活矩阵与注意力策略 */
export const COGNITION_SCHEMA: JsonSchema = {
  type: "object",
  required: ["activationMatrix", "attention"],
  _message: "cognition 必须包含 activationMatrix 与 attention",
  properties: {
    description: { type: "string" },
    activationMatrix: {
      type: "array",
      items: {
        type: "object",
        required: ["agentType", "active"],
        properties: {
          agentType: { type: "string", minLength: 1 },
          active: { type: "boolean" },
          orientation: { type: "string" },
        },
      },
    },
    attention: {
      type: "object",
      required: ["hcaWeight", "csaWeight", "maxMemoryItems"],
      properties: {
        hcaWeight: { type: "number", minimum: 0, maximum: 1 },
        csaWeight: { type: "number", minimum: 0, maximum: 1 },
        maxMemoryItems: { type: "integer", minimum: 1 },
      },
    },
  },
};

/** docs.json——宪法路径与文档注册表 */
export const DOCS_SCHEMA: JsonSchema = {
  type: "object",
  required: ["constitutionPath", "docRegistry"],
  _message: "docs 必须包含 constitutionPath 与 docRegistry",
  properties: {
    description: { type: "string" },
    constitutionPath: { type: "string", minLength: 1 },
    docRegistry: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "type", "version", "canonical"],
        properties: {
          path: { type: "string", minLength: 1 },
          type: { type: "string", enum: ["constitution", "design", "audit", "review", "governance"] },
          version: { type: "string" },
          canonical: { type: "boolean" },
        },
      },
    },
  },
};
