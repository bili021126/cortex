// ============================================================
// @cortex/engine — bootstrapEngine() 集成入口（编排层）
//
// 流水线（组合工厂模式，各步骤已拆至 ./bootstrap/）：
//   loadConfig → configAndInject → createEngineCore → createSpecialAgents
//   → createScheduler → initMemoryStore → initConsistencyLayer
//   → registerAgents → initSkillSystem → assemble
//
// @refactor v2.2 — 原 492 行单体拆为 7 文件，本文件退化为 ~50 行编排函数。
// ============================================================

import { loadConfig, resolveCodingStandards, resolveLlm } from "./load-config.js";
import { createEngineCore, createSpecialAgents, configAndInject, createScheduler } from "./create-core.js";
import { initMemoryStore, initConsistencyLayer } from "./init-memory.js";
import type { ConsistencyLayerResult } from "./init-memory.js";
import { registerAgents } from "./register-agents.js";
import { initSkillSystem } from "./init-skills.js";
import { assemble } from "./assemble.js";
import type { BootstrapEngineResult } from "./assemble.js";
import type { Toolkit } from "../platform/toolkit.js";
import { preloadModel } from "../memory/embedding.js";
import type { LlmAdapter } from "@cortex/llm";
import type { MemoryEntry, IMemoryStore, IFileSystemAdapter, ReadMode } from "@cortex/shared";
import type { EngineConfig } from "@cortex/config";

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

export type { BootstrapEngineResult };
export { resolveLlm };

/**
 * bootstrapEngine —— 从配置文件到运行时引擎的完整启动流水线。
 * 各步骤委托给 bootstrap/ 子模块执行。
 */
export async function bootstrapEngine(
  projectRoot: string,
  options: BootstrapEngineOptions,
): Promise<BootstrapEngineResult> {
  // §1 加载配置
  const config = loadConfig(projectRoot);

  // §2 注入运行时注册表 + 工具元数据 + 编码规范
  configAndInject(config, options.toolkit);
  const codingStandards = resolveCodingStandards(projectRoot);

  // §3 创建引擎核心组件
  const { observer, pool, gate, cliAdapter, board } = createEngineCore(options.toolkit);

  // §4 创建特殊 Agent（MetaAgent + Strategist）
  const { metaAgent, strategists } = await createSpecialAgents(config, options.llms, codingStandards);

  // §5 创建 Scheduler
  const scheduler = createScheduler(board, pool, observer, metaAgent, options.engineConfig);

  // §6 初始化 MemoryStore
  const memory = await initMemoryStore(observer, options.memory, options.dbPath);

  // §7 初始化 ConsistencyLayer
  const clResult: ConsistencyLayerResult | undefined = await initConsistencyLayer(memory, projectRoot, options.fs, options.filterRead);
  const consistencyLayer = clResult?.layer;
  const filterRead = clResult?.filterRead ?? options.filterRead;

  // §8 按配置定义创建并注册 Agent
  const agents = registerAgents(config, {
    llms: options.llms,
    toolkit: options.toolkit,
    scheduler,
    pool,
    memory,
    codingStandards,
    workspaceRoot: options.workspaceRoot,
    filterRead,
    engineConfig: options.engineConfig,
  });

  // §9 初始化技能系统（注入 web_search 用于知识事实认证）
  const { skillRegistry, skillExecutor } = await initSkillSystem(
    observer, memory, scheduler, metaAgent, projectRoot,
    (query, max) => options.toolkit.search(query, max),
  );

  // §9.5 ONNX 模型预热（fire-and-forget，不阻塞启动）
  preloadModel().catch((err) => {
    observer.emit({
      type: "memory_embedding_warmup_failed" as any,
      priority: 1 as any,
      payload: { error: String(err instanceof Error ? err.message : err) },
      timestamp: Date.now(),
      notificationType: "WARNING" as any,
    });
  });

  // §10 组装返回
  return assemble({
    scheduler, pool, observer, board, gate, cliAdapter,
    memory, metaAgent, strategists,
    skillRegistry, skillExecutor, config, agents, consistencyLayer,
  });
}
