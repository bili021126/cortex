// ============================================================
// @cortex/factory — Agent 配置加载器
//
// 从 @cortex/config 包的拆分 JSON 文件加载配置域，
// 组装为 CortexAgentsConfig，并解析 prompt 文件引用。
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveConfigDataDir, loadConfigDomain, type ConfigFileReader } from "@cortex/config";
import type { CortexAgentsConfig, AgentManifest } from "../types.js";

/** 基于 Node fs 的文件读取器 */
const readFileNode: ConfigFileReader = (fp: string) => fs.readFileSync(fp, "utf-8");

/**
 * 加载所有配置域（agents + eventRouting + roundtable + ...）。
 * @param projectRoot 项目根目录（用于解析 prompt 文件路径）
 * @param dataDirOverride 可选——覆盖 config data 目录路径（测试用）
 * @returns 解析后的配置
 * @throws 若必需文件缺失、JSON 解析失败、或必填字段缺失
 */
export function loadAgentsConfig(projectRoot: string, dataDirOverride?: string): CortexAgentsConfig {
  const dataDir = dataDirOverride ?? resolveConfigDataDir();

  // ── 加载各配置域 ──────────────────────────────

  // 1. Agent 定义（必需）
  let agentsRaw: Record<string, AgentManifest>;
  try {
    const loaded = loadConfigDomain<Record<string, AgentManifest>>(
      "agents",
      readFileNode,
      dataDir,
    );
    if (!loaded) throw new Error("agents 配置为空");
    agentsRaw = loaded;
  } catch (e) {
    throw new Error(`加载 agents.json 失败: ${String(e)}`, { cause: e });
  }

  // 2. 事件路由（必需）
  let eventRouting: CortexAgentsConfig["eventRouting"];
  try {
    const raw = loadConfigDomain<CortexAgentsConfig["eventRouting"]>(
      "eventRouting",
      readFileNode,
      dataDir,
    );
    if (!raw) throw new Error("eventRouting 配置为空");
    eventRouting = raw;
  } catch (e) {
    throw new Error(`加载 event-routing.json 失败: ${String(e)}`, { cause: e });
  }

  // 3. 圆桌模板（可选）
  let roundtableTemplates: CortexAgentsConfig["roundtableTemplates"];
  try {
    const raw = loadConfigDomain<CortexAgentsConfig["roundtableTemplates"]>(
      "roundtable",
      readFileNode,
      dataDir,
    );
    roundtableTemplates = raw ?? [];
  } catch (e) {
    if (typeof process !== "undefined") {
      process.stderr.write(`[agents.loader] ${e instanceof Error ? e.message : String(e)}\n`);
    }
    roundtableTemplates = [];
  }

  // 4. 搜索提供商（可选）
  let searchProviders: CortexAgentsConfig["searchProviders"];
  try {
    searchProviders = loadConfigDomain<CortexAgentsConfig["searchProviders"]>(
      "searchProviders",
      readFileNode,
      dataDir,
    );
  } catch (e) {
    if (typeof process !== "undefined") {
      process.stderr.write(`[agents.loader] ${e instanceof Error ? e.message : String(e)}\n`);
    }
    searchProviders = undefined;
  }

  // 5. 自审视（可选）
  let selfExamination: CortexAgentsConfig["selfExamination"];
  try {
    selfExamination = loadConfigDomain<CortexAgentsConfig["selfExamination"]>(
      "selfExamination",
      readFileNode,
      dataDir,
    );
  } catch (e) {
    if (typeof process !== "undefined") {
      process.stderr.write(`[agents.loader] ${e instanceof Error ? e.message : String(e)}\n`);
    }
    selfExamination = undefined;
  }

  // 6. 交叉验证（可选）
  let crossVerification: CortexAgentsConfig["crossVerification"];
  try {
    crossVerification = loadConfigDomain<CortexAgentsConfig["crossVerification"]>(
      "crossVerification",
      readFileNode,
      dataDir,
    );
  } catch (e) {
    if (typeof process !== "undefined") {
      process.stderr.write(`[agents.loader] ${e instanceof Error ? e.message : String(e)}\n`);
    }
    crossVerification = undefined;
  }

  // 7. 种子记忆（可选）
  let seedMemories: CortexAgentsConfig["seedMemories"];
  try {
    seedMemories = loadConfigDomain<CortexAgentsConfig["seedMemories"]>(
      "seedMemories",
      readFileNode,
      dataDir,
    );
  } catch (e) {
    if (typeof process !== "undefined") {
      process.stderr.write(`[agents.loader] ${e instanceof Error ? e.message : String(e)}\n`);
    }
    seedMemories = undefined;
  }

  // 8. 治理管线（可选）
  let governancePipeline: CortexAgentsConfig["governancePipeline"];
  try {
    governancePipeline = loadConfigDomain<CortexAgentsConfig["governancePipeline"]>(
      "governancePipeline",
      readFileNode,
      dataDir,
    );
  } catch (e) {
    if (typeof process !== "undefined") {
      process.stderr.write(`[agents.loader] ${e instanceof Error ? e.message : String(e)}\n`);
    }
    governancePipeline = undefined;
  }

  // 9. 工具元数据（可选）
  let tools: CortexAgentsConfig["tools"];
  try {
    const raw = loadConfigDomain<Record<string, unknown>>(
      "tools",
      readFileNode,
      dataDir,
    );
    // tools.json 的 dataKey 是 "tools"，但顶层就一个 key
    // loadConfigDomain 提取出 dataKey 后返回的是工具对象本身
    if (raw && typeof raw === "object") {
      tools = raw as Record<string, unknown>;
    }
  } catch (e) {
    if (typeof process !== "undefined") {
      process.stderr.write(`[agents.loader] ${e instanceof Error ? e.message : String(e)}\n`);
    }
    tools = undefined;
  }

  // ── 组装 ──────────────────────────────────────

  const config: CortexAgentsConfig = {
    agents: agentsRaw,
    eventRouting,
    roundtableTemplates,
    searchProviders,
    selfExamination,
    crossVerification,
    seedMemories,
    governancePipeline,
    tools,
  };

  // ── 校验 + 解析 prompt 文件 ──────────────────

  _validateStructure(config);
  _resolvePromptFiles(config, projectRoot);

  return config;
}

