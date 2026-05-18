// ============================================================
// @cortex/engine — bootstrapEngine() 集成入口
//
// 从 cortex-agents.json 等配置文件驱动整个引擎的启动，
// 替代所有硬编码 Agent 创建流程。
//
// 流水线：
//   factory.bootstrap() → 创建引擎组件 → 按定义创建 Agent → 注册
//
// @depends @cortex/factory（配置加载/校验/组装）
// @depends @cortex/llm（LLM 适配器）
// @depends @cortex/shared（AgentType, AgentConfig 等类型）
// ============================================================

import { bootstrap, type BootstrapResult, type AgentDefinition } from "@cortex/factory";
import { type AgentType, type AgentConfig, setAgentRegistry } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { TaskNode, MemoryQuery, Agent } from "@cortex/shared";

import { Scheduler } from "./scheduler.js";
import { TaskBoard } from "./task-board.js";
import { AgentPool } from "./agent-pool.js";
import { PipelineObserver } from "./pipeline-observer.js";
import { ConfirmGate } from "./confirm-gate.js";
import { CLIAdapter } from "./cli-adapter.js";
import { MemoryStore } from "./memory/memory-store.js";
import { Toolkit } from "./toolkit.js";
import { createAgent, type AgentFactoryConfig } from "./components/agent-factory.js";
import { MetaAgent } from "./meta-agent.js";
import { ButlerAgent } from "./agents/butler-agent.js";
import { StrategistAgent } from "./strategist-agent.js";
import { createInspectorAgent } from "./agents/inspector-agent.js";
import { createBrowserAgent } from "./agents/browser-agent.js";
import {
  codeMemoryQuery,
  reviewMemoryQuery,
  analysisMemoryQuery,
  opsMemoryQuery,
  loopMemoryQuery,
  docGovernMemoryQuery,
  apiMemoryQuery,
  dataMemoryQuery,
  fixMemoryQuery,
} from "./agents/index.js";
import type { EngineConfig } from "./config.js";

// ─── 类型 ────────────────────────────────────────────────

export interface BootstrapEngineOptions {
  /** LLM 适配器（必需） */
  llm: LlmAdapter;
  /** 工具箱（必需） */
  toolkit: Toolkit;
  /** 记忆存储（可选，提供则复用现有实例） */
  memory?: MemoryStore;
  /** 记忆数据库路径（可选，若未提供 memory 则据此创建） */
  dbPath?: string;
  /** 引擎配置（可选） */
  engineConfig?: EngineConfig;
  /** 工作区根目录（Browser/Inspector 需要） */
  workspaceRoot?: string;
}

export interface BootstrapEngineResult {
  /** 调度器 */
  scheduler: Scheduler;
  /** Agent 池 */
  pool: AgentPool;
  /** 管线观察者 */
  observer: PipelineObserver;
  /** 任务板 */
  board: TaskBoard;
  /** 确认门禁 */
  gate: ConfirmGate;
  /** CLI 适配器 */
  cliAdapter: CLIAdapter;
  /** 记忆存储 */
  memory: MemoryStore | undefined;
  /** 元 Agent（甘雨） */
  metaAgent: MetaAgent;
  /** 管家 Agent（托马） */
  butler: ButlerAgent;
  /** 战略 Agent（钟离，Core-2+ 预留） */
  strategist: StrategistAgent;
  /** 配置加载结果 */
  config: BootstrapResult;
  /** 创建的 Agent 实例（按类型索引，供外部直接访问） */
  agents: Map<string, Agent>;
}

// ─── 记忆查询策略映射 ──────────────────────────────────

type MemoryQueryFn = (node: TaskNode) => MemoryQuery;

const MEMORY_QUERY_MAP: Record<string, MemoryQueryFn> = {
  code: codeMemoryQuery,
  review: reviewMemoryQuery,
  analysis: analysisMemoryQuery,
  ops: opsMemoryQuery,
  loop: loopMemoryQuery,
  "doc-govern": docGovernMemoryQuery,
  api: apiMemoryQuery,
  data: dataMemoryQuery,
  fix: fixMemoryQuery,
};

/**
 * 从配置注入运行时 Agent 注册表（tags + toolPermissions）。
 * 调用 setAgentRegistry() 将 cortex-agents.json 中的配置推入 shared 层运行时状态。
 */
function _injectRegistryFromConfig(definitions: AgentDefinition[]): void {
  const tags: Record<string, readonly string[]> = {};
  const toolPermissions: Record<string, readonly string[]> = {};
  const allTags: string[] = [];

  for (const def of definitions) {
    if (def.tags) {
      tags[def.type] = [...def.tags];
      for (const t of def.tags) {
        if (!allTags.includes(t)) allTags.push(t);
      }
    }
    if (def.toolPermissions) {
      toolPermissions[def.type] = [...def.toolPermissions];
    }
  }

  setAgentRegistry(tags, toolPermissions, allTags);
}

/**
 * bootstrapEngine —— 从配置文件到运行时引擎的完整启动流水线。
 *
 * 这是 @cortex/engine 的唯一配置驱动启动入口。
 * 替代所有手动 createAgent() + scheduler.register() + pool.register() 的硬编码模式。
 *
 * @param projectRoot 项目根目录（包含 cortex-agents.json 等配置文件）
 * @param options 启动选项
 * @returns 组装完成的引擎组件集合
 * @throws 若配置加载或校验失败
 *
 * @example
 * ```typescript
 * const engine = await bootstrapEngine("/path/to/project", {
 *   llm: myAdapter,
 *   toolkit: myToolkit,
 *   dbPath: ".cortex/memory.db",
 * });
 * // engine.scheduler.executeAll() ...
 * ```
 */
