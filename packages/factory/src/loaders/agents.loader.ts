// ============================================================
// @cortex/factory — Agent 配置加载器
//
// 读取 cortex-agents.json，解析为 AgentDefinition[]。
// 顺带校验每个字段的完整性。
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";
import type { CortexAgentsConfig, AgentDefinition } from "../types.js";

/**
 * 加载 cortex-agents.json。
 * @param projectRoot 项目根目录
 * @returns 解析后的配置
 * @throws 若文件不存在、JSON 解析失败、或必填字段缺失
 */
export function loadAgentsConfig(projectRoot: string): CortexAgentsConfig {
  const filePath = path.join(projectRoot, "cortex-agents.json");

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `cortex-agents.json 不存在: ${filePath}。请确保项目根目录下有该配置文件。`,
    );
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    throw new Error(`读取 cortex-agents.json 失败: ${String(e)}`, { cause: e });
  }

  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    throw new Error(`cortex-agents.json JSON 解析失败: ${String(e)}`, { cause: e });
  }

  const validated = _validateStructure(config as CortexAgentsConfig);
  _resolvePromptFiles(validated, projectRoot);
  return validated;
}

/** 校验基本结构 */
function _validateStructure(config: CortexAgentsConfig): CortexAgentsConfig {
  if (!config || typeof config !== "object") {
    throw new Error("cortex-agents.json: 顶层必须为对象");
  }

  if (!config.agents || typeof config.agents !== "object") {
    throw new Error("cortex-agents.json: 缺少 agents 字段");
  }

  if (!config.eventRouting || typeof config.eventRouting !== "object") {
    throw new Error("cortex-agents.json: 缺少 eventRouting 字段");
  }

  // 校验每个 Agent 定义
  for (const [id, agent] of Object.entries(config.agents)) {
    _validateAgent(id, agent as AgentDefinition);
  }

  // 校验 eventRouting
  if (!config.eventRouting.routeTable || typeof config.eventRouting.routeTable !== "object") {
    throw new Error("cortex-agents.json: eventRouting 缺少 routeTable");
  }

  return config;
}

/** 校验单个 Agent 定义 */
function _validateAgent(id: string, agent: AgentDefinition): void {
  const prefix = `cortex-agents.json → agents.${id}`;

  if (!agent.type) {
    throw new Error(`${prefix}: 缺少 type`);
  }
  if (!agent.role) {
    throw new Error(`${prefix}: 缺少 role`);
  }
  if (!agent.systemPrompt && !agent.systemPromptFile) {
    throw new Error(`${prefix}: 缺少 systemPrompt 或 systemPromptFile`);
  }
  if (!Array.isArray(agent.produces)) {
    throw new Error(`${prefix}: produces 必须为数组`);
  }
  if (!agent.model) {
    throw new Error(`${prefix}: 缺少 model`);
  }
  if (!agent.key) {
    throw new Error(`${prefix}: 缺少 key`);
  }

  // 校验可选数组字段
  if (agent.tags !== undefined && !Array.isArray(agent.tags)) {
    throw new Error(`${prefix}: tags 必须为数组`);
  }
  if (agent.toolPermissions !== undefined && !Array.isArray(agent.toolPermissions)) {
    throw new Error(`${prefix}: toolPermissions 必须为数组`);
  }

  // 补全 id
  agent.id = id;
}

/** 解析 prompt 文件引用，将文件内容注入到内联字段 */
function _resolvePromptFiles(config: CortexAgentsConfig, projectRoot: string): void {
  for (const [_id, agent] of Object.entries(config.agents)) {
    const a = agent as AgentDefinition;

    // systemPrompt
    if (a.systemPromptFile) {
      a.systemPrompt = _readPromptFile(projectRoot, a.systemPromptFile);
    }

    // roundtable personaPrompt
    if (a.roundtable?.personaPromptFile) {
      a.roundtable.personaPrompt = _readPromptFile(projectRoot, a.roundtable.personaPromptFile);
    }

    // planningPrompt
    if (a.planningPromptFile) {
      a.planningPrompt = _readPromptFile(projectRoot, a.planningPromptFile);
    }

    // replanPrompt
    if (a.replanPromptFile) {
      a.replanPrompt = _readPromptFile(projectRoot, a.replanPromptFile);
    }
  }
}

/** 读取 prompt 文件内容 */
function _readPromptFile(projectRoot: string, filePath: string): string {
  const fullPath = path.join(projectRoot, filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Prompt 文件不存在: ${fullPath}`);
  }
  try {
    return fs.readFileSync(fullPath, "utf-8").trim();
  } catch (e) {
    throw new Error(`读取 Prompt 文件失败: ${fullPath}: ${String(e)}`, { cause: e });
  }
}