/** 校验基本结构 */
function _validateStructure(config: CortexAgentsConfig): CortexAgentsConfig {
  if (!config || typeof config !== "object") {
    throw new Error("cortex-agents.json: 顶层必须为对象");
  }

  if (!config.agents || typeof config.agents !== "object") {
    throw new Error("agents.json: 缺少 agents 字段");
  }

  if (!config.eventRouting || typeof config.eventRouting !== "object") {
    throw new Error("event-routing.json: 缺少 eventRouting 字段");
  }

  // 校验每个 Agent 定义
  for (const [id, agent] of Object.entries(config.agents)) {
    _validateAgent(id, agent as AgentManifest);
  }

  // 校验 eventRouting
  if (!config.eventRouting.routeTable || typeof config.eventRouting.routeTable !== "object") {
    throw new Error("event-routing.json: eventRouting 缺少 routeTable");
  }

  return config;
}

/** 校验单个 Agent 定义 */
function _validateAgent(id: string, agent: AgentManifest): void {
  const prefix = `agents.json → agents.${id}`;

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
    const a = agent as AgentManifest;

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
    // 文件大小限制 10MB（prompt 文件上限）
    const MAX_SIZE = 10 * 1024 * 1024;
    const stats = fs.statSync(fullPath);
    if (stats.size > MAX_SIZE) {
      throw new Error(`Prompt 文件过大: ${fullPath} (${stats.size} bytes, max ${MAX_SIZE})`);
    }
    return fs.readFileSync(fullPath, "utf-8").trim();
  } catch (e) {
    throw new Error(`读取 Prompt 文件失败: ${fullPath}: ${String(e)}`, { cause: e });
  }
}

// ── 异步增强（prompt-kit 接入）──────────────────────────

import type { PromptManager } from "../../../core/prompt-manager.js";

/**
 * 通过 PromptManager 异步增强 Agent prompt。
 *
 * 在 loadAgentsConfig() 同步加载完成后，由 bootstrapEngine() 异步调用。
 * 对每个 Agent 的 systemPrompt / roundtable.personaPrompt / planningPrompt / replanPrompt
 * 尝试走 PromptOrchestrator 的加载→校验→缓存管线。
 *
 * 设计要点：
 * - 不替换已有的同步文本：orchestrator 渲染结果仅作为校验和缓存层
 * - 失败时静默保留同步加载的原始文本（优雅降级）
 * - 渲染后 PromptValidator 至少检查 system prompt 非空
 */
export async function enhancePrompts(
  definitions: AgentManifest[],
  promptManager: PromptManager,
): Promise<void> {
  for (const a of definitions) {
    // systemPrompt：尝试 orchestrator 渲染 + 校验
    if (a.systemPromptFile && a.systemPrompt) {
      const rendered = await promptManager.renderAgentPrompt(a.systemPromptFile);
      if (rendered) {
        a.systemPrompt = rendered;
      }
      // 校验（不阻断，仅记录）
      promptManager.validateSystemPrompt(a.id, a.systemPrompt);
    }

    // roundtable personaPrompt
    if (a.roundtable?.personaPromptFile) {
      const rendered = await promptManager.renderAgentPrompt(a.roundtable.personaPromptFile);
      if (rendered) {
        a.roundtable.personaPrompt = rendered;
      }
    }

    // planningPrompt（MetaAgent 规划用）
    if (a.planningPromptFile) {
      const rendered = await promptManager.renderAgentPrompt(a.planningPromptFile);
      if (rendered) {
        a.planningPrompt = rendered;
      }
    }

    // replanPrompt（MetaAgent 重规划用）
    if (a.replanPromptFile) {
      const rendered = await promptManager.renderAgentPrompt(a.replanPromptFile);
      if (rendered) {
        a.replanPrompt = rendered;
      }
    }
  }
}
