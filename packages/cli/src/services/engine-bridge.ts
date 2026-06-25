/**
 * engine-bridge.ts — 引擎组件惰性初始化桥接
 *
 * 管理 Scheduler、MemoryStore、TaskBoard、PipelineObserver、
 * ConfirmGate 等引擎组件的生命周期。
 *
 * AgentPool 是 engine 内部组件（非公开 API），CLI 通过
 * Scheduler 间接与其交互。对于需要直接查询 Agent 状态的
 * 命令（cortex agent list），我们直接构建最小 AgentPool 实例。
 *
 * @see CLI 设计文档 §5.2（单次模式资源管理策略）
 */

import * as path from "node:path";

import {
  type MetaAgent,
  type StrategistAgent,
  Scheduler,
  bootstrapEngine,
  type BootstrapEngineResult,
} from "@cortex/engine";
import { SlashCommandParser } from "./slash-command.js";
import type { IScheduler, ITaskBoard, IAgentPool } from "@cortex/scheduler";
import { TaskBoard, PipelineObserver, ConfirmGate } from "@cortex/scheduler";
import { CLIAdapter, type Toolkit } from "@cortex/platform";
import type { EngineConfig } from "@cortex/config";
import { MemoryStore } from "@cortex/memory-store";
import { AgentType, type ChatOptions, type ExecutionReport, type IConfirmGate, type ICortexApi, type IMemoryStore, type IPipelineObserver, type ITuiEngineBridge, type LlmMessage, type MemoryEntry, type MemoryQuery, type MemoryWriteInput, type TaskNode, type ToolDef } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";

import type { ConfigManager } from "./config-manager.js";
import { LLM_KEY_NAMES } from "@cortex/config";
import type { TuiEvent } from "@cortex/tui";

export interface BridgeContext {
  scheduler?: IScheduler;
  memoryStore?: IMemoryStore;
  taskBoard?: ITaskBoard;
  pipelineObserver?: IPipelineObserver;
  confirmGate?: ConfirmGate;
  cliAdapter?: CLIAdapter;
  initialized: boolean;
  /** 是否为配置驱动模式（bootstrapEngine 初始化） */
  bootstrapped?: boolean;
  /** bootstrapEngine 完整结果 */
  bootstrapResult?: BootstrapEngineResult;
  /** 昔涟独立记忆数据库——仅 talk 模式使用，与主 MemoryStore 物理隔离 */
  talkMemoryStore?: MemoryStore;
  /** 斜杠命令解析器（Core-2） */
  slashCommandParser?: SlashCommandParser;
}

import { MiniAgentPool } from "./mini-agent-pool.js";

/** Bootstrap 配置——使用 bootstrapEngine 的必需参数 */
export interface BootstrapConfig {
  llms: Map<string, LlmAdapter>;
  toolkit: Toolkit;
  projectRoot: string;
  /** 工作区根目录（Agent 文件操作沙箱），默认等于 projectRoot */
  workspaceRoot?: string;
  dbPath?: string;
  engineConfig?: EngineConfig;
}

/**
 * EngineBridge — 引擎组件生命周期管理器。
 *
 * 支持两种初始化模式：
 * 1. 轻量模式（ensureInitialized）—— 使用 MiniAgentPool，无 Agent 注册
 * 2. 配置驱动模式（ensureBootstrapped）—— 使用 bootstrapEngine，
 *    从 cortex-agents.json 加载所有 Agent 定义并注册
 */
export class EngineBridge implements ICortexApi, ITuiEngineBridge {
  private ctx: BridgeContext = { initialized: false };
  private _pool: MiniAgentPool = new MiniAgentPool();
  private config: ConfigManager;
  private dbPath?: string;
  private engineConfig?: EngineConfig;
  private _bootstrapConfig?: BootstrapConfig;

  constructor(config: ConfigManager, dbPath?: string, engineConfig?: EngineConfig) {
    this.config = config;
    this.dbPath = dbPath;
    this.engineConfig = engineConfig;
  }

  /**
   * 设置 Bootstrap 配置——启用配置驱动模式。
   * 必须在 ensureBootstrapped() 之前调用。
   */
  setBootstrapConfig(bootstrapConfig: BootstrapConfig): void {
    this._bootstrapConfig = bootstrapConfig;
  }

  /**
   * 配置驱动初始化——使用 bootstrapEngine 加载 cortex-agents.json
   * 等配置文件，创建所有 Agent 并注册到 Scheduler。
   *
   * 此方法完全替代硬编码 Agent 创建流程。
   * 必须先调用 setBootstrapConfig() 设置 LlmAdapter 等参数。
   */
  async ensureBootstrapped(): Promise<void> {
    await this._ensureBootstrapped();
  }

