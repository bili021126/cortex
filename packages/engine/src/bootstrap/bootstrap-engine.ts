// ============================================================
// @cortex/engine — bootstrapEngine() 集成入口（v3.0 插件化）
//
// 原 v2.x 的硬编码装配流水线（createEngineCore / createSpecialAgents /
// createScheduler / initMemoryStore / initConsistencyLayer /
// registerAgents / initSkillSystem）已退化为 PluginLoader.load()。
//
// 流水线（简化）：
//   loadConfig → configAndInject → PluginLoader.load(plugins) → assemble
//
// @refactor v3.0 — 引擎插件化解耦
// ============================================================

import type { AgentDefinition } from "@cortex/factory";
import { loadConfig, resolveCodingStandards, resolveLlm, injectRegistryFromConfig } from "./load-config.js";
import { StrategistAgent } from "../agents/strategist-agent.js";
import { ButlerAgent } from "../agents/butler-agent.js";
// 副作用导入：触发全部插件自注册至 PluginLoader（无需调用任何函数）
import "../plugin/register-all.js";
import { PluginLoader, type EnginePluginLoadConfig } from "../plugin/plugin-loader.js";
import type { Toolkit } from "../platform/toolkit.js";
import { preloadModel } from "../memory/embedding.js";
import type { LlmAdapter } from "@cortex/llm";
import { PipelineEventType, PipelinePriority, type IFileSystemAdapter, type IMemoryStore, type MemoryEntry, type ReadMode } from "@cortex/shared";
import { resolveConfigDataDir, type EngineConfig } from "@cortex/config";
import { readFileSync } from "node:fs";
import { initSkillSystem } from "./init-skills.js";

// 插件类型引用
import type { PipelineObserverPlugin } from "../plugin/pipeline-observer.plugin.js";
import type { TaskBoardPlugin } from "../plugin/task-board.plugin.js";
import type { AgentPoolPlugin } from "../plugin/agent-pool.plugin.js";
import type { ConfirmGatePlugin } from "../plugin/confirm-gate.plugin.js";
import type { TrustModelPlugin } from "../plugin/trust-model.plugin.js";
import type { MemoryStorePlugin } from "../plugin/memory-store.plugin.js";
import type { ConsistencyLayerPlugin } from "../plugin/consistency-layer.plugin.js";
import type { MetaAgentPlugin } from "../plugin/meta-agent.plugin.js";
import type { SchedulerPlugin } from "../plugin/scheduler.plugin.js";

// 重导出外部依赖的类型
import type { BootstrapEngineResult } from "./assemble.js";

export type { BootstrapEngineResult };

export interface BootstrapEngineOptions {
  llms: Map<string, LlmAdapter>;
  toolkit: Toolkit;
  memory?: IMemoryStore;
  dbPath?: string;
  engineConfig?: EngineConfig;
  workspaceRoot?: string;
  filterRead?: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[];
  fs?: IFileSystemAdapter;
}

export { resolveLlm };

/**
 * bootstrapEngine —— 从配置文件到运行时引擎的完整启动流水线（v3.0 插件化）。
 *
 * 不再硬编码装配顺序，而是：
 *   1. 加载工厂配置（Agent 定义等）
 *   2. 注册全部插件到 PluginLoader
 *   3. PluginLoader.load() 按拓扑排序加载 → init → postInit → start
 *   4. 取出各插件实例组装 BootstrapEngineResult
 */
