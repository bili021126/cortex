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

import { Scheduler, TaskBoard, PipelineObserver, ConfirmGate, CLIAdapter, MemoryStore } from "@cortex/engine";
import type { EngineConfig } from "@cortex/engine";
import type { AgentType, AgentConfig } from "@cortex/shared";
import { AgentStatus } from "@cortex/shared";
import type { ConfigManager } from "./config-manager.js";

export interface BridgeContext {
  scheduler?: Scheduler;
  memoryStore?: MemoryStore;
  taskBoard?: TaskBoard;
  pipelineObserver?: PipelineObserver;
  confirmGate?: ConfirmGate;
  cliAdapter?: CLIAdapter;
  initialized: boolean;
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

/**
 * EngineBridge — 引擎组件生命周期管理器。
 */
export class EngineBridge {
  private ctx: BridgeContext = { initialized: false };
  private _pool: MiniAgentPool = new MiniAgentPool();
  private config: ConfigManager;
  private dbPath?: string;
  private engineConfig?: EngineConfig;

  constructor(config: ConfigManager, dbPath?: string, engineConfig?: EngineConfig) {
    this.config = config;
    this.dbPath = dbPath;
    this.engineConfig = engineConfig;
  }

  /** 初始化全部引擎组件（惰性，仅首次调用时创建） */
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
    // MiniAgentPool 满足接口要求。生产环境会使用 engine 的 AgentPool。
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

  /** 获取 AgentPool（MiniAgentPool 实例） */
  get agentPool(): MiniAgentPool {
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