  /**
   * 以新的工作区根路径重新引导引擎。
   * 用于用户在 intent 中指定了不同的工作区路径（如 "将这个路径作为工作区 D:\\Projects\\xxx"）。
   * 只有 workspaceRoot 与当前不同时才触发实际重引导。
   */
  async rebootstrapIfNeeded(workspaceRoot: string): Promise<void> {
    if (!this._bootstrapConfig) {
      throw new Error("[EngineBridge] rebootstrap() 需要先调用 setBootstrapConfig()");
    }
    const current = path.resolve(this._bootstrapConfig.workspaceRoot ?? this._bootstrapConfig.projectRoot);
    const target = path.resolve(workspaceRoot);
    if (current === target) return;
    this.ctx.bootstrapped = false;
    this._bootstrapConfig.workspaceRoot = target;
    await this._ensureBootstrapped();
  }

  /** 兼容旧调用方——返回 BridgeContext 的具体实现 */
  private async _ensureBootstrapped(): Promise<BridgeContext> {
    if (this.ctx.bootstrapped) return this.ctx;

    if (!this._bootstrapConfig) {
      throw new Error(
        "[EngineBridge] ensureBootstrapped() 需要先调用 setBootstrapConfig() 设置 LlmAdapter/Toolkit",
      );
    }

    const { llms, toolkit, projectRoot, dbPath, engineConfig, workspaceRoot } =
      this._bootstrapConfig;

    const result = await bootstrapEngine(projectRoot, {
      llms,
      toolkit,
      dbPath: dbPath ?? this.dbPath,
      engineConfig: engineConfig ?? this.engineConfig,
      workspaceRoot: workspaceRoot ?? projectRoot,
    });

    this.ctx = {
      scheduler: result.scheduler,
      memoryStore: result.memory,
      taskBoard: result.board,
      pipelineObserver: result.observer,
      confirmGate: result.gate,
      cliAdapter: result.cliAdapter,
      initialized: true,
      bootstrapped: true,
      bootstrapResult: result,
      // Core-2: 斜杠命令解析器——从 SkillRegistry 加载
      slashCommandParser: new SlashCommandParser(result.skillRegistry),
    };

    return this.ctx;
  }

  /**
   * 获取 Bootstrap 上下文（EngineBridge 专有，不在 ICortexApi 契约中）。
   * 供 roundtable / agent / task 等命令工厂在需要访问 bootstrapResult 时使用。
   */
  async ensureBootstrappedContext(): Promise<BridgeContext> {
    return await this._ensureBootstrapped();
  }

  /** 初始化全部引擎组件（轻量模式，惰性，仅首次调用时创建） */
  async ensureInitialized(): Promise<BridgeContext> {
    if (this.ctx.initialized) return this.ctx;

    // 1. PipelineObserver
    const observer = new PipelineObserver();

    // 2. CLIAdapter
    const cliAdapter = new CLIAdapter();

    // 3. ConfirmGate（轻量模式：TTY 环境提供 stdout bridge，非 TTY 自动放行）
    const gate = new ConfirmGate();
    if (process.stdout.isTTY) {
      gate.setBridge({
        confirm: async (msg: { id: string; level: string; toolName: string; summary: string; detail?: string }) => {
          process.stdout.write(`\n⚠️  [ConfirmGate] ${msg.summary}\n`);
          process.stdout.write('   非交互模式，自动放行...\n');
          return { requestId: msg.id, approved: true };
        },
        notify: (message: string) => process.stdout.write(`[ConfirmGate] ${message}\n`),
        getPlatformContext: () => ({ kind: 'cli' as const, foreground: true, idle: false }),
      });
    }

    // 4. TaskBoard
    const board = new TaskBoard();
    board.setObserver(observer);

    // 5. MemoryStore
    const memory = new MemoryStore(undefined, observer);
    if (this.dbPath) {
      await memory.init(this.dbPath);
    }

    // 6. Scheduler（使用 MiniAgentPool）
    // 注意：Scheduler 构造需要 AgentPool 实例。在原型阶段，
    // MiniAgentPool 满足接口要求。
    // 配置驱动模式请使用 ensureBootstrapped()，它会用真实 AgentPool
    // 并从 cortex-agents.json 加载所有 Agent。
    const scheduler = new Scheduler(board, this._pool, observer, undefined, this.engineConfig);

    this.ctx = {
      scheduler,
      memoryStore: memory,
      taskBoard: board,
      pipelineObserver: observer,
      confirmGate: gate,
      cliAdapter,
      initialized: true,
    };

    return this.ctx;
  }