export async function bootstrapEngine(
  projectRoot: string,
  options: BootstrapEngineOptions,
): Promise<BootstrapEngineResult> {
  // §1 加载配置
  const config = loadConfig(projectRoot);

  // §1.5 设置 Toolkit 的 workspaceRoot（路径沙箱）
  const wsRoot = options.workspaceRoot ?? projectRoot;
  options.toolkit.setWorkspaceRoot(wsRoot);

  // §2 注入运行时注册表 + 工具元数据
  injectRegistryFromConfig(config.agentDefinitions);
  const codingStandards = resolveCodingStandards(projectRoot);

  // §3 已由 plugin/register-all.js 副作用导入完成全部插件注册

  // §4 从 engine-plugins.json 读取插件清单（配置驱动，不再硬编码）
  const pluginsDataDir = resolveConfigDataDir();
  let pluginsJson: { plugins: string[] };
  try {
    pluginsJson = JSON.parse(readFileSync(`${pluginsDataDir}/engine-plugins.json`, "utf-8")) as { plugins: string[] };
  } catch (e) {
    throw new Error(
      `[bootstrapEngine] 无法加载引擎插件清单 ${pluginsDataDir}/engine-plugins.json: ` +
      (e instanceof Error ? e.message : String(e)),
      { cause: e },
    );
  }
  const pluginConfig: EnginePluginLoadConfig = {
    plugins: pluginsJson.plugins,
    engineConfig: options.engineConfig,
    workspaceRoot: wsRoot,
    externals: {
      llms: options.llms,
      toolkit: options.toolkit,
      codingStandards,
      factoryConfig: config,
      dbPath: options.dbPath,
      fs: options.fs,
    },
  };

  // §5 加载并启动全部插件
  const loader = new PluginLoader();
  const container = await loader.load(pluginConfig);

  // §6 从插件容器中取出组件
  const observer = container.get<PipelineObserverPlugin>("pipelineObserver").getInstance();
  const board = container.get<TaskBoardPlugin>("taskBoard").getInstance();
  const pool = container.get<AgentPoolPlugin>("agentPool").getInstance();
  const gate = container.get<ConfirmGatePlugin>("confirmGate").getInstance();
  const cliAdapter = container.get<ConfirmGatePlugin>("confirmGate").getCliAdapter();
  // 信任模型可选注入——不在插件清单中时静默跳过
  if (container.has("trustModel")) {
    const trustModel = container.get<TrustModelPlugin>("trustModel").getInstance();
    gate.setTrustModel(trustModel);
  }
  const memory = container.get<MemoryStorePlugin>("memoryStore").getInstance();
  const consistencyLayer = container.get<ConsistencyLayerPlugin>("consistencyLayer").getInstance();
  const metaAgent = container.get<MetaAgentPlugin>("metaAgent").getInstance();
  const scheduler = container.get<SchedulerPlugin>("scheduler").getInstance();
  const agents = container.get<SchedulerPlugin>("scheduler").getAgents();
  const butler = container.get<SchedulerPlugin>("scheduler").getButler();

  // §6.1 技能系统初始化——不再通过插件，直接在 bootstrap 中装配
  const skillRegistry = await initSkillSystem(
    observer,
    memory,
    metaAgent,
    projectRoot,
  );

  // §7 创建 StrategistAgent（钟离 + 霜凝——Core-2 预留）
  const strategistDefs = config.agentDefinitions.filter((d: AgentDefinition) => d.type === "strategist");
  const strategists = new Map<string, StrategistAgent>();
  for (const def of strategistDefs) {
    const agent = new StrategistAgent(
      resolveLlm(options.llms, def.key),
      codingStandards ? def.systemPrompt?.replace(/%%CODING_STANDARDS%%/g, codingStandards) ?? "" : def.systemPrompt ?? "",
    );
    await agent.wakeup();
    strategists.set(def.id, agent);
  }

  // §8 确认门接线——Toolkit 需要 ConfirmGate
  options.toolkit.setGate(gate);

  // §9 ONNX 模型预热（fire-and-forget）
  preloadModel().catch((err) => {
    observer.emit({
      type: PipelineEventType.MemoryEmbeddingWarmupFailed,
      priority: PipelinePriority.HIGH,
      payload: { error: String(err instanceof Error ? err.message : err) },
      timestamp: Date.now(),
      notificationType: "WARNING",
    });
  });

  // §10 组装返回
  return {
    scheduler,
    pool,
    observer,
    board,
    gate,
    cliAdapter,
    memory,
    metaAgent,
    butler: butler ?? new ButlerAgent(observer),
    strategists,
    skillRegistry,
    config,
    agents,
    consistencyLayer,
    shutdown: () => container.shutdown(),
  };
}