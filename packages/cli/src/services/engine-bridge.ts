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

import {
  Scheduler, TaskBoard, AgentPool, PipelineObserver, ConfirmGate,
  CLIAdapter, MemoryStore, bootstrapEngine,
} from "@cortex/engine";
import type { EngineConfig, BootstrapEngineResult } from "@cortex/engine";
import type { AgentConfig } from "@cortex/shared";
import { AgentStatus } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import { Toolkit } from "@cortex/engine";
import type { ConfigManager } from "./config-manager.js";

export interface BridgeContext {
  scheduler?: Scheduler;
  memoryStore?: MemoryStore;
  taskBoard?: TaskBoard;
  pipelineObserver?: PipelineObserver;
  confirmGate?: ConfirmGate;
  cliAdapter?: CLIAdapter;
  initialized: boolean;
  /** 是否为配置驱动模式（bootstrapEngine 初始化） */
  bootstrapped?: boolean;
  /** bootstrapEngine 完整结果 */
  bootstrapResult?: BootstrapEngineResult;
}

/**
 * 最小 AgentPool 兼容包装。
 * 原型阶段使用简单的内存存储，模拟 AgentPool 的接口。
 */
export class MiniAgentPool {
  private configs = new Map<string, AgentConfig>();
  private instances = new Map<string, Set<string>>();
  private statuses = new Map<string, string>();

  register(config: AgentConfig): void {
    this.configs.set(config.type, config);
    if (!this.instances.has(config.type)) {
      this.instances.set(config.type, new Set());
    }
  }

  spawn(agentType: string, instanceId: string): boolean {
    const config = this.configs.get(agentType);
    if (!config) return false;
    const instances = this.instances.get(agentType)!;
    if (instances.size >= config.maxInstances) return false;
    instances.add(instanceId);
    this.statuses.set(instanceId, AgentStatus.Created);
    return true;
  }

  setStatus(instanceId: string, status: string): boolean {
    if (!this.statuses.has(instanceId)) return false;
    this.statuses.set(instanceId, status);
    return true;
  }

  getStatuses(agentType: string): string[] {
    const instances = this.instances.get(agentType);
    if (!instances) return [];
    return [...instances].map((id) => this.statuses.get(id) ?? AgentStatus.Created);
  }

  getStatus(instanceId: string): string | undefined {
    return this.statuses.get(instanceId);
  }

  hasAwake(agentType: string): boolean {
    const instances = this.instances.get(agentType);
    if (!instances) return false;
    return [...instances].some((id) => this.statuses.get(id) === AgentStatus.Awake);
  }

  destroy(agentType: string, instanceId: string): void {
    const instances = this.instances.get(agentType);
    instances?.delete(instanceId);
    this.statuses.delete(instanceId);
  }

  count(agentType: string): number {
    return this.instances.get(agentType)?.size ?? 0;
  }
}

/** Bootstrap 配置——使用 bootstrapEngine 的必需参数 */
export interface BootstrapConfig {
  llm: LlmAdapter;
  toolkit: Toolkit;
  projectRoot: string;
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
export class EngineBridge {
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
  async ensureBootstrapped(): Promise<BridgeContext> {
    if (this.ctx.bootstrapped) return this.ctx;

    if (!this._bootstrapConfig) {
      throw new Error(
        "[EngineBridge] ensureBootstrapped() 需要先调用 setBootstrapConfig() 设置 LlmAdapter/Toolkit",
      );
    }

    const { llm, toolkit, projectRoot, dbPath, engineConfig } =
      this._bootstrapConfig;

    const result = await bootstrapEngine(projectRoot, {
      llm,
      toolkit,
      dbPath: dbPath ?? this.dbPath,
      engineConfig: engineConfig ?? this.engineConfig,
      workspaceRoot: projectRoot,
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
    };

    return this.ctx;
  }

  /** 初始化全部引擎组件（轻量模式，惰性，仅首次调用时创建） */
  async ensureInitialized(): Promise<BridgeContext> {
    if (this.ctx.initialized) return this.ctx;

    // 1. PipelineObserver
    const observer = new PipelineObserver();

    // 2. CLIAdapter
    const cliAdapter = new CLIAdapter();

    // 3. ConfirmGate
    const gate = new ConfirmGate();
    gate.setBridge(cliAdapter);

    // 4. TaskBoard
    const board = new TaskBoard();
    board.setObserver(observer);

    // 5. MemoryStore
    const memory = new MemoryStore(observer);
    if (this.dbPath) {
      await memory.init(this.dbPath);
    }

    // 6. Scheduler（使用 MiniAgentPool）
    // 注意：Scheduler 构造需要 AgentPool 实例。在原型阶段，
    // MiniAgentPool 满足接口要求。
    // 配置驱动模式请使用 ensureBootstrapped()，它会用真实 AgentPool
    // 并从 cortex-agents.json 加载所有 Agent。
    const scheduler = new Scheduler(board, this._pool as any, observer, gate, undefined, this.engineConfig);

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

  /** 获取 AgentPool（轻量模式使用 MiniAgentPool，配置驱动模式使用真实 AgentPool） */
  get agentPool(): MiniAgentPool | AgentPool {
    if (this.ctx.bootstrapped && this.ctx.bootstrapResult) {
      return this.ctx.bootstrapResult.pool;
    }
    return this._pool;
  }

  async getMemoryStore(): Promise<MemoryStore> {
    const ctx = await this.ensureInitialized();
    return ctx.memoryStore!;
  }

  async getScheduler(): Promise<Scheduler> {
    const ctx = await this.ensureInitialized();
    return ctx.scheduler!;
  }

  async getTaskBoard(): Promise<TaskBoard> {
    const ctx = await this.ensureInitialized();
    return ctx.taskBoard!;
  }

  async getObserver(): Promise<PipelineObserver> {
    const ctx = await this.ensureInitialized();
    return ctx.pipelineObserver!;
  }

  async getConfirmGate(): Promise<ConfirmGate> {
    const ctx = await this.ensureInitialized();
    return ctx.confirmGate!;
  }

  async shutdown(): Promise<void> {
    if (!this.ctx.initialized) return;
    if (this.ctx.memoryStore) {
      await this.ctx.memoryStore.flush();
      await this.ctx.memoryStore.close();
    }
    if (this.ctx.cliAdapter) {
      this.ctx.cliAdapter.close();
    }
    this.ctx.initialized = false;
  }

  get isInitialized(): boolean {
    return this.ctx.initialized;
  }
}