  /** 是否已初始化（ICortexApi.ready） */
  get ready(): boolean {
    return this.ctx.initialized;
  }

  /** 是否已 Bootstrap（ICortexApi.bootstrapped） */
  get bootstrapped(): boolean {
    return this.ctx.bootstrapped ?? false;
  }

  /** 确保引擎就绪（轻量模式，ICortexApi） */
  async ensureReady(): Promise<void> {
    await this.ensureInitialized();
  }

  /**
   * 统一对话接口（ICortexApi.chat）。
   * 等价于 directChat——不经调度器，直连 LLM。
   */
  async chat(systemPrompt: string, messages: LlmMessage[], opts?: ChatOptions): Promise<string> {
    return await this.directChat(systemPrompt, messages, opts);
  }

  /** 获取闲聊模型名（ICortexApi） */
  getChatModelName(): string {
    return this.llm?.chatModel ?? "";
  }

  /** 获取推理模型名（ICortexApi） */
  getReasonerModelName(): string {
    return this.llm?.reasonerModel ?? "";
  }

  /**
   * 获取 Agent 可用的工具定义——供 TUI queryLoop 注入 LLM function calling。
   * 若 Toolkit 未初始化（轻量模式），返回空数组。
   */
  getToolDefs(agent: AgentType): { name: string; description: string; parameters?: Record<string, unknown> }[] {
    const toolkit = this._bootstrapConfig?.toolkit;
    if (!toolkit) return [];
    return toolkit.listDefinitions(agent).map((d) => ({
      name: d.name,
      description: d.description,
      parameters: d.parameters,
    }));
  }

  /**
   * 执行工具调用——TUI 层通过此方法将 LLM 产出的 tool_call 转发到引擎 Toolkit。
   *
   * 默认以 "code" Agent 身份调用（TUI chat 模式的工具调用权限与 CodeAgent 一致）。
   */
  async executeToolCall(name: string, args: Record<string, unknown>): Promise<{ success: boolean; output: string }> {
    const toolkit = this._bootstrapConfig?.toolkit;
    if (!toolkit) {
      return { success: false, output: "Toolkit 未初始化——请通过 setBootstrapConfig() 注入 Toolkit" };
    }
    const result = await toolkit.execute({ toolName: name, params: args }, AgentType.Code);
    return { success: result.success, output: result.success ? (result.output ?? "") : (result.error ?? "未知错误") };
  }

  /**
   * 流式 LLM 对话——供 TUI queryLoop 使用。
   *
   * 通过 LlmAdapter.chatStream() 实现真正的 SSE 流式回调，
   * 每个 token chunk 即时推送给 TUI 渲染层。
   *
   * @param model 模型名
   * @param messages 完整消息列表（含 system）
   * @param tools 工具定义（可选，用于 function calling）
   * @param onChunk 每次收到文本 chunk 时回调
   * @param opts 推理选项
   * @returns LLM 完整响应
   */
  async streamChat(
    model: string,
    messages: LlmMessage[],
    tools: { name: string; description: string; parameters?: Record<string, unknown> }[] | undefined,
    onChunk: (content: string, reasoning?: string) => void,
    opts?: { reasoningEffort?: "high" | "max" },
  ): Promise<{ content: string | null; tool_calls?: { id: string; name: string; arguments: Record<string, unknown> }[]; usage?: { prompt_tokens: number; completion_tokens: number }; reasoning_content?: string }> {
    const l = this.llm;
    if (!l) throw new Error("LLM 未配置——请设置 DEEPSEEK_API_KEY 环境变量");

    return await l.chatStream(model, messages, tools as ToolDef[] | undefined, onChunk, opts?.reasoningEffort);
  }

  /** 提交任务节点到 TaskBoard（ICortexApi） */
  async submitTask(node: TaskNode): Promise<void> {
    const ctx = await (this.ctx.bootstrapped ? this._ensureBootstrapped() : this.ensureInitialized());
    if (ctx.taskBoard) {
      ctx.taskBoard.addNode(node as unknown as TaskNode);
    }
  }

  /** 执行 TaskBoard 上所有待处理节点（ICortexApi） */
  async executeAll(): Promise<ExecutionReport> {
    const scheduler = await this.getScheduler();
    return await scheduler.executeAll();
  }

