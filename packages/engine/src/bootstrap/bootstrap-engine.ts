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

import type { AgentDefinition } from "./factory/index.js";
import { loadConfig, resolveCodingStandards, resolveLlm, injectRegistryFromConfig } from "./load-config.js";
import { enhancePrompts } from "./factory/loaders/agents.loader.js";
import { PromptManager } from "../core/prompt-manager.js";
import { StrategistAgent } from "../agents/strategist-agent.js";
import { ButlerAgent } from "../agents/butler-agent.js";
import { createConfirmGateAgent } from "../agents/confirm-gate-agent.js";
import type { AgentFactoryConfig } from "../execution/agent-factory.js";
// ── Core-2: 新模块 ─────────────────────────────
import { TaskRouter } from "../execution/task-router.js";
import { EnvironmentAwareRouter } from "../execution/environment-aware-router.js";
// bootstrap 层 import planning/ 为装配层正常引用（加载阶段构造引擎容器）
import { SentinelSignalFilter } from "../planning/sentinel-signal-filter.js";
import { GovernanceEventEmitter } from "../planning/governance-events.js";
import { DecisionGateBridge } from "../execution/decision-gate-bridge.js";
import { resilienceFactory } from "../execution/resilience-integration.js";
import { NotificationRuntime } from "../planning/notification-runtime.js";
import { ZeroTokenValidator } from "../execution/zero-token-validator.js";
import { NotificationPipe } from "@cortex/notification";
import type { IModelRouter } from "@cortex/scheduler";
// 集中注册：触发全部插件注册至 PluginLoader
import "../plugin/register-all.js";
import { PluginLoader, type EnginePluginLoadConfig } from "@cortex/plugin-runner";
import type { Toolkit } from "@cortex/platform";
import { preloadModel } from "@cortex/memory-store";
import { LoggingPipelineBridge, createLogger, addTransport } from "@cortex/logging";
import type { LlmAdapter } from "@cortex/llm";
import { LlmAdapter as LlmAdapterValue } from "@cortex/llm";
import { WorkerPool } from "../core/worker-pool.js";
import * as os from "node:os";
import { PipelineEventType, PipelinePriority, type IFileSystemAdapter, type IMemoryStore, type MemoryEntry, type ObservableEvent, type PipelineHandler, type ReadMode, type TaskNode } from "@cortex/shared";
import { resolveConfigDataDir, type EngineConfig } from "@cortex/config";
import { readFileSync, statSync } from "node:fs";
import { initSkillSystem } from "./init-skills.js";
import { LifecycleManager } from "../lifecycle/lifecycle-manager.js";
import { installConsoleBridge, uninstallConsoleBridge, AuditTrail, MetricCounter, SILENT_THRESHOLD, HealthCollector } from "@cortex/telemetry";
import { DegradationBoundary } from "../core/degradation-boundary.js";
import { ShutdownOrchestrator } from "../core/shutdown-orchestrator.js";