export async function bootstrapEngine(
  projectRoot: string,
  options: BootstrapEngineOptions,
): Promise<BootstrapEngineResult> {
  // ════════════════════════════════════════════════════════
  // §1 加载配置
  // ════════════════════════════════════════════════════════
  const config = bootstrap(projectRoot);

  if (config.warnings.length > 0) {
    console.warn(
      `[bootstrapEngine] 配置警告:\n  ${config.warnings.join("\n  ")}`,
    );
  }

  // ════════════════════════════════════════════════════════
  // §2 注入运行时 Agent 注册表
  // ════════════════════════════════════════════════════════
  _injectRegistryFromConfig(config.agentDefinitions);

  // ════════════════════════════════════════════════════════
  // §3 创建引擎核心组件
  // ════════════════════════════════════════════════════════
  const observer = new PipelineObserver();

  const pool = new AgentPool();
  // 注入 observer 以启用双通道 invariant 上报
  pool.setObserver(observer);

  const gate = new ConfirmGate();
  const cliAdapter = new CLIAdapter();
  gate.setBridge(cliAdapter);

  const board = new TaskBoard();
  board.setObserver(observer);

  // ════════════════════════════════════════════════════════
  // §3 创建特殊 Agent
  // ════════════════════════════════════════════════════════

  // 3a. MetaAgent（甘雨）—— 从 JSON 配置注入 planning/replan 提示词
  const metaDef = config.agentDefinitions.find(
    (d: AgentDefinition) => d.type === "meta",
  );
  const metaAgent = new MetaAgent(
    options.llm,
    undefined,
    metaDef?.planningPrompt,
    metaDef?.replanPrompt,
  );

  // 3b. StrategistAgent（钟离）—— 从 JSON 配置注入 systemPrompt
  const strategistDef = config.agentDefinitions.find(
    (d: AgentDefinition) => d.type === "strategist",
  );
  const strategist = new StrategistAgent(
    options.llm,
    strategistDef?.systemPrompt,
  );

  // ════════════════════════════════════════════════════════
  // §4 创建 Scheduler
  // ════════════════════════════════════════════════════════
  const scheduler = new Scheduler(
    board,
    pool,
    observer,
    gate,
    metaAgent,
    options.engineConfig,
  );

  // ════════════════════════════════════════════════════════
  // §5 初始化 MemoryStore
  // ════════════════════════════════════════════════════════
  let memory = options.memory;
  if (!memory && options.dbPath) {
    memory = new MemoryStore(observer);
    await memory.init(options.dbPath);
  }

  // ════════════════════════════════════════════════════════
  // §6 按配置定义创建并注册 Agent
  // ════════════════════════════════════════════════════════
  const agents = new Map<string, Agent>();

  for (const def of config.agentDefinitions) {
    const agentType = def.type;

    // 6a. 跳过特殊 Agent（已在 §3 创建或不参与调度）
    if (agentType === "butler" || agentType === "meta") {
      continue;
    }

    // 6b. 跳过 strategist（Core-2+ 预留，不注册到 Scheduler）
    if (agentType === "strategist") {
      continue;
    }

    let agent: Agent | undefined;

    switch (agentType) {
      // ── InspectorAgent：需要前置编译事实采集 ──
      case "inspector": {
        const inspAgent = createInspectorAgent(
          options.llm,
          options.toolkit,
          memory,
          options.engineConfig,
          def.systemPrompt, // 从 JSON 配置注入 systemPrompt
        );
        if (options.workspaceRoot) {
          inspAgent.setWorkspaceRoot(options.workspaceRoot);
        }
        agent = inspAgent;
        break;
      }

      // ── BrowserAgent：需要 Playwright 集成 ──
      case "browser": {
        const brwAgent = createBrowserAgent(
          options.llm,
          options.toolkit,
          memory,
          def.systemPrompt, // 从 JSON 配置注入 systemPrompt
        );
        if (options.workspaceRoot) {
          brwAgent.setWorkspaceRoot(options.workspaceRoot);
        }
        agent = brwAgent;
        break;
      }

      // ── 标准 Agent：code / review / analysis / ops / loop /
      //    doc-govern / fix / api / data ──
      default: {
        const strategy = def.memoryQueryStrategy ?? agentType;
        const memoryQuery = MEMORY_QUERY_MAP[strategy];
        const factoryConfig: AgentFactoryConfig = {
          type: agentType as AgentType,
          systemPrompt: def.systemPrompt, // ⬅ 配置驱动，非硬编码
          memoryEnabled: memory != null,
          getMemoryQuery: memoryQuery,
        };
        agent = createAgent(factoryConfig, options.llm, options.toolkit, memory);
      }
    }

    if (agent) {
      // 注册到 Scheduler（用于任务分发）
      scheduler.register(agentType, agent, def.model);

      // 注册到 AgentPool（用于实例配额管理）
      pool.register({
        type: agentType as AgentType,
        maxInstances: def.maxInstances ?? 1,
      } as AgentConfig);

      agents.set(agentType, agent);
    }
  }

  // ════════════════════════════════════════════════════════
  // §7 创建 ButlerAgent（托马）—— 旁听管线事件
  // ════════════════════════════════════════════════════════
  const butler = new ButlerAgent(observer);

  // ════════════════════════════════════════════════════════
  // §8 返回组装结果
  // ════════════════════════════════════════════════════════
  return {
    scheduler,
    pool,
    observer,
    board,
    gate,
    cliAdapter,
    memory,
    metaAgent,
    butler,
    strategist,
    config,
    agents,
  };
}