  /**
   * 流式执行——将 executeAll 的结果拆解为 TUI 事件流。
   *
   * 提交节点 → 发射 node_start → await scheduler.executeAll() →
   * 发射 node_complete/node_failed 事件。
   *
   * @param nodes 要执行的任务节点列表
   * @param onEvent 事件回调——引擎每完成一个节点就调用一次
   * @returns 完整执行报告
   */
  async executeWithStream(
    nodes: TaskNode[],
    onEvent: (event: TuiEvent) => void,
  ): Promise<ExecutionReport> {
    const ctx = await (this.ctx.bootstrapped ? this._ensureBootstrapped() : this.ensureInitialized());
    const board = ctx.taskBoard;
    const scheduler = ctx.scheduler;

    if (!board || !scheduler) {
      throw new Error("[EngineBridge] executeWithStream 需要初始化的 taskBoard 和 scheduler");
    }

    // 1. 发射任务树更新事件
    onEvent({ type: "task_tree_update", nodes });

    // 2. 提交所有节点
    for (const node of nodes) {
      board.addNode(node as unknown as TaskNode);
      onEvent({
        type: "node_start",
        nodeId: node.id,
        nodeType: node.type,
        agent: (node.claimedBy?.[0] ?? "code") as AgentType,
        description: node.payload,
        parentId: node.parentId,
      });
    }

    // 3. 执行全部
    const _startMs = Date.now();
    const report = await scheduler.executeAll();

    // 4. 发射各节点完成/失败事件
    for (const result of report.results) {
      const durationMs = report.durationMs;
      if (result.success) {
        onEvent({
          type: "node_complete",
          nodeId: result.nodeId,
          agent: result.agentType ?? ("code" as AgentType),
          output: result.output ?? "",
          durationMs,
        });
      } else {
        onEvent({
          type: "node_failed",
          nodeId: result.nodeId,
          agent: result.agentType ?? ("code" as AgentType),
          error: result.error ?? "未知错误",
          durationMs,
        });
      }
    }

    return report;
  }

  /** 读取 Talk 专属记忆（ICortexApi） */
  async readTalkMemory(query: MemoryQuery): Promise<MemoryEntry[]> {
    const store = this.ctx.talkMemoryStore;
    if (!store) return [];
    return await store.read(query);
  }

  /** 写入 Talk 专属记忆（ICortexApi） */
  async writeTalkMemory(entry: MemoryWriteInput): Promise<void> {
    const store = this.ctx.talkMemoryStore;
    if (!store) return;
    await store.write(entry);
  }

  /** 只读访问主记忆库（ICortexApi，修复原 (bridge as any).ctx hack） */
  async readMainMemory(query: MemoryQuery): Promise<MemoryEntry[]> {
    const store = this.ctx.memoryStore;
    if (!store) return [];
    return await store.read(query);
  }

  /** 是否已设置 Bootstrap 配置（用于按需选择初始化模式） */
  get isBootstrapConfigured(): boolean {
    return this._bootstrapConfig !== undefined;
  }

  /** LLM 适配器（从 llms 映射中取昔涟适配器或第一个可用适配器，用于 directChat/talk） */
  private get llm(): LlmAdapter | undefined {
    const map = this._bootstrapConfig?.llms;
    if (!map || map.size === 0) return undefined;
    // 优先取昔涟适配器（talk 模式主要使用者）
    return map.get(LLM_KEY_NAMES.CYRENE) ?? map.values().next().value;
  }

  /**
   * 直接调用 LLM（绕过调度器，用于闲聊等不需要 Agent 的对话模式）。
   * 支持多轮对话——传入完整的 messages 数组（不含 system），
   * system 提示词单独传入并自动插入消息列表头部。
   * @param systemPrompt 系统提示词
   * @param messages 对话历史（user/assistant 交替，不含 system）
   * @param opts.model 可选覆盖模型名（默认使用 chatModel）
   * @param opts.reasoningEffort 推理强度（"high" | "max"），仅 reasoner 模型有效
   * @returns LLM 返回的文本内容
   */
  async directChat(
    systemPrompt: string,
    messages: LlmMessage[],
    opts?: { model?: string; reasoningEffort?: "high" | "max" },
  ): Promise<string> {
    const l = this.llm;
    if (!l) throw new Error("LLM 未配置——请设置 DEEPSEEK_API_KEY 环境变量");
    const model = opts?.model ?? l.chatModel;
    const resp = await l.chat(
      model,
      [{ role: "system", content: systemPrompt }, ...messages],
      undefined,
      opts?.reasoningEffort,
    );
    return resp.content ?? "";
  }

