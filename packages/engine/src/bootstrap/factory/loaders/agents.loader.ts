// @layer 规划-执行层
// ============================================================
// @cortex/engine 内部 Bootstrap 配置流水线 · Agent 配置加载器
//（包内模块，非独立包）
//
// 从 @cortex/config 包的拆分 JSON 文件加载配置域，
// 组装为 CortexAgentsConfig，并解析 prompt 文件引用。
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveConfigDataDir, loadConfigDomain, type ConfigFileReader } from "@cortex/config";
import type { AgentManifestConfig } from "@cortex/config";
import { AgentType } from "@cortex/shared";
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

  // 1. Agent 定义（必需）——B2：agentManifests 域（L3 声明差异 + profile 展开）
  //    agent 声明仅携带差异（type/profile/key/model/tags/toolPermissions/...），
  //    完整字段由 _profiles 预置展开合并。旧 agents.json 域已退役。
  let agentsRaw: Record<string, AgentManifest>;
  try {
    const manifests = loadConfigDomain<AgentManifestConfig>(
      "agentManifests",
      readFileNode,
      dataDir,
    );
    if (!manifests) throw new Error("agentManifests 配置为空");
    agentsRaw = {};
    for (const [id, decl] of Object.entries(manifests.agents)) {
      const base = decl.profile ? manifests._profiles[decl.profile] : undefined;
      agentsRaw[id] = {
        ...(base ?? {}),
        ...decl,
        type: decl.type as AgentType,
        id,
      } as AgentManifest;
    }
  } catch (e) {
    throw new Error(`加载 agent-manifests.json 失败: ${String(e)}`, { cause: e });
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

  // 5-8. D1：自审视/交叉验证/种子记忆/治理管线四域改按需加载——
  //      当前 engine 运行时零消费（混沌审计负债 4），不再默认加载；
  //      接消费方时在调用侧 loadConfigDomain 按需获取。

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
    // D1：selfExamination/crossVerification/seedMemories/governancePipeline 按需加载——暂缺省
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
    throw new Error("agents 配置域: 顶层必须为对象");
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
  // P1-3: 校验 type 必须为 AgentType 枚举合法值（防手写字符串漂移）
  const validTypes = Object.values(AgentType) as string[];
  if (!validTypes.includes(agent.type)) {
    throw new Error(`${prefix}: type "${agent.type}" 不在 AgentType 枚举中（合法值: ${validTypes.join(", ")}）`);
  }
  if (!agent.role) {
    throw new Error(`${prefix}: 缺少 role`);
  }
  // B2：systemPrompt 不再必填——agentManifests 域允许轻量 agent（如 api/data）无提示词，
  //     由 type 声明驱动；有提示词的 agent 在 _resolvePromptFiles 阶段注入。
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
  // R12-D8：路径校验——防 ../ 逃逸出项目根（任意克隆仓库的 prompts 接管系统指令）
  const resolved = path.resolve(projectRoot, filePath);
  const rootResolved = path.resolve(projectRoot);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    throw new Error(`Prompt 文件越界（禁止读取项目根之外）: ${filePath}`);
  }
  const fullPath = resolved;
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