// Core-2 Batch1: AgentRegistry 引用——遍历此注册表而非 JSON
import { agentRegistry } from "../registry/agent-registry.js";
export { agentRegistry };

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
import type { ILifecycle } from "@cortex/shared";

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

  // §1.1 PromptManager —— prompt-kit 编排器接入
  //     同步加载完成后，异步增强 Agent prompt（校验 + 缓存 + 模板渲染）
  //     失败时优雅降级：保留同步加载的原始文本
  const promptManager = new PromptManager(projectRoot);
  try {
    await enhancePrompts(config.agentDefinitions, promptManager);
  } catch (e) {
    // prompt-kit 增强失败不阻断启动——使用同步加载的原始 prompt
    // G1-5: bootstrap 阶段 observer 可能未就绪，console.warn 是故意的——见 G1-5
    console.warn(`[bootstrapEngine] prompt-kit 增强失败，回退到原始 prompt: ${String(e)}`);
  }

  // §1.5 设置 Toolkit 的 workspaceRoot（路径沙箱）
  const wsRoot = options.workspaceRoot ?? projectRoot;
  options.toolkit.setWorkspaceRoot(wsRoot);

  // §2 注入运行时注册表 + 工具元数据
  injectRegistryFromConfig(config.agentDefinitions);
  const codingStandards = resolveCodingStandards(projectRoot);

  // §3 已由 plugin/register-all.js 集中注册完成全部插件注册

  // §4 从 engine-plugins.json 读取插件清单（配置驱动，不再硬编码）
  const pluginsDataDir = resolveConfigDataDir();
  let pluginsJson: { plugins: string[] };
  try {
    // 文件大小限制 10MB（配置文件上限）
    const MAX_SIZE = 10 * 1024 * 1024;
    const _stats = statSync(`${pluginsDataDir}/engine-plugins.json`);
    if (_stats.size > MAX_SIZE) {
      throw new Error(`插件清单文件过大: ${_stats.size} bytes`);
    }
    try {
      pluginsJson = JSON.parse(readFileSync(`${pluginsDataDir}/engine-plugins.json`, "utf-8")) as { plugins: string[] };
    } catch (e) {
      // G1-5: bootstrap 阶段 observer 可能未就绪，console.warn 是故意的——见 G1-5
      console.warn(`[bootstrap] engine-plugins.json 解析失败，使用最小插件集: ${e}`);
      pluginsJson = { plugins: [] };
    }
  } catch (e) {
    console.warn(`[bootstrap] engine-plugins.json 缺失或无法读取，使用最小插件集: ${e instanceof Error ? e.message : String(e)}`);
    pluginsJson = { plugins: [] };
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
      memory: options.memory,
    },
    // postInit 钩子：全部插件 init 完成后，执行跨插件织入（Scheduler 注册 Agent）
    onPostInit: async (ctx, plugins) => {
      const schedulerPlugin = plugins.get("scheduler") as SchedulerPlugin | undefined;
      if (schedulerPlugin) {
        await schedulerPlugin.registerAllAgents(ctx);
      }
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
  // §6.0a 注入 PromptManager —— MetaAgent 的 planning prompt 走声明式块组装
  metaAgent.setPromptManager(promptManager);
  const scheduler = container.get<SchedulerPlugin>("scheduler").getInstance();
  const agents = container.get<SchedulerPlugin>("scheduler").getAgents();
  const butler = container.get<SchedulerPlugin>("scheduler").getButler();

  // §6.0 ConsoleBridge —— PipelineObserver 就绪后安装，拦截裸 console
  installConsoleBridge(observer);

  // §6.0b Logging → PipelineObserver 桥接
  //     宪法 §8.1 三档映射：Warn→degraded, Error→degraded, Fatal→fatal
  const _loggingBridge = new LoggingPipelineBridge({
    emit: (event: string) => observer.emit({
      type: PipelineEventType.ErrorReported,
      priority: PipelinePriority.NORMAL,
      payload: { message: event },
      timestamp: Date.now(),
      notificationType: "FYI",
    }),
  });
  addTransport(_loggingBridge.createTransport());
  const _bootstrapLogger = createLogger("bootstrap");

  // §6.0.0a Phase 0 遥测基础设施初始化
  const auditTrail = new AuditTrail();
  const metricCounter = new MetricCounter();

  // §6.0.0b HealthCollector —— 降级健康聚合
  const healthCollector = new HealthCollector();
  DegradationBoundary.collector = healthCollector;
  // G1-5: bootstrap 阶段 observer 已就绪，注入 DegradationBoundary 使其 handle() 走 observer.emit
  DegradationBoundary._observer = observer;
  metricCounter.startPeriodicFlush(
    60_000, // 每分钟 flush 一次
    (snapshots) => {
      for (const { source, count } of snapshots) {
        if (count >= SILENT_THRESHOLD) {
          observer.emit({
            type: PipelineEventType.TeleDegradationThresholdBreached,
            priority: PipelinePriority.HIGH,
            payload: {
              timestamp: Date.now(),
              source,
              count,
              threshold: SILENT_THRESHOLD,
            },
            timestamp: Date.now(),
            notificationType: "WARNING",
          });
        }
      }
    },
  );

  // §6.0.1 LifecycleManager —— 管理非插件 ILifecycle 组件的生命周期
  const lifecycleManager = new LifecycleManager(observer);

  // §6.0.2 ShutdownOrchestrator —— 统一关闭编排
  const orchestrator = new ShutdownOrchestrator(observer);

  // ────────────────────────────────────────────────
  // §6.2 Core-2 模块接线——将独立创建的模块接入运行时
  // ────────────────────────────────────────────────

  // §6.2.1 TaskRouter —— 统一策略+模型路由
  // @layer 规划-执行层→规划-执行层：事轴路由组合
  const modelRouter = scheduler.modelRouter;
  const defaultModel = process.env["DEEPSEEK_CHAT_MODEL"] ?? "";
  const taskRouter = modelRouter
    ? new TaskRouter(modelRouter, defaultModel)
    : undefined;

  // §6.2.2 EnvironmentAwareRouter —— 环境感知模型降级
  const envRouter = new EnvironmentAwareRouter({
    modelPriority: [
      process.env["DEEPSEEK_REASONER_MODEL"] ?? "",
      process.env["DEEPSEEK_CHAT_MODEL"] ?? "",
    ].filter(Boolean),
    fallbackStrategy: "next-in-priority",
  });

  // §6.2.2a 将 TaskRouter + EnvironmentAwareRouter 组合为调度器模型路由
  //     ExecuteStep/RlmExecuteStep 执行前自动走路由 → 环境感知降级
  // @layer 规划-执行层→规划-执行层：模型路由注入
  if (taskRouter) {
    const compositeRouter: IModelRouter = {
      name: "core-2-composite",
      route: async (node, agentType, _defaultModel) => {
        const decision = await taskRouter.route(node as TaskNode, agentType as string);
        return await envRouter.resolve(decision.model, node as TaskNode);
      },
    };
    scheduler.setModelRouter(compositeRouter);
  }

  // §6.2.3 SentinelSignalFilter —— 哨兵信号分层
  const sentinelFilter = new SentinelSignalFilter({
    deduplicationWindowMs: 5000,
    l3SampleRate: 0.1,
    alertStormThreshold: 10,
  });
  // 订阅 CRITICAL 事件到哨兵，过滤后仅 alert 级别记录遥测
  // @layer 治理层（观察者）→ 治理层：哨兵订阅 CRITICAL 事件
  const sentinelHandler = (event: ObservableEvent): void => {
    const signal = sentinelFilter.filter(event);
    if (signal?.suggestedAction === "alert") {
      void import("@cortex/telemetry").then(({ recordTelemetry }) =>
        recordTelemetry("sentinel.alert", 1, [
          { key: "level", value: signal.level },
          { key: "aggregationKey", value: signal.aggregationKey },
        ]),
      ).catch(err => process.stderr.write(`[bootstrap] sentinel telemetry failed: ${err instanceof Error ? err.message : String(err)}\n`));
    }
  };
  const _registeredHandlers: Array<{ priority: PipelinePriority; handler: PipelineHandler }> = [
    { priority: PipelinePriority.CRITICAL, handler: sentinelHandler },
  ];
  observer.on(PipelinePriority.CRITICAL, sentinelHandler);

  // §6.2.4 NotificationRuntime —— PipelineObserver → NotificationPipe 桥接
  // @layer 治理层→治理层：PipelineObserver → NotificationPipe 桥接
  const notificationPipe = new NotificationPipe();
  const govValidator = new ZeroTokenValidator();
  const notificationRuntime = new NotificationRuntime(observer, notificationPipe, {
    enableTelemetry: true,
    governanceValidator: govValidator,
  });
  notificationRuntime.start();

  // §6.2.5 ResiliencePolicyFactory —— 注册 LLM + 工具韧性策略
  // @role 恢复者——仅执行层调用，注册 llm-call + tool-exec 韧性策略
  resilienceFactory.registerPolicies("llm-call", {
    retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10000 },
    circuitBreaker: { threshold: 5, halfOpenAfterMs: 60000 },
    timeout: { timeoutMs: 120000 },
  });
  resilienceFactory.registerPolicies("tool-exec", {
    retry: { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 5000 },
    circuitBreaker: { threshold: 3, halfOpenAfterMs: 30000 },
    timeout: { timeoutMs: 30000 },
  });

  // §6.2.6 GovernanceEventEmitter + DecisionGateBridge
  const governanceEmitter = new GovernanceEventEmitter(observer);
  // @layer 治理层→交互层：权轴桥接
  const decisionBridge = new DecisionGateBridge(observer, gate);
  decisionBridge.start();

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

  // §7.2 创建 ConfirmGate Agent（烟绯）
  const confirmGateDefs = config.agentDefinitions.filter((d: AgentDefinition) => d.type === "confirm-gate");
  const confirmGateAgents = new Map<string, AgentFactoryConfig>();
  for (const def of confirmGateDefs) {
    confirmGateAgents.set(def.id, createConfirmGateAgent(def.systemPrompt));
  }

  // §7.1 StrategistAgent 订阅治理事件
  const strategistHandlers: Array<(event: ObservableEvent) => void> = [];
  for (const agent of strategists.values()) {
    const handler = (event: ObservableEvent) => agent.onGovernanceEvent(event);
    observer.on(PipelinePriority.HIGH, handler);
    strategistHandlers.push(handler);
    _registeredHandlers.push({ priority: PipelinePriority.HIGH, handler });
  }

  // §8 确认门接线——Toolkit 需要 ConfirmGate
  options.toolkit.setGate(gate);
  options.toolkit.setObserver(observer);

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

  // §9.5 WorkerPool —— CPU 密集型操作（JSON 解析）走独立线程
  //        解除对主事件循环的阻塞，防止 Agent 排队超时永不触发
  const workerPool = new WorkerPool({ maxWorkers: Math.max(1, os.cpus().length - 1) });
  LlmAdapterValue.setWorkerPool(workerPool);

  // §9.5.1 注册 ILifecycle 组件到 ShutdownOrchestrator
  //     memory（MemoryStore）实现 ILifecycle，参与统一关闭编排
  if (memory && typeof (memory as unknown as ILifecycle).stop === 'function') {
    orchestrator.register("memory", memory as unknown as ILifecycle);
  }

  // §9.6 发射启动完成事件
  observer.emit({
    type: PipelineEventType.ExecLifecyclePhaseChanged,
    priority: PipelinePriority.NORMAL,
    payload: {
      from: "uninitialized",
      to: "running",
      phase: "bootstrap_done",
    },
    timestamp: Date.now(),
    notificationType: "FYI",
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
    confirmGateAgents,
    skillRegistry,
    config,
    agents,
    consistencyLayer,
    lifecycleManager,
    orchestrator,
    // Core-2 模块
    taskRouter,
    envRouter,
    sentinelFilter,
    governanceEmitter,
    decisionBridge,
    notificationRuntime,
    auditTrail,
    metricCounter,
    shutdown: async () => {
      // 先发射关闭开始事件
      observer.emit({
        type: PipelineEventType.ExecLifecyclePhaseChanged,
        priority: PipelinePriority.NORMAL,
        payload: {
          from: "running",
          to: "shutdown",
          phase: "shutdown_start",
        },
        timestamp: Date.now(),
        notificationType: "FYI",
      });
      // 先取消注册的所有 handler，防止长期运行中 handler 累积泄漏
      for (const reg of _registeredHandlers) {
        observer.off(reg.priority, reg.handler);
      }
      // Phase 0 遥测基础设施清理
      metricCounter.stop();
      auditTrail.flush();
      // ShutdownOrchestrator —— 统一关闭注册的 ILifecycle 组件
      await orchestrator.shutdown();
      // 先优雅关闭 ILifecycle 组件（兼容 LifecycleManager 管理项）
      await lifecycleManager.shutdown();
      // WorkerPool —— 终止所有 worker 线程
      workerPool.shutdown();
      // 再关闭插件容器（反向顺序 stop 各插件）
      await container.shutdown();
      // 最后卸载 ConsoleBridge，恢复原始 console
      uninstallConsoleBridge();
    },
  };
}