  /** 获取 AgentPool（轻量模式使用 MiniAgentPool，配置驱动模式使用真实 AgentPool） */
  get agentPool(): IAgentPool | MiniAgentPool {
    if (this.ctx.bootstrapped && this.ctx.bootstrapResult) {
      return this.ctx.bootstrapResult.pool;
    }
    return this._pool;
  }

  /** ICortexApi.getAgentPool() —— 返回 AgentPool 实例（管理命令用） */
  getAgentPool(): unknown {
    return this.agentPool;
  }

  async getMemoryStore(): Promise<IMemoryStore> {
    const ctx = await this.ensureInitialized();
    if (!ctx.memoryStore) throw new Error("Engine not initialized: memoryStore missing");
    return ctx.memoryStore;
  }

  async getScheduler(): Promise<IScheduler> {
    const ctx = await this.ensureInitialized();
    if (!ctx.scheduler) throw new Error("Engine not initialized: scheduler missing");
    return ctx.scheduler;
  }

  async getTaskBoard(): Promise<ITaskBoard> {
    const ctx = await this.ensureInitialized();
    if (!ctx.taskBoard) throw new Error("Engine not initialized: taskBoard missing");
    return ctx.taskBoard;
  }

  async getObserver(): Promise<IPipelineObserver> {
    const ctx = await this.ensureInitialized();
    if (!ctx.pipelineObserver) throw new Error("Engine not initialized: pipelineObserver missing");
    return ctx.pipelineObserver;
  }

  async getConfirmGate(): Promise<IConfirmGate> {
    const ctx = await this.ensureInitialized();
    if (!ctx.confirmGate) throw new Error("Engine not initialized: confirmGate missing");
    return ctx.confirmGate;
  }

  /** 获取 MetaAgent（甘雨）—— 用于 Plan Mode 生成任务计划 */
  async getMetaAgent(): Promise<MetaAgent | undefined> {
    if (this.ctx.bootstrapped && this.ctx.bootstrapResult) {
      return this.ctx.bootstrapResult.metaAgent;
    }
    // 轻量模式没有 MetaAgent
    return undefined;
  }

  /** 获取 Strategist Agent 集合（钟离+霜凝）—— 用于 agent list 等查询 */
  getStrategists(): Map<string, StrategistAgent> | undefined {
    if (this.ctx.bootstrapped && this.ctx.bootstrapResult) {
      return this.ctx.bootstrapResult.strategists;
    }
    return undefined;
  }

  /**
   * 初始化昔涟的独立记忆数据库（仅在 talk 模式下调用一次）。
   * 数据库文件：.cortex/cyrene-memory.db（已 gitignored）。
   * 与主 MemoryStore（.cortex/memory.db）物理隔离——昔涟的记忆
   * 不参与 Agent 调度、宪法治理、roundtable 辩论。
   */
  async ensureTalkMemory(): Promise<void> {
    await this._ensureTalkMemory();
  }

  /** 兼容旧调用方——返回 MemoryStore 的具体实现 */
  async _ensureTalkMemory(): Promise<MemoryStore> {
    if (this.ctx.talkMemoryStore) return this.ctx.talkMemoryStore;
    const dbPath = path.join(process.cwd(), ".cortex", "cyrene-memory.db");
    // 昔涟的记忆不需要 PipelineObserver——她不参与事件总线
    const talkStore = new MemoryStore();
    await talkStore.init(dbPath);
    this.ctx.talkMemoryStore = talkStore;
    return talkStore;
  }

  /** 暴露 talkMemoryStore 给 repl.ts（懒加载，不强制初始化） */
  private get talkMemoryStore(): MemoryStore | undefined {
    return this.ctx.talkMemoryStore;
  }

  async shutdown(): Promise<void> {
    if (!this.ctx.initialized) return;
    if (this.ctx.memoryStore) {
      try { await this.ctx.memoryStore.flush(); } catch { /* store may not be initialized */ }
      try { await this.ctx.memoryStore.close(); } catch { /* store may not be initialized */ }
    }
    if (this.ctx.talkMemoryStore) {
      try { await this.ctx.talkMemoryStore.flush(); } catch { /* store may not be initialized */ }
      try { await this.ctx.talkMemoryStore.close(); } catch { /* store may not be initialized */ }
    }
    if (this.ctx.cliAdapter) {
      this.ctx.cliAdapter.close();
    }
    this.ctx.initialized = false;
    this.ctx.bootstrapped = false;
  }

  get isInitialized(): boolean {
    return this.ctx.initialized;
  }
}
